import { z } from "zod";
import { AgentFSM } from "./fsm";
import {
  scanMarkets,
  executeBuy,
  executeSell,
  monitorPositions,
  buildPortfolioSnapshot,
  publishAnalysisEvent,
  publishReasoningEvent,
  validateDecision,
} from "./execution-engine";
import { redis } from "../utils/redis";
import { REDIS_KEYS, AGENT_LIMITS, EXECUTE_TRADES } from "@agent-arena/shared";
import { getActivePositions } from "../services/trade-service";
import { getSharedSignals } from "../services/signal-cache";
import { getActivePrompts, recordPromptLinks } from "../services/evolution-service";
import { publishFeedEvent, buildFeedEvent } from "../feed";
import type {
  AgentConfig,
  AgentRuntimeContext,
  AgentTickResult,
  TradeDecision,
  MarketContext,
  AgentPosition,
} from "../ai/types";
import { TradeDecisionSchema } from "../ai/types";
import {
  DEFAULT_CRYPTO_AGENT_MODELS,
  resolveAgentModels,
  type ModelConfig,
} from "../ai/models";
import { CRYPTO_AGENT_TOOLS } from "../ai/tools";
import { quickDecision, quickAnalysis } from "../ai/pipeline";
import { checkThresholds } from "./strategy-engine";
import type { GeoSignals } from "./strategy-engine";
import { getCryptoSignals, getGlobalMarket } from "../data-sources/coingecko";
import { getDeFiSignals, getSolanaTVL } from "../data-sources/defillama";
import { runAdversarialReview } from "../services/adversarial-review";
import { runMultiModelConsensus } from "../services/multi-model-consensus";
import { checkMicrostructure } from "../services/market-microstructure";
import { checkCrossMarketCorrelation } from "../services/correlation-matrix";
import { checkMonitoredPositions, pollPriceUpdates, registerPositionForMonitoring, unregisterPositionFromMonitoring } from "../services/price-monitor";
import { getAllCalibratedWeights, decayConfidence, getConfidenceAdjustment, recordSignalPrediction } from "../services/calibration-service";
import { recordAgentPrediction as recordOutcomePrediction } from "../services/outcome-feedback";
import { runScenarioAnalysis, quickScenarioGate } from "../services/scenario-analysis";
import { db, schema } from "../db";

const AGENT_NAME = "Crypto Agent";
const AGENT_ID = "crypto-agent";

export function buildCryptoAgentConfig(promptOverrides?: {
  research?: string;
  analysis?: string;
  decision?: string;
}): AgentConfig {
  const models = resolveAgentModels(DEFAULT_CRYPTO_AGENT_MODELS);

  return {
    identity: {
      id: AGENT_ID,
      name: AGENT_NAME,
      category: "crypto",
      description:
        "Crypto prediction market agent. Analyzes price action, DeFi TVL, on-chain signals, regulatory news, social sentiment, and macro factors to trade crypto prediction markets. Covers BTC, ETH, SOL, altcoins, ETF approvals, regulatory decisions, and price targets.",
    },
    models,
    tools: [],
    pipeline: [
      {
        name: "research_analysis",
        modelKey: "analysis",
        systemPrompt: promptOverrides?.research ?? promptOverrides?.analysis ?? `You are a senior crypto prediction market analyst performing research AND Bayesian analysis in a single pass.

PART 1 — RESEARCH:
For each market, identify:
1. The top 5 factors that would determine the outcome
2. Price action signals (momentum, volume, volatility)
3. DeFi TVL trends and protocol health
4. On-chain signals (whale movements, exchange flows)
5. Regulatory news and ETF developments
6. Social sentiment from crypto Twitter and key influencers
7. Macro factors (Fed policy, DXY, treasury yields) that affect crypto

DOMAINS YOU COVER:
- Price targets (will BTC/ETH/SOL hit X price by date?)
- ETF approvals and regulatory decisions
- Protocol launches and upgrades
- Stablecoin depegs and market crises
- DeFi protocol outcomes

PART 2 — BAYESIAN ANALYSIS:
1. Start with the market's implied probability (current price) as your baseline prior
2. For each piece of evidence, estimate P(evidence|YES) and P(evidence|NO)
3. Apply Bayesian updating to refine your probability estimate
4. Weigh signals by reliability: on-chain data > price action > news > social media
5. Account for time-to-resolution (closer events are more predictable)
6. Consider market liquidity (thin crypto markets can be mispriced)
7. Factor in crypto base rates (e.g., BTC has 60% dominance historically)

SIGNAL SOURCES:
- CoinGecko: Price, volume, market cap, volatility, trending coins
- DeFiLlama: TVL trends, protocol health, Solana ecosystem growth
- Twitter: Crypto influencer sentiment, breaking news
- FRED: Macro indicators (Fed rate, inflation) that drive crypto
- GDELT: Regulatory news, government crypto policy

OUTPUT: For each market, provide your independent probability estimate with step-by-step reasoning.
Be specific about which signals changed your estimate from the market price.`,
        toolNames: [
          "web_search",
          "coingecko_price", "coingecko_trending", "coingecko_global",
          "defillama_tvl", "defillama_solana", "defillama_protocols",
          "twitter_search", "twitter_social_signal",
          "fred_series", "fred_macro_signal",
          "gdelt_search",
          "market_detail",
        ],
        maxTokens: 4000,
      },
      {
        name: "decision",
        modelKey: "decision",
        systemPrompt: promptOverrides?.decision ?? `You are a prediction market trader making the final trade decision on crypto markets.

RULES:
- Confidence must be >${AGENT_LIMITS.MIN_CONFIDENCE * 100}% to trade
- Max position: ${AGENT_LIMITS.MAX_PORTFOLIO_PERCENT_PER_MARKET * 100}% of portfolio per market
- Max ${AGENT_LIMITS.MAX_CONCURRENT_POSITIONS} concurrent positions
- Only trade markets settling within ${AGENT_LIMITS.MAX_MARKET_DAYS_TO_RESOLUTION} days
- Only trade markets with >$${AGENT_LIMITS.MIN_MARKET_VOLUME.toLocaleString()} volume
- If uncertain, choose "hold"
- Only trade when edge (your probability - market price) exceeds 5%
${EXECUTE_TRADES ? "" : "- NOTE: Running in decision-only mode (devnet). Log decisions but flag as analysis only."}

EDGE DETECTION:
- Calculate: edge = your_probability - market_probability
- Only trade if |edge| > 5% after accounting for fees (~2%)
- Direction: if your_prob > market_prob → buy YES; if your_prob < market_prob → buy NO

POSITION SIZING (Quarter-Kelly):
- Kelly fraction = (probability * (1 + odds) - 1) / odds
- Use quarter-Kelly (25% of full Kelly) for safety
- Minimum trade: $5 USDC

CRYPTO MARKET SPECIFICS:
- Price targets: consider momentum, support/resistance, volume profile
- ETF decisions: consider SEC precedent, political climate, applicant strength
- Regulatory: consider jurisdiction, precedent, political will
- Protocol: consider TVL trajectory, developer activity, community growth

Use market_search and market_detail tools to verify markets before deciding.

OUTPUT FORMAT (must be valid JSON):
{
  "action": "buy" | "sell" | "hold",
  "marketId": "string (required if action is buy/sell)",
  "marketQuestion": "string (required if action is buy/sell)",
  "isYes": true | false (required if action is buy/sell),
  "amount": number (required if action is buy/sell),
  "confidence": number between 0 and 1,
  "reasoning": "string explaining your decision",
  "signals": ["array of signal names that triggered this decision"]
}`,
        toolNames: [],
        outputSchema: TradeDecisionSchema,
        maxTokens: 1500,
      },
    ],
    minConfidence: AGENT_LIMITS.MIN_CONFIDENCE,
    scanIntervalMs: 5 * 60 * 1000,
    monitorIntervalMs: 60 * 1000,
  };
}

