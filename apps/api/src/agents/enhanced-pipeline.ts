// ============================================================
// Enhanced Agent Pipeline (v2)
// Shared pipeline function that all agents use for the new
// market scanning → ranking → research → analysis → Bayesian
// → decision flow.
//
// KEY FEATURE: Sliding window analysis across ticks.
// Tick 1: Analyze top 5-6 markets
// Tick 2: Reuse cached results for top 6, analyze markets 5-12
// Tick 3: Reuse cached results, analyze markets 10-18
// This discovers edges in lower-ranked markets over time.
// ============================================================

import { redis } from "../utils/redis";
import { REDIS_KEYS, AGENT_LIMITS } from "@agent-arena/shared";
import { publishFeedStep } from "./shared-helpers";
import { AgentFSM } from "./fsm";
import { scanAndRankMarkets, type ScannedAndRankedResult } from "./execution-engine";
import { type RankedMarket } from "../services/market-ranking";
import { type PerMarketAnalysisResult } from "../services/per-market-analysis";
import { type BayesianResult, type MarketSelection } from "../services/improved-bayesian";
import { type ResearchPhaseResult } from "../services/market-research";
import { getSharedSignals, type SharedSignals } from "../services/signal-cache";
import { getAllCalibratedWeights, decayConfidence } from "../services/calibration-service";
import { quickDecision } from "../ai/pipeline";
import type { TradeDecision, ModelConfig, AgentRuntimeContext, AgentTool } from "../ai/types";
import { TradeDecisionSchema } from "../ai/types";
import { runMultiModelConsensus } from "../services/multi-model-consensus";
import { runAdversarialReview } from "../services/adversarial-review";
import { runScenarioAnalysis, quickScenarioGate } from "../services/scenario-analysis";
import { checkCrossMarketCorrelation } from "../services/correlation-matrix";
import { recordAgentPrediction as recordOutcomePrediction } from "../services/outcome-feedback";
import { publishReasoningEvent } from "./execution-engine";
import { buildPortfolioSnapshot } from "./execution-engine";
import { getActivePositions } from "../services/trade-service";
import type { MarketContext, AgentPosition } from "./strategy-engine";
import type { PortfolioSnapshot } from "../plugins/risk-plugin";
import {
  loadAnalysisCursor,
  saveAnalysisCursor,
  planNextTickAnalysis,
  buildAnalyzedMarkets,
  mergeAnalyzedMarkets,
  selectMarketFromHistory,
  type AnalysisCursor,
  type AnalyzedMarket,
} from "../services/analysis-cursor";
import { analyzeMarketsInBatch } from "../services/per-market-analysis";
import { buildResearchContextForLLM } from "../services/market-research";
import { runImprovedBayesianSynthesis } from "../services/improved-bayesian";

// Tool sets for decision phase — allows final verification search
const CATEGORY_DECISION_TOOLS: Record<string, string[]> = {
  crypto: [
    "web_search",
    "coingecko_price", "coingecko_global",
    "twitter_search",
    "market_search", "market_detail",
  ],
  politics: [
    "web_search",
    "gdelt_search", "gdelt_tone",
    "acled_search", "acled_conflict_signal",
    "fred_series", "fred_macro_signal",
    "twitter_search", "twitter_social_signal",
    "market_search", "market_detail",
  ],
  sports: [
    "web_search",
    "twitter_search",
    "market_search", "market_detail",
  ],
  general: [
    "web_search",
    "gdelt_search", "gdelt_tone",
    "coingecko_price", "coingecko_global",
    "twitter_search",
    "market_search", "market_detail",
  ],
};

// --- Result of the full enhanced pipeline ---

export interface EnhancedPipelineResult {
  state: string;
  action: string;
  detail: string;
  decision?: TradeDecision;
  tokensUsed?: number;
  scanResult?: ScannedAndRankedResult;
}

// --- Build the decision context with research + Bayesian data ---

