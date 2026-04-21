import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import { db, schema } from "../db";
import { eq, desc, sql, and, gte } from "drizzle-orm";

// ============================================================
// 1. Signal Calibration Engine + 9. Confidence Calibration
//    Learns from outcomes to auto-adjust signal weights and
//    LLM confidence honesty scores.
// ============================================================

export interface SignalScore {
  source: string;
  predicted: number;
  actual: number;
  brierScore: number;
  sampleSize: number;
  weight: number;
}

export interface ConfidenceCalibrationBucket {
  predictedRange: string; // e.g. "0.70-0.75"
  predicted: number;
  actual: number;
  count: number;
}

// Default half-lives (in minutes) for signal decay per source
const DEFAULT_HALF_LIVES: Record<string, number> = {
  gdelt: 30,
  acled: 120,
  fred: 1440,
  firms: 60,
  coingecko: 5,
  defillama: 30,
  twitter: 15,
  market: 2,
};

// --- Load calibration data from Redis (fast) ---

async function getCalibrationScores(
  agentType: string
): Promise<Record<string, SignalScore>> {
  const key = `${REDIS_KEYS.AGENT_STATS_PREFIX}calibration:${agentType}`;
  const cached = await redis.get(key);
  if (cached) {
    try {
      return JSON.parse(cached) as Record<string, SignalScore>;
    } catch {
      return {};
    }
  }
  return {};
}

async function saveCalibrationScores(
  agentType: string,
  scores: Record<string, SignalScore>
): Promise<void> {
  const key = `${REDIS_KEYS.AGENT_STATS_PREFIX}calibration:${agentType}`;
  await redis.setex(key, 3600, JSON.stringify(scores));
}

// --- Record a signal prediction for later calibration ---

export async function recordSignalPrediction(
  agentType: string,
  source: string,
  predicted: number,
  marketId: string,
  positionId: string
): Promise<void> {
  const key = `${REDIS_KEYS.AGENT_STATS_PREFIX}predictions:${agentType}:${marketId}`;
  const existing = await redis.get(key);
  const predictions = existing ? JSON.parse(existing) : {};

  predictions[source] = {
    predicted,
    positionId,
    timestamp: Date.now(),
  };

  await redis.setex(key, 7 * 24 * 3600, JSON.stringify(predictions));
}

// --- Record a confidence prediction for calibration ---

export async function recordConfidencePrediction(
  agentType: string,
  model: string,
  predictedConfidence: number,
  marketId: string,
  positionId: string
): Promise<void> {
  const key = `${REDIS_KEYS.AGENT_STATS_PREFIX}confidence_pred:${agentType}:${positionId}`;
  await redis.setex(
    key,
    7 * 24 * 3600,
    JSON.stringify({
      model,
      predictedConfidence,
      marketId,
      positionId,
      timestamp: Date.now(),
    })
  );
}

// --- Score a resolved market (called when a position closes or market resolves) ---

export async function scoreResolvedMarket(
  agentType: string,
  marketId: string,
  actualOutcome: boolean // true = YES won, false = NO won
): Promise<void> {
  const actual = actualOutcome ? 1 : 0;

  // 1. Score signal predictions
  const predKey = `${REDIS_KEYS.AGENT_STATS_PREFIX}predictions:${agentType}:${marketId}`;
  const predRaw = await redis.get(predKey);
  if (predRaw) {
    const predictions = JSON.parse(predRaw) as Record<
      string,
      { predicted: number; positionId: string; timestamp: number }
    >;

    const scores = await getCalibrationScores(agentType);

    for (const [source, pred] of Object.entries(predictions)) {
      const brier = (pred.predicted - actual) ** 2;

      if (!scores[source]) {
        scores[source] = {
          source,
          predicted: pred.predicted,
          actual,
          brierScore: brier,
          sampleSize: 1,
          weight: 1.0,
        };
      } else {
        const s = scores[source];
        const n = s.sampleSize;
        s.brierScore = (s.brierScore * n + brier) / (n + 1);
        s.sampleSize = n + 1;

        // Adjust weight: lower Brier = higher weight (inverse-variance weighting)
        // Weight = 1 / (brier + 0.05) so that:
        //   - Perfect signal (brier=0) -> weight=20.0 (capped at 5.0)
        //   - Good signal (brier=0.1) -> weight=6.7
        //   - Decent signal (brier=0.2) -> weight=4.0
        //   - Weak signal (brier=0.4) -> weight=2.2
        //   - Random signal (brier=0.5) -> weight=1.8
        const adjustedBrier = Math.max(s.brierScore, 0.01);
        const rawWeight = 1 / (adjustedBrier + 0.05);
        s.weight = Math.max(0.1, Math.min(5.0, rawWeight));
      }
    }

    await saveCalibrationScores(agentType, scores);

    // Also persist to DB for durability
    for (const [source, pred] of Object.entries(predictions)) {
      await db.insert(schema.signalCalibration).values({
        agentType,
        source,
        predicted: String(pred.predicted),
        actual: String(actual),
        brierScore: String((pred.predicted - actual) ** 2),
        marketId,
        positionId: pred.positionId,
      }).onConflictDoNothing().catch(() => {});
    }
  }

  // 2. Score confidence calibration
  const positionIds = predRaw
    ? Object.values(JSON.parse(predRaw) as Record<string, { positionId: string }>).map(
        (p) => p.positionId
      )
    : [];

  for (const positionId of positionIds) {
    const confKey = `${REDIS_KEYS.AGENT_STATS_PREFIX}confidence_pred:${agentType}:${positionId}`;
    const confRaw = await redis.get(confKey);
    if (confRaw) {
      const conf = JSON.parse(confRaw) as {
        model: string;
        predictedConfidence: number;
        marketId: string;
      };

      await db.insert(schema.confidenceCalibration).values({
        agentType,
        model: conf.model,
        predictedConfidence: String(conf.predictedConfidence),
        actualOutcome: actualOutcome ? "true" : "false",
        positionId,
        marketId: conf.marketId,
      }).onConflictDoNothing().catch(() => {});

      await redis.del(confKey);
    }
  }

  // Clean up predictions key
  await redis.del(predKey);

  // Record the outcome for future reference
  await redis.setex(
    `${REDIS_KEYS.AGENT_STATS_PREFIX}outcome:${marketId}`,
    30 * 24 * 3600,
    JSON.stringify({ actual, timestamp: Date.now() })
  );
}

