// ============================================================
// Position Exit Monitor
// Unified monitoring for stop-loss, take-profit, market expiry,
// and market resolution. Replaces the basic price-monitor stop-loss.
// ============================================================

import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import { jupiterPredict, type JupiterMarket } from "../plugins/polymarket-plugin";
import {
  paperClosePosition,
  paperClaimPayout,
  updatePaperPositionPrices,
} from "./paper-trading";
import {
  closePosition as liveClosePosition,
} from "./trade-service";
import { publishFeedEvent, buildFeedEvent } from "../feed";

// --- Types ---

export interface ExitCheck {
  shouldExit: boolean;
  reasons: string[];
  exitPrice?: number;
  exitType: "stop_loss" | "take_profit" | "market_expiry" | "market_resolution" | "manual" | null;
}

export interface PositionMonitorConfig {
  stopLossPercent: number;
  takeProfitPercent: number;
}

// --- Check all exit conditions for a single position ---

export function checkPositionExit(
  position: {
    entryPrice: number;
    currentPrice: number;
    side: string;
    stopLossPercent: number;
    takeProfitPercent: number;
    openedAt: Date;
    expiresAt: Date | null;
  },
  marketData?: {
    status?: string;
    result?: string | null;
    closeTime?: number | string | null;
  }
): ExitCheck {
  const reasons: string[] = [];
  const exitTypes: Array<Exclude<ExitCheck["exitType"], null>> = [];

  const entryPrice = position.entryPrice;
  const currentPrice = position.currentPrice;
  const side = position.side;

  if (!entryPrice || entryPrice <= 0 || !currentPrice) {
    return { shouldExit: false, reasons: [], exitType: null };
  }

  // 1. Stop-Loss Check
  let lossPct: number;
  if (side === "yes") {
    lossPct = (entryPrice - currentPrice) / entryPrice;
  } else {
    lossPct = (currentPrice - entryPrice) / entryPrice;
  }

  if (lossPct >= position.stopLossPercent) {
    reasons.push(
      `Stop-loss triggered: ${(lossPct * 100).toFixed(1)}% loss on ${side.toUpperCase()} (limit: ${(position.stopLossPercent * 100).toFixed(0)}%)`
    );
    exitTypes.push("stop_loss");
  }

  // 2. Take-Profit Check
  let profitPct: number;
  if (side === "yes") {
    profitPct = (currentPrice - entryPrice) / entryPrice;
  } else {
    profitPct = (entryPrice - currentPrice) / entryPrice;
  }

  if (profitPct >= position.takeProfitPercent) {
    reasons.push(
      `Take-profit triggered: ${(profitPct * 100).toFixed(1)}% gain on ${side.toUpperCase()} (target: ${(position.takeProfitPercent * 100).toFixed(0)}%)`
    );
    exitTypes.push("take_profit");
  }

  // 3. Market Expiry Check
  const now = Date.now();
  const posExpiresAt = position.expiresAt ? new Date(position.expiresAt).getTime() : null;
  const marketCloseTime = marketData?.closeTime
    ? (typeof marketData.closeTime === "number" ? marketData.closeTime * 1000 : new Date(marketData.closeTime).getTime())
    : null;

  if (posExpiresAt && now > posExpiresAt) {
    reasons.push(`Position expiry reached`);
    exitTypes.push("market_expiry");
  }

  if (marketCloseTime && now > marketCloseTime) {
    reasons.push(`Market has closed`);
    exitTypes.push("market_expiry");
  }

  // 4. Market Resolution Check
  const result = marketData?.result;
  if (result && (result === "yes" || result === "no" || result === "cancelled")) {
    reasons.push(`Market resolved: ${result.toUpperCase()}`);
    exitTypes.push("market_resolution");
  }

  const shouldExit = reasons.length > 0;

  return {
    shouldExit,
    reasons,
    exitPrice: currentPrice,
    exitType: shouldExit ? exitTypes[0] : null,
  };
}

// --- Monitor all open positions for a job ---