async function publishFeedStep(
  agentId: string,
  category: "scanning" | "thinking" | "signal_update" | "edge_detected" | "analysis",
  displayMessage: string,
  content: Record<string, any> = {},
  severity: "info" | "significant" | "critical" = "info"
): Promise<void> {
  const feedEvent = buildFeedEvent({
    agentId,
    agentName: AGENT_NAME,
    category: category as any,
    severity,
    content: { ...content, pipeline_stage: category },
    displayMessage,
  });
  await publishFeedEvent(feedEvent);
}

function bayesianUpdate(
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

interface WeightedSignal {
  name: string;
  value: number;
  confidence: number;
  weight: number;
}

function aggregateSignals(signals: WeightedSignal[]): {
  probability: number;
  confidence: number;
  nSignals: number;
} {
  if (signals.length === 0) return { probability: 0.5, confidence: 0, nSignals: 0 };

  let totalWeight = 0;
  let weightedSum = 0;
  for (const s of signals) {
    const effectiveWeight = s.weight * s.confidence;
    weightedSum += s.value * effectiveWeight;
    totalWeight += effectiveWeight;
  }
  if (totalWeight === 0) return { probability: 0.5, confidence: 0, nSignals: signals.length };

  const probability = weightedSum / totalWeight;
  const values = signals.map((s) => s.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const agreement = 1 - Math.min(variance * 4, 1);
  const avgConfidence = signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length;
  const overallConfidence = Math.min(agreement * avgConfidence, 1);

  return {
    probability: Math.round(probability * 10000) / 10000,
    confidence: Math.round(overallConfidence * 10000) / 10000,
    nSignals: signals.length,
  };
}

function calculateEdge(
  agentProbability: number,
  marketPrice: number,
  confidence: number,
  platformFee: number = 0.02
): { direction: "yes" | "no" | "none"; rawEdge: number; netEdge: number; shouldTrade: boolean } {
  const rawEdgeYes = agentProbability - marketPrice;
  const rawEdgeNo = (1 - agentProbability) - (1 - marketPrice);
  const weightedEdgeYes = rawEdgeYes * confidence;
  const weightedEdgeNo = rawEdgeNo * confidence;
  const netEdgeYes = weightedEdgeYes - platformFee;
  const netEdgeNo = weightedEdgeNo - platformFee;

  if (netEdgeYes > netEdgeNo && netEdgeYes > 0) {
    return { direction: "yes", rawEdge: Math.round(rawEdgeYes * 10000) / 10000, netEdge: Math.round(netEdgeYes * 10000) / 10000, shouldTrade: netEdgeYes > 0.05 };
  } else if (netEdgeNo > 0) {
    return { direction: "no", rawEdge: Math.round(rawEdgeNo * 10000) / 10000, netEdge: Math.round(netEdgeNo * 10000) / 10000, shouldTrade: netEdgeNo > 0.05 };
  }
  return { direction: "none", rawEdge: 0, netEdge: 0, shouldTrade: false };
}

function kellyPositionSize(probability: number, marketPrice: number, portfolioBalance: number): number {
  if (probability <= marketPrice) return 0;
  const odds = (1 - marketPrice) / marketPrice;
  const fullKelly = (probability * (odds + 1) - 1) / odds;
  const quarterKelly = Math.max(0, Math.min(fullKelly * 0.25, 0.25));
  const size = portfolioBalance * quarterKelly;
  return Math.max(5, Math.round(size * 100) / 100);
}

export async function runCryptoAgentTick(ctx: AgentRuntimeContext): Promise<AgentTickResult> {
  const dbPrompts = await getActivePrompts("crypto");
  const config = buildCryptoAgentConfig({
    research: dbPrompts.research ?? undefined,
    analysis: dbPrompts.analysis ?? undefined,
    decision: dbPrompts.decision ?? undefined,
  });
  const fsm = new AgentFSM(ctx.agentId, ctx.jobId);

  const savedState = await redis.get(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:fsm`);
  if (savedState) {
    try {
      const parsed = JSON.parse(savedState) as { state: string; context?: any };
      fsm.restoreState(parsed.state as any, parsed.context);
    } catch {}
  }

  // Always force scan on first tick after resume (markets cache may be stale/missing)
  const marketsCacheKey = `${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:markets`;
  const marketsCacheExists = await redis.exists(marketsCacheKey);
  const currentState = fsm.getState();
  if (currentState !== "IDLE" && currentState !== "SCANNING" && !marketsCacheExists) {
    console.log(`[Crypto Agent] Resumed from ${currentState} but markets cache expired — forcing SCANNING`);
    fsm.reset();
    fsm.transition("user_hires");
  }

  const saveState = async () => {
    await redis.set(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:fsm`, JSON.stringify(fsm.toJSON()));
  };

  if (fsm.isPaused()) {
    return { state: fsm.getState(), action: "skipped", detail: `Paused: ${fsm.getContext().pauseReason}` };
  }

  if (fsm.getState() === "IDLE") {
    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} waking up — starting new analysis cycle`, { pipeline_stage: "waking_up" }, "info");
    try { fsm.transition("user_hires"); await saveState(); } catch {}
  }

  if (fsm.getState() === "SCANNING") {
    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} scanning crypto prediction markets (BTC, ETH, SOL, ETFs, regulations)...`, { pipeline_stage: "scanning_start" });

    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} fetching trending markets from Jupiter Predict...`, { pipeline_stage: "fetching_markets" });
    const markets = await scanMarkets("crypto");
    
    if (markets.length === 0) {
      fsm.transition("no_markets");
      await saveState();
      await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME}: No qualifying crypto markets found (min volume: $${AGENT_LIMITS.MIN_MARKET_VOLUME.toLocaleString()})`, { markets_scanned: 0 });
      return { state: fsm.getState(), action: "scanned", detail: "No qualifying crypto markets" };
    }

    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} found ${markets.length} qualifying markets:`, { 
      pipeline_stage: "markets_found", 
      markets_scanned: markets.length,
      market_list: markets.slice(0, 5).map(m => ({ id: m.marketId, question: m.question, volume: m.volume, closesAt: m.closesAt }))
    }, "significant");

    await redis.setex(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:markets`, 300, JSON.stringify(markets));
    fsm.transition("markets_found");
    await saveState();
  }

  if (fsm.getState() === "ANALYZING") {
    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} fetching live crypto signals...`, { pipeline_stage: "signal_fetch_start" });

    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} querying CoinGecko for price data...`, { pipeline_stage: "fetching_coingecko" });
    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} querying DeFiLlama for TVL data...`, { pipeline_stage: "fetching_defillama" });
    
    const signals = await getSharedSignals("crypto");

    const [cryptoSignals, defiSignals] = await Promise.allSettled([
      getCryptoSignals(),
      getDeFiSignals(),
    ]);

    const cryptoData = cryptoSignals.status === "fulfilled" ? cryptoSignals.value : {};
    const defiData = defiSignals.status === "fulfilled" ? defiSignals.value : { protocols: {}, solana: null };

    const signalCount = Object.keys(signals.gdelt).length + Object.keys(signals.acled).length +
      Object.keys(signals.fred).length + Object.keys(cryptoData).length;

    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} received ${signalCount} signal streams:`, { 
      signals_count: signalCount, 
      pipeline_stage: "signals_ready",
      signal_sources: {
        gdelt: Object.keys(signals.gdelt).length,
        acled: Object.keys(signals.acled).length,
        fred: Object.keys(signals.fred).length,
        crypto_prices: Object.keys(cryptoData).length,
        defi_protocols: Object.keys(defiData.protocols || {}).length,
      }
    });

    const marketsRaw = await redis.get(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:markets`);
    const markets: MarketContext[] = marketsRaw ? JSON.parse(marketsRaw) : [];

    const { positions: dbPositions } = await getActivePositions(ctx.jobId);
    const positions: AgentPosition[] = dbPositions.map((p) => ({
      marketId: p.marketId, side: p.side, amount: Number(p.amount),
      entryPrice: Number(p.entryPrice), currentPrice: Number(p.currentPrice ?? p.entryPrice),
      pnl: Number(p.pnl ?? 0),
    }));

    if (positions.length > 0) {
      await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} monitoring ${positions.length} open positions...`, { 
        pipeline_stage: "position_check",
        positions: positions.map(p => ({ marketId: p.marketId, side: p.side, amount: p.amount, pnl: p.pnl }))
      });
    }

    const lastAnalysisRaw = await redis.get(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:last_analysis`);
    const lastAnalysisTime = lastAnalysisRaw ? Number(lastAnalysisRaw) : null;
    
    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} checking signal thresholds...`, { pipeline_stage: "threshold_check_start" });
    const thresholdCheck = checkThresholds(signals, lastAnalysisTime, markets, positions, "crypto");

    if (!thresholdCheck.triggered) {
      fsm.transition("no_edge");
      await saveState();
      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME}: No signal thresholds triggered — market is calm, skipping deep analysis`, { pipeline_stage: "threshold_check", reasons: [] });
      return { state: fsm.getState(), action: "analyzed", detail: "No thresholds triggered, skipping LLM" };
    }

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ⚡ ${thresholdCheck.reasons.length} signal triggers detected:`, { 
      pipeline_stage: "thresholds_triggered", 
      signals_count: signalCount,
      trigger_reasons: thresholdCheck.reasons
    }, "significant");

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} building portfolio snapshot...`, { pipeline_stage: "portfolio_snapshot" });
    const portfolio = await buildPortfolioSnapshot(ctx.agentWalletAddress, positions, ctx.jobId);
    
    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} portfolio: $${portfolio.totalBalance.toFixed(2)} USDC | ${positions.length} open positions | Daily PnL: $${portfolio.dailyPnl.toFixed(2)}`, { 
      pipeline_stage: "portfolio_ready",
      balance: portfolio.totalBalance,
      positions: positions.length,
      daily_pnl: portfolio.dailyPnl
    });

    // STAGE 1+2: Combined Research + Analysis (single LLM call — saves ~90s)
    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} 🔍 Stage 1/2: Combined research + Bayesian analysis on ${markets.length} markets...`, { pipeline_stage: "research_analysis_start" });

    const researchAnalysisPrompt = buildPerMarketResearchContext(signals, cryptoData, defiData, markets, positions, portfolio.totalBalance, thresholdCheck.reasons);

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} calling LLM for combined research+analysis (model: ${config.models.analysis.model})...`, { pipeline_stage: "llm_research_analysis_call" });
    const primaryMarket = markets[0];
    const primaryYesPrice = primaryMarket?.outcomes.find(o => o.name.toLowerCase() === "yes")?.price ?? 0;
    const primaryNoPrice = primaryMarket?.outcomes.find(o => o.name.toLowerCase() === "no")?.price ?? 0;
    const researchAnalysis = await quickAnalysis({
      modelConfig: config.models.analysis,
      systemPrompt: config.pipeline[0].systemPrompt,
      userMessage: researchAnalysisPrompt,
      tools: config.pipeline[0].toolNames,
      marketContext: primaryMarket ? { marketId: primaryMarket.marketId, yesPrice: primaryYesPrice, noPrice: primaryNoPrice } : undefined,
    });

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ✅ Stage 1/2: Research + analysis complete`, { 
      pipeline_stage: "research_analysis_complete", 
      tokens_used: researchAnalysis.tokensUsed,
      tool_calls: researchAnalysis.toolCalls,
      reasoning_snippet: researchAnalysis.text.slice(0, 300)
    }, "significant");

    // Bayesian estimation with signal-strength-scaled likelihoods
    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} running scaled Bayesian probability estimation on ${Math.min(markets.length, 5)} markets...`, { pipeline_stage: "bayesian_estimation" });
    const bayesianResults = runScaledBayesianEstimation(markets.slice(0, 5), signals, cryptoData, researchAnalysis.text);

    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} Bayesian estimates:`, {
      pipeline_stage: "bayesian_results",
      estimates: bayesianResults.map(b => ({ marketId: b.marketId, probability: (b.probability * 100).toFixed(1) + "%" }))
    });

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} aggregating all signals (LLM + per-market crypto + GDELT + macro + Bayesian + temporal)...`, { pipeline_stage: "signal_aggregation" });

    const signalAgeMinutes = signals.fetchedAt
      ? (Date.now() - new Date(signals.fetchedAt).getTime()) / 60000
      : 0;

    const calibratedWeights = await getAllCalibratedWeights("crypto");

    const defaultWeights: Record<string, number> = {
      llm_analysis: 3.0, crypto_momentum: 2.0, gdelt_sentiment: 1.0, macro_signal: 1.5,
    };
    const decayedSignals = [
      { name: "llm_analysis", value: extractProbabilityFromText(researchAnalysis.text), confidence: decayConfidence(0.7, signalAgeMinutes, "market"), weight: calibratedWeights["llm_analysis"] ?? defaultWeights["llm_analysis"] ?? 3.0 },
      { name: "crypto_momentum", value: cryptoToProbability(cryptoData), confidence: decayConfidence(0.6, signalAgeMinutes, "coingecko"), weight: calibratedWeights["crypto_momentum"] ?? defaultWeights["crypto_momentum"] ?? 2.0 },
      { name: "gdelt_sentiment", value: gdeltToProbability(signals.gdelt), confidence: decayConfidence(0.5, signalAgeMinutes, "gdelt"), weight: calibratedWeights["gdelt_sentiment"] ?? defaultWeights["gdelt_sentiment"] ?? 1.0 },
      { name: "macro_signal", value: macroToProbability(signals.fred), confidence: decayConfidence(0.5, signalAgeMinutes, "fred"), weight: calibratedWeights["macro_signal"] ?? defaultWeights["macro_signal"] ?? 1.5 },
      ...bayesianResults.map((b) => ({
        name: `bayesian_${b.marketId}`,
        value: b.probability,
        confidence: decayConfidence(0.7, signalAgeMinutes, "market"),
        weight: calibratedWeights[`bayesian_${b.marketId}`] ?? 2.0,
      })),
    ];
    const finalAggregatedSignal = aggregateSignals(decayedSignals);

    // Temporal awareness: penalize near-resolution and far-resolution markets
    const temporalAdj = computeTemporalAdjustment(markets);

    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} ✅ Stage 1/2: Signal aggregation complete (calibrated + decayed + temporal)`, { 
      pipeline_stage: "analysis_complete", 
      aggregated_probability: (finalAggregatedSignal.probability * 100).toFixed(1) + "%",
      aggregated_confidence: (finalAggregatedSignal.confidence * 100).toFixed(1) + "%",
      calibration_info: Object.keys(calibratedWeights).length > 0 ? `${Object.keys(calibratedWeights).length} calibrated weights` : "using defaults",
      signals_combined: finalAggregatedSignal.nSignals,
      signal_age_minutes: signalAgeMinutes.toFixed(1),
      temporal_adjustments: temporalAdj,
      reasoning_snippet: researchAnalysis.text.slice(0, 300)
    }, "significant");

    // STAGE 2: Decision (renumbered from 3)
    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} 🎯 Stage 2/2: Making trade decision with edge detection...`, { pipeline_stage: "decision_start" });

    let decision!: TradeDecision;
    let decisionTokens = 0;
    try {
      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} calling LLM for final decision (model: ${config.models.decision.model})...`, { pipeline_stage: "llm_decision_call" });
      const result = await quickDecision<TradeDecision>({
        modelConfig: config.models.decision,
        systemPrompt: config.pipeline[1].systemPrompt,
        userMessage: buildPerMarketDecisionContext(researchAnalysis.text, finalAggregatedSignal, markets, positions, portfolio.totalBalance, temporalAdj),
        schema: TradeDecisionSchema,
        tools: config.pipeline[1].toolNames,
      });
      decision = result.decision;
      decisionTokens = result.tokensUsed;

      // Feature 9: Adjust LLM confidence based on calibration data
      const llmConfidenceAdj = await getConfidenceAdjustment("crypto", config.models.decision.model, decision.confidence);
      if (llmConfidenceAdj !== 1.0) {
        const originalConf = decision.confidence;
        decision.confidence = Math.max(0, Math.min(1, decision.confidence * llmConfidenceAdj));
        await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} confidence calibrated: ${(originalConf * 100).toFixed(0)}% → ${(decision.confidence * 100).toFixed(0)}% (adj: ${(llmConfidenceAdj * 100).toFixed(0)}%)`, {
          pipeline_stage: "confidence_calibration", original: originalConf, adjusted: decision.confidence, calibration_factor: llmConfidenceAdj,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      fsm.transition("no_edge");
      await saveState();
      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ❌ Decision stage failed: ${errorMsg}`, { pipeline_stage: "decision_error" }, "critical");
      return { state: fsm.getState(), action: "analyzed", detail: `Decision stage error: ${errorMsg}`, decision: decision ?? undefined, tokensUsed: researchAnalysis.tokensUsed };
    }

    const totalTokens = researchAnalysis.tokensUsed + decisionTokens;

    // Validate LLM decision against known markets
    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} validating decision against known markets...`, { pipeline_stage: "decision_validation" });
    const validation = validateDecision(decision, markets);
    if (!validation.valid) {
      fsm.transition("no_edge");
      await saveState();
      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ❌ Decision rejected — ${validation.error}`, { pipeline_stage: "validation_failed" }, "critical");
      return { state: fsm.getState(), action: "analyzed", detail: `Decision rejected: ${validation.error}`, decision, tokensUsed: totalTokens };
    }

    // Skip further checks for hold decisions
    const action: string = decision.action;
    if (action === "hold" || decision.confidence < config.minConfidence) {
      await redis.set(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:last_analysis`, String(Date.now()));
      fsm.transition("no_edge");
      await saveState();
      await publishReasoningEvent(ctx.agentId, ctx.jobId, decision, AGENT_NAME);
      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} 📋 Decision: HOLD — confidence ${(decision.confidence * 100).toFixed(0)}%${decision.confidence < config.minConfidence ? ` below ${(config.minConfidence * 100).toFixed(0)}% threshold` : ""}`, { 
        pipeline_stage: "hold", 
        confidence: decision.confidence,
        reasoning: decision.reasoning
      });
      return { state: fsm.getState(), action: "analyzed", detail: `Decision: hold (confidence: ${(decision.confidence * 100).toFixed(0)}%)`, decision, tokensUsed: totalTokens };
    }

    // Compute edge for fast-path determination
    const preEdgeMarketPrice = decision.isYes ? getMarketPrice(markets, decision.marketId, "yes") : getMarketPrice(markets, decision.marketId, "no");
    const preEdge = calculateEdge(finalAggregatedSignal.probability, preEdgeMarketPrice, finalAggregatedSignal.confidence);

    // ===== FAST-PATH: Skip adversarial + consensus for high-conviction trades =====
    const FAST_PATH_EDGE_THRESHOLD = 0.15;
    const useFastPath = preEdge.netEdge > FAST_PATH_EDGE_THRESHOLD && decision.confidence >= 0.85;

    if (useFastPath) {
      await publishFeedStep(ctx.agentId, "edge_detected", `${AGENT_NAME} ⚡ FAST-PATH: Edge ${(preEdge.netEdge * 100).toFixed(1)}% + confidence ${(decision.confidence * 100).toFixed(0)}% — skipping adversarial + consensus`, { 
        pipeline_stage: "fast_path",
        edge: preEdge.netEdge,
        confidence: decision.confidence,
      }, "significant");
    }

    // ===== POST-DECISION PIPELINE (Features 3, 5, 6, 7, 10) =====

    // Feature 10: Scenario Tree Analysis (quick gate check)
    if (decision.marketId) {
      const marketPrice = decision.isYes ? getMarketPrice(markets, decision.marketId, "yes") : getMarketPrice(markets, decision.marketId, "no");
      const scenarioGate = quickScenarioGate(
        finalAggregatedSignal.probability,
        marketPrice,
        decision.amount ?? 0,
        !!decision.isYes,
        portfolio.totalBalance,
        positions
      );

      if (!scenarioGate.pass) {
        await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ⛔ Scenario gate: ${scenarioGate.reason}`, { pipeline_stage: "scenario_gate_failed" }, "critical");
        fsm.transition("no_edge");
        await saveState();
        return { state: fsm.getState(), action: "analyzed", detail: `Scenario gate blocked: ${scenarioGate.reason}`, decision, tokensUsed: totalTokens };
      }

      // Full scenario analysis
      const scenarioResult = runScenarioAnalysis({
        estimatedProbability: finalAggregatedSignal.probability,
        marketPrice,
        amount: decision.amount ?? 0,
        isYes: !!decision.isYes,
        platformFee: 0.02,
        positions,
        balance: portfolio.totalBalance,
      });

      // Persist scenario analysis
      try {
        await db.insert(schema.scenarioResults).values({
          agentId: ctx.agentId,
          jobId: ctx.jobId,
          marketId: decision.marketId ?? "",
          action: decision.action,
          estimatedProbability: String(finalAggregatedSignal.probability),
          totalExpectedValue: String(scenarioResult.totalExpectedValue),
          riskRewardRatio: String(scenarioResult.riskRewardRatio),
          shouldTrade: scenarioResult.shouldTrade,
          reason: scenarioResult.reason,
          scenarios: scenarioResult.scenarios,
        }).onConflictDoNothing().catch(() => {});
      } catch {}

      if (!scenarioResult.shouldTrade) {
        await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ⛔ Scenario analysis rejected: ${scenarioResult.reason}`, { 
          pipeline_stage: "scenario_rejected",
          expected_value: scenarioResult.totalExpectedValue.toFixed(2),
          risk_reward: scenarioResult.riskRewardRatio.toFixed(2),
        }, "critical");
        fsm.transition("no_edge");
        await saveState();
        return { state: fsm.getState(), action: "analyzed", detail: `Scenario rejected: ${scenarioResult.reason}`, decision, tokensUsed: totalTokens };
      }

      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ✅ Scenario analysis passed: EV=$${scenarioResult.totalExpectedValue.toFixed(2)}, R/R=${scenarioResult.riskRewardRatio.toFixed(2)}:1`, { 
        pipeline_stage: "scenario_passed",
        expected_value: scenarioResult.totalExpectedValue.toFixed(2),
        risk_reward: scenarioResult.riskRewardRatio.toFixed(2),
      });
    }

    // Feature 3: Adversarial Self-Review (devil's advocate) — skip on fast-path
    if (decision.marketId && !useFastPath) {
      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} 🔍 Running adversarial review...`, { pipeline_stage: "adversarial_review" });
      const review = await runAdversarialReview(decision, markets, positions, portfolio.totalBalance, ctx.agentId, AGENT_NAME);

      try {
        await db.insert(schema.adversarialReviews).values({
          agentId: ctx.agentId,
          marketId: decision.marketId ?? "",
          action: decision.action,
          overturned: review.overturn,
          originalConfidence: String(decision.confidence),
          riskAdjustedConfidence: String(review.riskAdjustedConfidence),
          reason: review.reason,
          risks: review.risks,
        }).onConflictDoNothing().catch(() => {});
      } catch {}

      if (review.overturn) {
        fsm.transition("no_edge");
        await saveState();
        return { state: fsm.getState(), action: "analyzed", detail: `Adversarial review overturned: ${review.reason}`, decision, tokensUsed: totalTokens };
      }

      // Adjust confidence based on adversarial review
      decision.confidence = Math.min(decision.confidence, review.riskAdjustedConfidence);
    }

    // Feature 5: Multi-Model Consensus — skip on fast-path
    if (decision.marketId && !useFastPath) {
      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} 🤝 Running multi-model consensus...`, { pipeline_stage: "multi_model_consensus" });
      const consensus = await runMultiModelConsensus({
        systemPrompt: config.pipeline[1].systemPrompt,
        userMessage: buildPerMarketDecisionContext(researchAnalysis.text, finalAggregatedSignal, markets, positions, portfolio.totalBalance, temporalAdj),
        schema: TradeDecisionSchema,
        agentId: ctx.agentId,
        agentName: AGENT_NAME,
        primaryDecision: decision,
      });

      try {
        await db.insert(schema.consensusResults).values({
          agentId: ctx.agentId,
          marketId: decision.marketId ?? "",
          consensus: consensus.consensus,
          modelsAgreed: consensus.modelsAgreed,
          modelsQueried: consensus.modelsQueried,
          confidenceAdjustment: String(consensus.confidenceAdjustment),
          decisionAction: consensus.decision.action,
          decisionConfidence: String(consensus.decision.confidence),
          details: consensus.details,
        }).onConflictDoNothing().catch(() => {});
      } catch {}

      // Use consensus-adjusted decision
      decision = consensus.decision;

      if (decision.action === "hold") {
        fsm.transition("no_edge");
        await saveState();
        return { state: fsm.getState(), action: "analyzed", detail: `Consensus disagreement — defaulting to hold`, decision, tokensUsed: totalTokens };
      }
    }

    // Feature 4: Record prediction for outcome feedback
    if (decision.marketId) {
      await recordOutcomePrediction("crypto", ctx.agentId, decision, signals, markets, config.models.decision.model).catch((err) =>
        console.error(`[Crypto Agent] Failed to record prediction: ${err.message}`)
      );
    }

    // Record analysis timestamp
    await redis.set(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:last_analysis`, String(Date.now()));

    const finalMarketPrice = decision.isYes ? getMarketPrice(markets, decision.marketId ?? "", "yes") : getMarketPrice(markets, decision.marketId ?? "", "no");
    const edge = calculateEdge(finalAggregatedSignal.probability, finalMarketPrice, finalAggregatedSignal.confidence);

    await publishFeedStep(ctx.agentId, "edge_detected", `${AGENT_NAME} 🎯 Edge detected: ${edge.direction.toUpperCase()} on "${decision.marketQuestion}"`, { 
      pipeline_stage: "edge_found", 
      edge_percent: (edge.netEdge * 100).toFixed(1) + "%",
      raw_edge: (edge.rawEdge * 100).toFixed(1) + "%",
      confidence: (decision.confidence * 100).toFixed(0) + "%",
      market_analyzed: decision.marketQuestion,
      market_id: decision.marketId,
      is_yes: decision.isYes
    }, "significant");

    await redis.setex(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:decision`, 600, JSON.stringify(decision));
    fsm.transition("edge_found");
    await saveState();
    await publishReasoningEvent(ctx.agentId, ctx.jobId, decision, AGENT_NAME);

    return { state: fsm.getState(), action: "analyzed", detail: `Edge found: ${decision.action} ${decision.isYes ? "YES" : "NO"} on "${decision.marketQuestion}" | Edge: ${(edge.netEdge * 100).toFixed(1)}%`, decision, tokensUsed: totalTokens };
  }

  if (fsm.getState() === "EXECUTING") {
    const decisionRaw = await redis.get(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:decision`);
    if (!decisionRaw) {
      fsm.transition("order_failed");
      await saveState();
      return { state: fsm.getState(), action: "executed", detail: "No decision in cache" };
    }

    const decision = JSON.parse(decisionRaw) as TradeDecision;
    const { positions: dbPositions } = await getActivePositions(ctx.jobId);
    const positions: AgentPosition[] = dbPositions.map((p) => ({
      marketId: p.marketId, side: p.side, amount: Number(p.amount),
      entryPrice: Number(p.entryPrice), currentPrice: Number(p.currentPrice ?? p.entryPrice),
      pnl: Number(p.pnl ?? 0),
    }));
    const portfolio = await buildPortfolioSnapshot(ctx.agentWalletAddress, positions, ctx.jobId);

    if (decision.action === "buy") {
      // Feature 6: Market microstructure check
      if (decision.marketId) {
        const microCheck = await checkMicrostructure(decision.marketId, decision.amount ?? 0);
        if (!microCheck.allowed) {
          fsm.transition("order_failed");
          await saveState();
          await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ⛔ Microstructure rejection: ${microCheck.reason}`, { pipeline_stage: "microstructure_rejected" }, "critical");
          return { state: fsm.getState(), action: "executed", detail: `Microstructure rejection: ${microCheck.reason}`, decision };
        }
        if (microCheck.microstructure) {
          await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ✅ Microstructure OK: spread=${(microCheck.microstructure.bidAskSpread * 100).toFixed(2)}% impact=${(microCheck.microstructure.priceImpactEstimate * 100).toFixed(2)}%`, {
            pipeline_stage: "microstructure_ok",
            bid_ask_spread: microCheck.microstructure.bidAskSpread.toFixed(4),
            price_impact: microCheck.microstructure.priceImpactEstimate.toFixed(4),
            liquidity_score: microCheck.microstructure.liquidityScore.toFixed(4),
          });
        }

        try {
          if (microCheck.microstructure) {
            await db.insert(schema.microstructureChecks).values({
              marketId: decision.marketId,
              allowed: microCheck.allowed,
              reason: microCheck.reason ?? "",
              bidAskSpread: String(microCheck.microstructure.bidAskSpread),
              depthAt5Pct: String(microCheck.microstructure.depthAt5Pct),
              liquidityScore: String(microCheck.microstructure.liquidityScore),
              priceImpactEstimate: String(microCheck.microstructure.priceImpactEstimate),
              midPrice: String(microCheck.microstructure.midPrice),
            }).onConflictDoNothing().catch(() => {});
          }
        } catch {}
      }

      // Feature 7: Cross-market correlation check
      if (decision.marketId) {
        const positionRisks: Array<{ marketId: string; marketQuestion: string; side: string; amount: number; category: string }> = 
          positions.map((p) => ({ marketId: p.marketId, marketQuestion: p.marketId, side: p.side, amount: p.amount, category: "crypto" }));
        const correlationCheck = checkCrossMarketCorrelation(
          decision.marketQuestion ?? decision.marketId ?? "",
          decision.amount ?? 0,
          positionRisks,
          portfolio.totalBalance
        );

        try {
          await db.insert(schema.microstructureChecks).values({
            marketId: decision.marketId ?? "",
            allowed: correlationCheck.allowed,
            reason: correlationCheck.reason ?? "",
            bidAskSpread: "0",
            depthAt5Pct: "0",
            liquidityScore: "0",
            priceImpactEstimate: "0",
            midPrice: "0",
          }).onConflictDoNothing().catch(() => {});
        } catch {}

        if (!correlationCheck.allowed) {
          fsm.transition("order_failed");
          await saveState();
          await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ⛔ Correlation rejection: ${correlationCheck.reason}`, { pipeline_stage: "correlation_rejected", effective_exposure: correlationCheck.effectiveExposure.toFixed(2) }, "critical");
          return { state: fsm.getState(), action: "executed", detail: `Correlation rejection: ${correlationCheck.reason}`, decision };
        }
      }

      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} executing: BUY ${decision.isYes ? "YES" : "NO"} $${decision.amount ?? 0} on "${decision.marketQuestion}"`, { pipeline_stage: "executing", action: "buy", market_analyzed: decision.marketQuestion, amount: String(decision.amount ?? 0) });

      const result = await executeBuy(decision, ctx.agentId, ctx.jobId, ctx.agentWalletId, ctx.ownerPubkey, portfolio, AGENT_NAME, "crypto");
      if (result.success) {
        if (result.positionId) {
          await recordPromptLinks(result.positionId, "crypto").catch((err) =>
            console.error(`[Crypto Agent] Failed to record prompt links: ${err.message}`)
          );

          // Feature 8: Register position for real-time price monitoring
          await registerPositionForMonitoring({
            positionId: result.positionId,
            marketId: decision.marketId ?? "",
            marketQuestion: decision.marketQuestion ?? "",
            agentId: ctx.agentId,
            agentName: AGENT_NAME,
            jobId: ctx.jobId,
            agentWalletId: ctx.agentWalletId,
            side: decision.isYes ? "yes" : "no",
            entryPrice: 0.5, // Will be updated when position opens
            stopLossPrice: 0.5 * (1 - AGENT_LIMITS.STOP_LOSS_PERCENT),
            amount: decision.amount ?? 0,
            ownerPubkey: ctx.ownerPubkey,
          }).catch((err) => console.error(`[Crypto Agent] Failed to register position monitoring: ${err.message}`));
        }
        fsm.transition("order_placed");
        await saveState();
        return { state: fsm.getState(), action: "executed", detail: `Buy placed: ${result.positionId}`, decision };
      } else {
        fsm.transition("order_failed");
        await saveState();
        await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME}: Order failed — ${result.error}`, { pipeline_stage: "execution_failed" }, "critical");
        return { state: fsm.getState(), action: "executed", detail: `Buy failed: ${result.error}`, decision };
      }
    } else if (decision.action === "sell" && decision.marketId) {
      const pos = dbPositions.find((p) => p.marketId === decision.marketId);
      if (pos) {
        const result = await executeSell(pos.id, ctx.agentId, ctx.jobId, ctx.agentWalletId, decision.reasoning, AGENT_NAME);
        if (result.success) {
          fsm.transition("order_placed");
          await saveState();
          return { state: fsm.getState(), action: "executed", detail: `Sell executed: ${decision.marketId}`, decision };
        }
      }
    }

    fsm.transition("order_failed");
    await saveState();
    return { state: fsm.getState(), action: "executed", detail: "Execution failed", decision };
  }

  if (fsm.getState() === "MONITORING") {
    // Background price monitor handles stop-losses independently (30s interval)
    // No blocking calls needed — return immediately and let tick cycle continue
    return { state: fsm.getState(), action: "monitored", detail: "Background monitoring active" };
  }

  if (fsm.getState() === "CLOSING" || fsm.getState() === "SETTLING") {
    try { fsm.transition("cycle_complete"); await saveState(); } catch { fsm.reset(); await saveState(); }
    return { state: fsm.getState(), action: "skipped", detail: "Cycle complete" };
  }

  return { state: fsm.getState(), action: "skipped", detail: `Unhandled: ${fsm.getState()}` };
}

