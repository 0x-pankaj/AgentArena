// ============================================================
// Order Flow Analysis Service
// Analyzes Jupiter Predict orderbook data for trading signals:
// 1. Order flow imbalance (buying vs selling pressure)
// 2. Smart money detection (large orders, spread compression)
// 3. Momentum from orderbook changes across time
// ============================================================

import { redis } from "../utils/redis";
import { jupiterPredict } from "../plugins/polymarket-plugin";
import type { MarketMicrostructure } from "./market-microstructure";
import { analyzeMarketMicrostructure } from "./market-microstructure";

// --- Types ---

export interface OrderFlowSnapshot {
  marketId: string;
  timestamp: number;
  bidVolume: number;
  askVolume: number;
  midPrice: number;
  bidAskSpread: number;
  orderFlowImbalance: number;
  largeBidOrders: number; // count of orders > $1000
  largeAskOrders: number;
}

export interface OrderFlowSignal {
  marketId: string;
  signal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
  strength: number; // 0-1
  confidence: number;
  reasons: string[];
  trend: "accelerating" | "decelerating" | "stable";
}

const SNAPSHOT_KEY_PREFIX = "orderflow:snapshot:";
const SNAPSHOT_TTL = 3600; // 1 hour
const MIN_SNAPSHOTS_FOR_TREND = 3;

// --- Take a snapshot of order flow ---

export async function takeOrderFlowSnapshot(
  marketId: string
): Promise<OrderFlowSnapshot | null> {
  const micro = await analyzeMarketMicrostructure(marketId, 100);
  if (!micro) return null;

  // Fetch raw orderbook for large order detection
  let largeBidOrders = 0;
  let largeAskOrders = 0;

  try {
    const orderbook = await jupiterPredict.getOrderbook(marketId);
    const bids = Array.isArray(orderbook?.bids) ? orderbook.bids : [];
    const asks = Array.isArray(orderbook?.asks) ? orderbook.asks : [];

    for (const b of bids) {
      const amount = Number((b as any).amount ?? (b as any).size ?? 0);
      if (amount >= 1000) largeBidOrders++;
    }
    for (const a of asks) {
      const amount = Number((a as any).amount ?? (a as any).size ?? 0);
      if (amount >= 1000) largeAskOrders++;
    }
  } catch {
    // Skip large order detection if orderbook fails
  }

  const snapshot: OrderFlowSnapshot = {
    marketId,
    timestamp: Date.now(),
    bidVolume: micro.bidVolume,
    askVolume: micro.askVolume,
    midPrice: micro.midPrice,
    bidAskSpread: micro.bidAskSpread,
    orderFlowImbalance: micro.orderFlowImbalance,
    largeBidOrders,
    largeAskOrders,
  };

  // Store in Redis list (keep last 20 snapshots)
  const key = `${SNAPSHOT_KEY_PREFIX}${marketId}`;
  const existing = await redis.get(key);
  const snapshots: OrderFlowSnapshot[] = existing ? JSON.parse(existing) : [];
  snapshots.push(snapshot);
  if (snapshots.length > 20) snapshots.shift();
  await redis.setex(key, SNAPSHOT_TTL, JSON.stringify(snapshots));

  return snapshot;
}

// --- Analyze order flow trend ---

