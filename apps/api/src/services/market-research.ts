// ============================================================
// Market Research Orchestrator
// Coordinates Phase 2 (deterministic pre-research) of the pipeline.
// For each ranked market, fetches web search, Twitter sentiment,
// market detail, and category-specific data — all in parallel
// with Redis caching so multiple agents share results.
// ============================================================

import { redis } from "../utils/redis";
import { getMarket } from "./market-service";
import { analyzeMarketMicrostructure, type MarketMicrostructure } from "./market-microstructure";
import { researchMarkets, type MarketResearch } from "./research-cache";
import { webSearch } from "./web-search";
import { twitterSearchTool, twitterSocialSignalTool } from "../ai/tools";
import {
  rankMarkets,
  extractSearchQuery,
  generateExtraSearchQueries,
  type RankedMarket,
} from "./market-ranking";
import type { MarketContext } from "../ai/types";

// --- Types ---

export interface PerMarketResearchData {
  marketId: string;
  question: string;
  searchResults: Array<{
    title: string;
    url: string;
    snippet: string;
    source: string;
    date?: string;
  }>;
  twitterSentiment: Array<{
    text: string;
    likes: number;
    retweets: number;
    createdAt: string;
  }>;
  microstructure: MarketMicrostructure | null;
  research: MarketResearch;
  rankedMarket: RankedMarket;
}

export interface ResearchPhaseResult {
  deep: RankedMarket[];
  brief: RankedMarket[];
  researchData: Map<string, PerMarketResearchData>;
  totalSearches: number;
  cacheHits: number;
  durationMs: number;
}

// --- Concurrency-limited parallel execution ---

