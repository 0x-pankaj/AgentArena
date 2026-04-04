// Configurable signal weights for Bayesian evidence and signal aggregation.
// Weights can be overridden via environment variables for calibration.

export interface SignalWeight {
  likelihoodYes: number;
  likelihoodNo: number;
}

export interface SignalSourceWeight {
  baseWeight: number;
  confidenceMultiplier: number;
}

// Default Bayesian evidence weights
export const DEFAULT_BAYESIAN_WEIGHTS: Record<string, SignalWeight> = {
  gdelt_positive: { likelihoodYes: 0.7, likelihoodNo: 0.3 },
  gdelt_negative: { likelihoodYes: 0.3, likelihoodNo: 0.7 },
  acled_conflict: { likelihoodYes: 0.75, likelihoodNo: 0.25 },
  acled_calm: { likelihoodYes: 0.4, likelihoodNo: 0.6 },
  fred_bullish: { likelihoodYes: 0.65, likelihoodNo: 0.35 },
  fred_bearish: { likelihoodYes: 0.35, likelihoodNo: 0.65 },
  firms_fire: { likelihoodYes: 0.6, likelihoodNo: 0.4 },
  twitter_positive: { likelihoodYes: 0.55, likelihoodNo: 0.45 },
  twitter_negative: { likelihoodYes: 0.45, likelihoodNo: 0.55 },
  market_momentum: { likelihoodYes: 0.7, likelihoodNo: 0.3 },
  coingecko_bullish: { likelihoodYes: 0.65, likelihoodNo: 0.35 },
  defillama_healthy: { likelihoodYes: 0.6, likelihoodNo: 0.4 },
};

// Default signal source weights for aggregation
export const DEFAULT_SIGNAL_WEIGHTS: Record<string, SignalSourceWeight> = {
  gdelt: { baseWeight: 1.0, confidenceMultiplier: 1.2 },
  acled: { baseWeight: 1.2, confidenceMultiplier: 1.3 },
  fred: { baseWeight: 0.8, confidenceMultiplier: 1.0 },
  firms: { baseWeight: 0.6, confidenceMultiplier: 0.8 },
  twitter: { baseWeight: 0.7, confidenceMultiplier: 0.9 },
  coingecko: { baseWeight: 1.0, confidenceMultiplier: 1.1 },
  defillama: { baseWeight: 0.8, confidenceMultiplier: 1.0 },
  market: { baseWeight: 1.5, confidenceMultiplier: 1.5 },
};

// Parse env var overrides like: SIGNAL_WEIGHT_GDELT=1.2,0.7,1.1
// Format: baseWeight,likelihoodYes,confidenceMultiplier
function parseWeightOverride(envVar: string, defaults: number[]): number[] {
  const raw = process.env[envVar];
  if (!raw) return defaults;
  const parts = raw.split(",").map(Number);
  return parts.map((v, i) => (isNaN(v) ? defaults[i] : v));
}

export function getBayesianWeight(source: string): SignalWeight {
  const weight = DEFAULT_BAYESIAN_WEIGHTS[source];
  if (!weight) return { likelihoodYes: 0.5, likelihoodNo: 0.5 };

  const envKey = `SIGNAL_WEIGHT_${source.toUpperCase()}`;
  const overrides = parseWeightOverride(envKey, [
    weight.likelihoodYes,
    weight.likelihoodNo,
    1.0,
  ]);

  return {
    likelihoodYes: Math.max(0.01, Math.min(0.99, overrides[0])),
    likelihoodNo: Math.max(0.01, Math.min(0.99, overrides[1])),
  };
}

export function getSignalSourceWeight(source: string): SignalSourceWeight {
  const weight = DEFAULT_SIGNAL_WEIGHTS[source];
  if (!weight) return { baseWeight: 1.0, confidenceMultiplier: 1.0 };

  const envKey = `SIGNAL_SOURCE_${source.toUpperCase()}`;
  const overrides = parseWeightOverride(envKey, [
    weight.baseWeight,
    1.0,
    weight.confidenceMultiplier,
  ]);

  return {
    baseWeight: Math.max(0.1, overrides[0]),
    confidenceMultiplier: Math.max(0.1, overrides[2]),
  };
}

export function getAllBayesianWeights(): Record<string, SignalWeight> {
  return { ...DEFAULT_BAYESIAN_WEIGHTS };
}

export function getAllSignalSourceWeights(): Record<string, SignalSourceWeight> {
  return { ...DEFAULT_SIGNAL_WEIGHTS };
}