function buildPerMarketResearchContext(
  signals: GeoSignals,
  cryptoData: Record<string, any>,
  defiData: { protocols: Record<string, any>; solana: any },
  markets: MarketContext[],
  positions: AgentPosition[],
  balance: number,
  reasons: string[]
): string {
  const parts: string[] = [];
  parts.push(`## Portfolio\nBalance: $${balance.toFixed(2)} | Open positions: ${positions.length}/${AGENT_LIMITS.MAX_CONCURRENT_POSITIONS}`);

  if (positions.length > 0) {
    parts.push("\n### Open Positions:");
    for (const p of positions) {
      parts.push(`- ${p.marketId}: ${p.side} $${p.amount} @ ${p.entryPrice} (PnL: $${p.pnl.toFixed(2)})`);
    }
  }

  parts.push("\n## Signal Triggers:");
  for (const r of reasons) parts.push(`- ${r}`);

  parts.push("\n## Available Crypto Markets (with per-market relevant signals):");
  for (const m of markets.slice(0, 10)) {
    const prices = m.outcomes.map((o) => `${o.name}: $${o.price}`).join(", ");
    const hoursToClose = m.closesAt ? ((new Date(m.closesAt).getTime() - Date.now()) / 3600000).toFixed(1) : "N/A";
    parts.push(`\n### [${m.marketId}] "${m.question}"\n| Prices: ${prices} | Vol=$${m.volume} | Closes: ${m.closesAt ?? "N/A"} (${hoursToClose}h)`);
    
    const q = m.question.toLowerCase();
    const relevantSignals: string[] = [];

    if (q.includes("bitcoin") || q.includes("btc")) {
      const btc = cryptoData["bitcoin"];
      if (btc) relevantSignals.push(`BTC: $${btc.price} | 24h: ${btc.change24h?.toFixed(2)}% | 7d: ${btc.change7d?.toFixed(2)}% | Vol: $${(btc.volume24h / 1e6).toFixed(1)}M | Trend: ${btc.trend}`);
    }
    if (q.includes("ethereum") || q.includes("eth")) {
      const eth = cryptoData["ethereum"];
      if (eth) relevantSignals.push(`ETH: $${eth.price} | 24h: ${eth.change24h?.toFixed(2)}% | 7d: ${eth.change7d?.toFixed(2)}% | Vol: $${(eth.volume24h / 1e6).toFixed(1)}M | Trend: ${eth.trend}`);
    }
    if (q.includes("solana") || q.includes("sol")) {
      const sol = cryptoData["solana"];
      if (sol) relevantSignals.push(`SOL: $${sol.price} | 24h: ${sol.change24h?.toFixed(2)}% | 7d: ${sol.change7d?.toFixed(2)}% | Vol: $${(sol.volume24h / 1e6).toFixed(1)}M | Trend: ${sol.trend}`);
    }

    if (q.includes("tvl") || q.includes("defi")) {
      if (defiData.solana) relevantSignals.push(`Solana TVL: $${(defiData.solana.totalTvl / 1e9).toFixed(2)}B (7d: ${defiData.solana.change7d?.toFixed(2)}%)`);
      for (const [name, proto] of Object.entries(defiData.protocols).slice(0, 3)) {
        relevantSignals.push(`${name}: $${(proto.tvl / 1e9).toFixed(2)}B (7d: ${proto.tvlChange7d?.toFixed(2)}%)`);
      }
    }

    if (q.includes("etf") || q.includes("sec") || q.includes("regulat")) {
      for (const [region, signal] of Object.entries(signals.gdelt).slice(0, 2)) {
        relevantSignals.push(`GDELT ${region}: tone=${signal.avgTone?.toFixed(2)} (${signal.articleCount} articles)`);
      }
    }

    if (q.includes("fed") || q.includes("rate") || q.includes("inflation") || q.includes("gdp")) {
      for (const [key, signal] of Object.entries(signals.fred).slice(0, 3)) {
        relevantSignals.push(`FRED ${key}: ${signal.trend} ${signal.changePercent?.toFixed(2)}% (latest: ${signal.latestValue})`);
      }
    }

    if (relevantSignals.length > 0) {
      parts.push("Relevant signals:");
      for (const s of relevantSignals) parts.push(`  - ${s}`);
    } else {
      const allCryptoSummary = Object.entries(cryptoData).slice(0, 5).map(([sym, d]) => `${sym}: ${d.change24h?.toFixed(1)}%`).join(", ");
      parts.push(`General crypto context: ${allCryptoSummary}`);
    }
  }

  parts.push("\n## Global Market Data:");
  const allCoinsSummary = Object.entries(cryptoData).slice(0, 10).map(([sym, d]) => `${sym} (${d.coin}): $${d.price} | 24h: ${d.change24h?.toFixed(2)}% | 7d: ${d.change7d?.toFixed(2)}%`).join("\n- ");
  parts.push(`- ${allCoinsSummary}`);

  if (defiData.solana) {
    parts.push(`\nSolana TVL: $${(defiData.solana.totalTvl / 1e9).toFixed(2)}B (7d: ${defiData.solana.change7d?.toFixed(2)}%)`);
  }

  parts.push(`\n## Research + Analysis Task:\nFor EACH crypto market above:\n1. Identify the top 5 factors that would determine the outcome\n2. Start with the market's implied probability as your baseline prior\n3. For each piece of evidence, estimate P(evidence|YES) and P(evidence|NO)\n4. Apply Bayesian reasoning to update from the market price\n5. Provide your independent probability estimate with step-by-step reasoning\n\nUse available tools (CoinGecko, DeFiLlama, Twitter, FRED, GDELT, web_search) to gather real-time data.`);

  return parts.join("\n");
}

