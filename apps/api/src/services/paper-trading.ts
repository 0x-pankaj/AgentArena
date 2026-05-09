// ============================================================
// Paper Trading Engine
// Simulates prediction market trading with REAL Jupiter prices
// but simulated on-chain execution. When switching to live mode,
// only the execution layer changes — everything else stays identical.
// ============================================================

import { eq, and, desc, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { redis } from "../utils/redis";
import { jupiterPredict, type JupiterMarket } from "../plugins/polymarket-plugin";
import { getCachedMarket, getCachedMarketsBulk } from "./market-price-cache";
import { DEFAULT_TAKE_PROFIT_PERCENT, DEFAULT_STOP_LOSS_PERCENT, DEFAULT_PAPER_BALANCE_USDC } from "@agent-arena/shared";
import { recomputeAgentPerformance } from "../leaderboard";
import {
  submitAtomFeedback,
  getAtomSummary,
  computeReputationScore,
  AtomTag,
} from "../utils/atom-reputation";

// Heuristic tier from win-rate, used as a UX fallback when on-chain ATOM
// feedback is unavailable. The real on-chain tier overwrites this whenever
// getAtomSummary() succeeds.
function heuristicTierFromPerformance(winRate: number, totalTrades: number): string {
  if (totalTrades < 1) return "Unknown";
  if (winRate >= 0.7 && totalTrades >= 5) return "Gold";
  if (winRate >= 0.55 && totalTrades >= 3) return "Silver";
  return "Bronze";
}

// Submit ATOM feedback for a closed paper trade and refresh the agent's
// DB-side trust tier. Non-blocking: failures fall back to a local heuristic
// so the marketplace UI moves off "Unknown" even when on-chain submission
// fails (e.g., the deployed ATOM program rejects our discriminator).
async function reportTradeOutcomeToAtom(
  agentId: string,
  clientAddress: string,
  pnl: number,
  costBasis: number,
): Promise<void> {
  try {
    const [agent] = await db
      .select({ assetAddress: schema.agents.assetAddress })
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1);

    if (!agent?.assetAddress) return;

    let onChainSucceeded = false;
    try {
      const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
      const result = await submitAtomFeedback({
        agentAsset: agent.assetAddress,
        value: Math.abs(pnlPercent).toFixed(2),
        tag1: pnl >= 0 ? AtomTag.profit : AtomTag.loss,
        tag2: AtomTag.day,
        reviewerAddress: clientAddress,
      });

      if (result) {
        const summary = await getAtomSummary(agent.assetAddress);
        if (summary) {
          await db
            .update(schema.agents)
            .set({
              trustTier: summary.trustTier,
              reputationScore: String(computeReputationScore(summary)),
            })
            .where(eq(schema.agents.id, agentId));
          onChainSucceeded = true;
        }
      }
    } catch (err) {
      console.warn(
        `[PaperTrading] ATOM on-chain feedback failed for agent ${agentId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    if (!onChainSucceeded) {
      const [perf] = await db
        .select()
        .from(schema.agentPerformance)
        .where(eq(schema.agentPerformance.agentId, agentId))
        .limit(1);
      if (perf) {
        const winRate = Number(perf.winRate ?? 0);
        const totalTrades = Number(perf.totalTrades ?? 0);
        await db
          .update(schema.agents)
          .set({
            trustTier: heuristicTierFromPerformance(winRate, totalTrades),
            reputationScore: String(Math.round(winRate * 100)),
          })
          .where(eq(schema.agents.id, agentId));
      }
    }
  } catch (err) {
    console.warn(
      `[PaperTrading] reportTradeOutcomeToAtom failed for agent ${agentId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// --- Redis keys ---

const PAPER_BALANCE_KEY = (jobId: string) => `paper:balance:${jobId}`;
const PAPER_POSITIONS_KEY = (jobId: string) => `paper:positions:${jobId}`;

// --- Types ---

export interface PaperBalance {
  usdc: number;
  lastUpdated: number;
}

export interface PaperPosition {
  id: string;
  marketId: string;
  marketQuestion: string;
  side: "yes" | "no";
  contracts: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  depositAmount: number;
  status: "open" | "closing" | "closed" | "claimable" | "claimed";
  openedAt: number;
  expiresAt?: number;
  takeProfitPercent: number;
  stopLossPercent: number;
}

export interface PaperOrderResult {
  success: boolean;
  orderPubkey?: string;
  positionPubkey?: string;
  txSignature?: string;
  contracts?: number;
  fillPrice?: number;
  error?: string;
}

export interface PaperCloseResult {
  success: boolean;
  proceeds?: number;
  pnl?: number;
  error?: string;
}

export interface PaperClaimResult {
  success: boolean;
  payout?: number;
  error?: string;
}

// --- Get / Set Paper Balance ---

export async function getPaperBalance(jobId: string): Promise<number> {
  // Try Redis first
  const cached = await redis.get(PAPER_BALANCE_KEY(jobId));
  if (cached) {
    try {
      const bal = JSON.parse(cached) as PaperBalance;
      return bal.usdc;
    } catch {
      // fall through to DB
    }
  }

  // Fallback to DB
  const [job] = await db
    .select({ paperBalance: schema.jobs.paperBalance })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1);

  const balance = job?.paperBalance ? Number(job.paperBalance) : DEFAULT_PAPER_BALANCE_USDC;

  // Cache in Redis
  await redis.setex(
    PAPER_BALANCE_KEY(jobId),
    3600,
    JSON.stringify({ usdc: balance, lastUpdated: Date.now() })
  );

  return balance;
}

export async function setPaperBalance(jobId: string, amount: number): Promise<void> {
  // Update DB
  await db
    .update(schema.jobs)
    .set({ paperBalance: String(amount) })
    .where(eq(schema.jobs.id, jobId));

  // Update Redis
  await redis.setex(
    PAPER_BALANCE_KEY(jobId),
    3600,
    JSON.stringify({ usdc: amount, lastUpdated: Date.now() })
  );
}

export async function topUpPaperBalance(jobId: string, amount: number): Promise<number> {
  const current = await getPaperBalance(jobId);
  const newBalance = current + amount;
  await setPaperBalance(jobId, newBalance);
  return newBalance;
}

// --- Simulate Buy Order ---
// Uses real Jupiter market data to calculate fill price and contracts

export async function paperBuyOrder(params: {
  jobId: string;
  agentId: string;
  marketId: string;
  marketQuestion: string;
  isYes: boolean;
  depositAmount: number; // in USDC (not micro units)
  entryPrice: number;
  reasoning: string;
  category: string;
  marketClosesAt?: Date;
}): Promise<PaperOrderResult> {
  const {
    jobId,
    agentId,
    marketId,
    marketQuestion,
    isYes,
    depositAmount,
    entryPrice,
    reasoning,
    marketClosesAt,
  } = params;

  // 1. Check balance
  const balance = await getPaperBalance(jobId);
  if (balance < depositAmount) {
    return { success: false, error: `Insufficient paper balance: $${balance.toFixed(2)} < $${depositAmount.toFixed(2)}` };
  }

  // 2. Fetch current market data for realistic fill (cached + deduped)
  let fillPrice = entryPrice;
  let marketData: JupiterMarket | null = null;
  try {
    const cached = await getCachedMarket(marketId);
    marketData = cached.market;
    const pricing = marketData?.pricing as any;
    if (pricing) {
      const buyYes = pricing.buyYesPriceUsd ? Number(pricing.buyYesPriceUsd) / 1e6 : null;
      const buyNo = pricing.buyNoPriceUsd ? Number(pricing.buyNoPriceUsd) / 1e6 : null;
      fillPrice = isYes ? (buyYes ?? entryPrice) : (buyNo ?? entryPrice);
    }
  } catch (err) {
    console.warn(`[PaperTrading] Could not fetch live market data for ${marketId}, using estimated price`);
  }

  // 3. Calculate contracts (with simulated slippage based on orderbook depth)
  let contracts = depositAmount / fillPrice;

  // Try to get orderbook for realistic depth-based fill simulation.
  // If no orderbook depth is reported (sparse / newly listed market), fall back
  // to the full estimated fill — the original logic zeroed contracts here.
  try {
    const orderbook = await jupiterPredict.getOrderbook(marketId);
    const side = isYes ? "yes" : "no";
    const depth = (orderbook as any)[side] as Array<[number, number]> | undefined;
    if (depth && Array.isArray(depth) && depth.length > 0) {
      let availableContracts = 0;
      for (const [priceCents, qty] of depth) {
        const price = priceCents / 100;
        if (Math.abs(price - fillPrice) / fillPrice < 0.05) {
          availableContracts += qty;
        }
      }
      // Only apply partial fill when there *is* depth but it's < requested.
      // Zero depth means the orderbook API returned nothing useful — keep the estimate.
      if (availableContracts > 0 && availableContracts < contracts) {
        contracts = availableContracts * 0.95;
      }
    }
  } catch {
    // Ignore orderbook errors, use full estimated fill
  }

  contracts = Math.floor(contracts * 100) / 100; // 2 decimal precision

  if (contracts <= 0) {
    return { success: false, error: "Could not simulate any fill — insufficient orderbook depth" };
  }

  const actualDeposit = contracts * fillPrice;

  // 4. Deduct balance
  await setPaperBalance(jobId, balance - actualDeposit);

  // 5. Generate simulated on-chain identifiers.
  // positions.position_pubkey + trades.tx_signature are sized to fit Solana
  // base58-encoded values (44 / 88 chars). Paper rows must fit those columns,
  // so we use a short random suffix instead of jobId+timestamp.
  const timestamp = Date.now();
  const shortId = Math.random().toString(36).slice(2, 10) + timestamp.toString(36);
  const orderPubkey = `paper-order-${jobId}-${timestamp}`;
  const positionPubkey = `paper-pos-${shortId}`;
  const txSignature = `paper-tx-${shortId}`;

  // 6. Determine expiry (market close time or default 30 days)
  const expiresAt = marketClosesAt
    ? new Date(Math.min(marketClosesAt.getTime(), Date.now() + 30 * 24 * 60 * 60 * 1000))
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // 7. Create paper order record
  await db.insert(schema.paperOrders).values({
    jobId,
    marketId,
    side: isYes ? "yes" : "no",
    amount: String(contracts),
    depositAmount: String(actualDeposit),
    status: "filled",
    simulatedTxSignature: txSignature,
    simulatedOrderPubkey: orderPubkey,
    simulatedPositionPubkey: positionPubkey,
    fillPrice: String(fillPrice),
    filledAt: new Date(),
  });

  // 8. Create position record
  const [position] = await db
    .insert(schema.positions)
    .values({
      jobId,
      marketId,
      marketQuestion,
      side: isYes ? "yes" : "no",
      amount: String(contracts),
      entryPrice: String(fillPrice),
      currentPrice: String(fillPrice),
      status: "open",
      isPaperTrade: true,
      expiresAt,
      takeProfitPercent: String(DEFAULT_TAKE_PROFIT_PERCENT),
      stopLossPercent: String(DEFAULT_STOP_LOSS_PERCENT),
      reasoningSnippet: reasoning,
      txSignature,
      positionPubkey,
      simulatedOrderPubkey: orderPubkey,
      simulatedPositionPubkey: positionPubkey,
    })
    .returning();

  console.log(
    `[PaperTrading] BUY ${isYes ? "YES" : "NO"} ${contracts.toFixed(2)} contracts @ $${fillPrice.toFixed(4)} ` +
    `on "${marketQuestion.slice(0, 50)}" | Deposit: $${actualDeposit.toFixed(2)} | Balance: $${(balance - actualDeposit).toFixed(2)}`
  );

  return {
    success: true,
    orderPubkey,
    positionPubkey,
    txSignature,
    contracts,
    fillPrice,
  };
}

// --- Simulate Close Position (Sell) ---

export async function paperClosePosition(params: {
  jobId: string;
  positionId: string;
  agentId: string;
  reason: string;
}): Promise<PaperCloseResult> {
  const { jobId, positionId, reason } = params;

  // 1. Get position
  const [position] = await db
    .select()
    .from(schema.positions)
    .where(and(eq(schema.positions.id, positionId), eq(schema.positions.jobId, jobId)))
    .limit(1);

  if (!position) {
    return { success: false, error: "Position not found" };
  }
  if (position.status !== "open" && position.status !== "closing") {
    return { success: false, error: `Position is ${position.status}` };
  }

  // 2. Fetch current market price for realistic exit (cached + deduped)
  let exitPrice = Number(position.entryPrice);
  try {
    const cached = await getCachedMarket(position.marketId);
    const pricing = cached.market?.pricing as any;
    if (pricing) {
      const sellYes = pricing.sellYesPriceUsd ? Number(pricing.sellYesPriceUsd) / 1e6 : null;
      const sellNo = pricing.sellNoPriceUsd ? Number(pricing.sellNoPriceUsd) / 1e6 : null;
      exitPrice = position.side === "yes"
        ? (sellYes ?? exitPrice)
        : (sellNo ?? exitPrice);
    }
  } catch (err) {
    console.warn(`[PaperTrading] Could not fetch exit price for ${position.marketId}, using entry price`);
  }

  const contracts = Number(position.amount);
  const entryPrice = Number(position.entryPrice);

  // 3. Calculate proceeds and P&L
  const proceeds = contracts * exitPrice;
  const pnl = position.side === "yes"
    ? proceeds - (contracts * entryPrice)
    : (contracts * entryPrice) - proceeds;

  // 4. Credit balance
  const balance = await getPaperBalance(jobId);
  await setPaperBalance(jobId, balance + proceeds);

  // 5. Update position
  await db
    .update(schema.positions)
    .set({
      status: "closed",
      currentPrice: String(exitPrice),
      pnl: String(pnl),
      closedAt: new Date(),
    })
    .where(eq(schema.positions.id, positionId));

  // 6. Record trade
  await db.insert(schema.trades).values({
    jobId,
    agentId: params.agentId,
    marketId: position.marketId,
    marketQuestion: position.marketQuestion,
    side: position.side,
    amount: position.amount,
    entryPrice: position.entryPrice,
    exitPrice: String(exitPrice),
    outcome: pnl >= 0 ? "win" : "loss",
    profitLoss: String(pnl),
    reasoning: reason,
    txSignature: position.txSignature,
  });

  // 7. Update job-level realized PnL so profile/UI reflect cumulative profit.
  const [updatedJob] = await db
    .update(schema.jobs)
    .set({
      totalProfit: sql`${schema.jobs.totalProfit} + ${String(pnl)}`,
    })
    .where(eq(schema.jobs.id, jobId))
    .returning({ clientAddress: schema.jobs.clientAddress });

  console.log(
    `[PaperTrading] CLOSE ${position.side.toUpperCase()} ${contracts.toFixed(2)} contracts ` +
    `@ $${exitPrice.toFixed(4)} (entry: $${entryPrice.toFixed(4)}) | PnL: $${pnl.toFixed(2)} | Reason: ${reason.slice(0, 80)}`
  );

  try {
    await recomputeAgentPerformance(params.agentId, true);
  } catch (err) {
    console.error("[PaperTrading] recomputeAgentPerformance failed:", err);
  }

  // Push ATOM feedback so on-chain reputation moves off "Unknown" without
  // waiting for the whole job to complete.
  if (updatedJob?.clientAddress) {
    const costBasis = contracts * entryPrice;
    reportTradeOutcomeToAtom(params.agentId, updatedJob.clientAddress, pnl, costBasis).catch(() => {});
  }

  return { success: true, proceeds, pnl };
}

// --- Simulate Claim Payout ---

export async function paperClaimPayout(params: {
  jobId: string;
  positionId: string;
  agentId: string;
}): Promise<PaperClaimResult> {
  const { jobId, positionId } = params;

  // 1. Get position
  const [position] = await db
    .select()
    .from(schema.positions)
    .where(and(eq(schema.positions.id, positionId), eq(schema.positions.jobId, jobId)))
    .limit(1);

  if (!position) {
    return { success: false, error: "Position not found" };
  }

  if (position.status !== "claimable" && position.status !== "closed") {
    return { success: false, error: `Position is ${position.status} (expected claimable or closed)` };
  }

  // 2. Check market result
  const marketResult = position.marketResult;
  if (!marketResult) {
    return { success: false, error: "Market result not yet determined" };
  }

  const contracts = Number(position.amount);
  let payout = 0;

  if (marketResult === "cancelled") {
    // Refund full deposit
    payout = contracts * Number(position.entryPrice);
  } else if (marketResult === position.side) {
    // Winner: $1 per contract
    payout = contracts * 1.0;
  } else {
    // Loser: $0
    payout = 0;
  }

  // 3. Credit balance
  const balance = await getPaperBalance(jobId);
  await setPaperBalance(jobId, balance + payout);

  // 4. Update position
  await db
    .update(schema.positions)
    .set({
      status: "claimed",
      claimedAt: new Date(),
    })
    .where(eq(schema.positions.id, positionId));

  // 5. Record trade if not already recorded
  const tradeTxSignature = position.txSignature ?? `paper-claim-${positionId}-${Date.now()}`;
  const existingTrade = await db
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.txSignature, tradeTxSignature))
    .limit(1);

  if (existingTrade.length === 0) {
    const pnl = payout - (contracts * Number(position.entryPrice));
    await db.insert(schema.trades).values({
      jobId,
      agentId: params.agentId,
      marketId: position.marketId,
      marketQuestion: position.marketQuestion,
      side: position.side,
      amount: position.amount,
      entryPrice: position.entryPrice,
      exitPrice: String(marketResult === position.side ? 1.0 : 0),
      outcome: marketResult === position.side ? "win" : "loss",
      profitLoss: String(pnl),
      reasoning: `Market resolved ${marketResult}. Auto-claimed payout.`,
      txSignature: tradeTxSignature,
      settledAt: new Date(),
    });

    const [updatedJob] = await db
      .update(schema.jobs)
      .set({
        totalProfit: sql`${schema.jobs.totalProfit} + ${String(pnl)}`,
      })
      .where(eq(schema.jobs.id, jobId))
      .returning({ clientAddress: schema.jobs.clientAddress });

    if (updatedJob?.clientAddress) {
      const costBasis = contracts * Number(position.entryPrice);
      reportTradeOutcomeToAtom(params.agentId, updatedJob.clientAddress, pnl, costBasis).catch(() => {});
    }
  }

  console.log(
    `[PaperTrading] CLAIM ${position.side.toUpperCase()} ${contracts.toFixed(2)} contracts ` +
    `| Market result: ${marketResult} | Payout: $${payout.toFixed(2)}`
  );

  try {
    await recomputeAgentPerformance(params.agentId, true);
  } catch (err) {
    console.error("[PaperTrading] recomputeAgentPerformance failed:", err);
  }

  return { success: true, payout };
}

// --- Update unrealized P&L for all open paper positions ---

export async function updatePaperPositionPrices(jobId: string): Promise<{
  updated: number;
  closedByExpiry: number;
  closedByResolution: number;
}> {
  const openPositions = await db
    .select()
    .from(schema.positions)
    .where(
      and(
        eq(schema.positions.jobId, jobId),
        eq(schema.positions.status, "open"),
        eq(schema.positions.isPaperTrade, true)
      )
    );

  let updated = 0;
  let closedByExpiry = 0;
  let closedByResolution = 0;

  // Dedupe upstream calls: many positions can share the same marketId, and
  // even unique-market positions across agents benefit from the cache. One
  // bulk fetch with in-flight dedupe replaces N getMarket() round trips.
  const marketIds = openPositions.map((p) => p.marketId);
  const marketDataMap = await getCachedMarketsBulk(marketIds);

  for (const pos of openPositions) {
    try {
      const cached = marketDataMap.get(pos.marketId);
      const marketData = cached?.market;
      if (!marketData) {
        // Cache miss + upstream unreachable. Leave the position untouched
        // for this tick — pos.currentPrice from a previous tick is still
        // the best estimate; logging per-position would be noisy.
        continue;
      }
      const pricing = marketData.pricing as any;
      const status = marketData.status;
      const result = marketData.result;

      // Check if market resolved
      if (result && (result === "yes" || result === "no" || result === "cancelled")) {
        // Market resolved — mark as claimable
        await db
          .update(schema.positions)
          .set({
            status: "claimable",
            marketResult: result,
            currentPrice: result === pos.side ? "1.0" : "0",
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

        closedByResolution++;
        continue;
      }

      // Check if market expired (closed but not resolved yet)
      const closeTime = marketData.closeTime
        ? (typeof marketData.closeTime === "number" ? marketData.closeTime * 1000 : new Date(marketData.closeTime).getTime())
        : null;

      const posExpiresAt = pos.expiresAt ? new Date(pos.expiresAt).getTime() : null;

      if ((closeTime && Date.now() > closeTime) || (posExpiresAt && Date.now() > posExpiresAt)) {
        // Market expired but not resolved — mark as closed (will be claimable once resolved)
        await db
          .update(schema.positions)
          .set({
            status: "closed",
            closedAt: new Date(),
          })
          .where(eq(schema.positions.id, pos.id));

        closedByExpiry++;
        continue;
      }

      // Update current price and unrealized P&L
      if (pricing) {
        const buyYes = pricing.buyYesPriceUsd ? Number(pricing.buyYesPriceUsd) / 1e6 : null;
        const buyNo = pricing.buyNoPriceUsd ? Number(pricing.buyNoPriceUsd) / 1e6 : null;
        const currentPrice = pos.side === "yes"
          ? (buyYes ?? Number(pos.currentPrice ?? pos.entryPrice))
          : (buyNo ?? Number(pos.currentPrice ?? pos.entryPrice));

        const contracts = Number(pos.amount);
        const entryPrice = Number(pos.entryPrice);
        const unrealizedPnl = pos.side === "yes"
          ? contracts * (currentPrice - entryPrice)
          : contracts * (entryPrice - currentPrice);

        await db
          .update(schema.positions)
          .set({
            currentPrice: String(currentPrice),
            pnl: String(unrealizedPnl),
          })
          .where(eq(schema.positions.id, pos.id));

        updated++;
      }
    } catch (err) {
      // Don't log per-position — one upstream hiccup would otherwise
      // produce N error lines. Aggregate failures are visible via the
      // returned `updated` count and via the cache layer's own logs.
    }
  }

  return { updated, closedByExpiry, closedByResolution };
}

// --- Sync paper positions with real Jupiter positions ---
// When switching modes, reconcile any real positions from Jupiter API

export async function syncPaperPositionsWithJupiter(
  jobId: string,
  walletAddress: string
): Promise<{ synced: number }> {
  try {
    // Fetch real positions from Jupiter
    const jupiterPositions = await jupiterPredict.listPositions({ limit: 100 });
    let synced = 0;

    for (const jp of jupiterPositions) {
      // Check if we already track this position
      const existing = await db
        .select()
        .from(schema.positions)
        .where(
          and(
            eq(schema.positions.jobId, jobId),
            eq(schema.positions.marketId, jp.marketId),
            eq(schema.positions.status, "open")
          )
        )
        .limit(1);

      if (existing.length === 0) {
        // This is a real position not yet tracked — create a paper mirror
        // (This helps when user manually traded on Jupiter or switched from live to paper)
        await db.insert(schema.positions).values({
          jobId,
          marketId: jp.marketId,
          marketQuestion: jp.marketQuestion ?? "Unknown",
          side: jp.side as "yes" | "no",
          amount: String(jp.size ?? 0),
          entryPrice: String(jp.avgPrice ?? 0.5),
          currentPrice: String(jp.currentPrice ?? jp.avgPrice ?? 0.5),
          status: "open",
          isPaperTrade: true, // Mirrored as paper
          txSignature: `mirrored-${Date.now()}`,
          positionPubkey: jp.id,
        });
        synced++;
      }
    }

    return { synced };
  } catch (err) {
    console.error("[PaperTrading] Failed to sync with Jupiter positions:", err);
    return { synced: 0 };
  }
}

// --- Get paper portfolio snapshot ---

export async function getPaperPortfolio(jobId: string): Promise<{
  balance: number;
  openPositions: typeof schema.positions.$inferSelect[];
  totalUnrealizedPnl: number;
  totalEquity: number;
}> {
  const balance = await getPaperBalance(jobId);

  const openPositions = await db
    .select()
    .from(schema.positions)
    .where(
      and(
        eq(schema.positions.jobId, jobId),
        eq(schema.positions.status, "open"),
        eq(schema.positions.isPaperTrade, true)
      )
    );

  const totalUnrealizedPnl = openPositions.reduce(
    (sum, p) => sum + Number(p.pnl ?? 0),
    0
  );

  return {
    balance,
    openPositions,
    totalUnrealizedPnl,
    totalEquity: balance + totalUnrealizedPnl,
  };
}
