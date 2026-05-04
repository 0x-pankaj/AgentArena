import { jupiterPredict, type JupiterMarket, composeMarketQuestion } from "../plugins/polymarket-plugin";
import { signSolanaTransaction } from "../utils/privy";
import { getEffectiveBalance } from "../utils/balance";
import {
  executeBuyOrder,
  closePosition,
} from "../services/trade-service";
import { getMarket, getTrendingMarkets } from "../services/market-service";
import { getMarketsForAgent } from "../services/market-event-bus";
import { publishFeedEvent, buildFeedEvent } from "../feed";
import { setPendingReasoningEvent, getPendingReasoningEvent, clearPendingReasoningEvent, resolveBetsForEvent } from "../routers/paper-bets";
import { monitorJobPositions } from "../services/position-monitor";
import { getPaperBalance, getPaperPortfolio } from "../services/paper-trading";
import type { LLMDecision, MarketContext, AgentPosition } from "./strategy-engine";
import type { PortfolioSnapshot } from "../plugins/risk-plugin";
import { EXECUTE_TRADES, IS_SIMULATED, TEST_WALLET_BALANCE_USDC, TEST_WALLET_BALANCE_SOL } from "@agent-arena/shared";
import { db, schema } from "../db";
import { eq, and, gte, sql } from "drizzle-orm";
import type { TradeDecision } from "../ai/types";
import { rankMarkets, type RankedMarket } from "../services/market-ranking";
import { orchestrateMarketResearch, type ResearchPhaseResult } from "../services/market-research";
import { analyzeMarketsBatch, type PerMarketAnalysisResult } from "../services/per-market-analysis";
import { runImprovedBayesianSynthesis, selectBestMarket, type BayesianResult, type MarketSelection } from "../services/improved-bayesian";
import type { SharedSignals } from "../services/signal-cache";
import type { PerMarketResearchData } from "../services/market-research";
import type { PerMarketAnalysis } from "../services/per-market-analysis";

const AGENT_LIMITS = {
  MIN_MARKET_VOLUME: 10000,
  MAX_MARKET_DAYS_TO_RESOLUTION: 7,
};

// Defensive backstop: Jupiter sometimes mis-tags markets (memecoins ending up
// in "sports", non-Latin tokens leaking everywhere). Drop questions whose text
// has zero domain keywords for the agent's category before we waste an LLM
// call analyzing them. Generous on purpose — false negatives only cost reach.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  sports: [
    "wins","beats","defeats","loses","vs ","v.","championship","playoffs","title",
    "match","game","season","league","tournament","cup","final","semifinal",
    "nfl","nba","mlb","nhl","ufc","mma","ncaa","fifa","mls","nascar","atp","wta",
    "soccer","football","basketball","baseball","hockey","tennis","cricket","golf",
    "boxing","racing","olympics","grand prix","grand slam","super bowl","world cup",
    "premier league","champions league","la liga","bundesliga","serie a","ipl",
    "lakers","warriors","celtics","heat","nuggets","yankees","dodgers","cowboys",
    "patriots","chiefs","49ers","manchester","liverpool","barcelona","madrid",
    "messi","ronaldo","lebron","mahomes","brady","djokovic","alcaraz","rory","tiger",
  ],
  crypto: [
    "bitcoin","btc","ethereum","eth","sol","solana","xrp","ripple","doge","dogecoin",
    "shiba","ada","cardano","matic","polygon","avax","avalanche","dot","polkadot",
    "link","chainlink","memecoin","altcoin","crypto","blockchain","token","stablecoin",
    "usdc","usdt","tether","binance","coinbase","kraken","etf","halving","ath",
    "all-time high","reach $","hit $","cross $","break $","1k","10k","100k","1000k",
  ],
  politics: [
    "election","president","candidate","senator","senate","house","congress","governor",
    "mayor","primary","caucus","poll","polls","vote","voting","ballot",
    "democrat","republican","trump","biden","harris","desantis","obama",
    "putin","zelensky","modi","xi jinping","macron","merz","starmer",
    "supreme court","scotus","cabinet","policy","bill","law","tariff","sanction",
    "war","peace","treaty","nato","united nations","ukraine","russia","china",
    "israel","gaza","iran","north korea","saudi","fed","federal reserve","interest rate",
  ],
};