export async function monitorJobPositions(params: {
  jobId: string;
  agentId: string;
  agentWalletId: string;
  agentName: string;
  tradingMode: "paper" | "live";
}): Promise<{
  checked: number;
  closed: number;
  claimed: number;
  exits: Array<{ positionId: string; type: string; pnl?: number }>;
}> {
  const { jobId, agentId, agentWalletId, agentName, tradingMode } = params;

  // 1. First, update all paper position prices and handle resolved/expired markets
  if (tradingMode === "paper") {
    await updatePaperPositionPrices(jobId);
  }

  // 2. Get all open positions
  const openPositions = await db
    .select()
    .from(schema.positions)
    .where(
      and(
        eq(schema.positions.jobId, jobId),
        eq(schema.positions.status, "open")
      )
    );

  let checked = 0;
  let closed = 0;
  let claimed = 0;
  const exits: Array<{ positionId: string; type: string; pnl?: number }> = [];

  for (const pos of openPositions) {
    try {
      // Fetch current market data
      let marketData: JupiterMarket | null = null;
      try {
        marketData = await jupiterPredict.getMarket(pos.marketId);
      } catch {
        console.warn(`[PositionMonitor] Could not fetch market ${pos.marketId}`);
        continue;
      }

      if (!marketData) continue;

      const currentPrice = pos.currentPrice ? Number(pos.currentPrice) : Number(pos.entryPrice);

      const exitCheck = checkPositionExit(
        {
          entryPrice: Number(pos.entryPrice),
          currentPrice,
          side: pos.side,
          stopLossPercent: Number(pos.stopLossPercent ?? 0.15),
          takeProfitPercent: Number(pos.takeProfitPercent ?? 0.20),
          openedAt: pos.openedAt ?? new Date(),
          expiresAt: pos.expiresAt,
        },
        {
          status: marketData.status ?? undefined,
          result: marketData.result ?? undefined,
          closeTime: marketData.closeTime ?? undefined,
        }
      );

      checked++;

      if (!exitCheck.shouldExit) continue;

      // Handle the exit based on type
      const isResolution = exitCheck.exitType === "market_resolution";

      if (isResolution) {
        // Market resolved — mark as claimable
        const result = marketData.result;
        await db
          .update(schema.positions)
          .set({
            status: "claimable",
            marketResult: result,
            currentPrice: result === pos.side ? "1.0" : result === "cancelled" ? String(pos.entryPrice) : "0",
            pnl: String(
              result === "cancelled"
                ? 0
                : result === pos.side
                  ? Number(pos.amount) * (1 - Number(pos.entryPrice))
                  : -Number(pos.amount) * Number(pos.entryPrice)
            ),
            claimableAt: new Date(),
            closedAt: new Date(),
          })
          .where(eq(schema.positions.id, pos.id));

        // Auto-claim for paper trading
        if (tradingMode === "paper" && pos.isPaperTrade) {
          const claimResult = await paperClaimPayout({
            jobId,
            positionId: pos.id,
            agentId,
          });

          if (claimResult.success) {
            claimed++;
            exits.push({
              positionId: pos.id,
              type: "market_resolution_claimed",
              pnl: claimResult.payout ? claimResult.payout - Number(pos.amount) * Number(pos.entryPrice) : undefined,
            });

            await publishFeedEvent(
              buildFeedEvent({
                agentId,
                agentName,
                jobId,
                category: "position_update",
                severity: "significant",
                content: {
                  action: "sell",
                  market_analyzed: pos.marketQuestion,
                  pnl: claimResult.payout
                    ? {
                        value: claimResult.payout - Number(pos.amount) * Number(pos.entryPrice),
                        percent: ((claimResult.payout - Number(pos.amount) * Number(pos.entryPrice)) / (Number(pos.amount) * Number(pos.entryPrice))) * 100,
                      }
                    : undefined,
                },
                displayMessage: `${agentName} claimed payout for "${pos.marketQuestion}" | Result: ${result?.toUpperCase()} | Payout: $${claimResult.payout?.toFixed(2)}`,
              })
            );
          }
        } else {
          // Live mode: just mark claimable, user/agent must claim manually
          exits.push({ positionId: pos.id, type: "market_resolution_claimable" });

          await publishFeedEvent(
            buildFeedEvent({
              agentId,
              agentName,
              jobId,
              category: "position_update",
              severity: "significant",
              content: {
                action: "sell",
                market_analyzed: pos.marketQuestion,
              },
              displayMessage: `${agentName} position "${pos.marketQuestion}" is now claimable | Result: ${result?.toUpperCase()}`,
            })
          );
        }
      } else {
        // Regular close (SL, TP, expiry)
        const reason = exitCheck.reasons.join("; ");

        if (tradingMode === "paper" && pos.isPaperTrade) {
          const closeResult = await paperClosePosition({
            jobId,
            positionId: pos.id,
            agentId,
            reason,
          });

          if (closeResult.success) {
            closed++;
            exits.push({
              positionId: pos.id,
              type: exitCheck.exitType ?? "unknown",
              pnl: closeResult.pnl,
            });

            await publishFeedEvent(
              buildFeedEvent({
                agentId,
                agentName,
                jobId,
                category: "position_update",
                severity: exitCheck.exitType === "stop_loss" ? "critical" : "significant",
                content: {
                  action: "sell",
                  market_analyzed: pos.marketQuestion,
                  pnl: closeResult.pnl
                    ? {
                        value: closeResult.pnl,
                        percent: (closeResult.pnl / (Number(pos.amount) * Number(pos.entryPrice))) * 100,
                      }
                    : undefined,
                },
                displayMessage: `${agentName} auto-closed "${pos.marketQuestion}" | ${exitCheck.exitType?.toUpperCase().replace("_", " ")} | PnL: $${closeResult.pnl?.toFixed(2)}`,
              })
            );
          }
        } else {
          // Live mode
          const closeResult = await liveClosePosition({
            positionId: pos.id,
            agentId,
            agentWalletId,
            reason,
          });

          if (closeResult.success) {
            closed++;
            exits.push({
              positionId: pos.id,
              type: exitCheck.exitType ?? "unknown",
              pnl: closeResult.trade ? Number(closeResult.trade.profitLoss ?? 0) : undefined,
            });
          }
        }
      }
    } catch (err) {
      console.error(`[PositionMonitor] Error monitoring position ${pos.id}:`, err);
    }
  }

  return { checked, closed, claimed, exits };
}

