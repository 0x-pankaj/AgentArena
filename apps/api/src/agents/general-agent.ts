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
import { REDIS_KEYS, AGENT_LIMITS, AGENT_PROFILES, EXECUTE_TRADES } from "@agent-arena/shared";
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
  DEFAULT_GENERAL_AGENT_MODELS,
  resolveAgentModels,
  type ModelConfig,
} from "../ai/models";
import { GENERAL_AGENT_TOOLS } from "../ai/tools";
import { quickDecision, quickAnalysis } from "../ai/pipeline";
import { checkThresholds } from "./strategy-engine";
import type { GeoSignals } from "./strategy-engine";
import { runAdversarialReview } from "../services/adversarial-review";
import { checkMicrostructure } from "../services/market-microstructure";
import { checkCrossMarketCorrelation } from "../services/correlation-matrix";

import { getAllCalibratedWeights, decayConfidence, getConfidenceAdjustment } from "../services/calibration-service";
import { recordAgentPrediction } from "../services/outcome-feedback";
import { runScenarioAnalysis, quickScenarioGate } from "../services/scenario-analysis";
import { db, schema } from "../db";
import { runEnhancedPipeline } from "./enhanced-pipeline";

const FAST_PATH_EDGE_THRESHOLD = 0.15;
const FAST_PATH_CONFIDENCE_THRESHOLD = 0.85;

const AGENT_NAME = "General Agent";
const AGENT_ID = "general-agent";

// --- General Agent Configuration ---

