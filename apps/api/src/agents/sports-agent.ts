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
import { getSharedSignals, type SharedSignals } from "../services/signal-cache";
import { getActivePrompts, recordPromptLinks } from "../services/evolution-service";
import { publishFeedEvent, buildFeedEvent } from "../feed";
import { invalidateOnThreshold } from "../services/signal-invalidation";
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
  DEFAULT_SPORTS_AGENT_MODELS,
  resolveAgentModels,
  type ModelConfig,
} from "../ai/models";
import { SPORTS_AGENT_TOOLS } from "../ai/tools";
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

const AGENT_NAME = "Sports Agent";
const AGENT_ID = "sports-agent";
const FAST_PATH_EDGE_THRESHOLD = 0.15;
const FAST_PATH_CONFIDENCE_THRESHOLD = 0.85;

export function buildSportsAgentConfig(promptOverrides?: {
  research?: string;
  analysis?: string;
  decision?: string;
}): AgentConfig {
  const models = resolveAgentModels(DEFAULT_SPORTS_AGENT_MODELS);

  return {
    identity: {
      id: AGENT_ID,
      name: AGENT_NAME,
      category: "sports",
      description:
        "Sports prediction market agent. Analyzes team performance, injury reports, head-to-head records, betting lines, and social sentiment to trade sports prediction markets. Covers NFL, NBA, soccer, MMA, tennis, and major sporting events.",
    },
    models,
    tools: [],
    pipeline: [
      {
        name: "research_analysis",
        modelKey: "analysis",
        systemPrompt: promptOverrides?.research ?? promptOverrides?.analysis ?? `You are a senior sports prediction market analyst performing research AND Bayesian analysis in a single pass.

PART 1 — RESEARCH:
For each market, identify:
1. The top 5 factors that would determine the outcome
2. Team/player performance and recent form (last 5-10 games)
3. Injury reports and roster changes
4. Head-to-head historical records
5. Home/away advantage and venue factors
6. Betting line movements and sharp money indicators
7. Weather conditions (for outdoor sports)
8. Rest days and schedule fatigue
9. Coaching strategies and tactical matchups
10. Motivation factors (playoffs, rivalry, dead rubber)

PART 2 — BAYESIAN ANALYSIS:
1. Start with the market's implied probability (current price) as your baseline prior
2. For each piece of evidence, estimate P(evidence|YES) and P(evidence|NO)
3. Apply Bayesian updating to refine your probability estimate
4. Weigh signals by reliability: official injury reports > betting lines > social media rumors
5. Account for time-to-resolution (closer games are more predictable)
6. Consider market liquidity (thin sports markets can be mispriced)
7. Factor in sports base rates (home teams win ~60% in most sports)

SPORTS YOU COVER:
- NFL: Preseason, regular season, playoffs, Super Bowl
- NBA: Regular season, playoffs, Finals
- Soccer: Premier League, Champions League, World Cup qualifiers
- MMA/UFC: Fight cards, title bouts
- Tennis: Grand Slams, ATP/WTA events
- MLB: Regular season, World Series
- Major events: Olympics, World Cup, Euro

SIGNAL SOURCES:
- Recent form: Win/loss record in last 5-10 games, point differentials
- Injuries: Key player availability, impact on team performance
- Head-to-head: Historical matchup records, style advantages
- Venue: Home/away splits, altitude, crowd factor
- Betting lines: Opening vs current lines, sharp vs public money
- Social: Breaking news, insider reports, team chemistry rumors

OUTPUT: For each market, provide your independent probability estimate with step-by-step reasoning.`,
        toolNames: [
          "web_search",
          "twitter_search", "twitter_social_signal",
          "market_detail",
        ],
        maxTokens: 4000,
      },
      {
        name: "decision",
        modelKey: "decision",
        systemPrompt: promptOverrides?.decision ?? `You are a prediction market trader making the final trade decision on sports markets.

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

SPORTS MARKET SPECIFICS:
- Game outcomes: weigh recent form heavily (last 5 games)
- Injuries: check starting lineups close to game time
- Playoff games: motivation and experience matter more
- Upsets: underdogs win more often than odds suggest in knockout formats
- Near-resolution markets: require HIGHER confidence due to time decay

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

export async function runSportsAgentTick(ctx: AgentRuntimeContext): Promise<AgentTickResult> {
  const dbPrompts = await getActivePrompts("sports");
  const config = buildSportsAgentConfig({
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
    console.log(`[Sports Agent] Resumed from ${currentState} but markets cache expired — forcing SCANNING`);
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
    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} scanning sports prediction markets (NFL, NBA, Soccer, MMA, Tennis)...`, { pipeline_stage: "scanning_start" });

    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} fetching markets via MarketEventBus...`, { pipeline_stage: "fetching_markets_enhanced", pipeline_version: "v2" });
    const markets = await scanMarkets("sports");
    if (markets.length === 0) {
      fsm.transition("no_markets");
      await saveState();
      await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME}: No qualifying sports markets found (min volume: $${AGENT_LIMITS.MIN_MARKET_VOLUME.toLocaleString()})`, { markets_scanned: 0 });
      return { state: fsm.getState(), action: "scanned", detail: "No qualifying sports markets" };
    }

    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} found ${markets.length} qualifying sports markets:`, { 
      pipeline_stage: "markets_found", 
      markets_scanned: markets.length,
      market_list: markets.slice(0, 5).map(m => ({ id: m.marketId, question: m.question, volume: m.volume, closesAt: m.closesAt }))
    }, "significant");

    await redis.setex(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:markets`, 300, JSON.stringify(markets));
    fsm.transition("markets_found");
    await saveState();
  }

  if (fsm.getState() === "ANALYZING") {
    const pipelineResult = await runEnhancedPipeline(ctx, fsm, {
      agentId: AGENT_ID,
      agentName: AGENT_NAME,
      category: "sports",
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
          decision, AGENT_ID, ctx.jobId, ctx.agentWalletId, ctx.ownerPubkey, portfolio, AGENT_NAME, "sports"
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
      // Feature 6: Microstructure check
      if (decision.marketId) {
        const microCheck = await checkMicrostructure(decision.marketId, decision.amount ?? 0);
        if (!microCheck.allowed) {
          fsm.transition("order_failed"); await saveState();
          return { state: fsm.getState(), action: "executed", detail: `Microstructure rejected: ${microCheck.reason}`, decision };
        }
      }
      // Feature 7: Correlation check
      if (decision.marketId) {
        const positionRisks = positions.map((p) => ({ marketId: p.marketId, marketQuestion: p.marketId, side: p.side, amount: p.amount, category: "sports" as const }));
        const correlationCheck = checkCrossMarketCorrelation(decision.marketQuestion ?? decision.marketId ?? "", decision.amount ?? 0, positionRisks, portfolio.totalBalance);
        if (!correlationCheck.allowed) {
          fsm.transition("order_failed"); await saveState();
          return { state: fsm.getState(), action: "executed", detail: `Correlation rejected: ${correlationCheck.reason}`, decision };
        }
      }

      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} executing: BUY ${decision.isYes ? "YES" : "NO"} $${decision.amount ?? 0} on "${decision.marketQuestion}"`, { pipeline_stage: "executing", action: "buy", market_analyzed: decision.marketQuestion, amount: String(decision.amount ?? 0) });

      const result = await executeBuy(decision, ctx.agentId, ctx.jobId, ctx.agentWalletId, ctx.ownerPubkey, portfolio, AGENT_NAME, "sports");
      if (result.success) {
        if (result.positionId) {
          await recordPromptLinks(result.positionId, "sports").catch(() => {});
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

  if (fsm.getState() === "SCANNING") {
    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} fetching markets via MarketEventBus...`, { pipeline_stage: "fetching_markets_enhanced", pipeline_version: "v2" });

    const markets = await scanMarkets("sports");
    if (markets.length === 0) {
      fsm.transition("no_markets");
      await saveState();
      await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME}: No qualifying sports markets found`, { markets_scanned: 0 });
      return { state: fsm.getState(), action: "scanned", detail: "No qualifying sports markets" };
    }

    await redis.setex(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:markets`, 300, JSON.stringify(markets));
    fsm.transition("markets_found");
    await saveState();
    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} found ${markets.length} qualifying sports markets`, { markets_scanned: markets.length }, "significant");
  }

  if (fsm.getState() === "ANALYZING") {
    const pipelineResult = await runEnhancedPipeline(ctx, fsm, {
      agentId: AGENT_ID,
      agentName: AGENT_NAME,
      category: "sports",
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
          decision, AGENT_ID, ctx.jobId, ctx.agentWalletId, ctx.ownerPubkey, portfolio, AGENT_NAME, "sports"
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
      // Feature 6: Microstructure check
      if (decision.marketId) {
        const microCheck = await checkMicrostructure(decision.marketId, decision.amount ?? 0);
        if (!microCheck.allowed) {
          fsm.transition("order_failed"); await saveState();
          return { state: fsm.getState(), action: "executed", detail: `Microstructure rejected: ${microCheck.reason}`, decision };
        }
      }
      // Feature 7: Correlation check
      if (decision.marketId) {
        const positionRisks = positions.map((p) => ({ marketId: p.marketId, marketQuestion: p.marketId, side: p.side, amount: p.amount, category: "sports" as const }));
        const correlationCheck = checkCrossMarketCorrelation(decision.marketQuestion ?? decision.marketId ?? "", decision.amount ?? 0, positionRisks, portfolio.totalBalance);
        if (!correlationCheck.allowed) {
          fsm.transition("order_failed"); await saveState();
          return { state: fsm.getState(), action: "executed", detail: `Correlation rejected: ${correlationCheck.reason}`, decision };
        }
      }

      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} executing: BUY ${decision.isYes ? "YES" : "NO"} $${decision.amount ?? 0} on "${decision.marketQuestion}"`, { pipeline_stage: "executing", action: "buy", market_analyzed: decision.marketQuestion, amount: String(decision.amount ?? 0) });

      const result = await executeBuy(decision, ctx.agentId, ctx.jobId, ctx.agentWalletId, ctx.ownerPubkey, portfolio, AGENT_NAME, "sports");
      if (result.success) {
        if (result.positionId) {
          await recordPromptLinks(result.positionId, "sports").catch(() => {});
          // Position monitoring is handled automatically by the unified position-monitor service
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

function buildSportsResearchContext(
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
    parts.push(`\n### [${m.marketId}] "${m.question}"\n| Prices: ${prices} | Vol=$${m.volume} | Closes: ${m.closesAt ?? "N/A"} (${hoursToClose}h)`);
    const relevant: string[] = [];
    if (signals.sports) {
      for (const [sport, s] of Object.entries(signals.sports)) {
        if (s.totalEvents > 0) relevant.push(`${sport}: ${s.totalEvents} events, sharp: ${s.sharpMoneyIndicator.toFixed(2)}, odds_movement: ${s.avgOddsMovement.toFixed(2)}`);
      }
    }
    for (const [region, g] of Object.entries(signals.gdelt ?? {})) {
      if (Math.abs(g.avgTone) > 1) relevant.push(`GDELT ${region}: tone=${g.avgTone.toFixed(2)}`);
    }
    if (relevant.length > 0) parts.push("Signals: " + relevant.slice(0, 3).join("; "));
    else parts.push("No strong signals for this market");
  }
  parts.push(`\n## Research + Analysis Task:\nFor EACH sports market above, identify the top 5 factors, then provide your independent probability estimate with step-by-step Bayesian reasoning.`);
  return parts.join("\n");
}

function buildSportsDecisionContext(
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
    return `- [${m.marketId}] "${m.question}" | ${prices} | ${hoursToClose}h | Temporal adj: ${(adj * 100).toFixed(0)}%`;
  }).join("\n");
  return `## Analysis Results\n${analysis}\n\n## Signal Aggregation\n- Aggregated probability: ${(aggregated.probability * 100).toFixed(1)}%\n- Overall confidence: ${(aggregated.confidence * 100).toFixed(1)}%\n- Signals combined: ${aggregated.nSignals}\n\n## Temporal Adjustments\n${Object.entries(temporalAdj).map(([id, adj]) => `- ${id}: ${(adj * 100).toFixed(0)}%`).join("\n")}\n\n## Portfolio\n- Balance: $${balance.toFixed(2)} USDC\n- Open positions: ${positions.length}/${AGENT_LIMITS.MAX_CONCURRENT_POSITIONS}\n${positions.length > 0 ? positions.map((p) => `  - ${p.marketId}: ${p.side} $${p.amount} @ ${p.entryPrice} (PnL: $${p.pnl.toFixed(2)})`).join("\n") : ""}\n\n## Available Sports Markets\n${marketLines}\n\n## Decision Required\nBased on the analysis, make a trade decision. Edge > 5% and confidence > ${(AGENT_LIMITS.MIN_CONFIDENCE * 100).toFixed(0)}% to trade.\nConsider time-to-resolution. Quarter-Kelly for sizing.`;
}

