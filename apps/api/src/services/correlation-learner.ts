// ============================================================
// Dynamic Correlation Learner
// Learns actual market correlations from trade outcomes instead
// of relying on static hardcoded correlations.
// Decays old observations with half-life of 30 days.
// ============================================================

import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import { db, schema } from "../db";
import { eq, and, desc, sql, isNotNull } from "drizzle-orm";

// --- Redis keys ---

const CORR_PREFIX = `${REDIS_KEYS.CALIBRATION_PREFIX}correlation:`;
const CORR_META_KEY = `${CORR_PREFIX}meta`;

// --- Types ---

export interface CorrelationObservation {
  market1Id: string;
  market2Id: string;
  market1Category: string;
  market2Category: string;
  outcome1: boolean; // true = YES won
  outcome2: boolean;
  observedAt: number;
}

export interface LearnedCorrelation {
  market1Category: string;
  market2Category: string;
  correlation: number; // -1 to 1
  sampleSize: number;
  lastUpdated: number;
  confidence: number; // how reliable is this correlation?
}

// --- Extract correlation category from market question ---

export function extractCorrelationCategory(question: string): string {
  const q = question.toLowerCase();

  // Crypto
  if (q.includes("bitcoin") || q.includes("btc")) return "btc";
  if (q.includes("ethereum") || q.includes("eth")) return "eth";
  if (q.includes("solana") || q.includes("sol")) return "sol";
  if (q.includes("crypto") || q.includes("altcoin")) return "crypto-broad";
  if (q.includes("etf") && (q.includes("bitcoin") || q.includes("crypto"))) return "crypto-etf";
  if (q.includes("defi") || q.includes("tvl")) return "defi";

  // Politics
  if (q.includes("election") || q.includes("president") || q.includes("vote")) return "election";
  if (q.includes("fed") || q.includes("interest rate") || q.includes("fomc")) return "fed";
  if (q.includes("gdp") || q.includes("inflation") || q.includes("recession")) return "macro";
  if (q.includes("war") || q.includes("conflict") || q.includes("ceasefire")) return "conflict";
  if (q.includes("policy") || q.includes("legislation")) return "policy";

  // Sports
  if (q.includes("nfl") || q.includes("super bowl")) return "nfl";
  if (q.includes("nba")) return "nba";
  if (q.includes("soccer") || q.includes("fifa") || q.includes("world cup")) return "soccer";

  // General
  if (q.includes("stock") || q.includes("s&p") || q.includes("nasdaq")) return "stocks";
  return "other";
}

// --- Record a correlation observation ---

export async function recordCorrelationObservation(
  obs: CorrelationObservation
): Promise<void> {
  const pairKey = getPairKey(obs.market1Category, obs.market2Category);
  const raw = await redis.get(pairKey);

  let data: {
    bothYes: number;
    bothNo: number;
    mixed: number;
    total: number;
    lastUpdated: number;
  };

  if (raw) {
    data = JSON.parse(raw);
  } else {
    data = { bothYes: 0, bothNo: 0, mixed: 0, total: 0, lastUpdated: Date.now() };
  }

  if (obs.outcome1 && obs.outcome2) data.bothYes++;
  else if (!obs.outcome1 && !obs.outcome2) data.bothNo++;
  else data.mixed++;

  data.total++;
  data.lastUpdated = Date.now();

  // Expire in 90 days (old observations decay away)
  await redis.setex(pairKey, 90 * 24 * 3600, JSON.stringify(data));
}

// --- Compute correlation from observations ---

function computeCorrelation(data: {
  bothYes: number;
  bothNo: number;
  mixed: number;
  total: number;
}): { correlation: number; confidence: number } {
  if (data.total < 5) {
    return { correlation: 0, confidence: 0 };
  }

  // Phi coefficient (correlation for binary variables)
  // n11 = bothYes, n00 = bothNo, n10 + n01 = mixed
  const n11 = data.bothYes;
  const n00 = data.bothNo;
  const n10_01 = data.mixed;

  const n1_ = n11 + (n10_01 / 2); // approximate marginal for market1 YES
  const n_1 = n11 + (n10_01 / 2); // approximate marginal for market2 YES
  const n0_ = n00 + (n10_01 / 2);
  const n_0 = n00 + (n10_01 / 2);

  const denominator = Math.sqrt(n1_ * n0_ * n_1 * n_0);

  if (denominator === 0) {
    return { correlation: 0, confidence: 0 };
  }

  const phi = (n11 * n00 - (n10_01 / 2) * (n10_01 / 2)) / denominator;

  // Confidence based on sample size (more observations = higher confidence)
  const confidence = Math.min(1, data.total / 50); // Max confidence at 50+ observations

  return { correlation: Math.max(-1, Math.min(1, phi)), confidence };
}

