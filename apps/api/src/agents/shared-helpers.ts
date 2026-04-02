// Shared helper functions used across all agent types.
// Extracted to prevent code duplication and ensure consistency.

import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import { publishFeedEvent, buildFeedEvent } from "../feed";
import { getMarket } from "../services/market-service";

// --- Bayesian probability estimation (clamped, safe) ---

export function bayesianUpdate(
  prior: number,
  evidence: Array<{ likelihoodYes: number; likelihoodNo: number }>
): number {
  let pYes = Math.max(0.001, Math.min(0.999, prior));
  let pNo = 1 - pYes;

  for (const { likelihoodYes, likelihoodNo } of evidence) {
    const pEvidence = likelihoodYes * pYes + likelihoodNo * pNo;
    if (!isFinite(pEvidence) || pEvidence < 1e-10) continue;
    pYes = (likelihoodYes * pYes) / pEvidence;
    if (!isFinite(pYes)) break;
    pYes = Math.max(0.001, Math.min(0.999, pYes));
    pNo = 1 - pYes;
  }

  return pYes;
}

// --- Signal aggregation with confidence weighting ---

export interface WeightedSignal {
  name: string;
  value: number;
  confidence: number;
  weight: number;
}

export function aggregateSignals(signals: WeightedSignal[]): {
  probability: number;
  confidence: number;
  nSignals: number;
} {
  if (signals.length === 0) return { probability: 0.5, confidence: 0, nSignals: 0 };

  let weightedSum = 0;
  let totalWeight = 0;
  let confidenceSum = 0;

  for (const signal of signals) {
    const w = signal.weight * signal.confidence;
    weightedSum += signal.value * w;
    totalWeight += w;
    confidenceSum += signal.confidence;
  }

  const probability = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  const confidence = signals.length > 0 ? confidenceSum / signals.length : 0;

  return {
    probability: Math.max(0, Math.min(1, probability)),
    confidence: Math.max(0, Math.min(1, confidence)),
    nSignals: signals.length,
  };
}

// --- Edge detection ---

export function calculateEdge(
  agentProbability: number,
  marketPrice: number,
  confidence: number,
  platformFee: number = 0.02
): {
  direction: "yes" | "no" | "none";
  rawEdge: number;
  netEdge: number;
  shouldTrade: boolean;
} {
  const rawEdgeYes = agentProbability - marketPrice;
  const rawEdgeNo = (1 - agentProbability) - (1 - marketPrice);
  const weightedEdgeYes = rawEdgeYes * confidence;
  const weightedEdgeNo = rawEdgeNo * confidence;
  const netEdgeYes = weightedEdgeYes - platformFee;
  const netEdgeNo = weightedEdgeNo - platformFee;

  if (netEdgeYes > netEdgeNo && netEdgeYes > 0) {
    return {
      direction: "yes",
      rawEdge: Math.round(rawEdgeYes * 10000) / 10000,
      netEdge: Math.round(netEdgeYes * 10000) / 10000,
      shouldTrade: netEdgeYes > 0.05,
    };
  } else if (netEdgeNo > 0) {
    return {
      direction: "no",
      rawEdge: Math.round(rawEdgeNo * 10000) / 10000,
      netEdge: Math.round(netEdgeNo * 10000) / 10000,
      shouldTrade: netEdgeNo > 0.05,
    };
  }

  return { direction: "none", rawEdge: 0, netEdge: 0, shouldTrade: false };
}

// --- Quarter-Kelly position sizing ---

export function kellyPositionSize(
  probability: number,
  marketPrice: number,
  portfolioBalance: number
): number {
  if (probability <= marketPrice) return 0;
  const odds = (1 - marketPrice) / marketPrice;
  const fullKelly = (probability * (odds + 1) - 1) / odds;
  const quarterKelly = Math.max(0, Math.min(fullKelly * 0.25, 0.25));
  const size = portfolioBalance * quarterKelly;
  return Math.max(5, Math.round(size * 100) / 100);
}

// --- Get market price ---

export function getMarketPrice(
  markets: Array<{ marketId: string; yesPrice: number; noPrice: number }>,
  marketId: string,
  side: "yes" | "no"
): number {
  const market = markets.find((m) => m.marketId === marketId);
  if (!market) return 0.5;
  return side === "yes" ? market.yesPrice : market.noPrice;
}

// --- Feed step publisher ---

export async function publishFeedStep(
  agentId: string,
  category: string,
  message: string,
  content: Record<string, unknown> = {},
  severity: "info" | "significant" | "critical" = "info"
): Promise<void> {
  try {
    const feedEvent = buildFeedEvent({
      agentId,
      agentName: "Agent",
      category: category as any,
      severity,
      content: { summary: message, ...content },
      displayMessage: message,
    });
    await publishFeedEvent(feedEvent);
  } catch {
    // feed errors should not break the pipeline
  }
}
