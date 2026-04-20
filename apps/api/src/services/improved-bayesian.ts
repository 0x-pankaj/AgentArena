// ============================================================
// Improved Bayesian Synthesis (Phase 5)
// Uses per-market LLM analysis as ONE piece of evidence in
// a Bayesian update, instead of being the entire decision.
// Anchors to the market price (prior) and shifts based on:
//   1. LLM per-market analysis (weight: 3.0)
//   2. Category signal aggregation (weight: 2.0)
//   3. Web search sentiment (weight: 1.5)
//   4. Historical calibration (weight: varies)
// ============================================================

import type { MarketContext, AgentPosition } from "../ai/types";
import type { PerMarketAnalysis } from "./per-market-analysis";
import type { RankedMarket } from "./market-ranking";
import type { SharedSignals } from "./signal-cache";
import type { SearchResult } from "./web-search";

export interface BayesianEvidence {
  name: string;
  likelihoodYes: number;
  likelihoodNo: number;
  weight: number;
  source: string;
}

export interface BayesianResult {
  marketId: string;
  marketQuestion: string;
  prior: number;
  posterior: number;
  confidence: number;
  edgeDirection: "yes" | "no" | "none";
  edgeMagnitude: number;
  evidence: BayesianEvidence[];
  isNewMarket: boolean;
}

// --- Core Bayesian update ---

function bayesianUpdate(
  prior: number,
  evidence: BayesianEvidence[]
): number {
  let pYes = Math.max(0.001, Math.min(0.999, prior));
  let pNo = 1 - pYes;

  for (const e of evidence) {
    // Weighted evidence: weight scales how far likelihoods pull from neutral (0.5).
    // Higher weight = evidence has more influence on posterior.
    // weight=1.0 is baseline, weight=3.0 makes evidence ~3x more impactful.
    const w = Math.max(0.1, Math.min(e.weight ?? 1.0, 5.0));
    const scaleFactor = Math.min(w / 2.0, 1.0);
    const weightedLikelihoodYes = 0.5 + (e.likelihoodYes - 0.5) * scaleFactor;
    const weightedLikelihoodNo = 0.5 + (e.likelihoodNo - 0.5) * scaleFactor;

    const pEvidence = weightedLikelihoodYes * pYes + weightedLikelihoodNo * pNo;
    if (!isFinite(pEvidence) || pEvidence < 1e-10) continue;

    pYes = (weightedLikelihoodYes * pYes) / pEvidence;
    if (!isFinite(pYes)) continue;

    pYes = Math.max(0.001, Math.min(0.999, pYes));
    pNo = 1 - pYes;
  }

  return pYes;
}

// --- Convert LLM analysis to Bayesian evidence ---

function llmAnalysisToEvidence(
  analysis: PerMarketAnalysis,
  weight: number
): BayesianEvidence {
  // LLM probability as likelihood ratio
  const p = Math.max(0.01, Math.min(0.99, analysis.probability));
  // Convert probability to likelihood ratio
  // If LLM says P(YES) = 0.7, then likelihood(YES) = 0.7 / 0.5 = 1.4
  // But we need P(evidence|YES) and P(evidence|NO)
  //
  // Using Bayes: P(YES|evidence) ∝ P(evidence|YES) * P(YES)
  // We model the LLM output as: the LLM saw evidence E and concluded P(YES) = p
  // So the evidence supports YES with strength proportional to how far p is from 0.5

  const distanceFrom50 = Math.abs(p - 0.5);
  const direction = p > 0.5 ? 1 : -1;

  // Evidence quality multiplier
  const qualityMultiplier =
    analysis.evidenceQuality === "strong" ? 1.0 :
    analysis.evidenceQuality === "moderate" ? 0.75 :
    0.5;

  // Confidence multiplier (higher LLM confidence = stronger evidence)
  const confidenceMultiplier = analysis.confidence;

  const strength = 0.3 + distanceFrom50 * 1.2; // 0.3 baseline, up to ~0.9 at extremes
  const adjustedStrength = strength * qualityMultiplier * confidenceMultiplier;

  const likelihoodYes = 0.5 + direction * adjustedStrength;
  const likelihoodNo = 0.5 - direction * adjustedStrength;

  return {
    name: `llm_analysis_${analysis.recommendation}`,
    likelihoodYes: Math.max(0.01, Math.min(0.99, likelihoodYes)),
    likelihoodNo: Math.max(0.01, Math.min(0.99, likelihoodNo)),
    weight,
    source: `LLM (${analysis.evidenceQuality} evidence, ${analysis.sourcesUsed} sources)`,
  };
}

