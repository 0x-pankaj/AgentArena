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
  DEFAULT_SPORTS_AGENT_MODELS,
  resolveAgentModels,
  type ModelConfig,
} from "../ai/models";
import { SPORTS_AGENT_TOOLS } from "../ai/tools";
import { quickDecision, quickAnalysis } from "../ai/pipeline";
import { checkThresholds } from "./strategy-engine";
import type { GeoSignals } from "./strategy-engine";

const AGENT_NAME = "Sports Agent";
const AGENT_ID = "sports-agent";

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
        name: "research",
        modelKey: "analysis",
        systemPrompt: promptOverrides?.research ?? `You are a sports research analyst specializing in prediction markets. Your job is to identify the most important factors that could determine the outcome of sports prediction markets.

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

SPORTS YOU COVER:
- NFL: Preseason, regular season, playoffs, Super Bowl
- NBA: Regular season, playoffs, Finals
- Soccer: Premier League, Champions League, World Cup qualifiers
- MMA/UFC: Fight cards, title bouts
- Tennis: Grand Slams, ATP/WTA events
- MLB: Regular season, World Series
- Major events: Olympics, World Cup, Euro

Use web_search for game previews, injury reports, and betting analysis. Use Twitter for breaking sports news and insider information.
Be thorough, specific, and cite sources. Focus on DATA and STATS, not gut feelings.`,
        toolNames: [
          "web_search",
          "twitter_search", "twitter_social_signal",
        ],
        maxTokens: 4000,
      },
      {
        name: "analysis",
        modelKey: "analysis",
        systemPrompt: promptOverrides?.analysis ?? `You are a senior sports prediction market analyst performing deep Bayesian analysis.

Your job: synthesize all research signals into a probability estimate for each sports market.

METHODOLOGY:
1. Start with the market's implied probability (current price) as your baseline prior
2. For each piece of evidence, estimate how likely it would be if YES vs NO
3. Apply Bayesian updating to refine your probability estimate
4. Weigh signals by reliability: official injury reports > betting lines > social media rumors
5. Account for time-to-resolution (closer games are more predictable)
6. Consider market liquidity (thin sports markets can be mispriced)
7. Factor in base rates (home teams win ~60% in most sports)

SIGNAL SOURCES:
- Recent form: Win/loss record in last 5-10 games, point differentials
- Injuries: Key player availability, impact on team performance
- Head-to-head: Historical matchup records, style advantages
- Venue: Home/away splits, altitude, crowd factor
- Betting lines: Opening vs current lines, sharp vs public money
- Social: Breaking news, insider reports, team chemistry rumors

OUTPUT: For each market analyzed, provide your independent probability estimate.
Explain your reasoning step by step. Be specific about which signals changed your estimate from the market price.`,
        toolNames: [
          "web_search",
          "twitter_search",
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

Use market_search and market_detail tools to verify markets before deciding.`,
        toolNames: ["market_search", "market_trending", "market_detail"],
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

  const saveState = async () => {
    await redis.set(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:fsm`, JSON.stringify(fsm.toJSON()));
  };

  if (fsm.isPaused()) {
    return { state: fsm.getState(), action: "skipped", detail: `Paused: ${fsm.getContext().pauseReason}` };
  }

  if (fsm.getState() === "IDLE") {
    try { fsm.transition("user_hires"); await saveState(); } catch {}
  }

  if (fsm.getState() === "SCANNING") {
    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} scanning sports prediction markets (NFL, NBA, Soccer, MMA, Tennis)...`, { pipeline_stage: "scanning" });

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
    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} fetching signals for sports analysis...`, { pipeline_stage: "signal_fetch" });

    const signals = await getSharedSignals("sports");

    const marketsRaw = await redis.get(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:markets`);
    const markets: MarketContext[] = marketsRaw ? JSON.parse(marketsRaw) : [];

    const { positions: dbPositions } = await getActivePositions(ctx.jobId);
    const positions: AgentPosition[] = dbPositions.map((p) => ({
      marketId: p.marketId, side: p.side, amount: Number(p.amount),
      entryPrice: Number(p.entryPrice), currentPrice: Number(p.currentPrice ?? p.entryPrice),
      pnl: Number(p.pnl ?? 0),
    }));

    const lastAnalysisRaw = await redis.get(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:last_analysis`);
    const lastAnalysisTime = lastAnalysisRaw ? Number(lastAnalysisRaw) : null;
    const thresholdCheck = checkThresholds(signals, lastAnalysisTime, markets, positions, "sports");

    if (!thresholdCheck.triggered) {
      fsm.transition("no_edge");
      await saveState();
      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME}: No signal thresholds triggered — skipping deep analysis`, { pipeline_stage: "threshold_check" });
      return { state: fsm.getState(), action: "analyzed", detail: "No thresholds triggered, skipping LLM" };
    }

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME}: ${thresholdCheck.reasons.length} triggers detected — starting deep analysis`, { pipeline_stage: "thresholds_triggered" }, "significant");

    const portfolio = await buildPortfolioSnapshot(ctx.agentWalletAddress, positions, ctx.jobId);

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} stage 1/3: Researching sports factors across ${markets.length} markets...`, { pipeline_stage: "research_start" });

    const researchPrompt = buildResearchContext(signals, markets, positions, portfolio.totalBalance, thresholdCheck.reasons);

    const research = await quickAnalysis({
      modelConfig: config.models.analysis,
      systemPrompt: config.pipeline[0].systemPrompt,
      userMessage: researchPrompt,
      tools: config.pipeline[0].toolNames,
    });

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} stage 1/3: Research complete — ${research.tokensUsed} tokens used, ${research.toolCalls} tool calls`, { pipeline_stage: "research_complete", reasoning_snippet: research.text.slice(0, 300) });

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} stage 2/3: Running Bayesian analysis and signal aggregation...`, { pipeline_stage: "analysis_start" });

    const analysisPrompt = buildAnalysisContext(research.text, signals, markets, positions, portfolio.totalBalance);

    const analysis = await quickAnalysis({
      modelConfig: config.models.analysis,
      systemPrompt: config.pipeline[1].systemPrompt,
      userMessage: analysisPrompt,
      tools: config.pipeline[1].toolNames,
    });

    const bayesianResults = runBayesianEstimation(markets.slice(0, 5), signals, analysis.text);

    const aggregatedSignal = aggregateSignals([
      { name: "llm_analysis", value: extractProbabilityFromText(analysis.text), confidence: 0.7, weight: 3.0 },
      { name: "gdelt_sentiment", value: gdeltToProbability(signals.gdelt), confidence: 0.4, weight: 0.5 },
      { name: "conflict_signal", value: conflictToProbability(signals.acled), confidence: 0.3, weight: 0.3 },
      ...bayesianResults.map((b) => ({ name: `bayesian_${b.marketId}`, value: b.probability, confidence: 0.6, weight: 1.5 })),
    ]);

    await publishFeedStep(ctx.agentId, "signal_update", `${AGENT_NAME} stage 2/3: Aggregated ${aggregatedSignal.nSignals} signals → probability: ${(aggregatedSignal.probability * 100).toFixed(1)}%, confidence: ${(aggregatedSignal.confidence * 100).toFixed(1)}%`, { pipeline_stage: "analysis_complete", confidence: aggregatedSignal.confidence, signals_count: aggregatedSignal.nSignals, reasoning_snippet: analysis.text.slice(0, 300) });

    await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} stage 3/3: Making trade decision with edge detection...`, { pipeline_stage: "decision_start" });

    let decision: TradeDecision;
    let decisionTokens = 0;
    try {
      const result = await quickDecision<TradeDecision>({
        modelConfig: config.models.decision,
        systemPrompt: config.pipeline[2].systemPrompt,
        userMessage: buildDecisionContext(analysis.text, aggregatedSignal, markets, positions, portfolio.totalBalance),
        schema: TradeDecisionSchema,
        tools: config.pipeline[2].toolNames,
      });
      decision = result.decision;
      decisionTokens = result.tokensUsed;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      fsm.transition("no_edge");
      await saveState();
      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} decision stage failed: ${errorMsg}`, { pipeline_stage: "decision_error" }, "critical");
      return { state: fsm.getState(), action: "analyzed", detail: `Decision stage error: ${errorMsg}`, tokensUsed: research.tokensUsed + analysis.tokensUsed };
    }

    const totalTokens = research.tokensUsed + analysis.tokensUsed + decisionTokens;

    // Validate LLM decision against known markets
    const validation = validateDecision(decision, markets);
    if (!validation.valid) {
      fsm.transition("no_edge");
      await saveState();
      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME}: Decision rejected — ${validation.error}`, { pipeline_stage: "validation_failed" }, "critical");
      return { state: fsm.getState(), action: "analyzed", detail: `Decision rejected: ${validation.error}`, decision, tokensUsed: totalTokens };
    }

    await redis.set(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:last_analysis`, String(Date.now()));

    if (decision.action === "hold" || decision.confidence < config.minConfidence) {
      fsm.transition("no_edge");
      await saveState();
      await publishReasoningEvent(ctx.agentId, ctx.jobId, decision, AGENT_NAME);
      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME}: No trade — confidence ${(decision.confidence * 100).toFixed(0)}% below ${(config.minConfidence * 100).toFixed(0)}% threshold`, { pipeline_stage: "hold", confidence: decision.confidence });
      return { state: fsm.getState(), action: "analyzed", detail: `Decision: hold (confidence: ${(decision.confidence * 100).toFixed(0)}%)`, decision, tokensUsed: totalTokens };
    }

    const marketPrice = decision.isYes ? getMarketPrice(markets, decision.marketId, "yes") : getMarketPrice(markets, decision.marketId, "no");
    const edge = calculateEdge(aggregatedSignal.probability, marketPrice, aggregatedSignal.confidence);

    await publishFeedStep(ctx.agentId, "edge_detected", `${AGENT_NAME} found edge: ${edge.direction.toUpperCase()} on "${decision.marketQuestion}" — raw edge: ${(edge.rawEdge * 100).toFixed(1)}%, net: ${(edge.netEdge * 100).toFixed(1)}%`, { pipeline_stage: "edge_found", edge_percent: edge.netEdge * 100, confidence: decision.confidence, market_analyzed: decision.marketQuestion }, "significant");

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
      await publishFeedStep(ctx.agentId, "thinking", `${AGENT_NAME} executing: BUY ${decision.isYes ? "YES" : "NO"} $${decision.amount ?? 0} on "${decision.marketQuestion}"`, { pipeline_stage: "executing", action: "buy", market_analyzed: decision.marketQuestion, amount: String(decision.amount ?? 0) });

      const result = await executeBuy(decision, ctx.agentId, ctx.jobId, ctx.agentWalletId, ctx.ownerPubkey, portfolio, AGENT_NAME, "sports");
      if (result.success) {
        if (result.positionId) {
          await recordPromptLinks(result.positionId, "sports").catch((err) =>
            console.error(`[Sports Agent] Failed to record prompt links: ${err.message}`)
          );
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
    const { closedCount } = await monitorPositions(ctx.agentId, ctx.jobId, ctx.agentWalletId, AGENT_NAME);
    if (closedCount > 0) {
      fsm.transition("position_closed");
      await saveState();
      return { state: fsm.getState(), action: "monitored", detail: `Closed ${closedCount} (stop-loss)` };
    }
    const { positions } = await getActivePositions(ctx.jobId);
    if (positions.length === 0) {
      fsm.transition("position_closed");
      await saveState();
      return { state: fsm.getState(), action: "monitored", detail: "All positions closed" };
    }
    return { state: fsm.getState(), action: "monitored", detail: `${positions.length} open positions` };
  }

  if (fsm.getState() === "CLOSING" || fsm.getState() === "SETTLING") {
    try { fsm.transition("cycle_complete"); await saveState(); } catch { fsm.reset(); await saveState(); }
    return { state: fsm.getState(), action: "skipped", detail: "Cycle complete" };
  }

  return { state: fsm.getState(), action: "skipped", detail: `Unhandled: ${fsm.getState()}` };
}