function buildEnhancedDecisionContext(
  analysisResults: PerMarketAnalysisResult[],
  research: ResearchPhaseResult,
  bayesianResults: BayesianResult[],
  bestMarkets: MarketSelection[],
  signals: SharedSignals,
  positions: AgentPosition[],
  balance: number,
  temporalAdj: Record<string, number>,
  category: string
): string {
  const parts: string[] = [];

  // Top candidates (detailed)
  parts.push("## Top Market Candidates (by edge × confidence):\n");
  for (const m of bestMarkets.slice(0, 3)) {
    parts.push(`### ${m.rank}. "${m.marketQuestion}"`);
    parts.push(`| Our probability: ${(m.posterior * 100).toFixed(1)}% | Market price: ${(m.prior * 100).toFixed(1)}% | Edge: ${(m.edgeMagnitude * 100).toFixed(1)}% ${m.edgeDirection.toUpperCase()}`);
    parts.push(`| Confidence: ${(m.confidence * 100).toFixed(0)}% | ${m.isNewMarket ? "⚡ NEW MARKET" : "Established"} | Recommendation: ${m.recommendation}`);

    // Find the analysis for this market
    const analysis = analysisResults.find((a) => a.marketId === m.marketId);
    if (analysis) {
      parts.push(`| LLM Analysis: Probability ${(analysis.analysis.probability * 100).toFixed(1)}%, Evidence quality: ${analysis.analysis.evidenceQuality}`);
      parts.push(`| Key factors: ${analysis.analysis.keyFactors.slice(0, 3).join(", ")}`);
      parts.push(`| Risks: ${analysis.analysis.risks.slice(0, 3).join(", ")}`);
    }

    // Bayesian evidence
    const bayes = bayesianResults.find((b) => b.marketId === m.marketId);
    if (bayes && bayes.evidence.length > 0) {
      parts.push(`| Evidence (${bayes.evidence.length} signals):`);
      for (const e of bayes.evidence.slice(0, 5)) {
        parts.push(`  - ${e.name}: YES=${(e.likelihoodYes * 100).toFixed(0)}% NO=${(e.likelihoodNo * 100).toFixed(0)}% (weight=${e.weight.toFixed(1)} from ${e.source})`);
      }
    }
    parts.push("");
  }

  // Brief list of other markets
  if (research.brief.length > 0) {
    parts.push("## Other Markets (brief):\n");
    for (const m of research.brief.slice(0, 8)) {
      const hoursToClose = m.closesAt
        ? ((new Date(m.closesAt).getTime() - Date.now()) / 3600000).toFixed(0)
        : "?";
      parts.push(`- [${m.marketId}] "${m.question.slice(0, 60)}..." | Vol=$${m.volume.toLocaleString()} | ${hoursToClose}h${m.isNewMarket ? " [NEW]" : ""}`);
    }
    parts.push("");
  }

  // Portfolio
  parts.push(`## Portfolio\n- Balance: $${balance.toFixed(2)} USDC\n- Open positions: ${positions.length}/${AGENT_LIMITS.MAX_CONCURRENT_POSITIONS}`);
  if (positions.length > 0) {
    for (const p of positions.slice(0, 5)) {
      parts.push(`  - ${p.marketId}: ${p.side.toUpperCase()} $${p.amount} @ ${p.entryPrice} (PnL: $${p.pnl.toFixed(2)})`);
    }
  }

  // Signal summary
  parts.push(`\n## Signal Summary\n- GDELT events: ${Object.keys(signals.gdelt).length}\n- ACLED regions: ${Object.keys(signals.acled).length}\n- FRED indicators: ${Object.keys(signals.fred).length}`);
  if (signals.crypto) {
    parts.push(`- Crypto prices: ${Object.keys(signals.crypto.prices).length}\n- Global market: ${signals.crypto.global ? `${signals.crypto.global.marketCapChange24h?.toFixed(1)}% 24h` : "N/A"}`);
  }
  if (signals.sports) {
    parts.push(`- Sports events: ${Object.keys(signals.sports).length}`);
  }

  // Temporal adjustments
  parts.push(`\n## Temporal Adjustments`);
  for (const [id, adj] of Object.entries(temporalAdj).slice(0, 10)) {
    parts.push(`- ${id}: ${(adj * 100).toFixed(0)}%`);
  }

  parts.push(`\n## Decision Required`);
  parts.push(`Based on the analysis, Bayesian synthesis, and research above, make a trade decision.`);
  parts.push(`If edge > 5% and confidence > ${(AGENT_LIMITS.MIN_CONFIDENCE * 100).toFixed(0)}%, recommend a trade on the best candidate.`);
  parts.push(`Otherwise, recommend hold. Remember: quarter-Kelly for position sizing.`);
  parts.push(`IMPORTANT: Consider time-to-resolution. Near-resolution markets need HIGHER confidence to trade.`);
  parts.push(`For NEW markets with low volume: your edge may be larger due to mispricing — be more confident if research supports it.`);

  return parts.join("\n");
}