export function isLikelyCategoryMatch(category: string, question: string): boolean {
  if (!question) return false;
  if (category === "general") return true;
  // Reject markets whose first character is CJK / Hangul / Hiragana — these
  // are almost always memecoin / regional asset markets that leak into other
  // categories via Jupiter's loose tagging.
  if (/^[぀-ヿ㐀-䶿一-鿿가-힯]/.test(question)) {
    return false;
  }
  const tokens = CATEGORY_KEYWORDS[category];
  if (!tokens) return true; // unknown category — don't filter
  const q = question.toLowerCase();
  return tokens.some((t) => q.includes(t));
}

// Classify trade-execution failures so agents can quiet routine cap/cooldown
// rejections instead of broadcasting them as critical-severity events.
const SOFT_REJECT_PATTERNS = /exposure would exceed|cooldown active|concurrent positions|below minimum|daily loss limit|already have an open|requires human approval|insufficient orderbook depth|insufficient paper balance|microstructure rejected|correlation rejected|market resolves in|market has closed|confidence \d+% below/i;

export function isSoftRejection(error: string | undefined): boolean {
  if (!error) return false;
  return SOFT_REJECT_PATTERNS.test(error);
}

// --- Cached SOL price ---
let cachedSOLPrice = 150; // default fallback
let solPriceLastFetched = 0;
const SOL_PRICE_TTL_MS = 60_000;

function getSOLPrice(): number {
  return cachedSOLPrice;
}

export async function refreshSOLPrice(): Promise<void> {
  if (Date.now() - solPriceLastFetched < SOL_PRICE_TTL_MS) return;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    if (res.ok) {
      const data = await res.json() as { solana?: { usd?: number } };
      if (data.solana?.usd) {
        cachedSOLPrice = data.solana.usd;
        solPriceLastFetched = Date.now();
      }
    }
  } catch {
    // keep cached/default price
  }
}

// --- Validate LLM decision against known markets ---

export function validateDecision(
  decision: TradeDecision,
  markets: MarketContext[]
): { valid: boolean; error?: string } {
  if (decision.action === "hold") return { valid: true };

  if (!decision.marketId) {
    return { valid: false, error: "Decision has no marketId" };
  }

  const market = markets.find((m) => m.marketId === decision.marketId);
  if (!market) {
    return {
      valid: false,
      error: `LLM hallucinated marketId "${decision.marketId}" — not in scanned markets`,
    };
  }

  if (decision.amount && decision.amount <= 0) {
    return { valid: false, error: "Invalid trade amount" };
  }

  return { valid: true };
}

// --- Legacy scan markets (kept for backward compat) ---

