// ============================================================
// Analysis Cursor Service
// Tracks which markets have been analyzed across agent ticks.
// Implements a sliding window: each tick analyzes a new batch
// of markets, reusing cached results from previous ticks.
//
// Tick 1: Analyze markets 1-6 (research + LLM)
// Tick 2: Markets 1-6 cached, analyze markets 5-12
// Tick 3: Markets 1-12 cached, analyze markets 10-18
// Tick 4: Refresh markets 1-6 (cache expired), re-analyze
//
// This means every tick discovers NEW edges instead of
// re-analyzing the same top markets. Research cache (15min)
// is maximally utilized across ticks and across agents.
// ============================================================

import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import type { PerMarketAnalysis } from "./per-market-analysis";
import type { RankedMarket } from "./market-ranking";
import type { BayesianResult } from "./improved-bayesian";

// --- Types ---

export interface AnalyzedMarket {
  marketId: string;
  question: string;
  probability: number;
  confidence: number;
  recommendation: string;
  evidenceQuality: string;
  isNewMarket: boolean;
  analyzedAt: number;
  tickCount: number;
  bayesianPosterior: number;
  bayesianEdge: number;
  bayesianDirection: string;
}

export interface AnalysisCursor {
  agentId: string;
  lastTickRank: number;
  tickCount: number;
  updatedAt: number;
  analyzedMarkets: AnalyzedMarket[];
}

const CURSOR_KEY_PREFIX = "agent:analysis_cursor:";
const CURSOR_TTL = 30 * 60; // 30 minutes — cursor resets if agent is idle

// --- Save cursor state ---

export async function saveAnalysisCursor(cursor: AnalysisCursor): Promise<void> {
  const key = `${CURSOR_KEY_PREFIX}${cursor.agentId}`;
  await redis.setex(key, CURSOR_TTL, JSON.stringify(cursor));
}

// --- Load cursor state ---

export async function loadAnalysisCursor(agentId: string): Promise<AnalysisCursor | null> {
  const key = `${CURSOR_KEY_PREFIX}${agentId}`;
  const raw = await redis.get(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AnalysisCursor;
  } catch {
    await redis.del(key);
    return null;
  }
}

// --- Determine which markets to analyze this tick ---
// Returns markets that need fresh analysis (not recently analyzed)
// and markets that can be reused from cache.

export interface TickAnalysisPlan {
  freshMarkets: RankedMarket[];    // Need research + LLM analysis
  cachedMarkets: AnalyzedMarket[];  // Already analyzed, reuse results
  batchSize: number;
  overlapSize: number;
  windowStart: number;
  windowEnd: number;
}

export function planNextTickAnalysis(
  allMarkets: RankedMarket[],
  cursor: AnalysisCursor | null,
  tickIntervalMinutes: number = 5,
  maxBatchSize: number = 6,
  maxOverlap: number = 2,
  maxAnalyzedPerTick: number = 8
): TickAnalysisPlan {
  if (allMarkets.length === 0) {
    return { freshMarkets: [], cachedMarkets: [], batchSize: 0, overlapSize: 0, windowStart: 0, windowEnd: 0 };
  }

  const tickCount = cursor?.tickCount ?? 0;
  const lastTickRank = cursor?.lastTickRank ?? 0;

  // Build a set of recently analyzed market IDs (within last 15 min)
  const recentAnalysis = new Map<string, AnalyzedMarket>();
  if (cursor?.analyzedMarkets) {
    const now = Date.now();
    for (const m of cursor.analyzedMarkets) {
      const ageMinutes = (now - m.analyzedAt) / 60000;
      if (ageMinutes < 15) { // Only reuse if analyzed within last 15 minutes
        recentAnalysis.set(m.marketId, m);
      }
    }
  }

  // Sliding window:
  // Tick 0: analyze markets ranked 1-6
  // Tick 1: overlap last 2, analyze markets 5-12
  // Tick 2: overlap last 2, analyze markets 10-17
  // Tick N: analyze markets (lastTickRank - overlap) to (lastTickRank + batchSize - overlap)
  let windowStart: number;
  let windowEnd: number;

  if (tickCount === 0 || lastTickRank === 0) {
    // First tick: start from the top
    windowStart = 0; // index 0 = rank 1
    windowEnd = Math.min(maxBatchSize, allMarkets.length);
  } else {
    // Subsequent ticks: overlap with last tick, then move forward
    windowStart = Math.max(0, lastTickRank - maxOverlap); // Overlap last 2
    windowEnd = Math.min(windowStart + maxAnalyzedPerTick, allMarkets.length);

    // If we've gone through all markets, reset to the top
    // but only if enough time has passed for data to be fresh (15+ min)
    if (windowStart >= allMarkets.length) {
      windowStart = 0;
      windowEnd = Math.min(maxBatchSize, allMarkets.length);
    }
  }

  const windowMarkets = allMarkets.slice(windowStart, windowEnd);

  // Separate into fresh (need analysis) and cached (reuse)
  const freshMarkets: RankedMarket[] = [];
  const cachedMarkets: AnalyzedMarket[] = [];

  for (const market of windowMarkets) {
    const cached = recentAnalysis.get(market.marketId);
    if (cached && cached.evidenceQuality !== "stale") {
      cachedMarkets.push(cached);
    } else {
      freshMarkets.push(market);
    }
  }

  // If we have too few fresh markets, expand the window
  // This ensures we always have something new to analyze each tick
  if (freshMarkets.length < 2 && windowEnd < allMarkets.length) {
    const additionalNeeded = maxBatchSize - freshMarkets.length;
    const additionalMarkets = allMarkets.slice(windowEnd, windowEnd + additionalNeeded);
    for (const market of additionalMarkets) {
      const cached = recentAnalysis.get(market.marketId);
      if (cached && cached.evidenceQuality !== "stale") {
        cachedMarkets.push(cached);
      } else {
        freshMarkets.push(market);
      }
    }
  }

  return {
    freshMarkets,
    cachedMarkets,
    batchSize: windowEnd - windowStart,
    overlapSize: Math.max(0, (lastTickRank - maxOverlap) - Math.max(0, windowStart)),
    windowStart,
    windowEnd,
  };
}

