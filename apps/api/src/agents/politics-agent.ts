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
import { REDIS_KEYS, AGENT_LIMITS, AGENT_PROFILES, EXECUTE_TRADES, USE_ENHANCED_PIPELINE } from "@agent-arena/shared";
import { getActivePositions } from "../services/trade-service";
import { getSharedSignals, type SharedSignals } from "../services/signal-cache";
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
  DEFAULT_POLITICS_AGENT_MODELS,
  resolveAgentModels,
  type ModelConfig,
} from "../ai/models";
import { POLITICS_AGENT_TOOLS } from "../ai/tools";
import { quickDecision, quickAnalysis } from "../ai/pipeline";
import { checkThresholds } from "./strategy-engine";
import { runAdversarialReview } from "../services/adversarial-review";
import { runMultiModelConsensus } from "../services/multi-model-consensus";
import { checkMicrostructure } from "../services/market-microstructure";
import { checkCrossMarketCorrelation } from "../services/correlation-matrix";
import { checkMonitoredPositions, registerPositionForMonitoring } from "../services/price-monitor";
import { getAllCalibratedWeights, decayConfidence, getConfidenceAdjustment } from "../services/calibration-service";
import { recordAgentPrediction } from "../services/outcome-feedback";
import { runScenarioAnalysis, quickScenarioGate } from "../services/scenario-analysis";
import { db, schema } from "../db";
import { runEnhancedPipeline } from "./enhanced-pipeline";

const AGENT_NAME = "Politics Agent";
const AGENT_ID = "politics-agent";

const FAST_PATH_EDGE_THRESHOLD = 0.15;
const FAST_PATH_CONFIDENCE_THRESHOLD = 0.85;

// --- Politics Agent Configuration ---