// --- Convert web search sentiment to evidence ---

function webSentimentToEvidence(
  searchResults: SearchResult[],
  weight: number
): BayesianEvidence {
  // Simple sentiment heuristic: count positive/negative words in snippets
  const positiveWords = ["up", "rise", "gain", "bull", "positive", "surge", "rally", "growth", "approve", "win", "success", "breakthrough", "higher"];
  const negativeWords = ["down", "fall", "loss", "bear", "negative", "crash", "decline", "drop", "reject", "lose", "fail", "risk", "lower"];

  let positiveCount = 0;
  let negativeCount = 0;

  for (const result of searchResults) {
    const text = `${result.title} ${result.snippet}`.toLowerCase();
    for (const word of positiveWords) {
      if (text.includes(word)) positiveCount++;
    }
    for (const word of negativeWords) {
      if (text.includes(word)) negativeCount++;
    }
  }

  const total = positiveCount + negativeCount;
  if (total === 0) {
    // No sentiment signal — neutral evidence
    return {
      name: "web_sentiment",
      likelihoodYes: 0.5,
      likelihoodNo: 0.5,
      weight: 0.5, // reduced weight for no data
      source: "web_search (no sentiment detected)",
    };
  }

  const sentimentScore = (positiveCount - negativeCount) / total; // -1 to +1
  const magnitude = Math.min(Math.abs(sentimentScore) * 0.3 + 0.05, 0.25);
  const direction = sentimentScore > 0 ? 1 : -1;

  return {
    name: "web_sentiment",
    likelihoodYes: 0.5 + direction * magnitude,
    likelihoodNo: 0.5 - direction * magnitude,
    weight,
    source: `web_search (${positiveCount}+ ${negativeCount}- from ${searchResults.length} results)`,
  };
}

// --- Decay function for signal age (module-level for reuse) ---

function decayWeight(baseWeight: number, signalAgeMinutes: number): number {
  if (signalAgeMinutes <= 0) return baseWeight;
  const halfLife = 30;
  return baseWeight * Math.pow(0.5, signalAgeMinutes / halfLife);
}

// --- Convert signal data to evidence (category-aware) ---

