// ============================================================
// 10. Scenario Tree Analysis
//     Pre-trade expected value calculation across multiple
//     scenarios (best/base/worst case).
// ============================================================

import type { MarketContext, AgentPosition } from "../agents/strategy-engine";
import { AGENT_LIMITS } from "@agent-arena/shared";

export interface ScenarioResult {
  name: string;
  probability: number;
  outcome: "YES" | "NO";
  pnl: number;
  expectedValue: number;
}

export interface ScenarioAnalysisResult {
  scenarios: ScenarioResult[];
  totalExpectedValue: number;
  riskRewardRatio: number;
  shouldTrade: boolean;
  reason: string;
}

// --- Calculate expected value across scenarios ---

export function runScenarioAnalysis(params: {
  estimatedProbability: number;
  marketPrice: number;
  amount: number;
  isYes: boolean;
  platformFee: number;
  positions: AgentPosition[];
  balance: number;
}): ScenarioAnalysisResult {
  const {
    estimatedProbability,
    marketPrice,
    amount,
    isYes,
    platformFee = 0.02,
    positions,
    balance,
  } = params;

  // Generate three scenarios
  const confidence = estimatedProbability;
  const uncertainty = 0.1; // ±10% probability uncertainty

  const scenarios: ScenarioResult[] = [];

  // Best case: probability shifted up
  const bestProb = Math.min(0.99, confidence + uncertainty);
  const bestOutcome = bestProb > 0.5 ? "YES" : "NO";
  const bestPnl = calculatePnl(bestProb, marketPrice, amount, isYes, platformFee);
  scenarios.push({
    name: "best_case",
    probability: bestProb,
    outcome: bestOutcome,
    pnl: bestPnl,
    expectedValue: bestProb * bestPnl + (1 - bestProb) * calculatePnl(1 - bestProb, marketPrice, amount, isYes, platformFee),
  });

  // Base case: estimated probability as-is
  const baseOutcome = confidence > 0.5 ? "YES" : "NO";
  const basePnl = calculatePnl(confidence, marketPrice, amount, isYes, platformFee);
  scenarios.push({
    name: "base_case",
    probability: confidence,
    outcome: baseOutcome,
    pnl: basePnl,
    expectedValue: confidence * basePnl + (1 - confidence) * calculatePnl(1 - confidence, marketPrice, amount, isYes, platformFee),
  });

  // Worst case: probability shifted down
  const worstProb = Math.max(0.01, confidence - uncertainty);
  const worstOutcome = worstProb > 0.5 ? "YES" : "NO";
  const worstPnl = calculatePnl(worstProb, marketPrice, amount, isYes, platformFee);
  scenarios.push({
    name: "worst_case",
    probability: worstProb,
    outcome: worstOutcome,
    pnl: worstPnl,
    expectedValue: worstProb * worstPnl + (1 - worstProb) * calculatePnl(1 - worstProb, marketPrice, amount, isYes, platformFee),
  });

  // Also add three more specific scenarios
  // "Market resolves YES at estimated probability"
  const yesPnl = isYes
    ? (1 - marketPrice) * amount - platformFee * amount
    : -(marketPrice * amount + platformFee * amount);
  scenarios.push({
    name: "market_yes",
    probability: confidence,
    outcome: "YES",
    pnl: isYes ? (1 - marketPrice) * amount - platformFee * amount : -(marketPrice * amount + platformFee * amount),
    expectedValue: confidence * (isYes ? (1 - marketPrice) * amount - platformFee * amount : -(marketPrice * amount + platformFee * amount)),
  });

  // "Market resolves NO"
  scenarios.push({
    name: "market_no",
    probability: 1 - confidence,
    outcome: "NO",
    pnl: !isYes ? marketPrice * amount - platformFee * amount : -(amount * (1 - marketPrice) + platformFee * amount),
    expectedValue: (1 - confidence) * (!isYes ? marketPrice * amount - platformFee * amount : -(amount * (1 - marketPrice) + platformFee * amount)),
  });

  // Calculate overall expected value (probability-weighted)
  const totalEV = confidence * yesPnl + (1 - confidence) * (!isYes ? marketPrice * amount - platformFee * amount : -(1 - marketPrice) * amount);

  // Risk/reward ratio
  const maxGain = Math.max(...scenarios.map((s) => s.pnl));
  const maxLoss = Math.min(...scenarios.map((s) => s.pnl));
  const riskRewardRatio = maxLoss !== 0 ? Math.abs(maxGain / maxLoss) : maxGain > 0 ? Infinity : 0;

  // Check portfolio concentration
  const totalExposure = positions.reduce((sum, p) => sum + p.amount, 0) + amount;
  const concentrationRisk = totalExposure / balance;

  // Decision
  const shouldTrade =
    totalEV > 0 && // Positive expected value
    riskRewardRatio >= 1.5 && // At least 1.5:1 reward:risk
    confidence > AGENT_LIMITS.MIN_CONFIDENCE && // Meets minimum confidence
    concentrationRisk < AGENT_LIMITS.MAX_CATEGORY_EXPOSURE; // Not over-concentrated

  const reason = !shouldTrade
    ? totalEV <= 0
      ? `Negative expected value ($${totalEV.toFixed(2)}) across scenarios`
      : riskRewardRatio < 1.5
      ? `Risk/reward ratio too low (${riskRewardRatio.toFixed(2)}:1, need 1.5:1)`
      : confidence <= AGENT_LIMITS.MIN_CONFIDENCE
      ? `Confidence too low (${(confidence * 100).toFixed(0)}%, need ${(AGENT_LIMITS.MIN_CONFIDENCE * 100).toFixed(0)}%)`
      : `Portfolio concentration too high (${(concentrationRisk * 100).toFixed(0)}%)`
    : `Positive EV ($${totalEV.toFixed(2)}), risk/reward ${riskRewardRatio.toFixed(2)}:1, concentration ${(concentrationRisk * 100).toFixed(0)}%`;

  return {
    scenarios,
    totalExpectedValue: totalEV,
    riskRewardRatio,
    shouldTrade,
    reason,
  };
}