function buildResearchContext(
  signals: GeoSignals,
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

  parts.push("\n## Available Sports Markets:");
  for (const m of markets.slice(0, 10)) {
    const prices = m.outcomes.map((o) => `${o.name}: $${o.price}`).join(", ");
    parts.push(`- [${m.marketId}] "${m.question}" | ${prices} | Vol=$${m.volume} | Closes: ${m.closesAt ?? "N/A"}`);
  }

  parts.push(`\n## Research Task:\nFor each sports market above, identify the top 5 factors.\nUse web_search and Twitter tools to gather real-time information on injuries, form, matchups, and betting lines.\nFocus on DATA and STATS — recent form, head-to-head records, injury impact.`);

  return parts.join("\n");
}

function buildAnalysisContext(
  research: string,
  signals: GeoSignals,
  markets: MarketContext[],
  positions: AgentPosition[],
  balance: number
): string {
  const parts: string[] = [];
  parts.push(`## Research Findings\n${research}\n\n## Deep Analysis Task:\nBased on the research, provide your independent probability estimate for each sports market.\n\nFor each market:\n1. Start with the market's implied probability (current price)\n2. Consider each factor identified in research\n3. Estimate P(evidence | Yes) and P(evidence | No) for key signals\n4. Apply Bayesian reasoning to update from the market price\n5. Factor in sports base rates (home teams win ~60%, favorites win ~65%)\n6. Provide your final probability estimate with step-by-step reasoning`);

  parts.push("\n## Market Prices (implied probabilities):");
  for (const m of markets.slice(0, 5)) {
    const yesPrice = m.outcomes.find((o) => o.name.toLowerCase() === "yes")?.price ?? 0.5;
    parts.push(`- "${m.question}": Yes=$${yesPrice} (implies ${(yesPrice * 100).toFixed(1)}% probability)`);
  }

  return parts.join("\n");
}

