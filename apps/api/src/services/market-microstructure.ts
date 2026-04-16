// ============================================================
// 6. Market Microstructure Checks
//    Order book depth, spread, and slippage analysis
//    before executing a trade.
// ============================================================

import { jupiterPredict } from "../plugins/polymarket-plugin";

export interface MarketMicrostructure {
  bidAskSpread: number;
  depthAt5Pct: number;
  liquidityScore: number;
  priceImpactEstimate: number;
  midPrice: number;
  bidVolume: number;
  askVolume: number;
}

export interface MicrostructureCheckResult {
  allowed: boolean;
  reason?: string;
  microstructure: MarketMicrostructure | null;
}

// --- Fetch orderbook and compute microstructure ---

export async function analyzeMarketMicrostructure(
  marketId: string,
  proposedAmount: number
): Promise<MarketMicrostructure | null> {
  try {
    const orderbook = await jupiterPredict.getOrderbook(marketId);
    if (!orderbook || !orderbook.bids || !orderbook.asks) {
      return null;
    }

    const bids = Array.isArray(orderbook.bids) ? orderbook.bids : [];
    const asks = Array.isArray(orderbook.asks) ? orderbook.asks : [];

    if (bids.length === 0 || asks.length === 0) return null;

    const bestBid = Number((bids[0] as any)?.price ?? bids[0]?.price ?? 0);
    const bestAsk = Number((asks[0] as any)?.price ?? asks[0]?.price ?? 0);

    if (bestBid === 0 && bestAsk === 0) return null;

    const midPrice = (bestBid + bestAsk) / 2;

    const bidAskSpread = midPrice > 0 ? (bestAsk - bestBid) / midPrice : 1;

    // Depth at 5% range around mid
    const depthAt5Pct = calculateDepthInRange(bids, asks, midPrice, 0.05);

    // Total volumes
    const bidVolume = bids.reduce(
      (sum: number, b: any) => sum + (Number(b.amount ?? b.size ?? 0)),
      0
    );
    const askVolume = asks.reduce(
      (sum: number, a: any) => sum + (Number(a.amount ?? a.size ?? 0)),
      0
    );

    // Liquidity score: 0-1, based on depth and spread
    const liquidityScore = Math.max(0, Math.min(1,
      (1 - bidAskSpread * 5) * Math.min(bidVolume + askVolume, 10000) / 10000
    ));

    // Price impact estimate: how much would proposedAmount move the price
    const priceImpact = estimatePriceImpact(asks, proposedAmount, midPrice);

    return {
      bidAskSpread: Math.round(bidAskSpread * 10000) / 10000,
      depthAt5Pct,
      liquidityScore: Math.round(liquidityScore * 10000) / 10000,
      priceImpactEstimate: Math.round(priceImpact * 10000) / 10000,
      midPrice: Math.round(midPrice * 10000) / 10000,
      bidVolume: Math.round(bidVolume * 100) / 100,
      askVolume: Math.round(askVolume * 100) / 100,
    };
  } catch (err) {
    console.error("[Microstructure] Error analyzing market:", err);
    return null;
  }
}

// --- Pre-trade microstructure risk check ---

export async function checkMicrostructure(
  marketId: string,
  proposedAmount: number
): Promise<MicrostructureCheckResult> {
  const micro = await analyzeMarketMicrostructure(marketId, proposedAmount);

  if (!micro) {
    return {
      allowed: true, // Allow if we can't fetch orderbook data
      reason: "Could not fetch orderbook data — allowing trade",
      microstructure: null,
    };
  }

  // Check 1: Bid-ask spread > 8% is too illiquid
  if (micro.bidAskSpread > 0.08) {
    return {
      allowed: false,
      reason: `Bid-ask spread too wide (${(micro.bidAskSpread * 100).toFixed(1)}%) — low liquidity`,
      microstructure: micro,
    };
  }

  // Check 2: Price impact > 3% of proposed amount
  if (micro.priceImpactEstimate > 0.03 && proposedAmount > 0) {
    return {
      allowed: false,
      reason: `Price impact too high (${(micro.priceImpactEstimate * 100).toFixed(1)}% estimated slippage)`,
      microstructure: micro,
    };
  }

  // Check 3: Very low liquidity score
  if (micro.liquidityScore < 0.1 && micro.bidVolume + micro.askVolume < 500) {
    return {
      allowed: false,
      reason: `Market too illiquid (liquidity score: ${(micro.liquidityScore * 100).toFixed(1)}%, total volume: $${(micro.bidVolume + micro.askVolume).toFixed(0)})`,
      microstructure: micro,
    };
  }

  return {
    allowed: true,
    reason: `Market microstructure OK (spread: ${(micro.bidAskSpread * 100).toFixed(2)}%, impact: ${(micro.priceImpactEstimate * 100).toFixed(2)}%, liquidity: ${(micro.liquidityScore * 100).toFixed(0)}%)`,
    microstructure: micro,
  };
}

// --- Helper: Calculate depth within a price range ---

function calculateDepthInRange(
  bids: any[],
  asks: any[],
  midPrice: number,
  rangePct: number
): number {
  let totalDepth = 0;
  const lowBound = midPrice * (1 - rangePct);
  const highBound = midPrice * (1 + rangePct);

  for (const b of bids) {
    const price = Number(b.price ?? 0);
    const amount = Number(b.amount ?? b.size ?? 0);
    if (price >= lowBound && price <= midPrice) {
      totalDepth += amount * price;
    }
  }

  for (const a of asks) {
    const price = Number(a.price ?? 0);
    const amount = Number(a.amount ?? a.size ?? 0);
    if (price > midPrice && price <= highBound) {
      totalDepth += amount * price;
    }
  }

  return Math.round(totalDepth * 100) / 100;
}

// --- Helper: Estimate price impact of a proposed order ---

function estimatePriceImpact(
  asks: any[],
  proposedAmount: number,
  midPrice: number
): number {
  if (proposedAmount <= 0 || asks.length === 0) return 0;

  let filled = 0;
  let totalCost = 0;

  for (const ask of asks) {
    const price = Number(ask.price ?? 0);
    const amount = Number(ask.amount ?? ask.size ?? 0);

    if (filled < proposedAmount) {
      const fillAmount = Math.min(amount, proposedAmount - filled);
      totalCost += fillAmount * price;
      filled += fillAmount;
    } else {
      break;
    }
  }

  if (filled === 0) return 1; // Can't fill at all

  const avgPrice = totalCost / filled;
  const bestAsk = Number(asks[0]?.price ?? midPrice);

  if (bestAsk === 0) return 0;

  return Math.abs(avgPrice - bestAsk) / bestAsk;
}