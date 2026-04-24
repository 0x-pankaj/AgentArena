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

import { checkMicrostructure } from "../services/market-microstructure";
import { checkCrossMarketCorrelation } from "../services/correlation-matrix";

import { getAllCalibratedWeights, decayConfidence, getConfidenceAdjustment, recordSignalPrediction } from "../services/calibration-service";
import { recordAgentPrediction as recordOutcomePrediction } from "../services/outcome-feedback";
import { runScenarioAnalysis, quickScenarioGate } from "../services/scenario-analysis";
import { db, schema } from "../db";
import { runEnhancedPipeline } from "./enhanced-pipeline";

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

    // Enhanced pipeline: use MarketEventBus for deduped fetching + market ranking
    await publishFeedStep(ctx.agentId, "scanning", `${AGENT_NAME} fetching markets via MarketEventBus...`, { pipeline_stage: "fetching_markets_enhanced", pipeline_version: "v2" });
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
    const pipelineResult = await runEnhancedPipeline(ctx, fsm, {
      agentId: AGENT_ID,
      agentName: AGENT_NAME,
      category: "crypto",
      models: config.models,
      decisionSystemPrompt: config.pipeline[1].systemPrompt,
    }, saveState);

    if (pipelineResult.decision && pipelineResult.action === "analyzed") {
      // We have a decision with edge found — proceed to execution
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
          decision, AGENT_ID, ctx.jobId, ctx.agentWalletId, ctx.ownerPubkey, portfolio, AGENT_NAME, "crypto"
        );
        if (buyResult.success) {
          fsm.transition("order_placed");
          await saveState();
          return { state: fsm.getState() as any, action: "executed", detail: `Bought on "${decision.marketQuestion}"`, decision, tokensUsed: pipelineResult.tokensUsed };
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