function buildDecisionContext(
  analysis: string,
  aggregated: { probability: number; confidence: number; nSignals: number },
  markets: MarketContext[],
  positions: AgentPosition[],
  balance: number
): string {
  return `## Analysis Results\n${analysis}\n\n## Signal Aggregation\n- Aggregated probability: ${(aggregated.probability * 100).toFixed(1)}%\n- Overall confidence: ${(aggregated.confidence * 100).toFixed(1)}%\n- Signals combined: ${aggregated.nSignals}\n\n## Portfolio\n- Balance: $${balance.toFixed(2)} USDC\n- Open positions: ${positions.length}/${AGENT_LIMITS.MAX_CONCURRENT_POSITIONS}\n${positions.length > 0 ? positions.map((p) => `  - ${p.marketId}: ${p.side} $${p.amount} @ ${p.entryPrice} (PnL: $${p.pnl.toFixed(2)})`).join("\n") : ""}\n\n## Available Sports Markets\n${markets.slice(0, 5).map((m) => { const prices = m.outcomes.map((o) => `${o.name}: $${o.price}`).join(", "); return `- [${m.marketId}] "${m.question}" | ${prices} | Vol=$${m.volume}`; }).join("\n")}\n\n## Decision Required\nBased on the analysis and aggregated signals, make a trade decision on the best sports market.\nIf edge > 5% and confidence > ${(AGENT_LIMITS.MIN_CONFIDENCE * 100).toFixed(0)}%, recommend a trade.\nOtherwise, recommend hold. Remember: quarter-Kelly for position sizing.`;
}