function computeSportsTemporalAdjustment(markets: MarketContext[]): Record<string, number> {
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
    for (const [, signal] of Object.entries(signals.gdelt ?? {})) {
      if (Math.abs(signal.avgTone) > 1) {
        const strength = Math.min(Math.abs(signal.avgTone) / 10, 1);
        const mag = 0.2 * strength;
        evidence.push({ likelihoodYes: 0.5 + (signal.avgTone > 0 ? mag : -mag), likelihoodNo: 0.5 - (signal.avgTone > 0 ? mag : -mag) });
      }
    }
    for (const [, signal] of Object.entries(signals.acled ?? {})) {
      if (Math.abs(signal.delta7d) > 20) {
        const strength = Math.min(Math.abs(signal.delta7d) / 100, 1);
        const mag = 0.15 * strength;
        evidence.push({ likelihoodYes: 0.5 + mag, likelihoodNo: 0.5 - mag });
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
  return Math.max(0, Math.min(1, 0.5 + avgTone / 20));
}

function conflictToProbability(acled: Record<string, any>): number {
  const deltas = Object.values(acled).map((s: any) => s.delta7d ?? 0);
  if (deltas.length === 0) return 0.5;
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return Math.max(0, Math.min(1, 0.5 + avgDelta / 200));
}

function getMarketPrice(markets: MarketContext[], marketId: string | undefined, side: "yes" | "no"): number {
  if (!marketId) return 0.5;
  const market = markets.find((m) => m.marketId === marketId);
  if (!market) return 0.5;
  return market.outcomes.find((o) => o.name.toLowerCase() === side)?.price ?? 0.5;
}