function buildPerMarketDecisionContext(
  analysis: string,
  aggregated: { probability: number; confidence: number; nSignals: number },
  markets: MarketContext[],
  positions: AgentPosition[],
  balance: number,
  temporalAdj: Record<string, number>
): string {
  const marketLines = markets.slice(0, 5).map((m) => {
    const hoursToClose = m.closesAt ? ((new Date(m.closesAt).getTime() - Date.now()) / 3600000).toFixed(1) : "N/A";
    const prices = m.outcomes.map((o) => `${o.name}: $${o.price}`).join(", ");
    const adj = temporalAdj[m.marketId] ?? 1.0;
    return `- [${m.marketId}] "${m.question}" | ${prices} | Vol=$${m.volume} | ${hoursToClose}h to close | Temporal adj: ${(adj * 100).toFixed(0)}%`;
  }).join("\n");

  return `## Analysis Results\n${analysis}\n\n## Signal Aggregation\n- Aggregated probability: ${(aggregated.probability * 100).toFixed(1)}%\n- Overall confidence: ${(aggregated.confidence * 100).toFixed(1)}%\n- Signals combined: ${aggregated.nSignals}\n\n## Temporal Adjustments\nMarkets close to resolution (<6h) or far from resolution (>5d) have reduced confidence. Adjustments:\n${Object.entries(temporalAdj).map(([id, adj]) => `- ${id}: ${(adj * 100).toFixed(0)}%`).join("\n")}\n\n## Portfolio\n- Balance: $${balance.toFixed(2)} USDC\n- Open positions: ${positions.length}/${AGENT_LIMITS.MAX_CONCURRENT_POSITIONS}\n${positions.length > 0 ? positions.map((p) => `  - ${p.marketId}: ${p.side} $${p.amount} @ ${p.entryPrice} (PnL: $${p.pnl.toFixed(2)})`).join("\n") : ""}\n\n## Available Crypto Markets\n${marketLines}\n\n## Decision Required\nBased on the analysis and aggregated signals, make a trade decision on the best crypto market.\nIf edge > 5% and confidence > ${(AGENT_LIMITS.MIN_CONFIDENCE * 100).toFixed(0)}%, recommend a trade.\nOtherwise, recommend hold. Remember: quarter-Kelly for position sizing.\nIMPORTANT: Consider time-to-resolution. Near-resolution markets need HIGHER confidence to trade.`;
}