function runBayesianEstimation(
  markets: MarketContext[],
  signals: GeoSignals,
  analysis: string
): Array<{ marketId: string; probability: number }> {
  return markets.map((m) => {
    const prior = m.outcomes.find((o) => o.name.toLowerCase() === "yes")?.price ?? 0.5;
    const evidence: Array<{ likelihoodYes: number; likelihoodNo: number }> = [];

    for (const [, signal] of Object.entries(signals.gdelt)) {
      if (Math.abs(signal.avgTone) > 2) {
        evidence.push(signal.avgTone > 0 ? { likelihoodYes: 0.6, likelihoodNo: 0.4 } : { likelihoodYes: 0.4, likelihoodNo: 0.6 });
      }
    }

    if (evidence.length === 0) return { marketId: m.marketId, probability: prior };
    const posterior = bayesianUpdate(prior, evidence.slice(0, 5));
    return { marketId: m.marketId, probability: posterior };
  });
}

function extractProbabilityFromText(text: string): number {
  const patterns = [/(\d{1,3})%/g, /probability[:\s]*(\d+\.?\d*)/gi, /estimate[:\s]*(\d+\.?\d*)/gi];
  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      const values = matches.map((m) => parseFloat(m[1]));
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      if (avg > 1) return Math.min(avg / 100, 1);
      return Math.min(avg, 1);
    }
  }
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