export async function scanMarkets(
  category: string = "general",
  minVolume: number = AGENT_LIMITS.MIN_MARKET_VOLUME
): Promise<MarketContext[]> {
  try {
    const categoryMap: Record<string, string[]> = {
      politics: ["politics", "economics"],
      sports: ["sports"],
      crypto: ["crypto"],
      general: ["politics", "crypto", "sports", "economics"],
    };
    const categories = categoryMap[category] ?? ["crypto", "politics", "sports", "economics"];
    const allMarkets: MarketContext[] = [];

    const results = await Promise.allSettled(
      categories.map((cat) =>
        getTrendingMarkets({ category: cat, limit: 20 })
      )
    );

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { markets } = result.value;

      for (const m of markets) {
        const volume = Number(m.volume ?? 0);
        if (volume < minVolume) continue;

        const daysUntilClose = m.closesAt
          ? (new Date(m.closesAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          : Infinity;
        if (daysUntilClose > AGENT_LIMITS.MAX_MARKET_DAYS_TO_RESOLUTION) continue;
        if (daysUntilClose < 0) continue; // skip markets that already closed

        const outcomes = Array.isArray(m.outcomes)
          ? (m.outcomes as Array<{ name: string; price?: number }>)
              .map((o) => ({ name: o.name, price: o.price ?? 0 }))
          : [];

        if (!isLikelyCategoryMatch(category, m.question)) continue;

        allMarkets.push({
          marketId: m.marketId,
          question: m.question,
          outcomes,
          volume,
          liquidity: Number(m.liquidity ?? 0),
          closesAt: m.closesAt ? new Date(m.closesAt).toISOString() : null,
        });
      }
    }

    return allMarkets;
  } catch (err) {
    console.error("Market scan failed:", err);
    return [];
  }
}

// ============================================================
// NEW: Full pipeline scan + rank + research
// Uses MarketEventBus for deduped Jupiter calls,
// then ranks markets, then pre-researches top candidates.
// ============================================================

export interface ScannedAndResearchedResult {
  markets: MarketContext[];
  ranked: { deep: RankedMarket[]; brief: RankedMarket[] };
  research: ResearchPhaseResult;
  bayesianResults: BayesianResult[];
  bestMarkets: MarketSelection[];
  analysisResults: PerMarketAnalysisResult[];
  totalDurationMs: number;
}

// Variant that skips LLM analysis — only fetch + rank + research.
// Used by the enhanced pipeline which does its own batch analysis.
export interface ScannedAndRankedResult {
  markets: MarketContext[];
  ranked: { deep: RankedMarket[]; brief: RankedMarket[] };
  research: ResearchPhaseResult;
  totalDurationMs: number;
}

export async function scanMarketsWithResearch(
  category: string,
  agentId: string,
  agentName: string,
  modelConfig: import("../ai/types").ModelConfig,
  signals: SharedSignals,
  positions: AgentPosition[],
  balance: number,
  signalAgeMinutes: number = 0,
  calibratedWeights: Record<string, number> = {}
): Promise<ScannedAndResearchedResult> {
  const totalStart = Date.now();

  // Step 1: Fetch markets via MarketEventBus (deduped + cached)
  console.log(`[ScanWithResearch] ${agentName}: Fetching markets for ${category}...`);
  let markets: MarketContext[];

  try {
    const eventsByCategory = await getMarketsForAgent(category);
    const allMarkets: MarketContext[] = [];

    for (const [, events] of Object.entries(eventsByCategory)) {
      for (const event of events) {
        if (!event.markets) continue;
        for (const market of event.markets) {
          const volume = Number((market.pricing as any)?.volume ?? 0) || Number((market as any).volume ?? 0);
          const minVol = category === "sports" ? 5000 : AGENT_LIMITS.MIN_MARKET_VOLUME;
          if (volume < minVol) continue;

          const daysUntilClose = market.closeTime
            ? (new Date(typeof market.closeTime === "number" ? market.closeTime * 1000 : market.closeTime).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            : Infinity;
          if (daysUntilClose > AGENT_LIMITS.MAX_MARKET_DAYS_TO_RESOLUTION) continue;
          if (daysUntilClose < 0) continue; // skip markets that already closed

          // Drop markets with no readable question. Jupiter returns title +
          // rulesPrimary at the top level of each market, plus a templated
          // event.metadata.title (e.g. "Bitcoin above ___ on May 5?") that
          // composeMarketQuestion fills in with the market title (e.g.
          // "78,000" → "Bitcoin above 78,000 on May 5?"). If even that
          // can't produce a usable string, skip the market — better to
          // lose a candidate than persist a bare ID onto a position row.
          const question = composeMarketQuestion(market, event);
          if (!question) continue;
          const closesAt = market.closeTime
            ? new Date(typeof market.closeTime === "number" ? market.closeTime * 1000 : market.closeTime).toISOString()
            : null;

          const pricingObj = market.pricing as any;
          const buyYesPrice = pricingObj?.buyYesPriceUsd ? Number(pricingObj.buyYesPriceUsd) / 1e6 : null;
          const buyNoPrice = pricingObj?.buyNoPriceUsd ? Number(pricingObj.buyNoPriceUsd) / 1e6 : null;
          const outcomes: Array<{ name: string; price: number }> = [];
          if (buyYesPrice !== null) outcomes.push({ name: "Yes", price: buyYesPrice });
          if (buyNoPrice !== null) outcomes.push({ name: "No", price: buyNoPrice });

          if (!isLikelyCategoryMatch(category, question)) continue;

          allMarkets.push({
            marketId: market.marketId,
            question,
            outcomes,
            volume,
            liquidity: Number((market as any).liquidity ?? pricingObj?.liquidity ?? 0),
            closesAt,
          });
        }
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    markets = allMarkets.filter((m) => {
      if (seen.has(m.marketId)) return false;
      seen.add(m.marketId);
      return true;
    });

    console.log(`[ScanWithResearch] ${agentName}: Found ${markets.length} markets via MarketEventBus`);
  } catch (err) {
    console.warn(`[ScanWithResearch] ${agentName}: MarketEventBus fetch failed, falling back to scanMarkets:`, err);
    markets = await scanMarkets(category);
  }

  if (markets.length === 0) {
    console.warn(`[ScanWithResearch] ${agentName}: No qualifying markets found`);
    return {
      markets: [],
      ranked: { deep: [], brief: [] },
      research: {
        deep: [],
        brief: [],
        researchData: new Map(),
        totalSearches: 0,
        cacheHits: 0,
        durationMs: 0,
      },
      bayesianResults: [],
      bestMarkets: [],
      analysisResults: [],
      totalDurationMs: Date.now() - totalStart,
    };
  }

  // Step 2: Rank markets (deterministic, no LLM)
  const ranked = rankMarkets(markets, 7, 10);
  console.log(`[ScanWithResearch] ${agentName}: Ranked ${markets.length} markets — ${ranked.deep.length} deep, ${ranked.brief.length} brief`);
  console.log(`[ScanWithResearch] ${agentName}: Deep markets: ${ranked.deep.map((m) => `"${m.question.slice(0, 40)}" (score=${m.score.toFixed(3)}${m.isNewMarket ? " NEW" : ""})`).join(", ")}`);

  // Step 3: Pre-research (deterministic, cached)
  const research = await orchestrateMarketResearch(markets, category, agentId);

  // Step 4: Per-market deep analysis (LLM calls, parallel, batched)
  const analysisResults = await analyzeMarketsBatch(
    ranked.deep,
    research.researchData,
    signals,
    positions,
    balance,
    modelConfig,
    agentId,
    agentName,
    category
  );

  // Step 5: Bayesian synthesis
  const analysesMap = new Map<string, PerMarketAnalysis>();
  for (const result of analysisResults) {
    analysesMap.set(result.marketId, result.analysis);
  }

  const bayesianResults = runImprovedBayesianSynthesis(
    ranked.deep,
    analysesMap,
    signals,
    research.researchData,
    calibratedWeights,
    signalAgeMinutes,
    category
  );

  // Step 6: Select best markets
  const bestMarkets = selectBestMarket(
    bayesianResults,
    analysesMap,
    positions,
    balance
  );

  const totalDurationMs = Date.now() - totalStart;
  console.log(
    `[ScanWithResearch] ${agentName}: Complete in ${totalDurationMs}ms — ${markets.length} markets, ${analysisResults.length} analyzed, ${bestMarkets.length} candidates with edge`
  );

  return {
    markets,
    ranked,
    research,
    bayesianResults,
    bestMarkets,
    analysisResults,
    totalDurationMs,
  };
}

// ============================================================
// Lightweight variant: fetch + rank + research only (no LLM).
// The enhanced pipeline calls this and then does its own batch
// analysis + Bayesian synthesis + decision.
// ============================================================

export async function scanAndRankMarkets(
  category: string,
  agentId: string,
  agentName: string
): Promise<ScannedAndRankedResult> {
  const totalStart = Date.now();

  console.log(`[ScanAndRank] ${agentName}: Fetching markets for ${category}...`);
  let markets: MarketContext[];

  try {
    const eventsByCategory = await getMarketsForAgent(category);
    const allMarkets: MarketContext[] = [];

    for (const [, events] of Object.entries(eventsByCategory)) {
      for (const event of events) {
        if (!event.markets) continue;
        for (const market of event.markets) {
          const volume = Number((market.pricing as any)?.volume ?? 0) || Number((market as any).volume ?? 0);
          const minVol = category === "sports" ? 5000 : AGENT_LIMITS.MIN_MARKET_VOLUME;
          if (volume < minVol) continue;

          const daysUntilClose = market.closeTime
            ? (new Date(typeof market.closeTime === "number" ? market.closeTime * 1000 : market.closeTime).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            : Infinity;
          if (daysUntilClose > AGENT_LIMITS.MAX_MARKET_DAYS_TO_RESOLUTION) continue;
          if (daysUntilClose < 0) continue; // skip markets that already closed

          // Same composeMarketQuestion path as scanMarkets above. Drop the
          // market entirely when no readable question can be assembled.
          const question = composeMarketQuestion(market, event);
          if (!question) continue;
          const closesAt = market.closeTime
            ? new Date(typeof market.closeTime === "number" ? market.closeTime * 1000 : market.closeTime).toISOString()
            : null;

          const pricingObj = market.pricing as any;
          const buyYesPrice = pricingObj?.buyYesPriceUsd ? Number(pricingObj.buyYesPriceUsd) / 1e6 : null;
          const buyNoPrice = pricingObj?.buyNoPriceUsd ? Number(pricingObj.buyNoPriceUsd) / 1e6 : null;
          const outcomes: Array<{ name: string; price: number }> = [];
          if (buyYesPrice !== null) outcomes.push({ name: "Yes", price: buyYesPrice });
          if (buyNoPrice !== null) outcomes.push({ name: "No", price: buyNoPrice });

          allMarkets.push({
            marketId: market.marketId,
            question,
            outcomes,
            volume,
            liquidity: Number((market as any).liquidity ?? pricingObj?.liquidity ?? 0),
            closesAt,
          });
        }
      }
    }

    const seen = new Set<string>();
    markets = allMarkets.filter((m) => {
      if (seen.has(m.marketId)) return false;
      seen.add(m.marketId);
      return true;
    });

    console.log(`[ScanAndRank] ${agentName}: Found ${markets.length} markets via MarketEventBus`);
  } catch (err) {
    console.warn(`[ScanAndRank] ${agentName}: MarketEventBus fetch failed, falling back to scanMarkets:`, err);
    markets = await scanMarkets(category);
  }

  if (markets.length === 0) {
    return {
      markets: [],
      ranked: { deep: [], brief: [] },
      research: { deep: [], brief: [], researchData: new Map(), totalSearches: 0, cacheHits: 0, durationMs: 0 },
      totalDurationMs: Date.now() - totalStart,
    };
  }

  const ranked = rankMarkets(markets, 7, 10);
  console.log(`[ScanAndRank] ${agentName}: Ranked ${markets.length} markets — ${ranked.deep.length} deep, ${ranked.brief.length} brief`);

  const research = await orchestrateMarketResearch(markets, category, agentId);

  const totalDurationMs = Date.now() - totalStart;
  console.log(
    `[ScanAndRank] ${agentName}: Complete in ${totalDurationMs}ms — ${markets.length} markets ranked, ${research.totalSearches} search results`
  );

  return {
    markets,
    ranked,
    research,
    totalDurationMs,
  };
}

// --- Execute a buy order based on LLM decision ---

export async function executeBuy(
  decision: LLMDecision,
  agentId: string,
  jobId: string,
  agentWalletId: string,
  ownerPubkey: string,
  portfolio: PortfolioSnapshot,
  agentName: string = "Agent",
  category: string = "general"
): Promise<{ success: boolean; positionId?: string; error?: string; softReject?: boolean }> {
  if (decision.action !== "buy" || !decision.marketId) {
    return { success: false, error: "Invalid decision for buy execution" };
  }

  // Get market details
  const market = await getMarket(decision.marketId);
  if (!market) {
    return { success: false, error: `Market ${decision.marketId} not found` };
  }

  const amount = decision.amount ?? 0;
  if (amount <= 0) {
    return { success: false, error: "Invalid amount" };
  }

  // Determine trading mode for this job — paper trades flow through regardless of EXECUTE_TRADES.
  const [jobMode] = await db
    .select({ tradingMode: schema.jobs.tradingMode })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1);
  const tradingMode = (jobMode?.tradingMode as "paper" | "live") ?? "paper";

  // Live trading still requires EXECUTE_TRADES; paper traction simulates against real Jupiter pricing.
  if (tradingMode === "live" && !EXECUTE_TRADES) {
    const feedEvent = buildFeedEvent({
      agentId,
      agentName,
      jobId,
      category: "decision",
      severity: "info",
      content: {
        market_analyzed: decision.marketQuestion ?? market.question,
        action: "buy",
        amount: String(amount),
        price: decision.isYes ? "yes" : "no",
        decision: decision.reasoning,
        reasoning_snippet: decision.reasoning.slice(0, 200),
        confidence: decision.confidence,
      },
      displayMessage: `${agentName} decided: BUY ${decision.isYes ? "YES" : "NO"}, $${amount} USDC on "${decision.marketQuestion ?? market.question}" (live disabled — not executed)`,
    });
    await publishFeedEvent(feedEvent);
    return { success: false, error: "Live trading disabled — set DEPLOY_PHASE=production and EXECUTE_TRADES=true" };
  }

  // Execute via trade service (includes risk checks)
  const outcomes = (market.outcomes ?? []) as Array<{ name: string; price: number }>;
  const entryPrice = decision.isYes
    ? (outcomes.find((o: { name: string; price: number }) => o.name?.toLowerCase() === "yes")?.price ?? 0.5)
    : (outcomes.find((o: { name: string; price: number }) => o.name?.toLowerCase() === "no")?.price ?? 0.5);

  const result = await executeBuyOrder({
    jobId,
    agentId,
    agentWalletId,
    ownerPubkey,
    marketId: decision.marketId,
    marketQuestion: decision.marketQuestion ?? market.question,
    isYes: decision.isYes ?? true,
    amount,
    entryPrice,
    confidence: decision.confidence,
    reasoning: decision.reasoning,
    category,
    marketVolume: Number(market.volume ?? 0),
    marketClosesAt: market.closesAt ? new Date(market.closesAt) : new Date(),
    portfolio,
  });

  if (result.success && result.position) {
    // Use the *filled* amount from the position record, not the LLM's intended
    // amount. Quarter-Kelly + the $5 paper-fill floor mean the actual fill is
    // routinely much smaller than what the LLM asked for; surfacing the
    // pre-sizing number here made the feed disagree with the position screen.
    const filledAmount = Number(result.position.amount);
    const intendedAmount = amount;
    const sizingNote = filledAmount < intendedAmount
      ? ` (Kelly-sized from $${intendedAmount.toFixed(0)})`
      : "";

    const feedEvent = buildFeedEvent({
      agentId,
      agentName,
      jobId,
      category: "trade",
      severity: "significant",
      content: {
        market_analyzed: decision.marketQuestion ?? market.question,
        action: "buy",
        amount: String(filledAmount),
        price: decision.isYes ? "yes" : "no",
        decision: decision.reasoning,
        reasoning_snippet: decision.reasoning.slice(0, 200),
      },
      displayMessage: `${agentName} placed order: BUY ${decision.isYes ? "YES" : "NO"}, $${filledAmount.toFixed(2)} USDC on "${decision.marketQuestion ?? market.question}"${sizingNote}`,
    });
    await publishFeedEvent(feedEvent);

    // Resolve paper bets for this agent+market
    if (decision.marketId) {
      const reasoningEventId = getPendingReasoningEvent(agentId, decision.marketId);
      if (reasoningEventId) {
        try {
          const resolution = await resolveBetsForEvent(reasoningEventId, "buy");
          console.log(`[PaperBets] Resolved ${resolution.winners} winners, ${resolution.losers} losers for event ${reasoningEventId}`);
        } catch (err) {
          console.error("[PaperBets] Failed to resolve bets:", err);
        }
        clearPendingReasoningEvent(agentId, decision.marketId);
      }
    }

    return { success: true, positionId: result.position.id };
  }

  return { success: false, error: result.error, softReject: isSoftRejection(result.error) };
}

// --- Execute a sell (close position) ---

export async function executeSell(
  positionId: string,
  agentId: string,
  jobId: string,
  agentWalletId: string,
  reason: string,
  agentName: string = "Agent"
): Promise<{ success: boolean; error?: string }> {
  const result = await closePosition({
    positionId,
    agentId,
    agentWalletId,
    reason,
  });

  if (result.success && result.trade) {
    const feedEvent = buildFeedEvent({
      agentId,
      agentName,
      jobId,
      category: "position_update",
      severity: result.trade.profitLoss && Number(result.trade.profitLoss) < 0 ? "critical" : "significant",
      content: {
        action: "sell",
        market_analyzed: result.trade.marketQuestion,
        pnl: result.trade.profitLoss
          ? {
              value: Number(result.trade.profitLoss),
              percent:
                Number(result.trade.profitLoss) / Number(result.trade.amount) * 100,
            }
          : undefined,
        reasoning_snippet: reason.slice(0, 200),
      },
      displayMessage: `${agentName} closed position: ${result.trade.marketQuestion} | PnL: $${Number(result.trade.profitLoss ?? 0).toFixed(2)}`,
    });
    await publishFeedEvent(feedEvent);

    return { success: true };
  }

  return { success: false, error: result.error };
}

// --- Monitor positions (check stop-loss, take-profit, expiry, resolution) ---

export async function monitorPositions(
  agentId: string,
  jobId: string,
  agentWalletId: string,
  agentName: string = "Agent"
): Promise<{ closedCount: number; claimedCount: number }> {
  // Get job trading mode
  const [job] = await db
    .select({ tradingMode: schema.jobs.tradingMode })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1);

  const tradingMode = (job?.tradingMode as "paper" | "live") ?? "paper";

  const result = await monitorJobPositions({
    jobId,
    agentId,
    agentWalletId,
    agentName,
    tradingMode,
  });

  if (result.closed > 0 || result.claimed > 0) {
    const feedEvent = buildFeedEvent({
      agentId,
      agentName,
      jobId,
      category: "position_update",
      severity: result.exits.some(e => e.type === "stop_loss") ? "critical" : "significant",
      content: {
        summary: `Monitored ${result.checked} positions: ${result.closed} closed, ${result.claimed} claimed`,
      },
      displayMessage: `${agentName} monitored positions: ${result.closed} closed, ${result.claimed} claimed`,
    });
    await publishFeedEvent(feedEvent);
  }

  return { closedCount: result.closed, claimedCount: result.claimed };
}

// --- Build portfolio snapshot for risk checks ---

export async function buildPortfolioSnapshot(
  agentWalletAddress: string,
  positions: AgentPosition[],
  jobId?: string,
  agentCategory: string = "general"
): Promise<PortfolioSnapshot> {
  await refreshSOLPrice();

  let balance: { sol: number; usdc: number };
  let isPaperMode = false;

  if (jobId) {
    const [job] = await db
      .select({ tradingMode: schema.jobs.tradingMode })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId))
      .limit(1);
    isPaperMode = job?.tradingMode === "paper";
  }

  if (isPaperMode && jobId) {
    // Paper mode: use simulated paper balance
    const paperBalance = await getPaperBalance(jobId);
    balance = { sol: 0, usdc: paperBalance };
    console.log(`[PaperTrading] Using paper balance: $${paperBalance.toFixed(2)} USDC`);
  } else if (IS_SIMULATED) {
    balance = { sol: TEST_WALLET_BALANCE_SOL, usdc: TEST_WALLET_BALANCE_USDC };
    console.log(`[SIMULATED] Using simulated $${TEST_WALLET_BALANCE_USDC} USDC balance`);
  } else {
    balance = await getEffectiveBalance(agentWalletAddress);
  }

  const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);

  // Calculate actual daily PnL from today's settled trades
  let dailyPnl = totalPnl;
  if (jobId) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayTrades = await db
      .select({ profitLoss: schema.trades.profitLoss })
      .from(schema.trades)
      .where(
        and(
          eq(schema.trades.jobId, jobId),
          gte(schema.trades.executedAt, todayStart)
        )
      );

    const realizedDaily = todayTrades.reduce(
      (sum, t) => sum + Number(t.profitLoss ?? 0),
      0
    );
    dailyPnl = realizedDaily + totalPnl;
  }

  return {
    totalBalance: balance.usdc + balance.sol * getSOLPrice(),
    totalPnl,
    dailyPnl,
    positions: positions.map((p) => ({
      marketId: p.marketId,
      // All positions in a job belong to the same agent (1 job ↔ 1 agent),
      // so they share the agent's category. Hardcoding "general" here broke
      // the category-exposure check for sports/crypto/politics agents.
      category: agentCategory,
      amount: p.amount,
      entryPrice: p.entryPrice,
      currentPrice: p.currentPrice,
      status: "open" as const,
    })),
    lastTradeTimestamp: null,
  };
}