function runScaledBayesianEstimation(
  markets: MarketContext[],
  signals: GeoSignals,
  cryptoData: Record<string, any>,
  analysis: string
): Array<{ marketId: string; probability: number }> {
  return markets.map((m) => {
    const prior = m.outcomes.find((o) => o.name.toLowerCase() === "yes")?.price ?? 0.5;
    const evidence: Array<{ likelihoodYes: number; likelihoodNo: number }> = [];

    const q = m.question.toLowerCase();

    for (const [symbol, data] of Object.entries(cryptoData)) {
      if (Math.abs(data.change24h) > 3) {
        const isRelevant = q.includes(symbol) || q.includes("crypto") || q.includes("bitcoin") || q.includes("ethereum") || q.includes("solana");
        const strength = Math.min(Math.abs(data.change24h) / 20, 1);
        const relevanceMultiplier = isRelevant ? 1.0 : 0.3;
        const direction = data.change24h > 0 ? 1 : -1;
        const magnitude = 0.3 * strength * relevanceMultiplier + 0.1;
        evidence.push({
          likelihoodYes: 0.5 + direction * magnitude,
          likelihoodNo: 0.5 - direction * magnitude,
        });
      }
    }

    for (const [, signal] of Object.entries(signals.gdelt)) {
      if (Math.abs(signal.avgTone) > 2) {
        const strength = Math.min(Math.abs(signal.avgTone) / 10, 1);
        const direction = signal.avgTone > 0 ? 1 : -1;
        const magnitude = 0.2 * strength;
        evidence.push({
          likelihoodYes: 0.5 + direction * magnitude,
          likelihoodNo: 0.5 - direction * magnitude,
        });
      }
    }

    for (const [, signal] of Object.entries(signals.fred)) {
      if (Math.abs(signal.changePercent) > 1) {
        const strength = Math.min(Math.abs(signal.changePercent) / 5, 1);
        const magnitude = 0.15 * strength;
        evidence.push({
          likelihoodYes: 0.5 + magnitude,
          likelihoodNo: 0.5 - magnitude,
        });
      }
    }

    if (evidence.length === 0) return { marketId: m.marketId, probability: prior };
    const posterior = bayesianUpdate(prior, evidence.slice(0, 8));
    return { marketId: m.marketId, probability: posterior };
  });
}

