// ============================================================
// 7. Cross-Market Correlation Matrix
//    Prevents over-exposure to correlated bets
//    (e.g., BTC >$100K and ETH >$4K = same bet)
// ============================================================

import type { AgentPosition } from "../ai/types";

// Well-known correlations between prediction market categories
// These are reasonable defaults that can be overridden via env vars
const DEFAULT_CORRELATIONS: Record<string, Record<string, number>> = {
  // Crypto correlations
  "btc-price":   { "eth-price": 0.85, "sol-price": 0.78, "crypto-regulation": 0.3, "crypto-etf": 0.4 },
  "eth-price":   { "btc-price": 0.85, "sol-price": 0.75, "defi-tvl": 0.6 },
  "sol-price":   { "btc-price": 0.78, "eth-price": 0.75, "defi-tvl": 0.5 },
  "crypto-etf":  { "btc-price": 0.4, "crypto-regulation": 0.7 },
  "crypto-regulation": { "crypto-etf": 0.7, "btc-price": 0.3 },
  "defi-tvl":   { "eth-price": 0.6, "sol-price": 0.5 },

  // Political correlations
  "us-election":     { "us-policy": 0.8, "us-economy": 0.6, "geopolitics": 0.4 },
  "us-policy":       { "us-election": 0.8, "us-economy": 0.7, "regulation": 0.5 },
  "us-economy":      { "us-election": 0.6, "us-policy": 0.7, "fed-rate": 0.8 },
  "fed-rate":        { "us-economy": 0.8, "btc-price": 0.4, "stock-market": 0.7 },
  "geopolitics":     { "us-election": 0.4, "conflict": 0.6 },
  "conflict":        { "geopolitics": 0.6 },

  // Sports correlations (generally low)
  "nfl":   { "nfl-prop": 0.7 },
  "nba":    { "nba-prop": 0.7 },
  "soccer": { "soccer-prop": 0.6 },
};

export interface PositionRisk {
  marketId: string;
  marketQuestion: string;
  side: string;
  amount: number;
  category: string;
}

export interface CorrelationCheckResult {
  allowed: boolean;
  reason?: string;
  effectiveExposure: number;
  correlatedPositions: Array<{
    marketId: string;
    correlation: number;
    additionalExposure: number;
  }>;
}

// --- Classify a market question into a correlation category ---

function classifyMarket(question: string): string {
  const q = question.toLowerCase();

  if (q.includes("bitcoin") || q.includes("btc")) return "btc-price";
  if (q.includes("ethereum") || q.includes("eth")) return "eth-price";
  if (q.includes("solana") || q.includes("sol")) return "sol-price";
  if (q.includes("etf") && (q.includes("crypto") || q.includes("bitcoin") || q.includes("eth"))) return "crypto-etf";
  if (q.includes("regulat") && q.includes("crypto")) return "crypto-regulation";
  if (q.includes("tvl") || q.includes("defi")) return "defi-tvl";
  if (q.includes("election") || q.includes("president") || q.includes("vote")) return "us-election";
  if (q.includes("fed") || q.includes("interest rate") || q.includes("fomc")) return "fed-rate";
  if (q.includes("economy") || q.includes("gdp") || q.includes("inflation") || q.includes("recession")) return "us-economy";
  if (q.includes("policy") || q.includes("legislation") || q.includes("congress")) return "us-policy";
  if (q.includes("war") || q.includes("conflict") || q.includes("military") || q.includes("ceasefire")) return "conflict";
  if (q.includes("geopolitic") || q.includes("sanctions") || q.includes("nato")) return "geopolitics";
  if (q.includes("nfl") || q.includes("super bowl")) return "nfl";
  if (q.includes("nba") || q.includes("basketball")) return "nba";
  if (q.includes("soccer") || q.includes("fifa") || q.includes("world cup")) return "soccer";
  if (q.includes("stock") || q.includes("s&p") || q.includes("dow")) return "stock-market";

  // Substring matching as fallback
  if (q.includes("crypto") || q.includes("coin")) return "btc-price";
  if (q.includes("trump") || q.includes("biden")) return "us-election";

  return "unknown";
}

// --- Get correlation between two market categories ---

export function getCorrelation(cat1: string, cat2: string): number {
  if (cat1 === cat2) return 1.0;

  // Look up in both directions
  const forward = DEFAULT_CORRELATIONS[cat1]?.[cat2];
  if (forward !== undefined) return forward;

  const reverse = DEFAULT_CORRELATIONS[cat2]?.[cat1];
  if (reverse !== undefined) return reverse;

  // Unknown categories: assume low correlation
  return 0.1;
}

// --- Calculate effective exposure accounting for correlations ---

export function calculateEffectiveExposure(
  proposedMarket: string,
  proposedAmount: number,
  existingPositions: PositionRisk[]
): {
  effectiveExposure: number;
  correlatedPositions: Array<{ marketId: string; correlation: number; additionalExposure: number }>;
} {
  const proposedCat = classifyMarket(proposedMarket);

  let effectiveExposure = proposedAmount;
  const correlatedPositions: Array<{ marketId: string; correlation: number; additionalExposure: number }> = [];

  for (const pos of existingPositions) {
    const posCat = classifyMarket(pos.marketQuestion);
    const corr = getCorrelation(proposedCat, posCat);

    if (corr > 0.3) {
      // Correlated position: effective exposure increases
      const additionalExposure = pos.amount * corr;
      effectiveExposure += additionalExposure;
      correlatedPositions.push({
        marketId: pos.marketId,
        correlation: corr,
        additionalExposure,
      });
    }
  }

  return { effectiveExposure, correlatedPositions };
}

// --- Check if a proposed trade would create excessive correlation ---

export function checkCrossMarketCorrelation(
  proposedMarket: string,
  proposedAmount: number,
  existingPositions: PositionRisk[],
  totalBalance: number,
  maxCorrelatedExposurePct: number = 0.25
): CorrelationCheckResult {
  const { effectiveExposure, correlatedPositions } = calculateEffectiveExposure(
    proposedMarket,
    proposedAmount,
    existingPositions
  );

  const maxAllowed = totalBalance * maxCorrelatedExposurePct;

  if (effectiveExposure > maxAllowed) {
    const highCorrelations = correlatedPositions.filter((p) => p.correlation > 0.5);

    return {
      allowed: false,
      reason: `Correlated exposure too high: $${effectiveExposure.toFixed(2)} effective (limit: $${maxAllowed.toFixed(2)}). ` +
        `Correlated with ${correlatedPositions.length} positions (${highCorrelations.length} high-correlation). ` +
        `Positions: ${correlatedPositions.map((p) => `${p.marketId} (corr: ${(p.correlation * 100).toFixed(0)}%)`).join(", ")}`,
      effectiveExposure,
      correlatedPositions,
    };
  }

  return {
    allowed: true,
    reason: correlatedPositions.length > 0
      ? `Correlated exposure OK: $${effectiveExposure.toFixed(2)} effective (within $${maxAllowed.toFixed(2)} limit). ` +
        `Correlated with ${correlatedPositions.length} positions.`
      : "No correlated positions",
    effectiveExposure,
    correlatedPositions,
  };
}