// --- Helper: Calculate PnL for a position ---

function calculatePnl(
  probability: number,
  marketPrice: number,
  amount: number,
  isYes: boolean,
  platformFee: number
): number {
  if (isYes) {
    // Buying YES: profit if YES resolves
    return probability * (1 - marketPrice) * amount - (1 - probability) * marketPrice * amount - platformFee * amount;
  } else {
    // Buying NO: profit if NO resolves
    return probability * marketPrice * amount - (1 - probability) * (1 - marketPrice) * amount - platformFee * amount;
  }
}

// --- Quick check: should we even bother with full analysis? ---

export function quickScenarioGate(
  estimatedProbability: number,
  marketPrice: number,
  amount: number,
  isYes: boolean,
  balance: number,
  positions: AgentPosition[]
): { pass: boolean; reason: string } {
  // Edge detection
  const edge = isYes
    ? estimatedProbability - marketPrice
    : (1 - estimatedProbability) - (1 - marketPrice);

  if (Math.abs(edge) < 0.05) {
    return { pass: false, reason: `Edge too small (${(edge * 100).toFixed(1)}%)` };
  }

  // Quick EV estimate
  const quickEV = edge * amount;
  if (quickEV <= 0) {
    return { pass: false, reason: `Negative quick EV ($${quickEV.toFixed(2)})` };
  }

  // Position count check
  if (positions.length >= AGENT_LIMITS.MAX_CONCURRENT_POSITIONS) {
    return { pass: false, reason: `Max positions reached (${positions.length}/${AGENT_LIMITS.MAX_CONCURRENT_POSITIONS})` };
  }

  // Amount check
  const pctOfPortfolio = amount / balance;
  if (pctOfPortfolio > AGENT_LIMITS.MAX_PORTFOLIO_PERCENT_PER_MARKET) {
    return { pass: false, reason: `Position size ${(pctOfPortfolio * 100).toFixed(1)}% exceeds ${(AGENT_LIMITS.MAX_PORTFOLIO_PERCENT_PER_MARKET * 100).toFixed(0)}% limit` };
  }

  return { pass: true, reason: "Quick gate passed" };
}