// --- Publish analysis event to feed ---

export async function publishAnalysisEvent(
  agentId: string,
  jobId: string,
  summary: string,
  severity: "info" | "significant" | "critical" = "info",
  agentName: string = "Agent"
): Promise<void> {
  const feedEvent = buildFeedEvent({
    agentId,
    agentName,
    jobId,
    category: "analysis",
    severity,
    content: { summary },
    displayMessage: summary,
  });
  await publishFeedEvent(feedEvent);
}

// --- Publish reasoning event to feed ---

export async function publishReasoningEvent(
  agentId: string,
  jobId: string,
  decision: LLMDecision,
  agentName: string = "Agent"
): Promise<void> {
  const feedEvent = buildFeedEvent({
    agentId,
    agentName,
    jobId,
    category: "reasoning",
    severity: decision.confidence > 0.8 ? "significant" : "info",
    content: {
      decision: decision.action,
      reasoning_snippet: decision.reasoning.slice(0, 500),
      market_analyzed: decision.marketQuestion,
      confidence: decision.confidence,
    },
    displayMessage: `${agentName} decided: ${decision.action.toUpperCase()} ${decision.isYes ? "YES" : "NO"} on "${decision.marketQuestion ?? "N/A"}" | Confidence: ${(decision.confidence * 100).toFixed(0)}%`,
  });
  await publishFeedEvent(feedEvent);

  // Cache this reasoning event for paper betting resolution
  if (decision.marketId) {
    setPendingReasoningEvent(agentId, decision.marketId, feedEvent.event_id);
  }
}