// --- Get learned correlation between two categories ---

export async function getLearnedCorrelation(
  cat1: string,
  cat2: string
): Promise<LearnedCorrelation> {
  const pairKey = getPairKey(cat1, cat2);
  const raw = await redis.get(pairKey);

  if (!raw) {
    return {
      market1Category: cat1,
      market2Category: cat2,
      correlation: 0,
      sampleSize: 0,
      lastUpdated: 0,
      confidence: 0,
    };
  }

  const data = JSON.parse(raw);
  const { correlation, confidence } = computeCorrelation(data);

  return {
    market1Category: cat1,
    market2Category: cat2,
    correlation,
    sampleSize: data.total,
    lastUpdated: data.lastUpdated,
    confidence,
  };
}

// --- Get all learned correlations ---

export async function getAllLearnedCorrelations(): Promise<LearnedCorrelation[]> {
  const keys = await redis.keys(`${CORR_PREFIX}*`);
  const results: LearnedCorrelation[] = [];

  for (const key of keys) {
    if (key === CORR_META_KEY) continue;
    const raw = await redis.get(key);
    if (!raw) continue;

    const data = JSON.parse(raw);
    const { correlation, confidence } = computeCorrelation(data);
    const [cat1, cat2] = key.replace(CORR_PREFIX, "").split(":");

    results.push({
      market1Category: cat1,
      market2Category: cat2,
      correlation,
      sampleSize: data.total,
      lastUpdated: data.lastUpdated,
      confidence,
    });
  }

  return results;
}

// --- Hybrid correlation: learned + fallback to static ---

import { getCorrelation as getStaticCorrelation } from "./correlation-matrix";

export async function getHybridCorrelation(
  cat1: string,
  cat2: string
): Promise<number> {
  if (cat1 === cat2) return 1.0;

  const learned = await getLearnedCorrelation(cat1, cat2);

  // If we have high-confidence learned correlation, use it
  if (learned.confidence > 0.3 && learned.sampleSize >= 10) {
    // Blend learned with static (70% learned, 30% static)
    const staticCorr = getStaticCorrelation(cat1, cat2);
    return learned.correlation * 0.7 + staticCorr * 0.3;
  }

  // Otherwise fall back to static
  return getStaticCorrelation(cat1, cat2);
}

// --- Process a batch of resolved markets to update correlations ---

export async function updateCorrelationsFromResolutions(
  resolutions: Array<{
    marketId: string;
    question: string;
    outcome: boolean;
    resolvedAt: Date;
  }>
): Promise<number> {
  let updatedCount = 0;

  // Compare every pair
  for (let i = 0; i < resolutions.length; i++) {
    for (let j = i + 1; j < resolutions.length; j++) {
      const r1 = resolutions[i];
      const r2 = resolutions[j];

      const cat1 = extractCorrelationCategory(r1.question);
      const cat2 = extractCorrelationCategory(r2.question);

      // Only track if categories are related or both in same broad area
      if (cat1 === cat2 || isRelatedCategory(cat1, cat2)) {
        await recordCorrelationObservation({
          market1Id: r1.marketId,
          market2Id: r2.marketId,
          market1Category: cat1,
          market2Category: cat2,
          outcome1: r1.outcome,
          outcome2: r2.outcome,
          observedAt: r1.resolvedAt.getTime(),
        });
        updatedCount++;
      }
    }
  }

  return updatedCount;
}

// --- Helper: are two categories related enough to track? ---

function isRelatedCategory(cat1: string, cat2: string): boolean {
  const groups = [
    ["btc", "eth", "sol", "crypto-broad", "crypto-etf", "defi"],
    ["election", "fed", "macro", "conflict", "policy"],
    ["nfl", "nba", "soccer"],
  ];

  for (const group of groups) {
    if (group.includes(cat1) && group.includes(cat2)) return true;
  }
  return false;
}

// --- Load historical correlations from DB (one-time migration) ---

export async function bootstrapCorrelationsFromDB(): Promise<number> {
  const trades = await db
    .select()
    .from(schema.trades)
    .where(isNotNull(schema.trades.outcome))
    .orderBy(desc(schema.trades.settledAt))
    .limit(500);

  const resolutions = trades.map((t) => ({
    marketId: t.marketId,
    question: t.marketQuestion ?? "",
    outcome: t.outcome === "win",
    resolvedAt: t.settledAt ?? new Date(),
  }));

  return updateCorrelationsFromResolutions(resolutions);
}

// --- Get pair key for Redis ---

function getPairKey(cat1: string, cat2: string): string {
  // Ensure consistent ordering
  const [a, b] = [cat1, cat2].sort();
  return `${CORR_PREFIX}${a}:${b}`;
}