// --- Pre-flight position sync (run before agent starts) ---

export async function preFlightPositionSync(params: {
  jobId: string;
  agentId: string;
  agentWalletId: string;
  agentName: string;
  walletAddress: string;
  tradingMode: "paper" | "live";
}): Promise<{
  openPositionsCount: number;
  closedByExpiry: number;
  claimedByResolution: number;
}> {
  const { jobId, agentId, agentWalletId, agentName, tradingMode } = params;

  console.log(`[PreFlightSync] Starting sync for job ${jobId} (${tradingMode})`);

  // 1. Update paper position prices and auto-handle resolved markets
  if (tradingMode === "paper") {
    await updatePaperPositionPrices(jobId);
  }

  // 2. Monitor all positions for exits
  const monitorResult = await monitorJobPositions({
    jobId,
    agentId,
    agentWalletId,
    agentName,
    tradingMode,
  });

  // 3. Count remaining open positions
  const remainingOpen = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.positions)
    .where(
      and(
        eq(schema.positions.jobId, jobId),
        eq(schema.positions.status, "open")
      )
    );

  const openPositionsCount = Number(remainingOpen[0]?.count ?? 0);
  const closedByExpiry = monitorResult.exits.filter((e) => e.type === "market_expiry").length;
  const claimedByResolution = monitorResult.exits.filter((e) => e.type === "market_resolution_claimed").length;

  console.log(
    `[PreFlightSync] Complete for job ${jobId}: ` +
    `${openPositionsCount} open positions remaining, ` +
    `${closedByExpiry} closed by expiry, ` +
    `${claimedByResolution} claimed by resolution`
  );

  return { openPositionsCount, closedByExpiry, claimedByResolution };
}

// --- Background monitor (decoupled from FSM tick) ---

const MONITOR_INTERVAL_MS = 30_000; // 30 seconds

const backgroundMonitors = new Map<string, ReturnType<typeof setInterval>>();

export function startBackgroundPositionMonitor(params: {
  jobId: string;
  agentId: string;
  agentWalletId: string;
  agentName: string;
  tradingMode: "paper" | "live";
}): void {
  const key = params.jobId;

  if (backgroundMonitors.has(key)) {
    return; // already running
  }

  const intervalId = setInterval(async () => {
    try {
      await monitorJobPositions(params);
    } catch (err) {
      console.error(`[PositionMonitor] Background check failed for job ${params.jobId}:`, err instanceof Error ? err.message : String(err));
    }
  }, MONITOR_INTERVAL_MS);

  backgroundMonitors.set(key, intervalId);
  console.log(`[PositionMonitor] Started background monitor for job ${params.jobId} (interval: ${MONITOR_INTERVAL_MS}ms)`);
}

export function stopBackgroundPositionMonitor(jobId: string): void {
  const intervalId = backgroundMonitors.get(jobId);
  if (intervalId) {
    clearInterval(intervalId);
    backgroundMonitors.delete(jobId);
    console.log(`[PositionMonitor] Stopped background monitor for job ${jobId}`);
  }
}