function computeTemporalAdjustment(markets: MarketContext[]): Record<string, number> {
  const adjustments: Record<string, number> = {};
  for (const m of markets) {
    if (!m.closesAt) {
      adjustments[m.marketId] = 0.85;
      continue;
    }
    const hoursToClose = (new Date(m.closesAt).getTime() - Date.now()) / 3600000;
    if (hoursToClose < 1) {
      adjustments[m.marketId] = 0.7;
    } else if (hoursToClose < 6) {
      adjustments[m.marketId] = 0.85;
    } else if (hoursToClose < 24) {
      adjustments[m.marketId] = 0.95;
    } else if (hoursToClose < 72) {
      adjustments[m.marketId] = 1.0;
    } else if (hoursToClose > 120) {
      adjustments[m.marketId] = 0.9;
    } else {
      adjustments[m.marketId] = 1.0;
    }
  }
  return adjustments;
}

function extractProbabilityFromText(text: string): number {
  // Try percentage first (most common LLM output format)
  const pctMatch = text.match(/(\d{1,3})\s*%/);
  if (pctMatch) {
    const val = parseInt(pctMatch[1], 10);
    if (val >= 0 && val <= 100) return val / 100;
  }

  // Try "probability of 0.XX" or "probability: 0.XX"
  const probMatch = text.match(/probability\s*(?:of|:)?\s*(\d+\.?\d*)/i);
  if (probMatch) {
    const val = parseFloat(probMatch[1]);
    if (val >= 0 && val <= 1) return val;
    if (val > 1 && val <= 100) return val / 100;
  }

  // Try standalone decimal between 0 and 1 (e.g., "0.75")
  const decimalMatch = text.match(/\b(0\.\d{1,3})\b/);
  if (decimalMatch) {
    const val = parseFloat(decimalMatch[1]);
    if (val >= 0 && val <= 1) return val;
  }

  // Try "X out of 10" or "X/10" patterns
  const outOfMatch = text.match(/(\d{1,2})\s*(?:out of|\/)\s*10/i);
  if (outOfMatch) {
    const val = parseInt(outOfMatch[1], 10);
    if (val >= 0 && val <= 10) return val / 10;
  }

  console.warn("[Agent] Could not extract probability from text, defaulting to 0.5");
  return 0.5;
}

function gdeltToProbability(gdelt: Record<string, any>): number {
  const tones = Object.values(gdelt).map((s: any) => s.avgTone ?? 0);
  if (tones.length === 0) return 0.5;
  const avgTone = tones.reduce((a, b) => a + b, 0) / tones.length;
  return Math.max(0, Math.min(1, 0.5 + avgTone / 20));
}

function cryptoToProbability(cryptoData: Record<string, any>): number {
  const changes = Object.values(cryptoData).map((d: any) => d.change24h ?? 0);
  if (changes.length === 0) return 0.5;
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  return Math.max(0, Math.min(1, 0.5 + avgChange / 20));
}

function macroToProbability(fred: Record<string, any>): number {
  const changes = Object.values(fred).map((s: any) => s.changePercent ?? 0);
  if (changes.length === 0) return 0.5;
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  return Math.max(0, Math.min(1, 0.5 + avgChange / 10));
}

function getMarketPrice(markets: MarketContext[], marketId: string | undefined, side: "yes" | "no"): number {
  if (!marketId) return 0.5;
  const market = markets.find((m) => m.marketId === marketId);
  if (!market) return 0.5;
  return market.outcomes.find((o) => o.name.toLowerCase() === side)?.price ?? 0.5;
}