export function buildPoliticsAgentConfig(promptOverrides?: {
  research?: string;
  analysis?: string;
  decision?: string;
}): AgentConfig {
  const models = resolveAgentModels(DEFAULT_POLITICS_AGENT_MODELS);
  const profile = AGENT_PROFILES.politics;

  return {
    identity: {
      id: AGENT_ID,
      name: AGENT_NAME,
      category: "politics",
      description:
        "Political & geopolitical prediction market agent. Analyzes global news tone (GDELT), conflict escalation (ACLED), economic policy indicators (FRED), social sentiment (Twitter), and breaking news to trade political and geopolitical markets. Covers elections, wars, sanctions, treaties, coups, referendums, and policy outcomes.",
    },
    models,
    tools: [],
    pipeline: [
      {
        name: "research_analysis",
        modelKey: "analysis",
        systemPrompt: promptOverrides?.research ?? promptOverrides?.analysis ?? `You are a geopolitical and political research analyst specializing in prediction markets. Your job is to identify the most important factors that could determine the outcome of political prediction markets AND synthesize them into probability estimates.

For each market:
1. Identify top 5 factors that would determine the outcome
2. Use GDELT for global news tone, ACLED for conflict data, FRED for economic indicators, Twitter for sentiment, web_search for breaking developments
3. Start with the market's implied probability (current price) as baseline prior
4. For each piece of evidence, estimate P(evidence | Yes) and P(evidence | No)
5. Apply Bayesian updating to refine your probability estimate
6. Factor in base rates and historical precedents
7. Consider time-to-resolution (closer events are more predictable)

DOMAINS YOU COVER:
- Elections & referendums (polling, turnout, voter sentiment)
- Wars & conflicts (military movements, ceasefire negotiations, escalation)
- Sanctions & trade policy (economic impact, diplomatic signals)
- Coups & political instability (ACLED conflict data, social unrest)
- Treaties & diplomacy (negotiation progress, diplomatic language)
- Legislative outcomes (vote counts, party dynamics, lobbying)
- Supreme Court / judicial decisions (legal precedent, judicial philosophy)

OUTPUT: For each market, provide your probability estimate with step-by-step Bayesian reasoning. Be specific about which signals shifted your estimate from the market price.`,
        toolNames: [
          "web_search",
          "gdelt_search", "gdelt_tone", "gdelt_all_signals",
          "acled_search", "acled_conflict_signal", "acled_regional",
          "fred_series", "fred_macro_signal", "fred_all_signals",
          "twitter_search", "twitter_social_signal", "twitter_key_accounts",
        ],
        maxTokens: 6000,
      },
      {
        name: "decision",
        modelKey: "decision",
        systemPrompt: promptOverrides?.decision ?? `You are a prediction market trader making the final trade decision on political markets.

RULES:
- Confidence must be >${profile.minConfidence * 100}% to trade
- Max position: ${profile.maxPortfolioPercent * 100}% of portfolio per market
- Max ${profile.maxPositions} concurrent positions
- Only trade markets settling within ${profile.maxMarketDays} days
- Only trade markets with >$${profile.minVolume.toLocaleString()} volume
- If uncertain, choose "hold"
- Only trade when edge (your probability - market price) exceeds 5% after fees (~2%)
${EXECUTE_TRADES ? "" : "- NOTE: Running in decision-only mode (devnet). Log decisions but flag as analysis only."}

EDGE DETECTION:
- Calculate: edge = your_probability - market_probability
- Only trade if |edge| > 5% after accounting for fees (~2%)
- Direction: if your_prob > market_prob → buy YES; if your_prob < market_prob → buy NO

POSITION SIZING (Quarter-Kelly):
- Kelly fraction = (probability * (1 + odds) - 1) / odds
- Use quarter-Kelly (25% of full Kelly) for safety
- Minimum trade: $5 USDC

POLITICAL MARKET SPECIFICS:
- Elections: consider polling averages, not individual polls
- Wars/conflicts: consider military capability, international support, economic constraints
- Policy: consider legislative math, party discipline, public opinion
- Sanctions: consider economic interdependence, diplomatic relationships

OUTPUT FORMAT (must be valid JSON, no other text):
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
    minConfidence: profile.minConfidence,
    scanIntervalMs: 5 * 60 * 1000,
    monitorIntervalMs: 60 * 1000,
  };
}

// --- Publish rich feed events for live pipeline visibility ---

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
    content: {
      ...content,
      pipeline_stage: category,
    },
    displayMessage,
  });
  await publishFeedEvent(feedEvent);
}

// --- Bayesian probability estimation ---

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

// --- Signal aggregation with confidence weighting ---

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
  if (signals.length === 0) {
    return { probability: 0.5, confidence: 0, nSignals: 0 };
  }

  let totalWeight = 0;
  let weightedSum = 0;

  for (const s of signals) {
    const effectiveWeight = s.weight * s.confidence;
    weightedSum += s.value * effectiveWeight;
    totalWeight += effectiveWeight;
  }

  if (totalWeight === 0) {
    return { probability: 0.5, confidence: 0, nSignals: signals.length };
  }

  const probability = weightedSum / totalWeight;

  // Confidence increases with agreeing signals
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

// --- Edge detection ---

function calculateEdge(
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

  return {
    direction: "none",
    rawEdge: 0,
    netEdge: 0,
    shouldTrade: false,
  };
}

// --- Quarter-Kelly position sizing ---

function kellyPositionSize(
  probability: number,
  marketPrice: number,
  portfolioBalance: number
): number {
  if (probability <= marketPrice) return 0;

  const odds = (1 - marketPrice) / marketPrice;
  const fullKelly = (probability * (odds + 1) - 1) / odds;
  const quarterKelly = Math.max(0, Math.min(fullKelly * 0.25, 0.25));

  const size = portfolioBalance * quarterKelly;
  return Math.max(5, Math.round(size * 100) / 100); // min $5
}

// --- Politics Agent Tick ---

export async function runPoliticsAgentTick(
  ctx: AgentRuntimeContext
): Promise<AgentTickResult> {
  const dbPrompts = await getActivePrompts("politics");
  const config = buildPoliticsAgentConfig({
    research: dbPrompts.research ?? undefined,
    analysis: dbPrompts.analysis ?? undefined,
    decision: dbPrompts.decision ?? undefined,
  });
  const fsm = new AgentFSM(ctx.agentId, ctx.jobId);

  // Restore FSM state
  const savedState = await redis.get(
    `${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:fsm`
  );
  if (savedState) {
    try {
      const parsed = JSON.parse(savedState) as { state: string; context?: any };
      fsm.restoreState(parsed.state as any, parsed.context);
    } catch {
      // ignore — start fresh
    }
  }

  // Always force scan on first tick after resume (markets cache may be stale/missing)
  const marketsCacheKey = `${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:markets`;
  const marketsCacheExists = await redis.exists(marketsCacheKey);
  const currentState = fsm.getState();
  if (currentState !== "IDLE" && currentState !== "SCANNING" && !marketsCacheExists) {
    console.log(`[Politics Agent] Resumed from ${currentState} but markets cache expired — forcing SCANNING`);
    fsm.reset();
    fsm.transition("user_hires");
  }

  const saveState = async () => {
    await redis.set(
      `${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:fsm`,
      JSON.stringify(fsm.toJSON())
    );
  };

  if (fsm.isPaused()) {
    return {
      state: fsm.getState(),
      action: "skipped",
      detail: `Paused: ${fsm.getContext().pauseReason}`,
    };
  }

  // Start scanning if idle
  if (fsm.getState() === "IDLE") {
    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} waking up — starting new analysis cycle`, { pipeline_stage: "waking_up" }, "info");
    try {
      fsm.transition("user_hires");
      await saveState();
    } catch {
      // already scanning
    }
  }

  // --- SCANNING ---
  if (fsm.getState() === "SCANNING") {
    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} scanning political & geopolitical markets (elections, wars, sanctions, treaties)...`, { pipeline_stage: "scanning_start" });

    if (USE_ENHANCED_PIPELINE) {
      await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} fetching markets via MarketEventBus (enhanced pipeline)...`, { pipeline_stage: "fetching_markets_enhanced", pipeline_version: "v2" });
    } else {
      await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} fetching trending markets from Jupiter Predict...`, { pipeline_stage: "fetching_markets" });
    }
    const markets = await scanMarkets("politics");

    if (markets.length === 0) {
      fsm.transition("no_markets");
      await saveState();

      await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME}: No qualifying political markets found (min volume: $${AGENT_LIMITS.MIN_MARKET_VOLUME.toLocaleString()})`, { markets_scanned: 0 }, "info");

      return { state: fsm.getState(), action: "scanned", detail: "No qualifying political markets" };
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

  // --- ANALYZING (3-stage pipeline) ---
  if (fsm.getState() === "ANALYZING") {
    // ===== ENHANCED PIPELINE (v2) =====
    if (USE_ENHANCED_PIPELINE) {
      const pipelineResult = await runEnhancedPipeline(ctx, fsm, {
        agentId: AGENT_ID,
        agentName: AGENT_NAME,
        category: "politics",
        models: config.models,
        decisionSystemPrompt: config.pipeline[1].systemPrompt,
      }, saveState);

      if (pipelineResult.decision && pipelineResult.action === "analyzed") {
        const marketsRaw = await redis.get(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:markets`);
        const markets: MarketContext[] = marketsRaw ? JSON.parse(marketsRaw) : [];
        const { positions: dbPositions } = await getActivePositions(ctx.jobId);
        const positions: AgentPosition[] = dbPositions.map((p) => ({
          marketId: p.marketId, side: p.side, amount: Number(p.amount),
          entryPrice: Number(p.entryPrice), currentPrice: Number(p.currentPrice ?? p.entryPrice),
          pnl: Number(p.pnl ?? 0),
        }));
        const portfolio = await buildPortfolioSnapshot(ctx.agentWalletAddress, positions, ctx.jobId);
        const decision = pipelineResult.decision;

        if (decision.action === "buy" && decision.marketId) {
          const buyResult = await executeBuy(
            decision, AGENT_ID, ctx.jobId, ctx.agentWalletId, ctx.ownerPubkey, portfolio, AGENT_NAME, "politics"
          );
          if (buyResult.success) {
            fsm.transition("order_placed");
            await saveState();
            return { state: fsm.getState() as any, action: "executed" as any, detail: `Bought on "${decision.marketQuestion}"`, decision, tokensUsed: pipelineResult.tokensUsed };
          }
        }

        return { state: fsm.getState() as any, action: pipelineResult.action as any, detail: pipelineResult.detail, decision: pipelineResult.decision, tokensUsed: pipelineResult.tokensUsed };
      }

      return { state: fsm.getState() as any, action: pipelineResult.action as any, detail: pipelineResult.detail, tokensUsed: pipelineResult.tokensUsed };
    }

    // ===== LEGACY PIPELINE (v1) =====
    // Fetch signals from shared cache
    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} fetching live geopolitical signals...`, { pipeline_stage: "signal_fetch_start" });

    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} querying GDELT for global news tone...`, { pipeline_stage: "fetching_gdelt" });
    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} querying ACLED for conflict data...`, { pipeline_stage: "fetching_acled" });
    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} querying FRED for macro indicators...`, { pipeline_stage: "fetching_fred" });
    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} querying NASA FIRMS for satellite data...`, { pipeline_stage: "fetching_firms" });

    const signals = await getSharedSignals("politics");

    // Count active signals
    const signalCount = Object.keys(signals.gdelt).length + Object.keys(signals.acled).length + Object.keys(signals.fred).length + Object.keys(signals.fires).length;

    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} received ${signalCount} signal streams:`, { 
      signals_count: signalCount, 
      pipeline_stage: "signals_ready",
      signal_sources: {
        gdelt: Object.keys(signals.gdelt).length,
        acled: Object.keys(signals.acled).length,
        fred: Object.keys(signals.fred).length,
        fires: Object.keys(signals.fires).length,
      }
    });

    // Get markets
    const marketsRaw = await redis.get(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:markets`);
    const markets: MarketContext[] = marketsRaw ? JSON.parse(marketsRaw) : [];

    // Get positions
    const { positions: dbPositions } = await getActivePositions(ctx.jobId);
    const positions: AgentPosition[] = dbPositions.map((p) => ({
      marketId: p.marketId,
      side: p.side,
      amount: Number(p.amount),
      entryPrice: Number(p.entryPrice),
      currentPrice: Number(p.currentPrice ?? p.entryPrice),
      pnl: Number(p.pnl ?? 0),
    }));

    if (positions.length > 0) {
      await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} monitoring ${positions.length} open positions...`, { 
        pipeline_stage: "position_check",
        positions: positions.map(p => ({ marketId: p.marketId, side: p.side, amount: p.amount, pnl: p.pnl }))
      });
    }

    // Check thresholds
    const lastAnalysisRaw = await redis.get(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:last_analysis`);
    const lastAnalysisTime = lastAnalysisRaw ? Number(lastAnalysisRaw) : null;

    const consecutiveNoEdgeRaw = await redis.get(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:consecutive_no_edge`);
    const consecutiveNoEdge = consecutiveNoEdgeRaw ? Number(consecutiveNoEdgeRaw) : 0;

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} checking signal thresholds...`, { pipeline_stage: "threshold_check_start" });
    const thresholdCheck = checkThresholds(signals, lastAnalysisTime, markets, positions, "politics", consecutiveNoEdge);

    if (!thresholdCheck.triggered) {
      await redis.setex(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:consecutive_no_edge`, 3600, String(consecutiveNoEdge + 1));

      fsm.transition("no_edge");
      await saveState();

      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME}: No signal thresholds triggered — market is calm, skipping deep analysis`, { 
        pipeline_stage: "threshold_check", 
        reasons: thresholdCheck.reasons,
        skipped_reasons: thresholdCheck.skippedReasons ?? [],
        consecutive_no_edge: consecutiveNoEdge + 1
      });

      return { state: fsm.getState(), action: "analyzed", detail: "No thresholds triggered, skipping LLM" };
    }

    await redis.set(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:consecutive_no_edge`, "0");

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ⚡ ${thresholdCheck.reasons.length} signal triggers detected:`, { 
      pipeline_stage: "thresholds_triggered", 
      signals_count: signalCount,
      trigger_reasons: thresholdCheck.reasons,
      skipped_reasons: thresholdCheck.skippedReasons ?? []
    }, "significant");

    // Build portfolio snapshot
    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} building portfolio snapshot...`, { pipeline_stage: "portfolio_snapshot" });
    const portfolio = await buildPortfolioSnapshot(ctx.agentWalletAddress, positions, ctx.jobId);

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} portfolio: $${portfolio.totalBalance.toFixed(2)} USDC | ${positions.length} open positions | Daily PnL: $${portfolio.dailyPnl.toFixed(2)}`, { 
      pipeline_stage: "portfolio_ready",
      balance: portfolio.totalBalance,
      positions: positions.length,
      daily_pnl: portfolio.dailyPnl
    });

    // STAGE 1/2: Combined Research + Analysis
    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} 🔍 Stage 1/2: Starting combined research + analysis — analyzing ${markets.length} markets...`, { pipeline_stage: "research_analysis_start" });

    const researchAnalysisPrompt = buildPoliticsResearchContext(signals, markets, positions, portfolio.totalBalance, thresholdCheck.reasons);

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} calling LLM for research + analysis (model: ${config.models.analysis.model})...`, { pipeline_stage: "llm_research_analysis_call" });
    const primaryMarket = markets[0];
    const primaryYesPrice = primaryMarket?.outcomes.find(o => o.name.toLowerCase() === "yes")?.price ?? 0;
    const primaryNoPrice = primaryMarket?.outcomes.find(o => o.name.toLowerCase() === "no")?.price ?? 0;
    const researchAnalysisModel = config.models.analysis;
    const researchAnalysis = await quickAnalysis({
      modelConfig: researchAnalysisModel,
      systemPrompt: config.pipeline[0].systemPrompt,
      userMessage: researchAnalysisPrompt,
      tools: config.pipeline[0].toolNames,
      agentId: ctx.agentId,
      marketContext: primaryMarket ? { marketId: primaryMarket.marketId, yesPrice: primaryYesPrice, noPrice: primaryNoPrice } : undefined,
    });

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ✅ Stage 1/2: Research + Analysis complete`, { 
      pipeline_stage: "research_analysis_complete", 
      tokens_used: researchAnalysis.tokensUsed,
      tool_calls: researchAnalysis.toolCalls,
      reasoning_snippet: researchAnalysis.text.slice(0, 300)
    });

    // Run Bayesian estimation on top markets
    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} running Bayesian probability estimation on ${Math.min(markets.length, 5)} markets...`, { pipeline_stage: "bayesian_estimation" });
    const bayesianResults = runScaledBayesianEstimation(markets.slice(0, 5), signals, researchAnalysis.text);

    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} Bayesian estimates:`, {
      pipeline_stage: "bayesian_results",
      estimates: bayesianResults.map(b => ({ marketId: b.marketId, probability: (b.probability * 100).toFixed(1) + "%" }))
    });

    // Features 1+2+9: Calibrated weights + signal decay + confidence calibration
    const signalAgeMinutes = signals.fetchedAt
      ? (Date.now() - new Date(signals.fetchedAt).getTime()) / 60000
      : 0;
    const calibratedWeights = await getAllCalibratedWeights("politics");

    const defaultPoliticsWeights: Record<string, number> = {
      llm_analysis: 3.0, gdelt_sentiment: 1.0, acled_conflict: 1.5, fred_macro: 1.0,
    };
    const decayedSignals = [
      { name: "llm_analysis", value: extractProbabilityFromText(researchAnalysis.text), confidence: decayConfidence(0.7, signalAgeMinutes, "market"), weight: calibratedWeights["llm_analysis"] ?? defaultPoliticsWeights["llm_analysis"] ?? 3.0 },
      { name: "gdelt_sentiment", value: gdeltToProbability(signals.gdelt), confidence: decayConfidence(0.5, signalAgeMinutes, "gdelt"), weight: calibratedWeights["gdelt_sentiment"] ?? defaultPoliticsWeights["gdelt_sentiment"] ?? 1.0 },
      { name: "acled_conflict", value: conflictToProbability(signals.acled), confidence: decayConfidence(0.6, signalAgeMinutes, "acled"), weight: calibratedWeights["acled_conflict"] ?? defaultPoliticsWeights["acled_conflict"] ?? 1.5 },
      { name: "fred_macro", value: macroToProbability(signals.fred), confidence: decayConfidence(0.5, signalAgeMinutes, "fred"), weight: calibratedWeights["fred_macro"] ?? defaultPoliticsWeights["fred_macro"] ?? 1.0 },
      ...bayesianResults.map((b) => ({
        name: `bayesian_${b.marketId}`,
        value: b.probability,
        confidence: decayConfidence(0.7, signalAgeMinutes, "market"),
        weight: calibratedWeights[`bayesian_${b.marketId}`] ?? 2.0,
      })),
    ];
    const finalAggregatedSignal = aggregateSignals(decayedSignals);

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} aggregating all signals (LLM + GDELT + ACLED + FRED + Bayesian + calibrated + decayed)...`, { pipeline_stage: "signal_aggregation" });
    
    const temporalAdj = computePoliticsTemporalAdjustment(markets);

    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} ✅ Stage 2/2: Signal aggregation complete (calibrated + decayed + temporal)`, { 
      pipeline_stage: "analysis_complete", 
      aggregated_probability: (finalAggregatedSignal.probability * 100).toFixed(1) + "%",
      aggregated_confidence: (finalAggregatedSignal.confidence * 100).toFixed(1) + "%",
      calibration_info: Object.keys(calibratedWeights).length > 0 ? `${Object.keys(calibratedWeights).length} calibrated weights` : "using defaults",
      signals_combined: finalAggregatedSignal.nSignals,
      signal_age_minutes: signalAgeMinutes.toFixed(1),
      reasoning_snippet: researchAnalysis.text.slice(0, 300),
      temporal_adjustment: temporalAdj,
    }, "significant");

    // STAGE 2/2: Decision
    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} 🎯 Stage 2/2: Making trade decision with edge detection...`, { pipeline_stage: "decision_start" });

    let decision: TradeDecision;
    let decisionTokens = 0;
    try {
      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} calling LLM for final decision (model: ${config.models.decision.model})...`, { pipeline_stage: "llm_decision_call" });
      const result = await quickDecision<TradeDecision>({
        modelConfig: config.models.decision,
        systemPrompt: config.pipeline[1].systemPrompt,
        userMessage: buildPoliticsDecisionContext(researchAnalysis.text, finalAggregatedSignal, markets, positions, portfolio.totalBalance, temporalAdj),
        schema: TradeDecisionSchema,
        tools: config.pipeline[1].toolNames,
        agentId: ctx.agentId,
      });
      decision = result.decision;
      decisionTokens = result.tokensUsed;

      // Feature 9: Adjust LLM confidence based on calibration data
      const llmConfidenceAdj = await getConfidenceAdjustment("politics", config.models.decision.model, decision.confidence);
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
      return { state: fsm.getState(), action: "analyzed", detail: `Decision stage error: ${errorMsg}`, tokensUsed: researchAnalysis.tokensUsed };
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

    // FAST-PATH: Skip adversarial review + consensus if edge > 15% and confidence >= 85%
    const preEdgeMarketPrice = decision.isYes ? getMarketPrice(markets, decision.marketId, "yes") : getMarketPrice(markets, decision.marketId, "no");
    const preEdge = calculateEdge(finalAggregatedSignal.probability, preEdgeMarketPrice, finalAggregatedSignal.confidence);
    const useFastPath = preEdge.netEdge > FAST_PATH_EDGE_THRESHOLD && decision.confidence >= FAST_PATH_CONFIDENCE_THRESHOLD;
    if (useFastPath) {
      await publishFeedStep(ctx.agentId, "edge_detected", `${AGENT_NAME} ⚡ FAST-PATH: Edge ${(preEdge.netEdge * 100).toFixed(1)}% and confidence ${(decision.confidence * 100).toFixed(0)}% exceed thresholds — skipping adversarial review & consensus`, { 
        pipeline_stage: "fast_path", 
        edge_percent: (preEdge.netEdge * 100).toFixed(1) + "%",
        confidence: (decision.confidence * 100).toFixed(0) + "%",
        market_id: decision.marketId,
        is_yes: decision.isYes
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

    // Feature 3: Adversarial Self-Review (devil's advocate)
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

    // Feature 5: Multi-Model Consensus
    if (decision.marketId && !useFastPath) {
      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} 🤝 Running multi-model consensus...`, { pipeline_stage: "multi_model_consensus" });
      const consensus = await runMultiModelConsensus({
        systemPrompt: config.pipeline[1].systemPrompt,
        userMessage: buildPoliticsDecisionContext(researchAnalysis.text, finalAggregatedSignal, markets, positions, portfolio.totalBalance, temporalAdj),
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
      await recordAgentPrediction("politics", ctx.agentId, decision, signals, markets, config.models.decision.model).catch((err) =>
        console.error(`[Politics Agent] Failed to record prediction: ${err.message}`)
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

  // --- EXECUTING ---
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
      marketId: p.marketId,
      side: p.side,
      amount: Number(p.amount),
      entryPrice: Number(p.entryPrice),
      currentPrice: Number(p.currentPrice ?? p.entryPrice),
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
          positions.map((p) => ({ marketId: p.marketId, marketQuestion: p.marketId, side: p.side, amount: p.amount, category: "politics" }));
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

      const result = await executeBuy(decision, ctx.agentId, ctx.jobId, ctx.agentWalletId, ctx.ownerPubkey, portfolio, AGENT_NAME, "politics");
      if (result.success) {
        if (result.positionId) {
          await recordPromptLinks(result.positionId, "politics").catch((err) =>
            console.error(`[Politics Agent] Failed to record prompt links: ${err.message}`)
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
            entryPrice: 0.5,
            stopLossPrice: 0.5 * (1 - AGENT_LIMITS.STOP_LOSS_PERCENT),
            amount: decision.amount ?? 0,
            ownerPubkey: ctx.ownerPubkey,
          }).catch((err) => console.error(`[Politics Agent] Failed to register position monitoring: ${err.message}`));
        }
        fsm.transition("order_placed");
        await saveState();
        await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ✅ Order placed successfully`, { pipeline_stage: "order_placed", position_id: result.positionId ?? "" }, "significant");
        return { state: fsm.getState(), action: "executed", detail: `Buy placed: ${result.positionId}`, decision };
      } else {
        fsm.transition("order_failed");
        await saveState();
        await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ❌ Order failed — ${result.error}`, { pipeline_stage: "execution_failed" }, "critical");
        return { state: fsm.getState(), action: "executed", detail: `Buy failed: ${result.error}`, decision };
      }
    } else if (decision.action === "sell" && decision.marketId) {
      const pos = dbPositions.find((p) => p.marketId === decision.marketId);
      if (pos) {
        const result = await executeSell(pos.id, ctx.agentId, ctx.jobId, ctx.agentWalletId, decision.reasoning, AGENT_NAME);
        if (result.success) {
          fsm.transition("order_placed");
          await saveState();
          await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ✅ Sell order placed`, { pipeline_stage: "sell_placed" }, "significant");
          return { state: fsm.getState(), action: "executed", detail: "Sell placed", decision };
        } else {
          fsm.transition("order_failed");
          await saveState();
          await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} ❌ Sell failed — ${result.error}`, { pipeline_stage: "sell_failed" }, "critical");
          return { state: fsm.getState(), action: "executed", detail: `Sell failed: ${result.error}`, decision };
        }
      } else {
        fsm.transition("order_failed");
        await saveState();
        return { state: fsm.getState(), action: "executed", detail: "Position not found for sell" };
      }
    } else {
      fsm.transition("order_failed");
      await saveState();
      return { state: fsm.getState(), action: "executed", detail: "Invalid decision action" };
    }
  }

  // --- MONITORING ---
  if (fsm.getState() === "MONITORING") {
    // Background price monitor handles stop-losses independently (30s interval)
    // No blocking calls needed — return immediately and let tick cycle continue
    return { state: fsm.getState(), action: "monitored", detail: "Background monitoring active" };
  }

  // --- CLOSING / SETTLING ---
  if (fsm.getState() === "CLOSING" || fsm.getState() === "SETTLING") {
    try {
      fsm.transition("cycle_complete");
      await saveState();
    } catch {
      fsm.reset();
      await saveState();
    }
    return {
      state: fsm.getState(),
      action: "skipped",
      detail: "Cycle complete",
    };
  }

  return {
    state: fsm.getState(),
    action: "skipped",
    detail: `Unhandled: ${fsm.getState()}`,
  };
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