// --- Full enhanced pipeline (Phase 1-6) ---

export async function runEnhancedPipeline(
  ctx: AgentRuntimeContext,
  fsm: AgentFSM,
  config: {
    agentId: string;
    agentName: string;
    category: string;
    models: { analysis: ModelConfig; decision: ModelConfig };
    decisionSystemPrompt: string;
  },
  saveState: () => Promise<void>
): Promise<EnhancedPipelineResult> {
  const { agentId, agentName, category } = config;

  // ===== PHASE 1: Market Discovery via MarketEventBus =====
  if (fsm.getState() === "SCANNING") {
    await publishFeedStep(agentId, "scanning", `${agentName} scanning ${category} prediction markets...`, { pipeline_stage: "scanning_start" });
    await publishFeedStep(agentId, "scanning", `${agentName} fetching markets from Jupiter Predict (via EventBus)...`, { pipeline_stage: "fetching_markets" });
    fsm.transition("markets_found");
    await saveState();
  }

  // ===== PHASE 2-5: Signals + Ranking + Research + Analysis =====
  if (fsm.getState() === "ANALYZING") {
    await publishFeedStep(agentId, "signal_update", `${agentName} fetching ${category} signals...`, { pipeline_stage: "signal_fetch_start" });

    // Fetch signals
    const signals = await getSharedSignals(category);
    const signalCount = Object.keys(signals.gdelt).length + Object.keys(signals.acled).length +
      Object.keys(signals.fred).length +
      (signals.crypto ? Object.keys(signals.crypto.prices).length : 0) +
      (signals.sports ? Object.keys(signals.sports).length : 0);

    await publishFeedStep(agentId, "signal_update", `${agentName} received ${signalCount} signal streams`, {
      pipeline_stage: "signals_ready",
      signals_count: signalCount,
    });

    // Load markets from Redis (saved in SCANNING phase)
    const marketsRaw = await redis.get(`${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}:markets`);
    const markets: MarketContext[] = marketsRaw ? JSON.parse(marketsRaw) : [];

    if (markets.length === 0) {
      fsm.transition("no_edge");
      await saveState();
      return { state: fsm.getState(), action: "analyzed", detail: "No markets cached" };
    }

    // Get positions and portfolio
    const { positions: dbPositions } = await getActivePositions(ctx.jobId);
    const positions: AgentPosition[] = dbPositions.map((p) => ({
      marketId: p.marketId, side: p.side, amount: Number(p.amount),
      entryPrice: Number(p.entryPrice), currentPrice: Number(p.currentPrice ?? p.entryPrice),
      pnl: Number(p.pnl ?? 0),
    }));

    const portfolio = await buildPortfolioSnapshot(ctx.agentWalletAddress, positions, ctx.jobId);

    // Check thresholds
    const lastAnalysisRaw = await redis.get(`${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}:last_analysis`);
    const lastAnalysisTime = lastAnalysisRaw ? Number(lastAnalysisRaw) : null;

    const { checkThresholds } = await import("./strategy-engine");
    const thresholdCheck = checkThresholds(signals, lastAnalysisTime, markets, positions, category);

    if (!thresholdCheck.triggered) {
      fsm.transition("no_edge");
      await saveState();
      await publishFeedStep(agentId, "thinking", `${agentName}: No signal thresholds triggered — skipping deep analysis`, { pipeline_stage: "threshold_check", reasons: [] });
      return { state: fsm.getState(), action: "analyzed", detail: "No thresholds triggered, skipping" };
    }

    await publishFeedStep(agentId, "thinking", `${agentName} ⚡ ${thresholdCheck.reasons.length} signal triggers detected`, {
      pipeline_stage: "thresholds_triggered",
      signals_count: signalCount,
      trigger_reasons: thresholdCheck.reasons,
    }, "significant");

    // ===== SLIDING WINDOW: Determine which markets to analyze this tick =====
    await publishFeedStep(agentId, "thinking", `${agentName} 🔍 Phase 2/3: Planning analysis window...`, { pipeline_stage: "enhanced_pipeline_start" });

    const signalAgeMinutes = signals.fetchedAt
      ? (Date.now() - new Date(signals.fetchedAt).getTime()) / 60000
      : 0;

    const calibratedWeights = await getAllCalibratedWeights(category);

    // Load previous analysis cursor (which markets we already analyzed)
    const previousCursor = await loadAnalysisCursor(agentId);
    const tickCount = (previousCursor?.tickCount ?? 0) + 1;

    const scanResult = await scanAndRankMarkets(
      category,
      agentId,
      agentName
    );

    if (scanResult.ranked.deep.length === 0) {
      await redis.set(`${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}:last_analysis`, String(Date.now()));
      fsm.transition("no_edge");
      await saveState();
      await publishFeedStep(agentId, "thinking", `${agentName}: No deep markets to analyze`, {
        pipeline_stage: "no_markets",
      });
      return { state: fsm.getState(), action: "analyzed", detail: "No deep markets to analyze", tokensUsed: 0 };
    }

    // Plan which markets to analyze this tick using sliding window
    const allRankedMarkets = [...scanResult.ranked.deep, ...scanResult.ranked.brief];
    const analysisPlan = planNextTickAnalysis(allRankedMarkets, previousCursor, 5, 6, 2, 8);

    await publishFeedStep(agentId, "thinking", `${agentName} 📊 Analysis window [tick #${tickCount}]: markets ${analysisPlan.windowStart + 1}-${analysisPlan.windowEnd} | ${analysisPlan.freshMarkets.length} fresh + ${analysisPlan.cachedMarkets.length} cached`, {
      pipeline_stage: "analysis_window",
      tick_count: tickCount,
      window_start: analysisPlan.windowStart + 1,
      window_end: analysisPlan.windowEnd,
      fresh_count: analysisPlan.freshMarkets.length,
      cached_count: analysisPlan.cachedMarkets.length,
      total_markets: allRankedMarkets.length,
    });

    // ===== Analyze FRESH markets (those not in cache) =====
    let freshAnalysisResults: PerMarketAnalysisResult[] = [];
    let freshAnalysisMap = new Map<string, import("../services/per-market-analysis").PerMarketAnalysis>();
    let analysisTokensUsed = 0;

    if (analysisPlan.freshMarkets.length > 0) {
      await publishFeedStep(agentId, "thinking", `${agentName} 🔬 Analyzing ${analysisPlan.freshMarkets.length} fresh markets (tick #${tickCount})...`, {
        pipeline_stage: "per_market_analysis_start",
        fresh_markets: analysisPlan.freshMarkets.map(m => `"${m.question.slice(0, 30)}..."`).join(", "),
      });

      freshAnalysisResults = await analyzeMarketsInBatch(
        analysisPlan.freshMarkets,
        scanResult.research.researchData,
        signals,
        positions,
        portfolio.totalBalance,
        config.models.analysis,
        agentId,
        agentName,
        category
      );

      for (const result of freshAnalysisResults) {
        freshAnalysisMap.set(result.marketId, result.analysis);
      }
      analysisTokensUsed += freshAnalysisResults.reduce((sum, r) => sum + r.tokensUsed, 0);
    }

    // Run Bayesian synthesis on fresh markets only (cached already has results)
    const freshBayesianResults = runImprovedBayesianSynthesis(
      analysisPlan.freshMarkets,
      freshAnalysisMap,
      signals,
      scanResult.research.researchData,
      calibratedWeights,
      signalAgeMinutes,
      category
    );

    // ===== Combine fresh + cached analysis results =====
    const analyzedMarkets = buildAnalyzedMarkets(
      freshAnalysisResults.map(r => ({
        marketId: r.marketId,
        question: r.question,
        analysis: r.analysis,
        isNewMarket: r.isNewMarket,
      })),
      freshBayesianResults,
      tickCount
    );

    const mergedAnalyzed = mergeAnalyzedMarkets(previousCursor?.analyzedMarkets, analyzedMarkets);

    // ===== Select best market from combined fresh + cached results =====
    const AGENT_MIN_EDGE = 0.05;
    const AGENT_MIN_CONFIDENCE = AGENT_LIMITS.MIN_CONFIDENCE;

    const allCandidates = selectMarketFromHistory(
      freshAnalysisMap,
      mergedAnalyzed,
      freshBayesianResults,
      positions,
      AGENT_MIN_EDGE,
      AGENT_MIN_CONFIDENCE
    );

    // Save cursor for next tick
    const newCursor: AnalysisCursor = {
      agentId,
      lastTickRank: analysisPlan.windowEnd,
      tickCount,
      updatedAt: Date.now(),
      analyzedMarkets: mergedAnalyzed,
    };
    await saveAnalysisCursor(newCursor);

    // If no candidates with edge found
    if (allCandidates.length === 0) {
      await redis.set(`${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}:last_analysis`, String(Date.now()));
      fsm.transition("no_edge");
      await saveState();
      await publishFeedStep(agentId, "thinking", `${agentName}: No markets with sufficient edge found (analyzed ${freshAnalysisResults.length} fresh + ${analysisPlan.cachedMarkets.length} cached)`, {
        pipeline_stage: "no_edge",
        markets_analyzed: freshAnalysisResults.length,
        cached_markets: analysisPlan.cachedMarkets.length,
        total_analyzed: mergedAnalyzed.length,
      });
      return { state: fsm.getState(), action: "analyzed", detail: `No edge found (${freshAnalysisResults.length} fresh + ${analysisPlan.cachedMarkets.length} cached)`, tokensUsed: analysisTokensUsed };
    }

    // Log analysis summary
    const bestCandidate = allCandidates[0];
    await publishFeedStep(agentId, "thinking", `${agentName} ✅ Analysis complete: ${freshAnalysisResults.length} fresh + ${analysisPlan.cachedMarkets.length} cached | Best: "${bestCandidate.question.slice(0, 40)}..." (${(bestCandidate.edgeMagnitude * 100).toFixed(1)}% ${bestCandidate.edgeDirection}) [${bestCandidate.source}]`, {
      pipeline_stage: "analysis_summary",
      fresh_analyzed: freshAnalysisResults.length,
      cached_reused: analysisPlan.cachedMarkets.length,
      total_candidates: allCandidates.length,
      best_candidate: {
        question: bestCandidate.question,
        edge: `${(bestCandidate.edgeMagnitude * 100).toFixed(1)}% ${bestCandidate.edgeDirection}`,
        confidence: `${(bestCandidate.confidence * 100).toFixed(0)}%`,
        source: bestCandidate.source,
        is_new: bestCandidate.isNewMarket,
      },
    }, "significant");

    // ===== PHASE 6: Decision =====
    await publishFeedStep(agentId, "thinking", `${agentName} 🎯 Making trade decision (tick #${tickCount})...`, { pipeline_stage: "decision_start" });

    // Temporal adjustments
    const { computeTemporalAdjustment } = await import("./shared-pipeline-utils");
    const temporalAdj = computeTemporalAdjustment(markets);

    // Build decision context using the best candidate
    // Include both fresh analysis and cached results
    const bestMarketContext = scanResult.ranked.deep.find(m => m.marketId === bestCandidate.marketId) ?? scanResult.ranked.brief.find(m => m.marketId === bestCandidate.marketId);
    const bestMarketAnalysis = freshAnalysisMap.get(bestCandidate.marketId);
    const bestMarketResearch = scanResult.research.researchData.get(bestCandidate.marketId);

    // Build brief list for other candidates (fresh + cached)
    const otherCandidates = allCandidates.slice(1, 6).map(c => {
      const m = scanResult.ranked.deep.find(m => m.marketId === c.marketId) ?? scanResult.ranked.brief.find(m => m.marketId === c.marketId);
      if (!m) return `- [${c.marketId}] (cached) edge=${(c.edgeMagnitude * 100).toFixed(1)}% ${c.edgeDirection}`;
      const prices = m.outcomes.map((o: { name: string; price: number }) => `${o.name}:$${o.price?.toFixed(2) ?? "?"}`).join("/");
      return `- [${m.marketId}] "${m.question.slice(0, 60)}" | ${prices} | score=${m.score.toFixed(2)}${m.isNewMarket ? " [NEW]" : ""} [${c.source}]`;
    });

    const decisionUserMessage = `## Best Market Candidate (tick #${tickCount}, ${bestCandidate.source} analysis)

### "${bestCandidate.question}"
Market ID: ${bestCandidate.marketId}
Edge: ${(bestCandidate.edgeMagnitude * 100).toFixed(1)}% ${bestCandidate.edgeDirection.toUpperCase()}
Confidence: ${(bestCandidate.confidence * 100).toFixed(0)}%
Is New Market: ${bestCandidate.isNewMarket ? "YES — potentially mispriced" : "No"}
Recommendation: ${bestCandidate.recommendation}

${bestMarketAnalysis ? `### LLM Analysis (${bestCandidate.source}):
Probability: ${(bestCandidate.probability * 100).toFixed(1)}%
Key Factors: ${bestMarketAnalysis.keyFactors?.slice(0, 3).join(", ") ?? "N/A"}
Risks: ${bestMarketAnalysis.risks?.slice(0, 3).join(", ") ?? "N/A"}
Evidence Quality: ${bestMarketAnalysis.evidenceQuality ?? "N/A"}` : "(Analysis from previous tick — cached)"}

${bestMarketResearch ? `### Research Context:
${buildResearchContextForLLM(bestMarketContext!, bestMarketResearch)}` : "(No fresh research for this market)"}

## Other Candidates:
${otherCandidates.join("\n") || "(No other candidates with edge)"}

## Portfolio
- Balance: $${portfolio.totalBalance.toFixed(2)} USDC
- Open positions: ${positions.length}/${AGENT_LIMITS.MAX_CONCURRENT_POSITIONS}
${positions.length > 0 ? positions.slice(0, 3).map(p => `  - ${p.marketId}: ${p.side.toUpperCase()} $${p.amount} @ ${p.entryPrice} (PnL: $${p.pnl.toFixed(2)})`).join("\n") : ""}

## Sliding Window Info
- Tick #${tickCount}: Analyzed markets ${analysisPlan.windowStart + 1}-${analysisPlan.windowEnd}
- Fresh this tick: ${freshAnalysisResults.length} markets
- Cached from previous ticks: ${analysisPlan.cachedMarkets.length} markets
- Total analyzed history: ${mergedAnalyzed.length} markets

## Decision Required
Based on the analysis above, make a trade decision on the best market.
If edge > 5% and confidence > ${(AGENT_LIMITS.MIN_CONFIDENCE * 100).toFixed(0)}%, recommend a trade.
Otherwise, recommend hold. Use quarter-Kelly for position sizing.
IMPORTANT: For NEW markets with low volume, the edge may be larger due to mispricing — be more confident if research supports it.
You have access to web_search and other tools for a final verification if needed.`;

    let decision: TradeDecision;
    let decisionTokens = 0;

    try {
      // Decision LLM gets tools for final verification (e.g., breaking news check)
      const decisionTools = CATEGORY_DECISION_TOOLS[category] ?? CATEGORY_DECISION_TOOLS.general;
      const result = await quickDecision<TradeDecision>({
        modelConfig: config.models.decision,
        systemPrompt: config.decisionSystemPrompt,
        userMessage: decisionUserMessage,
        schema: TradeDecisionSchema,
        tools: decisionTools,
        agentId,
      });
      decision = result.decision;
      decisionTokens = result.tokensUsed;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      fsm.transition("no_edge");
      await saveState();
      return { state: fsm.getState(), action: "analyzed", detail: `Decision stage error: ${errorMsg}`, tokensUsed: analysisTokensUsed };
    }

    const totalTokensUsed = analysisTokensUsed + decisionTokens;

// Validate decision
    const { validateDecision } = await import("./execution-engine");
    const validation = validateDecision(decision, markets);
    if (!validation.valid) {
      fsm.transition("no_edge");
      await saveState();
      return { state: fsm.getState(), action: "analyzed", detail: `Decision rejected: ${validation.error}`, decision, tokensUsed: totalTokensUsed };
    }

    // Hold or low confidence
    if (decision.action === "hold" || decision.confidence < AGENT_LIMITS.MIN_CONFIDENCE) {
      await redis.set(`${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}:last_analysis`, String(Date.now()));
      fsm.transition("no_edge");
      await saveState();
      await publishReasoningEvent(ctx.agentId, ctx.jobId, decision, agentName);
      return { state: fsm.getState(), action: "analyzed", detail: `Decision: hold (confidence: ${(decision.confidence * 100).toFixed(0)}%)`, decision, tokensUsed: totalTokensUsed };
    }

    // Edge calculation for fast-path
    const { calculateEdge } = await import("./shared-helpers");
    const pricesMap = markets.map(m => ({
      marketId: m.marketId,
      yesPrice: m.outcomes.find(o => o.name.toLowerCase() === "yes")?.price ?? 0.5,
      noPrice: m.outcomes.find(o => o.name.toLowerCase() === "no")?.price ?? 0.5,
    }));
    const marketPrice = decision.isYes
      ? (pricesMap.find(m => m.marketId === decision.marketId)?.yesPrice ?? 0.5)
      : (pricesMap.find(m => m.marketId === decision.marketId)?.noPrice ?? 0.5);
    const edge = calculateEdge(bestCandidate.probability, marketPrice, decision.confidence);

// Fast-path for high-conviction trades: skip multi-model consensus (expensive)
    // but ALWAYS run adversarial review (safety-critical)
    const FAST_PATH_EDGE_THRESHOLD = 0.15;
    const useFastPath = edge.netEdge > FAST_PATH_EDGE_THRESHOLD && decision.confidence >= 0.85;

    if (useFastPath) {
      await publishFeedStep(agentId, "edge_detected", `${agentName} ⚡ FAST-PATH: Edge ${(edge.netEdge * 100).toFixed(1)}% + confidence ${(decision.confidence * 100).toFixed(0)}% — skipping consensus (adversarial review still runs)`, {
        pipeline_stage: "fast_path",
        edge: edge.netEdge,
        confidence: decision.confidence,
        source: bestCandidate.source,
      }, "significant");
    }

    // ===== POST-DECISION CHECKS =====
    if (decision.marketId) {
      // Scenario gate
      const scenarioGate = quickScenarioGate(
        bestCandidate.probability,
        marketPrice,
        decision.amount ?? 0,
        !!decision.isYes,
        portfolio.totalBalance,
        positions
      );

      if (!scenarioGate.pass) {
        fsm.transition("no_edge");
        await saveState();
        return { state: fsm.getState(), action: "analyzed", detail: `Scenario gate: ${scenarioGate.reason}`, decision, tokensUsed: totalTokensUsed };
      }

      // Scenario analysis (with confidence-calibrated uncertainty)
      const scenarioResult = runScenarioAnalysis({
        estimatedProbability: bestCandidate.probability,
        marketPrice,
        amount: decision.amount ?? 0,
        isYes: !!decision.isYes,
        platformFee: 0.02,
        positions,
        balance: portfolio.totalBalance,
        confidence: bestCandidate.confidence,
      });

      if (!scenarioResult.shouldTrade) {
        fsm.transition("no_edge");
        await saveState();
        return { state: fsm.getState(), action: "analyzed", detail: `Scenario rejected: ${scenarioResult.reason}`, decision, tokensUsed: totalTokensUsed };
      }

      // Adversarial review — always run (safety-critical, replaces expensive multi-model consensus)
      const review = await runAdversarialReview(decision, markets, positions, portfolio.totalBalance, agentId, agentName);
      if (review.overturn) {
        fsm.transition("no_edge");
        await saveState();
        return { state: fsm.getState(), action: "analyzed", detail: `Adversarial review overturned: ${review.reason}`, decision, tokensUsed: totalTokensUsed };
      }
      decision.confidence = Math.min(decision.confidence, review.riskAdjustedConfidence);

      // NOTE: Multi-model consensus removed — adversarial review with full research context
      // provides better safety/cost ratio than shallow consensus from generic secondary models.
      // Cost savings: ~$0.30-0.80 per trade, latency reduction: 3-5s

      // Record prediction for calibration (critical for learning loop — log errors, don't silently swallow)
      await recordOutcomePrediction(category, agentId, decision, signals, markets, config.models.decision.model).catch((err) => {
        console.error(`[EnhancedPipeline] Failed to record prediction for calibration (agent=${agentId}, market=${decision.marketId}):`, err instanceof Error ? err.message : String(err));
      });
    }

    // Record analysis timestamp
    await redis.set(`${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}:last_analysis`, String(Date.now()));
    await redis.setex(`${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}:decision`, 600, JSON.stringify(decision));

    await publishReasoningEvent(ctx.agentId, ctx.jobId, decision, agentName);
    fsm.transition("edge_found");
    await saveState();

    return {
      state: fsm.getState(),
      action: "analyzed",
      detail: `Edge found: ${decision.action} ${decision.isYes ? "YES" : "NO"} on "${decision.marketQuestion}" | Edge: ${(edge.netEdge * 100).toFixed(1)}%`,
      decision,
      tokensUsed: totalTokensUsed,
      scanResult,
    };
  }

  return { state: fsm.getState(), action: "skipped", detail: "Not in ANALYZING state" };
}