// --- Get calibrated weight for a signal source ---

export async function getCalibratedWeight(
  agentType: string,
  source: string,
  defaultWeight: number = 1.0
): Promise<number> {
  const scores = await getCalibrationScores(agentType);
  const score = scores[source];

  if (!score || score.sampleSize < 5) {
    return defaultWeight; // Not enough data yet, use default
  }

  return score.weight;
}

// --- Get all calibrated weights for an agent type ---

export async function getAllCalibratedWeights(
  agentType: string
): Promise<Record<string, number>> {
  const scores = await getCalibrationScores(agentType);

  const weights: Record<string, number> = {};
  for (const [source, score] of Object.entries(scores)) {
    if (score.sampleSize >= 5) {
      weights[source] = score.weight;
    }
  }

  return weights;
}

// --- Get confidence calibration adjustment ---

export async function getConfidenceAdjustment(
  agentType: string,
  model: string,
  predictedConfidence: number
): Promise<number> {
  // Look up historical calibration for this model/agent combination
  // Returns a multiplier to apply (e.g., 0.85 if model is overconfident by 15%)
  const key = `${REDIS_KEYS.AGENT_STATS_PREFIX}confidence_cal:${agentType}:${model}`;
  const cached = await redis.get(key);
  if (cached) {
    try {
      const cal = JSON.parse(cached) as Record<string, number>;
      const bucket = findBucket(predictedConfidence);
      return cal[bucket] ?? 1.0;
    } catch {
      return 1.0;
    }
  }

  // Compute from DB
  try {
    const rows = await db
      .select({
        predictedConfidence: schema.confidenceCalibration.predictedConfidence,
        actualOutcome: schema.confidenceCalibration.actualOutcome,
      })
      .from(schema.confidenceCalibration)
      .where(
        and(
          eq(schema.confidenceCalibration.agentType, agentType),
          eq(schema.confidenceCalibration.model, model)
        )
      )
      .limit(500);

    if (rows.length < 10) return 1.0;

    // Bucket by predicted confidence and compute actual win rate per bucket
    const buckets: Record<string, { total: number; wins: number }> = {};
    for (const row of rows) {
      const pred = Number(row.predictedConfidence);
      const bucket = findBucket(pred);
      if (!buckets[bucket]) buckets[bucket] = { total: 0, wins: 0 };
      buckets[bucket].total++;
      if (row.actualOutcome === "true") buckets[bucket].wins++;
    }

    // Adjustment = actual_win_rate / predicted_midpoint
    const adjustments: Record<string, number> = {};
    for (const [bucket, data] of Object.entries(buckets)) {
      if (data.total < 5) continue;
      const actualRate = data.wins / data.total;
      const midpoints: Record<string, number> = {
        "0.50-0.55": 0.525, "0.55-0.60": 0.575, "0.60-0.65": 0.625,
        "0.65-0.70": 0.675, "0.70-0.75": 0.725, "0.75-0.80": 0.775,
        "0.80-0.85": 0.825, "0.85-0.90": 0.875, "0.90-0.95": 0.925,
        "0.95-1.00": 0.975,
      };
      const midpoint = midpoints[bucket] ?? Number(rows[0]?.predictedConfidence ?? 0.5);
      const adj = midpoint > 0 ? actualRate / midpoint : 1.0;
      adjustments[bucket] = Math.max(0.5, Math.min(1.5, adj));
    }

    await redis.setex(key, 3600, JSON.stringify(adjustments));
    return adjustments[findBucket(predictedConfidence)] ?? 1.0;
  } catch {
    return 1.0;
  }
}

function findBucket(confidence: number): string {
  const lower = Math.floor(confidence * 20) / 20;
  const upper = lower + 0.05;
  return `${lower.toFixed(2)}-${upper.toFixed(2)}`;
}

// --- Decay confidence based on signal age (Feature 2) ---

export function decayConfidence(
  baseConfidence: number,
  signalAgeMinutes: number,
  source: string = "default"
): number {
  const halfLife = DEFAULT_HALF_LIVES[source] ?? 30;
  const decayed = baseConfidence * Math.pow(0.5, signalAgeMinutes / halfLife);
  return Math.max(0.01, Math.min(1.0, decayed));
}

// --- Decay all signal weights based on age ---

export interface TimestampedSignal {
  value: number;
  confidence: number;
  fetchedAt: number; // unix ms
  source: string;
}

export function decaySignalConfidence(signal: TimestampedSignal): number {
  const ageMinutes = (Date.now() - signal.fetchedAt) / 60000;
  return decayConfidence(signal.confidence, ageMinutes, signal.source);
}