function conflictToProbability(acled: Record<string, any>): number {
  const deltas = Object.values(acled).map((s: any) => s.delta7d ?? 0);
  if (deltas.length === 0) return 0.5;
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return Math.max(0, Math.min(1, 0.5 + avgDelta / 200));
}

function macroToProbability(fred: Record<string, any>): number {
  const changes = Object.values(fred).map((s: any) => s.changePercent ?? 0);
  if (changes.length === 0) return 0.5;
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  return Math.max(0, Math.min(1, 0.5 + avgChange / 10));
}

function getMarketPrice(
  markets: MarketContext[],
  marketId: string | undefined,
  side: "yes" | "no"
): number {
  if (!marketId) return 0.5;
  const market = markets.find((m) => m.marketId === marketId);
  if (!market) return 0.5;
  const price = market.outcomes.find(
    (o) => o.name.toLowerCase() === side
  )?.price;
  return price ?? 0.5;
}

function buildPoliticsResearchContext(
  signals: SharedSignals,
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
  for (const m of markets.slice(0, 10)) {
    const prices = m.outcomes.map((o) => `${o.name}: $${o.price}`).join(", ");
    const hoursToClose = m.closesAt ? ((new Date(m.closesAt).getTime() - Date.now()) / 3600000).toFixed(1) : "N/A";
    parts.push(`\n### [${m.marketId}] "${m.question}"\n| Prices: ${prices} | Vol=$${m.volume} | ${hoursToClose}h to close`);
    const relevant: string[] = [];
    for (const [region, g] of Object.entries(signals.gdelt ?? {})) {
      if (Math.abs(g.avgTone) > 2) relevant.push(`GDELT ${region}: tone=${g.avgTone.toFixed(2)}`);
    }
    for (const [region, a] of Object.entries(signals.acled ?? {})) {
      if (Math.abs(a.delta7d) > 30) relevant.push(`ACLED ${region}: delta=${a.delta7d.toFixed(0)}%`);
    }
    for (const [key, f] of Object.entries(signals.fred ?? {})) {
      if (Math.abs(f.changePercent) > 0.5) relevant.push(`FRED ${key}: ${f.trend} ${f.changePercent.toFixed(2)}%`);
    }
    if (relevant.length > 0) parts.push("Signals: " + relevant.slice(0, 3).join("; "));
    else parts.push("No strong signals for this market");
  }
  parts.push(`\n## Research + Analysis Task:\nFor EACH market above, identify top 5 factors and provide probability estimates with Bayesian reasoning.`);
  return parts.join("\n");
}