function signalsToEvidence(
  signals: SharedSignals,
  market: RankedMarket,
  calibratedWeights: Record<string, number>,
  signalAgeMinutes: number,
  category: string
): BayesianEvidence[] {
  const evidence: BayesianEvidence[] = [];
  const q = market.question.toLowerCase();

  // Decay function for signal age
  const decay = (baseWeight: number) => {
    return decayWeight(baseWeight, signalAgeMinutes);
  };

  // GDELT (political/geopolitical sentiment)
  if (signals.gdelt && Object.keys(signals.gdelt).length > 0) {
    const relevantRegions = Object.entries(signals.gdelt).filter(([region]) => {
      const regionLower = region.toLowerCase();
      return q.includes(regionLower) || category === "politics" || category === "general";
    });

    for (const [, signal] of relevantRegions.slice(0, 2)) {
      const s = signal as any;
      if (Math.abs(s.avgTone ?? 0) > 2) {
        const direction = (s.avgTone ?? 0) > 0 ? 1 : -1;
        const strength = Math.min(Math.abs(s.avgTone ?? 0) / 15, 0.3);
        const weight = calibratedWeights["gdelt_sentiment"] ?? 1.0;
        const decayedWeight = decay(weight);
        evidence.push({
          name: "gdelt_sentiment",
          likelihoodYes: 0.5 + direction * strength,
          likelihoodNo: 0.5 - direction * strength,
          weight: decayedWeight,
          source: `GDELT tone=${s.avgTone?.toFixed(2)} (${s.articleCount} articles)`,
        });
        break;
      }
    }
  }

  // FRED (macro)
  if (signals.fred && Object.keys(signals.fred).length > 0) {
    const relevantIndicators = Object.entries(signals.fred).filter(([key]) => {
      return q.includes("fed") || q.includes("rate") || q.includes("inflation") ||
        q.includes("gdp") || q.includes("recession") || q.includes("economy") ||
        category === "politics" || category === "general";
    });

    for (const [key, signal] of relevantIndicators.slice(0, 2)) {
      const s = signal as any;
      if (Math.abs(s.changePercent ?? 0) > 0.5) {
        const direction = (s.trend ?? "").toLowerCase().includes("up") ? 1 : -1;
        const strength = Math.min(Math.abs(s.changePercent ?? 0) / 10, 0.2);
        const weight = calibratedWeights["macro_signal"] ?? 1.5;
        const decayedWeight = decay(weight);
        evidence.push({
          name: "fred_macro",
          likelihoodYes: 0.5 + direction * strength,
          likelihoodNo: 0.5 - direction * strength,
          weight: decayedWeight,
          source: `FRED ${key}: ${s.trend} ${s.changePercent?.toFixed(2)}%`,
        });
      }
    }
  }

  // Crypto signals
  if (signals.crypto && (category === "crypto" || category === "general")) {
    const prices = signals.crypto.prices ?? {};
    for (const [symbol, data] of Object.entries(prices)) {
      const d = data as any;
      if (Math.abs(d.change24h ?? 0) > 3) {
        const isRelevant = q.includes(symbol.toLowerCase()) || q.includes("crypto") ||
          q.includes("bitcoin") || q.includes("ethereum") || q.includes("solana");
        const relevanceMultiplier = isRelevant ? 1.0 : 0.2;
        const direction = (d.change24h ?? 0) > 0 ? 1 : -1;
        const strength = Math.min(Math.abs(d.change24h ?? 0) / 25, 0.35) * relevanceMultiplier;
        if (strength > 0.05) {
          const weight = calibratedWeights["crypto_momentum"] ?? 2.0;
          const decayedWeight = decay(weight);
          evidence.push({
            name: `crypto_${symbol.toLowerCase()}`,
            likelihoodYes: 0.5 + direction * strength,
            likelihoodNo: 0.5 - direction * strength,
            weight: decayedWeight,
            source: `${symbol}: ${d.change24h?.toFixed(2)}% 24h, $${d.price}`,
          });
          break;
        }
      }
    }
  }

  return evidence;
}

// --- Main function: run improved Bayesian synthesis for markets ---