export async function analyzeOrderFlowTrend(
  marketId: string
): Promise<OrderFlowSignal | null> {
  const key = `${SNAPSHOT_KEY_PREFIX}${marketId}`;
  const raw = await redis.get(key);
  if (!raw) return null;

  const snapshots: OrderFlowSnapshot[] = JSON.parse(raw);
  if (snapshots.length < MIN_SNAPSHOTS_FOR_TREND) return null;

  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots[snapshots.length - 2];
  const older = snapshots.length >= 4 ? snapshots[snapshots.length - 4] : previous;

  const reasons: string[] = [];
  let strength = 0;
  let confidence = 0.5;
  let signal: OrderFlowSignal["signal"] = "neutral";
  let trend: OrderFlowSignal["trend"] = "stable";

  // 1. Order flow imbalance trend
  const imbalanceChange = latest.orderFlowImbalance - previous.orderFlowImbalance;
  const imbalanceAccel = previous.orderFlowImbalance - older.orderFlowImbalance;

  if (latest.orderFlowImbalance > 0.3) {
    reasons.push(`Buying pressure: ${(latest.orderFlowImbalance * 100).toFixed(0)}% imbalance`);
    strength += latest.orderFlowImbalance * 0.4;
    signal = latest.orderFlowImbalance > 0.6 ? "strong_buy" : "buy";
  } else if (latest.orderFlowImbalance < -0.3) {
    reasons.push(`Selling pressure: ${(Math.abs(latest.orderFlowImbalance) * 100).toFixed(0)}% imbalance`);
    strength += Math.abs(latest.orderFlowImbalance) * 0.4;
    signal = latest.orderFlowImbalance < -0.6 ? "strong_sell" : "sell";
  }

  // 2. Acceleration/deceleration
  if (Math.abs(imbalanceChange) > 0.1) {
    if (Math.abs(imbalanceChange) > Math.abs(imbalanceAccel)) {
      trend = "accelerating";
      reasons.push(`${signal.includes("buy") ? "Buying" : "Selling"} pressure accelerating`);
      strength += 0.2;
    } else {
      trend = "decelerating";
      reasons.push("Pressure decelerating — possible reversal");
      strength -= 0.1;
    }
  }

  // 3. Large order activity (smart money proxy)
  if (latest.largeBidOrders > previous.largeBidOrders) {
    reasons.push(`Large bids increased: ${latest.largeBidOrders} vs ${previous.largeBidOrders}`);
    if (signal === "neutral" || signal.includes("buy")) {
      signal = signal === "neutral" ? "buy" : signal;
      strength += 0.15;
    }
  }
  if (latest.largeAskOrders > previous.largeAskOrders) {
    reasons.push(`Large asks increased: ${latest.largeAskOrders} vs ${previous.largeAskOrders}`);
    if (signal === "neutral" || signal.includes("sell")) {
      signal = signal === "neutral" ? "sell" : signal;
      strength += 0.15;
    }
  }

  // 4. Spread compression/expansion
  const spreadChange = previous.bidAskSpread - latest.bidAskSpread;
  if (spreadChange > 0.01) {
    reasons.push("Spread compressing — liquidity improving");
    confidence += 0.1;
  } else if (spreadChange < -0.01) {
    reasons.push("Spread widening — liquidity deteriorating");
    confidence -= 0.1;
  }

  // Cap values
  strength = Math.max(0, Math.min(1, strength));
  confidence = Math.max(0.1, Math.min(0.95, confidence + (snapshots.length / 40))); // more data = higher confidence

  return {
    marketId,
    signal,
    strength,
    confidence,
    reasons,
    trend,
  };
}

// --- Convert order flow signal to Bayesian evidence ---

export function orderFlowToEvidence(
  flowSignal: OrderFlowSignal
): {
  name: string;
  likelihoodYes: number;
  likelihoodNo: number;
  weight: number;
  source: string;
} | null {
  if (flowSignal.signal === "neutral") return null;

  // Map order flow signal to likelihoods
  // Buying pressure -> more likely YES resolves
  // Selling pressure -> more likely NO resolves
  const isBuyPressure = flowSignal.signal.includes("buy");
  const magnitude = flowSignal.strength;

  const direction = isBuyPressure ? 1 : -1;
  const strength = magnitude * 0.25; // max 0.25 likelihood shift

  return {
    name: "order_flow",
    likelihoodYes: 0.5 + direction * strength,
    likelihoodNo: 0.5 - direction * strength,
    weight: flowSignal.confidence * 2,
    source: `orderbook (${flowSignal.signal}, strength=${(magnitude * 100).toFixed(0)}%, trend=${flowSignal.trend})`,
  };
}

// --- Batch analyze order flow for multiple markets ---

export async function batchAnalyzeOrderFlow(
  marketIds: string[]
): Promise<Record<string, OrderFlowSignal | null>> {
  const results: Record<string, OrderFlowSignal | null> = {};

  for (const marketId of marketIds) {
    await takeOrderFlowSnapshot(marketId);
    results[marketId] = await analyzeOrderFlowTrend(marketId);
  }

  return results;
}