// ============================================================
// 8. Real-Time Price Monitor
//    Background price monitoring for stop-loss execution.
//    Runs independently of the FSM tick to avoid analysis latency.
// ============================================================

import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import { getMarket } from "../services/market-service";
import { checkStopLoss } from "../plugins/risk-plugin";
import { closePosition } from "../services/trade-service";
import { publishFeedEvent, buildFeedEvent } from "../feed";

export interface PriceUpdate {
  marketId: string;
  yesPrice: number;
  noPrice: number;
  timestamp: number;
  source: "ws" | "poll";
}

export interface PositionMonitor {
  positionId: string;
  marketId: string;
  marketQuestion: string;
  agentId: string;
  agentName: string;
  jobId: string;
  agentWalletId: string;
  side: string;
  entryPrice: number;
  stopLossPrice: number;
  amount: number;
  ownerPubkey: string;
}

// --- Price cache key ---

function priceCacheKey(marketId: string): string {
  return `${REDIS_KEYS.AGENT_STATS_PREFIX}price:${marketId}`;
}

function monitorKey(jobId: string): string {
  return `${REDIS_KEYS.AGENT_STATS_PREFIX}monitor:${jobId}`;
}

// --- Update price in cache ---

export async function updatePriceCache(update: PriceUpdate): Promise<void> {
  await redis.setex(
    priceCacheKey(update.marketId),
    300, // 5 min TTL
    JSON.stringify(update)
  );
}

// --- Get cached price ---

export async function getCachedPrice(marketId: string): Promise<PriceUpdate | null> {
  const cached = await redis.get(priceCacheKey(marketId));
  if (!cached) return null;
  try {
    return JSON.parse(cached) as PriceUpdate;
  } catch {
    return null;
  }
}

// --- Register a position for real-time monitoring ---

export async function registerPositionForMonitoring(
  monitor: PositionMonitor
): Promise<void> {
  const key = monitorKey(monitor.jobId);
  const existing = await redis.get(key);
  const monitors: PositionMonitor[] = existing ? JSON.parse(existing) : [];
  monitors.push(monitor);
  await redis.setex(key, 7 * 24 * 3600, JSON.stringify(monitors));
}

// --- Unregister a position from monitoring ---

export async function unregisterPositionFromMonitoring(
  jobId: string,
  positionId: string
): Promise<void> {
  const key = monitorKey(jobId);
  const existing = await redis.get(key);
  if (!existing) return;
  const monitors: PositionMonitor[] = JSON.parse(existing);
  const filtered = monitors.filter((m) => m.positionId !== positionId);
  if (filtered.length > 0) {
    await redis.setex(key, 7 * 24 * 3600, JSON.stringify(filtered));
  } else {
    await redis.del(key);
  }
}

// --- Check all monitored positions for stop-loss (called from tick) ---