export function runImprovedBayesianSynthesis(
  markets: RankedMarket[],
  analyses: Map<string, PerMarketAnalysis>,
  signals: SharedSignals,
  researchData: Map<string, import("./market-research").PerMarketResearchData>,
  calibratedWeights: Record<string, number>,
  signalAgeMinutes: number,
  category: string
): BayesianResult[] {
  return markets.map((market) => {
    // Prior: market YES price (this is our baseline)
    const prior = market.outcomes.find((o) => o.name.toLowerCase() === "yes")?.price ?? 0.5;

    const evidence: BayesianEvidence[] = [];

    // 1. LLM analysis as evidence (weight: 3.0 for strong, 2.0 for moderate, 1.0 for weak)
    const analysis = analyses.get(market.marketId);
    if (analysis) {
      const llmWeight = calibratedWeights["llm_analysis"] ?? 3.0;
      const decayedLlmWeight = decayWeight(llmWeight, signalAgeMinutes);
      evidence.push(llmAnalysisToEvidence(analysis, decayedLlmWeight));
    }

    // 2. Category signals as evidence
    const signalEvidence = signalsToEvidence(
      signals, market, calibratedWeights, signalAgeMinutes, category
    );
    evidence.push(...signalEvidence);

    // 3. Web search sentiment as evidence
    const research = researchData.get(market.marketId);
    if (research && research.searchResults.length > 0) {
      const webWeight = calibratedWeights["web_sentiment"] ?? 1.5;
      const decayedWebWeight = decayWeight(webWeight, signalAgeMinutes);
      evidence.push(webSentimentToEvidence(research.searchResults, decayedWebWeight));
    }

    // 4. New market skepticism: compress posterior toward 0.5 (uncertainty)
    // Instead of neutral 0.5/0.5 (which is a no-op), we add evidence that
    // gently pulls toward the prior mean — this widens our uncertainty and
    // prevents overconfident bets on newly listed markets.
    if (market.isNewMarket) {
      // Slightly favor the "opposite" of whatever direction the evidence points,
      // reducing the net edge. This is equivalent to saying "new markets have
      // more noise, so I discount the signal strength by ~15%"
      const compressionStrength = 0.15;
      evidence.push({
        name: "new_market_uncertainty",
        likelihoodYes: 0.5 - compressionStrength * (prior > 0.5 ? 1 : prior < 0.5 ? -1 : 0),
        likelihoodNo: 0.5 + compressionStrength * (prior > 0.5 ? 1 : prior < 0.5 ? -1 : 0),
        weight: 1.0,
        source: "new market uncertainty penalty",
      });
    }

    // Run Bayesian update
    const posterior = bayesianUpdate(prior, evidence.length > 0 ? evidence : []);

    // Compute edge and direction
    const edge = posterior - prior;
    const absoluteEdge = Math.abs(edge);
    const direction = edge > 0.01 ? "yes" : edge < -0.01 ? "no" : "none";

    // Confidence: base LLM confidence, boosted by evidence count but capped.
    // Evidence weight already includes decay, so stale signals contribute less.
    const llmConfidence = analysis?.confidence ?? 0.5;
    const evidenceWeight = evidence.reduce((sum, e) => sum + e.weight, 0);
    const evidenceBoost = Math.min(evidenceWeight / 8, 0.25);
    const confidence = Math.min(0.95, llmConfidence + evidenceBoost * (1 - llmConfidence));

    return {
      marketId: market.marketId,
      marketQuestion: market.question,
      prior,
      posterior,
      confidence,
      edgeDirection: direction,
      edgeMagnitude: absoluteEdge,
      evidence,
      isNewMarket: market.isNewMarket,
    };
  });
}

// --- Select best market(s) to trade ---

export interface MarketSelection {
  marketId: string;
  marketQuestion: string;
  posterior: number;
  prior: number;
  edgeDirection: "yes" | "no";
  edgeMagnitude: number;
  confidence: number;
  isNewMarket: boolean;
  recommendation: string;
  rank: number;
}

export function selectBestMarket(
  bayesianResults: BayesianResult[],
  analyses: Map<string, PerMarketAnalysis>,
  positions: AgentPosition[],
  balance: number,
  minEdge: number = 0.05,
  minConfidence: number = 0.6
): MarketSelection[] {
  const selections: MarketSelection[] = [];

  for (const result of bayesianResults) {
    if (result.edgeDirection === "none") continue;
    if (result.edgeMagnitude < minEdge) continue;
    if (result.confidence < minConfidence) continue;

    // Check position limits
    const existingPositions = positions.filter((p) => p.marketId === result.marketId);
    if (existingPositions.length > 0) continue; // Already have a position here

    // Check portfolio concentration
    const proposedAmount = balance * 0.08; // 8% of portfolio
    const totalExposure = positions.reduce((sum, p) => sum + p.amount, 0) + proposedAmount;
    if (totalExposure / balance > 0.25) continue; // Too concentrated

    const analysis = analyses.get(result.marketId);

    selections.push({
      marketId: result.marketId,
      marketQuestion: result.marketQuestion,
      posterior: result.posterior,
      prior: result.prior,
      edgeDirection: result.edgeDirection as "yes" | "no",
      edgeMagnitude: result.edgeMagnitude,
      confidence: result.confidence,
      isNewMarket: result.isNewMarket,
      recommendation: analysis?.recommendation ?? "speculative",
      rank: 0,
    });
  }

  // Sort by edge * confidence (with new market bonus)
  selections.sort((a, b) => {
    const scoreA = a.edgeMagnitude * a.confidence * (a.isNewMarket ? 1.2 : 1.0);
    const scoreB = b.edgeMagnitude * b.confidence * (b.isNewMarket ? 1.2 : 1.0);
    return scoreB - scoreA;
  });

  // Assign ranks
  selections.forEach((s, i) => {
    s.rank = i + 1;
  });

  return selections;
}