export function buildGeneralAgentConfig(promptOverrides?: {
  research?: string;
  analysis?: string;
  decision?: string;
}): AgentConfig {
  const models = resolveAgentModels(DEFAULT_GENERAL_AGENT_MODELS);
  const profile = AGENT_PROFILES.general;

  return {
    identity: {
      id: AGENT_ID,
      name: AGENT_NAME,
      category: "general",
      description:
        "General-purpose prediction market agent. Scans ALL market categories using multi-signal analysis: news tone (GDELT), conflict data (ACLED), economic indicators (FRED), satellite data (NASA FIRMS), social signals (Twitter), and web search. Uses Bayesian probability estimation and signal aggregation to find edges across politics, crypto, sports, and economics markets.",
    },
    models,
    tools: [],
    pipeline: [
      {
        name: "research_analysis",
        modelKey: "analysis",
        systemPrompt: promptOverrides?.research ?? `You are a prediction market research analyst. Your job is to identify the most important factors that could determine the outcome of prediction markets, synthesize all research signals into a probability estimate, and provide Bayesian reasoning.

For each market, identify:
1. The top 5 factors that would determine the outcome
2. What data sources could verify each factor
3. Base rates and historical precedents
4. Recent developments that might shift probability
5. Potential contrarian signals (when crowd is wrong)

Then synthesize all research signals into a probability estimate for each market.

METHODOLOGY:
1. Start with the market's implied probability (current price) as your baseline
2. For each piece of evidence, estimate how likely it would be if YES vs NO
3. Apply Bayesian updating to refine your probability estimate
4. Weigh signals by reliability: official data > news reports > social media
5. Account for time-to-resolution (closer events are more predictable)
6. Consider market liquidity (thin markets can be mispriced)

SIGNAL SOURCES:
- GDELT: Global news tone (spikes indicate market-moving events)
- ACLED: Conflict escalation (>50% delta = significant)
- FRED: Economic surprises (>1% change on key indicators)
- NASA FIRMS: Disaster/wildfire risk (>50 hotspots per region)
- Twitter: Social sentiment and breaking news from key accounts
- Web search: Breaking developments

Be thorough, specific, and cite sources. Use web_search and data tools to gather real-time information.
Focus on FACTS and DATA, not speculation. Provide your independent probability estimate for each market.
Explain your reasoning step by step. Be specific about which signals changed your estimate from the market price.`,
        toolNames: [
          "web_search",
          "gdelt_search", "gdelt_tone", "gdelt_all_signals",
          "acled_search", "acled_conflict_signal",
          "fred_series", "fred_macro_signal", "fred_all_signals",
          "twitter_search", "twitter_social_signal", "twitter_key_accounts",
          "coingecko_price", "coingecko_trending", "coingecko_global",
          "defillama_tvl", "defillama_solana", "defillama_protocols",
          "firms_hotspots",
          "market_detail",
        ],
        maxTokens: 6000,
      },
      {
        name: "decision",
        modelKey: "decision",
        systemPrompt: promptOverrides?.decision ?? `You are a prediction market trader making the final trade decision.

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
  let pYes = Math.max(0.001, Math.min(0.999, prior)); // clamp prior
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

  // Filter out NaN/Infinity signals
  const validSignals = signals.filter(
    (s) => isFinite(s.value) && isFinite(s.confidence) && isFinite(s.weight)
  );

  if (validSignals.length === 0) {
    return { probability: 0.5, confidence: 0, nSignals: 0 };
  }

  let totalWeight = 0;
  let weightedSum = 0;

  for (const s of validSignals) {
    const effectiveWeight = s.weight * s.confidence;
    weightedSum += s.value * effectiveWeight;
    totalWeight += effectiveWeight;
  }

  if (!isFinite(totalWeight) || totalWeight === 0) {
    return { probability: 0.5, confidence: 0, nSignals: validSignals.length };
  }

  const probability = weightedSum / totalWeight;
  if (!isFinite(probability)) {
    return { probability: 0.5, confidence: 0, nSignals: validSignals.length };
  }

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

// --- General Agent Tick ---

export async function runGeneralAgentTick(
  ctx: AgentRuntimeContext
): Promise<AgentTickResult> {
  // Load evolved prompts from DB (falls back to hardcoded if none)
  const dbPrompts = await getActivePrompts("general");
  const config = buildGeneralAgentConfig({
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
    console.log(`[General Agent] Resumed from ${currentState} but markets cache expired — forcing SCANNING`);
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
    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} scanning all market categories (politics, crypto, sports, economics)...`, { pipeline_stage: "scanning_start" });

    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} fetching markets via MarketEventBus...`, { pipeline_stage: "fetching_markets_enhanced", pipeline_version: "v2" });
    const markets = await scanMarkets("general");

    if (markets.length === 0) {
      fsm.transition("no_markets");
      await saveState();

      await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME}: No qualifying markets found (min volume: $${AGENT_LIMITS.MIN_MARKET_VOLUME.toLocaleString()})`, { markets_scanned: 0 }, "info");

      return { state: fsm.getState(), action: "scanned", detail: "No qualifying markets" };
    }

    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} found ${markets.length} qualifying markets across all categories:`, { 
      pipeline_stage: "markets_found", 
      markets_scanned: markets.length,
      market_list: markets.slice(0, 5).map(m => ({ id: m.marketId, question: m.question, volume: m.volume, closesAt: m.closesAt }))
    }, "significant");

    await redis.setex(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:markets`, 300, JSON.stringify(markets));
    fsm.transition("markets_found");
    await saveState();
  }

  // --- ANALYZING (2-stage pipeline) ---
  if (fsm.getState() === "ANALYZING") {
    // ===== ENHANCED PIPELINE (v2) =====
    const pipelineResult = await runEnhancedPipeline(ctx, fsm, {
      agentId: AGENT_ID,
      agentName: AGENT_NAME,
      category: "general",
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
          decision, AGENT_ID, ctx.jobId, ctx.agentWalletId, ctx.ownerPubkey, portfolio, AGENT_NAME, "general"
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
          positions.map((p) => ({ marketId: p.marketId, marketQuestion: p.marketId, side: p.side, amount: p.amount, category: "general" }));
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

      const result = await executeBuy(decision, ctx.agentId, ctx.jobId, ctx.agentWalletId, ctx.ownerPubkey, portfolio, AGENT_NAME, "general");
      if (result.success) {
        if (result.positionId) {
          await recordPromptLinks(result.positionId, "general").catch((err) =>
            console.error(`[General Agent] Failed to record prompt links: ${err.message}`)
          );

          // Position monitoring is handled automatically by the unified position-monitor service
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

// --- Context builders ---

function buildGeneralResearchContext(
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
    const q = m.question.toLowerCase();
    if (q.includes("crypto") || q.includes("bitcoin") || q.includes("eth")) {
      if (signals.crypto) {
        for (const [coin, c] of Object.entries(signals.crypto.prices ?? {})) {
          if (Math.abs(c.change24h) > 3) relevant.push(`${coin}: ${c.change24h.toFixed(1)}%`);
        }
      }
    }
    for (const [region, g] of Object.entries(signals.gdelt ?? {})) {
      if (Math.abs(g.avgTone) > 2) relevant.push(`GDELT ${region}: tone=${g.avgTone.toFixed(2)}`);
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

function buildGeneralDecisionContext(
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

function computeGeneralTemporalAdjustment(markets: MarketContext[]): Record<string, number> {
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
    if (signals.crypto) {
      for (const [, c] of Object.entries(signals.crypto.prices ?? {})) {
        if (Math.abs(c.change24h) > 3) {
          const strength = Math.min(Math.abs(c.change24h) / 20, 1);
          const mag = 0.25 * strength;
          evidence.push({ likelihoodYes: 0.5 + (c.change24h > 0 ? mag : -mag), likelihoodNo: 0.5 - (c.change24h > 0 ? mag : -mag) });
        }
      }
    }
    for (const [, g] of Object.entries(signals.gdelt ?? {})) {
      if (Math.abs(g.avgTone) > 2) {
        const strength = Math.min(Math.abs(g.avgTone) / 10, 1);
        const mag = 0.2 * strength;
        evidence.push({ likelihoodYes: 0.5 + (g.avgTone > 0 ? mag : -mag), likelihoodNo: 0.5 - (g.avgTone > 0 ? mag : -mag) });
      }
    }
    if (evidence.length === 0) return { marketId: m.marketId, probability: prior };
    return { marketId: m.marketId, probability: bayesianUpdate(prior, evidence.slice(0, 8)) };
  });
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
  // Map tone (-10 to +10) to probability (0 to 1)
  return Math.max(0, Math.min(1, 0.5 + avgTone / 20));
}

function conflictToProbability(acled: Record<string, any>): number {
  const deltas = Object.values(acled).map((s: any) => s.delta7d ?? 0);
  if (deltas.length === 0) return 0.5;
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  // Conflict escalation → higher probability for negative outcomes
  return Math.max(0, Math.min(1, 0.5 + avgDelta / 200));
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