// --- Build analyzed market entries from analysis results ---

export function buildAnalyzedMarkets(
  analysisResults: Array<{ marketId: string; question: string; analysis: PerMarketAnalysis; isNewMarket: boolean }>,
  bayesianResults: BayesianResult[],
  tickCount: number
): AnalyzedMarket[] {
  const bayesianMap = new Map(bayesianResults.map((b) => [b.marketId, b]));

  return analysisResults.map((r) => {
    const bayes = bayesianMap.get(r.marketId);
    return {
      marketId: r.marketId,
      question: r.question,
      probability: r.analysis.probability,
      confidence: r.analysis.confidence,
      recommendation: r.analysis.recommendation,
      evidenceQuality: r.analysis.evidenceQuality,
      isNewMarket: r.isNewMarket,
      analyzedAt: Date.now(),
      tickCount,
      bayesianPosterior: bayes?.posterior ?? r.analysis.probability,
      bayesianEdge: bayes?.edgeMagnitude ?? 0,
      bayesianDirection: bayes?.edgeDirection ?? "none",
    };
  });
}

// --- Merge new analysis with previous cursor state ---

export function mergeAnalyzedMarkets(
  previous: AnalyzedMarket[] | undefined,
  newMarkets: AnalyzedMarket[]
): AnalyzedMarket[] {
  const merged = new Map<string, AnalyzedMarket>();

  // Add previous markets (they may have stale data)
  if (previous) {
    for (const m of previous) {
      merged.set(m.marketId, m);
    }
  }

  // Overwrite with fresh analysis
  for (const m of newMarkets) {
    merged.set(m.marketId, m);
  }

  // Keep only markets analyzed in the last 30 minutes (discard old data)
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes
  return Array.from(merged.values()).filter((m) => now - m.analyzedAt < maxAge);
}

// --- Select best market from combined fresh + cached results ---

export function selectMarketFromHistory(
  freshAnalyses: Map<string, PerMarketAnalysis>,
  cachedMarkets: AnalyzedMarket[],
  bayesianResults: BayesianResult[],
  positions: Array<{ marketId: string }>,
  minEdge: number = 0.05,
  minConfidence: number = 0.6
): Array<{
  marketId: string;
  question: string;
  probability: number;
  edgeDirection: string;
  edgeMagnitude: number;
  confidence: number;
  isNewMarket: boolean;
  recommendation: string;
  source: "fresh" | "cached";
}> {
  const positionIds = new Set(positions.map((p) => p.marketId));
  const bayesianMap = new Map(bayesianResults.map((b) => [b.marketId, b]));
  const candidates: Array<{
    marketId: string;
    question: string;
    probability: number;
    edgeDirection: string;
    edgeMagnitude: number;
    confidence: number;
    isNewMarket: boolean;
    recommendation: string;
    source: "fresh" | "cached";
  }> = [];

  // Fresh results (from this tick's LLM analysis)
  for (const [marketId, analysis] of freshAnalyses) {
    const bayes = bayesianMap.get(marketId);
    const edge = bayes?.edgeMagnitude ?? Math.abs(analysis.probability - 0.5);
    const direction = bayes?.edgeDirection ?? (analysis.probability > 0.5 ? "yes" : "no");
    const confidence = bayes?.confidence ?? analysis.confidence;

    if (edge >= minEdge && confidence >= minConfidence && !positionIds.has(marketId)) {
      candidates.push({
        marketId,
        question: analysis.reasoning?.slice(0, 60) ?? marketId,
        probability: bayes?.posterior ?? analysis.probability,
        edgeDirection: direction,
        edgeMagnitude: edge,
        confidence,
        isNewMarket: false, // will be set from rankedMarkets
        recommendation: analysis.recommendation,
        source: "fresh",
      });
    }
  }

  // Cached results (from previous tick's analysis)
  for (const cached of cachedMarkets) {
    if (positionIds.has(cached.marketId)) continue;
    const edge = cached.bayesianEdge;
    const confidence = cached.confidence;

    if (edge >= minEdge && confidence >= minConfidence) {
      // Slightly discount cached results (they're a few minutes old)
      const discountedConfidence = confidence * 0.95;

      candidates.push({
        marketId: cached.marketId,
        question: cached.question,
        probability: cached.bayesianPosterior,
        edgeDirection: cached.bayesianDirection,
        edgeMagnitude: edge,
        confidence: discountedConfidence,
        isNewMarket: cached.isNewMarket,
        recommendation: cached.recommendation,
        source: "cached",
      });
    }
  }

  // Sort by edge × confidence (with new market bonus)
  candidates.sort((a, b) => {
    const scoreA = a.edgeMagnitude * a.confidence * (a.isNewMarket ? 1.2 : 1.0);
    const scoreB = b.edgeMagnitude * b.confidence * (b.isNewMarket ? 1.2 : 1.0);
    return scoreB - scoreA;
  });

  return candidates;
}