function buildPoliticsDecisionContext(
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
    return `- [${m.marketId}] "${m.question}" | ${prices} | ${hoursToClose}h | adj: ${(adj * 100).toFixed(0)}%`;
  }).join("\n");
  return `## Analysis\n${analysis}\n\n## Aggregation\nprob=${(aggregated.probability * 100).toFixed(1)}% conf=${(aggregated.confidence * 100).toFixed(1)}% n=${aggregated.nSignals}\n## Temporal\n${Object.entries(temporalAdj).map(([k, v]) => `${k}: ${(v * 100).toFixed(0)}%`).join(", ")}\n## Portfolio\nBalance: $${balance.toFixed(2)} | ${positions.length} positions\n${marketLines}\n\n## Decision\nEdge > 5%, confidence > ${(AGENT_LIMITS.MIN_CONFIDENCE * 100).toFixed(0)}%, quarter-Kelly.`;
}

function computePoliticsTemporalAdjustment(markets: MarketContext[]): Record<string, number> {
  const adj: Record<string, number> = {};
  for (const m of markets) {
    if (!m.closesAt) { adj[m.marketId] = 0.85; continue; }
    const h = (new Date(m.closesAt).getTime() - Date.now()) / 3600000;
    if (h < 1) adj[m.marketId] = 0.7;
    else if (h < 6) adj[m.marketId] = 0.85;
    else if (h < 24) adj[m.marketId] = 0.95;
    else if (h < 72) adj[m.marketId] = 1.0;
    else adj[m.marketId] = 0.9;
  }
  return adj;
}