async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<PromiseSettledResult<Awaited<T>>[]> {
  const results: PromiseSettledResult<Awaited<T>>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() } as PromiseSettledResult<Awaited<T>>;
      } catch (err) {
        results[i] = { status: "rejected", reason: err } as PromiseSettledResult<Awaited<T>>;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// --- Category-specific data mapping ---

const CATEGORY_KEYWORD_MAP: Record<string, Record<string, string[]>> = {
  crypto: {
    bitcoin: ["bitcoin", "btc"],
    ethereum: ["ethereum", "eth"],
    solana: ["solana", "sol"],
    defi: ["defi", "tvl", "liquidity"],
    nft: ["nft", "digital collectible"],
    etf: ["etf", "sec", "approval"],
  },
  politics: {
    election: ["election", "vote", "poll", "campaign"],
    congress: ["congress", "senate", "house", "legislation"],
    supreme_court: ["supreme court", "ruling", "decision"],
    geopolitical: ["war", "conflict", "treaty", "sanctions"],
  },
  sports: {
    nfl: ["nfl", "football", "super bowl"],
    nba: ["nba", "basketball", "playoffs"],
    soccer: ["soccer", "premier league", "champions league"],
    mma: ["ufc", "mma", "fight"],
  },
  general: {},
};

function getCategoryKeywords(question: string, category: string): string[] {
  const q = question.toLowerCase();
  const categoryMap = CATEGORY_KEYWORD_MAP[category] ?? CATEGORY_KEYWORD_MAP.general;
  const matchedKeywords: string[] = [];

  for (const [, keywords] of Object.entries(categoryMap)) {
    for (const keyword of keywords) {
      if (q.includes(keyword)) {
        matchedKeywords.push(keyword);
      }
    }
  }

  return matchedKeywords;
}

// --- Build per-market research context for LLM ---

export function buildResearchContextForLLM(
  market: RankedMarket,
  researchData: PerMarketResearchData | undefined
): string {
  const parts: string[] = [];

  parts.push(`### [${market.marketId}] "${market.question}"`);
  const prices = market.outcomes.map((o) => `${o.name}: $${o.price?.toFixed(2) ?? "?"}`).join(", ");
  const hoursToClose = market.closesAt
    ? ((new Date(market.closesAt).getTime() - Date.now()) / 3600000).toFixed(1)
    : "N/A";
  parts.push(`| Prices: ${prices} | Vol=$${market.volume.toLocaleString()} | Closes: ${hoursToClose}h`);

  // Score breakdown
  const bd = market.scoreBreakdown;
  parts.push(
    `| Score: ${market.score.toFixed(3)} (edge=${bd.edgePotential.toFixed(2)} vol=${bd.volumeConfidence.toFixed(2)} time=${bd.timeSweetSpot.toFixed(2)} fresh=${bd.freshnessBonus.toFixed(2)} newBonus=${bd.newMarketBonus.toFixed(2)})`
  );
  if (market.isNewMarket) {
    parts.push(`| ⚡ NEW/EMERGING MARKET — potentially mispriced`);
  }
  parts.push(`| Research priority: ${market.researchPriority}`);

  // Web search results
  if (researchData?.searchResults && researchData.searchResults.length > 0) {
    parts.push(`| Recent news & web sources:`);
    for (const r of researchData.searchResults.slice(0, 6)) {
      parts.push(`  - ${r.title} (${r.source}${r.date ? `, ${r.date}` : ""})`);
      if (r.snippet) {
        parts.push(`    "${r.snippet.slice(0, 200)}"`);
      }
    }
  } else {
    parts.push(`| (No web search results found)`);
  }

  // Extra search results (for deep/new markets)
  if (researchData?.research.extraSearchResults && researchData.research.extraSearchResults.length > 0) {
    parts.push(`| Additional research:`);
    for (const r of researchData.research.extraSearchResults.slice(0, 4)) {
      parts.push(`  - ${r.title} (${r.source})`);
      if (r.snippet) {
        parts.push(`    "${r.snippet.slice(0, 150)}"`);
      }
    }
  }

  // Twitter sentiment
  if (researchData?.twitterSentiment && researchData.twitterSentiment.length > 0) {
    parts.push(`| Twitter sentiment (${researchData.twitterSentiment.length} tweets):`);
    for (const t of researchData.twitterSentiment.slice(0, 3)) {
      parts.push(`  - "${t.text.slice(0, 100)}" (❤${t.likes} 🔄${t.retweets})`);
    }
  }

  // Market microstructure
  if (researchData?.microstructure) {
    const m = researchData.microstructure;
    parts.push(`| Microstructure: spread=${(m.bidAskSpread * 100).toFixed(1)}% depth@5%=$${m.depthAt5Pct?.toFixed(0) ?? "?"} impact=$${m.priceImpactEstimate?.toFixed(2) ?? "?"}`);
  }

  parts.push(""); // blank line separator
  return parts.join("\n");
}

// --- Build brief context for lower-priority markets ---

export function buildBriefContextForLLM(markets: RankedMarket[]): string {
  if (markets.length === 0) return "(No additional markets)";

  const lines = markets.map((m) => {
    const prices = m.outcomes.map((o) => `${o.name}:$${o.price?.toFixed(2) ?? "?"}`).join("/");
    const hoursToClose = m.closesAt
      ? ((new Date(m.closesAt).getTime() - Date.now()) / 3600000).toFixed(0) + "h"
      : "?";
    const newTag = m.isNewMarket ? " [NEW]" : "";
    return `- [${m.marketId}] "${m.question}" | ${prices} | Vol=$${m.volume.toLocaleString()} | ${hoursToClose}${newTag} (score:${m.score.toFixed(2)})`;
  });

  return lines.join("\n");
}

// --- Main research orchestration function ---

export async function orchestrateMarketResearch(
  markets: MarketContext[],
  category: string,
  agentId: string = "system"
): Promise<ResearchPhaseResult> {
  const startTime = Date.now();

  // Step 1: Rank markets
  const { deep, brief } = rankMarkets(markets, 7, 10);

  console.log(
    `[MarketResearch] Ranked ${markets.length} markets: ${deep.length} deep, ${brief.length} brief`
  );
  console.log(
    `[MarketResearch] Deep: ${deep.map((m) => `"${m.question.slice(0, 40)}..." (score=${m.score.toFixed(3)}${m.isNewMarket ? " NEW" : ""})`).join(", ")}`
  );

  // Step 2: Prepare search queries for deep markets
  const searchSpecs = deep.map((m) => ({
    marketId: m.marketId,
    question: m.question,
    searchQuery: extractSearchQuery(m.question),
    extraQueries: generateExtraSearchQueries(m),
    maxResults: m.researchPriority === "deep" ? 10 : 6,
  }));

  // Step 3: Batch research (with caching)
  const researchMap = await researchMarkets(searchSpecs, agentId);

  let totalSearches = 0;
  let cacheHits = 0;
  for (const [, research] of researchMap) {
    totalSearches += research.searchResults.length;
    if (research.extraSearchResults.length > 0) {
      totalSearches += research.extraSearchResults.length;
    }
    const age = (Date.now() - research.searchedAt) / 1000;
    if (age > 5) {
      cacheHits++;
    }
  }

  // Step 4: Fetch Twitter sentiment + microstructure for deep markets
// (concurrency-limited to avoid API rate limits)
  const perMarketData = new Map<string, PerMarketResearchData>();

  const twitterAndMicroTasks = deep.map((m) => async () => {
    const research = researchMap.get(m.marketId);

    // Twitter search
    let twitterSentiment: PerMarketResearchData["twitterSentiment"] = [];
    try {
      const searchQuery = extractSearchQuery(m.question);
      const tweetResults = await searchTweetsSafe(searchQuery, 5);
      twitterSentiment = tweetResults;
    } catch (err) {
      console.warn(`[MarketResearch] Twitter search failed for ${m.marketId}:`, err);
    }

    // Microstructure analysis
    let microstructure: MarketMicrostructure | null = null;
    try {
      microstructure = await analyzeMarketMicrostructure(m.marketId, 10);
    } catch (err) {
      // Not critical — continue without microstructure
    }

    const data: PerMarketResearchData = {
      marketId: m.marketId,
      question: m.question,
      searchResults: research?.searchResults ?? [],
      twitterSentiment,
      microstructure,
      research: research ?? {
        marketId: m.marketId,
        question: m.question,
        searchResults: [],
        extraSearchResults: [],
        searchedAt: Date.now(),
        searchedBy: agentId,
        searchQuery: extractSearchQuery(m.question),
        categoryData: {},
      },
      rankedMarket: m,
    };

    perMarketData.set(m.marketId, data);
  });

  // Limit to 3 concurrent research tasks to avoid API rate limits
  await runConcurrent(twitterAndMicroTasks, 3);

  const durationMs = Date.now() - startTime;
  console.log(
    `[MarketResearch] Research phase complete in ${durationMs}ms: ${totalSearches} results, ${cacheHits} cache hits, ${perMarketData.size} markets with data`
  );

  return {
    deep,
    brief,
    researchData: perMarketData,
    totalSearches,
    cacheHits,
    durationMs,
  };
}

// --- Safe Twitter search wrapper ---

async function searchTweetsSafe(
  query: string,
  maxResults: number
): Promise<Array<{ text: string; likes: number; retweets: number; createdAt: string }>> {
  try {
    const result = await twitterSearchTool.execute({ query, maxResults });
    if (Array.isArray(result)) {
      return result.map((t: any) => ({
        text: t.text ?? "",
        likes: t.likes ?? 0,
        retweets: t.retweets ?? 0,
        createdAt: t.createdAt ?? "",
      }));
    }
    return [];
  } catch {
    return [];
  }
}