import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../db";
import { redis } from "../utils/redis";
import { REDIS_KEYS, EXECUTE_TRADES, IS_DEVNET } from "@agent-arena/shared";
import {
  jupiterPredict,
  type CreateOrderParams,
  type JupiterPosition,
} from "../plugins/polymarket-plugin";
import {
  runPreTradeChecks,
  checkStopLoss,
  calculatePositionSize,
  type PortfolioSnapshot,
  type PositionRecord,
} from "../plugins/risk-plugin";
import { signSolanaTransaction } from "../utils/privy";

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

  return { positions, total: positions.length };
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

  return { positions };
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
  // 1. Run risk checks
  const riskResult = runPreTradeChecks(
    params.amount,
    params.category,
    params.confidence,
    params.marketVolume,
    params.marketClosesAt,
    params.portfolio,
    params.marketId
  );

  if (!riskResult.allowed) {
    return { success: false, error: riskResult.reason };
  }

  // 2. Calculate position size (True Kelly Criterion)
  const positionSize = calculatePositionSize(
    params.estimatedProbability ?? params.confidence, // use true probability estimate if available
    params.entryPrice,
    params.portfolio.totalBalance,
    params.isYes,
    params.confidence
  );
  const finalAmount = Math.min(params.amount, positionSize);

  // 3. Create order via Jupiter Predict API
  try {
    const orderParams: CreateOrderParams = {
      ownerPubkey: params.ownerPubkey,
      marketId: params.marketId,
      isYes: params.isYes,
      isBuy: true,
      depositAmount: String(Math.round(finalAmount * 1_000_000)), // USDC has 6 decimals
    };

    // Decision-only mode: log but don't execute on devnet
    if (!EXECUTE_TRADES) {
      console.log(
        `[DECISION-ONLY] Agent ${params.agentId}: BUY ${params.isYes ? "YES" : "NO"} $${finalAmount} on "${params.marketQuestion}"`
      );
      console.log(`  Confidence: ${(params.confidence * 100).toFixed(0)}%`);
      console.log(`  Reasoning: ${params.reasoning.slice(0, 200)}`);

      // Push decision to feed as analysis event (not a trade)
      await redis.xadd(
        REDIS_KEYS.AGENT_EVENTS_STREAM,
        "*",
        "event",
        JSON.stringify({
          type: "decision",
          agentId: params.agentId,
          action: "would_buy",
          marketId: params.marketId,
          marketQuestion: params.marketQuestion,
          side: params.isYes ? "yes" : "no",
          amount: finalAmount,
          confidence: params.confidence,
          reasoning: params.reasoning,
          timestamp: new Date().toISOString(),
        })
      );

      return { success: false, error: "Decision-only mode (devnet) — trade not executed" };
    }

    const order = await withRetry(
      () => jupiterPredict.createOrder(orderParams),
      "jupiter.createOrder"
    );

    // 4. Sign the transaction
    const txSignature = await signSolanaTransaction(
      params.agentWalletId,
      order.transaction
    );

    // 5. Record position in DB
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
        reasoningSnippet: params.reasoning,
        txSignature,
        positionPubkey: order.positionPubkey ?? null,
      })
      .returning();

    // 6. Push to Redis stream for public feed
    await redis.xadd(
      REDIS_KEYS.AGENT_EVENTS_STREAM,
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
        reasoning: params.reasoning,
        txSignature,
        timestamp: new Date().toISOString(),
      })
    );

    // 7. Update last trade timestamp
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
    // Decision-only mode: log but don't execute on devnet
    if (!EXECUTE_TRADES) {
      console.log(
        `[DECISION-ONLY] Agent ${params.agentId}: CLOSE position ${params.positionId} on "${position.marketQuestion}"`
      );
      console.log(`  Reason: ${params.reason}`);

      await redis.xadd(
        REDIS_KEYS.AGENT_EVENTS_STREAM,
        "*",
        "event",
        JSON.stringify({
          type: "decision",
          agentId: params.agentId,
          action: "would_close",
          positionId: params.positionId,
          marketQuestion: position.marketQuestion,
          reason: params.reason,
          timestamp: new Date().toISOString(),
        })
      );

      return { success: false, error: "Decision-only mode (devnet) — close not executed" };
    }

    // 2. Close via Jupiter Predict API
    const closeIdentifier = position.positionPubkey ?? position.txSignature ?? position.marketId;
    if (!closeIdentifier || closeIdentifier.length === 0) {
      return { success: false, error: "No valid identifier to close position (missing positionPubkey, txSignature, and marketId)" };
    }
    await withRetry(
      () => jupiterPredict.closePosition(closeIdentifier),
      "jupiter.closePosition"
    );

    // 3. Update position
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

    // 4. Record trade
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

    // 5. Push to feed
    await redis.xadd(
      REDIS_KEYS.AGENT_EVENTS_STREAM,
      "*",
      "event",
      JSON.stringify({
        type: "position_update",
        agentId: params.agentId,
        action: "sell",
        marketId: position.marketId,
        marketQuestion: position.marketQuestion,
        pnl: { value: pnl, percent: (pnl / Number(position.amount)) * 100 },
        reason: params.reason,
        timestamp: new Date().toISOString(),
      })
    );

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