export async function checkMonitoredPositions(
  jobId: string,
  agentId: string,
  agentWalletId: string,
  agentName: string
): Promise<{ closedCount: number; checkedCount: number }> {
  const key = monitorKey(jobId);
  const existing = await redis.get(key);
  if (!existing) return { closedCount: 0, checkedCount: 0 };

  let monitors: PositionMonitor[];
  try {
    monitors = JSON.parse(existing) as PositionMonitor[];
  } catch {
    return { closedCount: 0, checkedCount: 0 };
  }

  let closedCount = 0;
  let checkedCount = 0;

  for (const monitor of monitors) {
    try {
      // Fetch current price
      const market = await getMarket(monitor.marketId);
      if (!market) continue;

      const outcomes = (market.outcomes ?? []) as Array<{ name: string; price: number }>;
      const yesOutcome = outcomes.find((o) => o.name?.toLowerCase() === "yes");
      const currentPrice = monitor.side === "yes"
        ? (yesOutcome?.price ?? monitor.entryPrice)
        : 1 - (yesOutcome?.price ?? monitor.entryPrice);

      // Update cache
      await updatePriceCache({
        marketId: monitor.marketId,
        yesPrice: yesOutcome?.price ?? 0.5,
        noPrice: yesOutcome ? 1 - yesOutcome.price : 0.5,
        timestamp: Date.now(),
        source: "poll",
      });

      // Check stop-loss
      const stopLossResult = checkStopLoss(
        monitor.entryPrice,
        currentPrice,
        monitor.side
      );

      checkedCount++;

      if (!stopLossResult.allowed) {
        // Execute stop-loss immediately
        const result = await closePosition({
          positionId: monitor.positionId,
          agentId,
          agentWalletId,
          reason: stopLossResult.reason ?? "Stop-loss triggered",
        });

        if (result.success) {
          closedCount++;

          await publishFeedEvent(
            buildFeedEvent({
              agentId,
              agentName,
              jobId,
              category: "position_update",
              severity: "critical",
              content: {
                summary: `REAL-TIME STOP-LOSS: ${monitor.marketId} ${monitor.side.toUpperCase()} @ $${currentPrice.toFixed(4)} (entry: $${monitor.entryPrice.toFixed(4)})`,
                action: "sell",
                pnl: result.trade
                  ? {
                      value: Number(result.trade.profitLoss ?? 0),
                      percent:
                        Number(result.trade.profitLoss ?? 0) /
                        Number(monitor.amount),
                    }
                  : undefined,
              },
              displayMessage: `🛑 REAL-TIME STOP-LOSS triggered for ${agentName}: ${monitor.side.toUpperCase()} on "${monitor.marketQuestion ?? monitor.marketId}" at $${currentPrice.toFixed(4)}`,
            })
          );

          // Remove from monitor list
          await unregisterPositionFromMonitoring(jobId, monitor.positionId);
        }
      }
    } catch (err) {
      console.error(`[PriceMonitor] Error checking position ${monitor.positionId}:`, err);
    }
  }

  return { closedCount, checkedCount };
}

// --- Poll-based price update (called every tick as fallback) ---

export async function pollPriceUpdates(
  agentWalletAddress: string,
  positions: Array<{ marketId: string; jobId: string }>
): Promise<PriceUpdate[]> {
  const updates: PriceUpdate[] = [];

  for (const pos of positions) {
    try {
      const market = await getMarket(pos.marketId);
      if (!market) continue;

      const outcomes = (market.outcomes ?? []) as Array<{ name: string; price: number }>;
      const yesOutcome = outcomes.find((o) => o.name?.toLowerCase() === "yes");

      const update: PriceUpdate = {
        marketId: pos.marketId,
        yesPrice: yesOutcome?.price ?? 0.5,
        noPrice: yesOutcome ? 1 - yesOutcome.price : 0.5,
        timestamp: Date.now(),
        source: "poll",
      };

      await updatePriceCache(update);
      updates.push(update);
    } catch {
      // Skip failed market fetches
    }
  }

  return updates;
}

// --- Background price monitor (decoupled from FSM tick) ---

const PRICE_CHECK_INTERVAL_MS = 30_000; // 30 seconds

const backgroundMonitors = new Map<string, ReturnType<typeof setInterval>>();

export function startBackgroundPriceMonitor(params: {
  jobId: string;
  agentId: string;
  agentWalletId: string;
  agentName: string;
}): void {
  const key = params.jobId;

  if (backgroundMonitors.has(key)) {
    return; // already running
  }

  const intervalId = setInterval(async () => {
    try {
      await checkMonitoredPositions(params.jobId, params.agentId, params.agentWalletId, params.agentName);
    } catch (err) {
      console.error(`[PriceMonitor] Background check failed for job ${params.jobId}:`, err instanceof Error ? err.message : String(err));
    }
  }, PRICE_CHECK_INTERVAL_MS);

  backgroundMonitors.set(key, intervalId);
  console.log(`[PriceMonitor] Started background monitor for job ${params.jobId} (interval: ${PRICE_CHECK_INTERVAL_MS}ms)`);
}

export function stopBackgroundPriceMonitor(jobId: string): void {
  const intervalId = backgroundMonitors.get(jobId);
  if (intervalId) {
    clearInterval(intervalId);
    backgroundMonitors.delete(jobId);
    console.log(`[PriceMonitor] Stopped background monitor for job ${jobId}`);
  }
}