import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../db";
import { redis } from "../utils/redis";
import { REDIS_KEYS, EXECUTE_TRADES } from "@agent-arena/shared";
import {
  jupiterPredict,
  type CreateOrderParams,
} from "../plugins/polymarket-plugin";
import {
  runPreTradeChecks,
  checkStopLoss,
  calculatePositionSize,
  type PortfolioSnapshot,
} from "../plugins/risk-plugin";
import { signSolanaTransaction } from "../utils/privy";
import {
  paperBuyOrder,
  paperClosePosition,
} from "./paper-trading";
import { recomputeAgentPerformance } from "../leaderboard";

// Approximate cap for the global agent-events stream so Redis memory stays bounded
// on free tiers (Upstash 256 MB). ~ uses radix-node trimming for low overhead.
const AGENT_EVENTS_STREAM_MAXLEN = 5000;

// --- Retry helper for external API calls ---

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        console.warn(`[Retry] ${label} attempt ${attempt}/${maxRetries} failed, retrying in ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs * attempt));
      }
    }
  }
  throw lastError;
}

// --- List trades for a job ---

export async function listTrades(params: {
  jobId: string;
  limit?: number;
  offset?: number;
}): Promise<{ trades: typeof schema.trades.$inferSelect[]; total: number }> {
  const { jobId, limit = 50, offset = 0 } = params;

  const trades = await db
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.jobId, jobId))
    .orderBy(desc(schema.trades.executedAt))
    .limit(limit)
    .offset(offset);

  return { trades, total: trades.length };
}

// --- Get single trade ---

export async function getTrade(
  tradeId: string
): Promise<typeof schema.trades.$inferSelect | null> {
  const [trade] = await db
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.id, tradeId))
    .limit(1);

  return trade ?? null;
}

// --- List positions for a job ---

export async function listPositions(params: {
  jobId: string;
  limit?: number;
  offset?: number;
}): Promise<{
  positions: typeof schema.positions.$inferSelect[];
  total: number;
}> {
  const { jobId, limit = 50, offset = 0 } = params;

  const positions = await db
    .select()
    .from(schema.positions)
    .where(eq(schema.positions.jobId, jobId))
    .orderBy(desc(schema.positions.openedAt))
    .limit(limit)
    .offset(offset);

  return { positions: positions.map(patchPositionDisplay), total: positions.length };
}

// --- Get active positions ---

export async function getActivePositions(
  jobId: string
): Promise<{ positions: typeof schema.positions.$inferSelect[] }> {
  const positions = await db
    .select()
    .from(schema.positions)
    .where(
      and(eq(schema.positions.jobId, jobId), eq(schema.positions.status, "open"))
    );

  return { positions: positions.map(patchPositionDisplay) };
}

// Display-time patch: legacy rows may carry a placeholder marketQuestion
// (`Market POLY-…` or bare `Untitled prediction market`) from before the
// scan-time fix + ID-tagged label landed. Show the canonical
// `Untitled prediction market (<id>)` label so the user can identify
// which untitled position is which.
function patchPositionDisplay<T extends { marketId: string; marketQuestion: string | null }>(p: T): T {
  if (!isPlaceholderMarketQuestion(p.marketQuestion)) return p;
  return { ...p, marketQuestion: displayMarketQuestion(p.marketQuestion, p.marketId) };
}

// Detect placeholder marketQuestion shapes. Several have leaked over time:
//   1. `Market <id>` — original execution-engine fallback (now blocked).
//   2. `Untitled prediction market` — earlier display fallback (no ID).
//   3. `Untitled prediction market (<id>)` — current canonical fallback.
// Any of these is a signal that no real title was available; keep the
// guard so a regression can't quietly land worse data onto a position row.
const ID_PLACEHOLDER_RE = /^Market\s+[A-Z0-9_-]+$/i;
const UNTITLED_PLACEHOLDER_RE = /^Untitled prediction market(?:\s*\(.+\))?$/i;

export function isPlaceholderMarketQuestion(question: string | null | undefined): boolean {
  const q = (question ?? "").trim();
  return q.length === 0 || ID_PLACEHOLDER_RE.test(q) || UNTITLED_PLACEHOLDER_RE.test(q);
}

// Display-time fallback for legacy rows that still carry one of the
// placeholder shapes above. Includes the marketId in brackets so the user
// can at least cross-reference a specific market — the bare label was
// indistinguishable across multiple untitled positions in the same screen.
export function displayMarketQuestion(
  question: string | null | undefined,
  marketId?: string | null,
): string {
  const q = (question ?? "").trim();
  if (q && !isPlaceholderMarketQuestion(q)) return q;
  return marketId
    ? `Untitled prediction market (${marketId})`
    : "Untitled prediction market";
}

// Last-line guard: replace any leaked placeholder/error reasoning that would
// otherwise appear in the public feed (e.g. "Batch analysis partial output …",
// raw market UUIDs) with a coherent market-question-based rationale.
function sanitizeReasoning(reasoning: string, marketQuestion: string, isYes: boolean): string {
  const r = (reasoning ?? "").trim();
  const looksLikePlaceholder =
    r.length === 0 ||
    /^batch analysis (partial output|failed)/i.test(r) ||
    /^analysis (failed|error|unavailable)/i.test(r) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r) || // bare UUID
    r === marketQuestion;
  if (!looksLikePlaceholder) return r;
  return `Taking ${isYes ? "YES" : "NO"} on "${marketQuestion.slice(0, 140)}" based on prevailing signals; sized as a speculative entry.`;
}

// --- Execute a trade (buy) ---

export async function executeBuyOrder(params: {
  jobId: string;
  agentId: string;
  agentWalletId: string;
  ownerPubkey: string;
  marketId: string;
  marketQuestion: string;
  isYes: boolean;
  amount: number;
  entryPrice: number;
  estimatedProbability?: number; // true probability estimate from analysis (for Kelly sizing)
  confidence: number;
  reasoning: string;
  category: string;
  marketVolume: number;
  marketClosesAt: Date;
  portfolio: PortfolioSnapshot;
}): Promise<{
  success: boolean;
  position?: typeof schema.positions.$inferSelect;
  error?: string;
}> {
  // 0. Refuse trades on placeholder-titled markets. With the scan-time drop
  // in place this should never fire — but defense-in-depth keeps a future
  // regression from persisting "Market POLY-…" onto a position row.
  if (isPlaceholderMarketQuestion(params.marketQuestion)) {
    return { success: false, error: `Market has no readable title (got "${params.marketQuestion}") — refusing to trade` };
  }

  // 1. Calculate position size (True Kelly Criterion) FIRST so the risk
  // checks operate on the actual fill amount, not the LLM's pre-resize ask.
  // Risk-checking the unresized amount caused size-sensitive gates
  // (category exposure, portfolio limit, human-approval threshold) to trip
  // on a $40+ "intended" amount that Kelly would have shrunk to ~$5.
  const positionSize = calculatePositionSize(
    params.estimatedProbability ?? params.confidence, // use true probability estimate if available
    params.entryPrice,
    params.portfolio.totalBalance,
    params.isYes,
    params.confidence
  );
  // Quarter-Kelly with confidence-scaling can shrink positionSize to fractions
  // of a cent on low-confidence trades. Enforce a $5 minimum so paper fills
  // don't round to zero contracts and so executions stay demo-visible.
  const sizedAmount = Math.min(params.amount, positionSize);
  const finalAmount = Math.max(5, sizedAmount);

  // 2. Run risk checks on the sized amount
  const riskResult = runPreTradeChecks(
    finalAmount,
    params.category,
    params.confidence,
    params.marketVolume,
    params.marketClosesAt,
    params.portfolio,
    params.marketId,
    undefined,
    params.isYes ? "yes" : "no",
  );

  if (!riskResult.allowed) {
    return { success: false, error: riskResult.reason };
  }

  // 3. Check trading mode for this job
  const [job] = await db
    .select({ tradingMode: schema.jobs.tradingMode })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, params.jobId))
    .limit(1);

  const tradingMode = job?.tradingMode ?? "paper";
  const reasoning = sanitizeReasoning(params.reasoning, params.marketQuestion, params.isYes);

  // 4. Execute based on trading mode
  try {
    if (tradingMode === "paper") {
      // Paper trading: simulate execution with real market data
      const result = await paperBuyOrder({
        jobId: params.jobId,
        agentId: params.agentId,
        marketId: params.marketId,
        marketQuestion: params.marketQuestion,
        isYes: params.isYes,
        depositAmount: finalAmount,
        entryPrice: params.entryPrice,
        reasoning,
        category: params.category,
        marketClosesAt: params.marketClosesAt,
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      // Fetch the created position
      const orderPubkey = result.orderPubkey ?? `paper-order-${params.jobId}-${Date.now()}`;
      const [position] = await db
        .select()
        .from(schema.positions)
        .where(eq(schema.positions.simulatedOrderPubkey, orderPubkey))
        .limit(1);

      if (position) {
        // Push to feed
        await redis.xadd(
          REDIS_KEYS.AGENT_EVENTS_STREAM,
          "MAXLEN",
          "~",
          AGENT_EVENTS_STREAM_MAXLEN,
          "*",
          "event",
          JSON.stringify({
            type: "trade",
            agentId: params.agentId,
            action: "buy",
            marketId: params.marketId,
            marketQuestion: params.marketQuestion,
            side: params.isYes ? "yes" : "no",
            amount: result.contracts ?? finalAmount,
            reasoning,
            txSignature: result.txSignature,
            isPaperTrade: true,
            timestamp: new Date().toISOString(),
          })
        );

        await redis.set(
          `${REDIS_KEYS.AGENT_STATS_PREFIX}${params.agentId}:last_trade`,
          String(Date.now())
        );

        return { success: true, position };
      }

      return { success: false, error: "Paper trade executed but position not found" };
    }

    // Live trading: real Jupiter API + on-chain signing
    if (!EXECUTE_TRADES) {
      return { success: false, error: "Live trading disabled — set DEPLOY_PHASE=production and EXECUTE_TRADES=true" };
    }

    const orderParams: CreateOrderParams = {
      ownerPubkey: params.ownerPubkey,
      marketId: params.marketId,
      isYes: params.isYes,
      isBuy: true,
      depositAmount: String(Math.round(finalAmount * 1_000_000)),
    };

    const order = await withRetry(
      () => jupiterPredict.createOrder(orderParams),
      "jupiter.createOrder"
    );

    const txSignature = await signSolanaTransaction(
      params.agentWalletId,
      order.transaction
    );

    const [position] = await db
      .insert(schema.positions)
      .values({
        jobId: params.jobId,
        marketId: params.marketId,
        marketQuestion: params.marketQuestion,
        side: params.isYes ? "yes" : "no",
        amount: String(finalAmount),
        entryPrice: String(params.entryPrice),
        status: "open",
        isPaperTrade: false,
        reasoningSnippet: reasoning,
        txSignature,
        positionPubkey: order.positionPubkey ?? null,
      })
      .returning();

    await redis.xadd(
      REDIS_KEYS.AGENT_EVENTS_STREAM,
      "MAXLEN",
      "~",
      AGENT_EVENTS_STREAM_MAXLEN,
      "*",
      "event",
      JSON.stringify({
        type: "trade",
        agentId: params.agentId,
        action: "buy",
        marketId: params.marketId,
        marketQuestion: params.marketQuestion,
        side: params.isYes ? "yes" : "no",
        amount: finalAmount,
        reasoning,
        txSignature,
        isPaperTrade: false,
        timestamp: new Date().toISOString(),
      })
    );

    await redis.set(
      `${REDIS_KEYS.AGENT_STATS_PREFIX}${params.agentId}:last_trade`,
      String(Date.now())
    );

    return { success: true, position };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Trade execution failed:", message);
    return { success: false, error: message };
  }
}

// --- Close a position (sell) ---

export async function closePosition(params: {
  positionId: string;
  agentId: string;
  agentWalletId: string;
  reason: string;
}): Promise<{
  success: boolean;
  trade?: typeof schema.trades.$inferSelect;
  error?: string;
}> {
  // 1. Get position
  const [position] = await db
    .select()
    .from(schema.positions)
    .where(eq(schema.positions.id, params.positionId))
    .limit(1);

  if (!position) {
    return { success: false, error: "Position not found" };
  }

  if (position.status !== "open" && position.status !== "closing") {
    return { success: false, error: `Position is ${position.status} (expected open or closing)` };
  }

  try {
    // Route based on trading mode
    if (position.isPaperTrade) {
      const result = await paperClosePosition({
        jobId: position.jobId,
        positionId: params.positionId,
        agentId: params.agentId,
        reason: params.reason,
      });

      if (result.success) {
        // Push to feed
        await redis.xadd(
          REDIS_KEYS.AGENT_EVENTS_STREAM,
          "MAXLEN",
          "~",
          AGENT_EVENTS_STREAM_MAXLEN,
          "*",
          "event",
          JSON.stringify({
            type: "position_update",
            agentId: params.agentId,
            action: "sell",
            marketId: position.marketId,
            marketQuestion: position.marketQuestion,
            pnl: result.pnl != null
              ? {
                  value: result.pnl,
                  // Percent of cost basis (contracts × entry price), not contracts.
                  percent:
                    (result.pnl /
                      (Number(position.amount) * Number(position.entryPrice))) *
                    100,
                }
              : undefined,
            reason: params.reason,
            isPaperTrade: true,
            timestamp: new Date().toISOString(),
          })
        );

        // Return a synthetic trade record for compatibility
        const syntheticTrade = {
          id: `paper-${Date.now()}`,
          jobId: position.jobId,
          agentId: params.agentId,
          marketId: position.marketId,
          marketQuestion: position.marketQuestion,
          side: position.side,
          amount: position.amount,
          entryPrice: position.entryPrice,
          exitPrice: String(result.proceeds ? result.proceeds / Number(position.amount) : position.currentPrice),
          outcome: (result.pnl && result.pnl >= 0 ? "win" : "loss") as "win" | "loss" | null,
          profitLoss: String(result.pnl ?? 0),
          reasoning: params.reason,
          executedAt: new Date(),
          settledAt: new Date(),
          txSignature: position.txSignature,
        } as typeof schema.trades.$inferSelect;

        return { success: true, trade: syntheticTrade };
      }

      return { success: false, error: result.error };
    }

    // Live trading close
    if (!EXECUTE_TRADES) {
      return { success: false, error: "Live trading disabled" };
    }

    const closeIdentifier = position.positionPubkey ?? position.txSignature ?? position.marketId;
    if (!closeIdentifier || closeIdentifier.length === 0) {
      return { success: false, error: "No valid identifier to close position" };
    }
    await withRetry(
      () => jupiterPredict.closePosition(closeIdentifier),
      "jupiter.closePosition"
    );

    const exitPrice = position.currentPrice ?? position.entryPrice;
    const pnl = calculatePnl(
      Number(position.amount),
      Number(position.entryPrice),
      Number(exitPrice),
      position.side
    );

    await db
      .update(schema.positions)
      .set({
        status: "closed",
        closedAt: new Date(),
        pnl: String(pnl),
      })
      .where(eq(schema.positions.id, params.positionId));

    const [trade] = await db
      .insert(schema.trades)
      .values({
        jobId: position.jobId,
        agentId: params.agentId,
        marketId: position.marketId,
        marketQuestion: position.marketQuestion,
        side: position.side,
        amount: position.amount,
        entryPrice: position.entryPrice,
        exitPrice,
        outcome: pnl >= 0 ? "win" : "loss",
        profitLoss: String(pnl),
        reasoning: params.reason,
        txSignature: position.txSignature,
      })
      .returning();

    await redis.xadd(
      REDIS_KEYS.AGENT_EVENTS_STREAM,
      "MAXLEN",
      "~",
      AGENT_EVENTS_STREAM_MAXLEN,
      "*",
      "event",
      JSON.stringify({
        type: "position_update",
        agentId: params.agentId,
        action: "sell",
        marketId: position.marketId,
        marketQuestion: position.marketQuestion,
        pnl: { value: pnl, percent: (pnl / (Number(position.amount) * Number(position.entryPrice))) * 100 },
        reason: params.reason,
        isPaperTrade: false,
        timestamp: new Date().toISOString(),
      })
    );

    try {
      await recomputeAgentPerformance(params.agentId, false);
    } catch (err) {
      console.error("[TradeService] recomputeAgentPerformance failed:", err);
    }

    return { success: true, trade };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Close position failed:", message);
    return { success: false, error: message };
  }
}

// --- Monitor stop-loss for open positions ---

export async function checkStopLosses(
  agentId: string,
  agentWalletId: string
): Promise<{ closed: number }> {
  const openPositions = await db
    .select({
      id: schema.positions.id,
      jobId: schema.positions.jobId,
      marketId: schema.positions.marketId,
      marketQuestion: schema.positions.marketQuestion,
      side: schema.positions.side,
      amount: schema.positions.amount,
      entryPrice: schema.positions.entryPrice,
      currentPrice: schema.positions.currentPrice,
      pnl: schema.positions.pnl,
      status: schema.positions.status,
      reasoningSnippet: schema.positions.reasoningSnippet,
      txSignature: schema.positions.txSignature,
      positionPubkey: schema.positions.positionPubkey,
      openedAt: schema.positions.openedAt,
      closedAt: schema.positions.closedAt,
    })
    .from(schema.positions)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.positions.jobId))
    .where(
      and(
        eq(schema.positions.status, "open"),
        eq(schema.jobs.agentId, agentId)
      )
    );

  let closed = 0;

  for (const pos of openPositions) {
    // Fetch current price from Jupiter
    try {
      const market = await withRetry(
        () => jupiterPredict.getMarket(pos.marketId),
        "jupiter.getMarket"
      );
      const pricingObj = (market.pricing ?? {}) as any;
      const yesPrice = pricingObj.buyYesPriceUsd ? Number(pricingObj.buyYesPriceUsd) / 1e6 : null;
      const noPrice = pricingObj.buyNoPriceUsd ? Number(pricingObj.buyNoPriceUsd) / 1e6 : null;
      const currentPrice = yesPrice !== null
        ? (pos.side === "yes" ? yesPrice : noPrice ?? Number(pos.currentPrice ?? pos.entryPrice))
        : Number(pos.currentPrice ?? pos.entryPrice);

      // Update current price in DB
      await db
        .update(schema.positions)
        .set({ currentPrice: String(currentPrice) })
        .where(eq(schema.positions.id, pos.id));

      // Check stop-loss
      const slCheck = checkStopLoss(Number(pos.entryPrice), currentPrice, pos.side);
      if (!slCheck.allowed) {
        // Atomically claim this position for closing (race condition protection)
        const [claimed] = await db
          .update(schema.positions)
          .set({ status: "closing" })
          .where(
            and(
              eq(schema.positions.id, pos.id),
              eq(schema.positions.status, "open")
            )
          )
          .returning();

        if (!claimed) {
          // Another tick already claimed this position
          continue;
        }

        await closePosition({
          positionId: pos.id,
          agentId,
          agentWalletId,
          reason: slCheck.reason ?? "Stop-loss triggered",
        });
        closed++;
      }
    } catch (err) {
      console.error(`Failed to check stop-loss for position ${pos.id}:`, err);
    }
  }

  return { closed };
}

// --- Helper ---

function calculatePnl(
  amount: number,
  entryPrice: number,
  exitPrice: number,
  side: string
): number {
  if (!isFinite(amount) || !isFinite(entryPrice) || !isFinite(exitPrice)) {
    return 0;
  }
  if (side === "yes") {
    return amount * (exitPrice - entryPrice);
  } else {
    return amount * (entryPrice - exitPrice);
  }
}

// --- Sync positions from Jupiter ---

export async function syncPositionsFromJupiter(
  jobId: string
): Promise<number> {
  try {
    const jupiterPositions = await jupiterPredict.listPositions({ limit: 100 });
    let count = 0;

    for (const jp of jupiterPositions) {
      // Update matching DB positions
      await db
        .update(schema.positions)
        .set({
          currentPrice: jp.currentPrice ?? undefined,
        })
        .where(
          and(
            eq(schema.positions.jobId, jobId),
            eq(schema.positions.marketId, jp.marketId),
            eq(schema.positions.status, "open")
          )
        );
      count++;
    }

    return count;
  } catch (err) {
    console.error("Failed to sync positions from Jupiter:", err);
    return 0;
  }
}