function runScaledBayesianEstimation(
  markets: MarketContext[],
  signals: SharedSignals,
  analysis: string
): Array<{ marketId: string; probability: number }> {
  return markets.map((m) => {
    const prior = m.outcomes.find((o) => o.name.toLowerCase() === "yes")?.price ?? 0.5;
    const evidence: Array<{ likelihoodYes: number; likelihoodNo: number }> = [];
    for (const [, g] of Object.entries(signals.gdelt ?? {})) {
      if (Math.abs(g.avgTone) > 2) {
        const strength = Math.min(Math.abs(g.avgTone) / 10, 1);
        const mag = 0.2 * strength;
        evidence.push({ likelihoodYes: 0.5 + (g.avgTone > 0 ? mag : -mag), likelihoodNo: 0.5 - (g.avgTone > 0 ? mag : -mag) });
      }
    }
    for (const [, a] of Object.entries(signals.acled ?? {})) {
      if (Math.abs(a.delta7d) > 20) {
        const strength = Math.min(Math.abs(a.delta7d) / 100, 1);
        const mag = 0.15 * strength;
        evidence.push({ likelihoodYes: 0.5 + mag, likelihoodNo: 0.5 - mag });
      }
    }
    if (evidence.length === 0) return { marketId: m.marketId, probability: prior };
    return { marketId: m.marketId, probability: bayesianUpdate(prior, evidence.slice(0, 8)) };
  });
}
