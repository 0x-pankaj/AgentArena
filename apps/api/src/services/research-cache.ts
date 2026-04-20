// ============================================================
// Research Cache Service
// Caches web search results per marketId with 15min TTL.
// When multiple agents (or multiple ticks) research the same
// market, they reuse cached results — no duplicate API calls.
// ============================================================

import { redis } from "../utils/redis";
import { webSearch, type SearchResult } from "./web-search";

export interface MarketResearch {
  marketId: string;
  question: string;
  searchResults: SearchResult[];
  extraSearchResults: SearchResult[];
  searchedAt: number;
  searchedBy: string;
  searchQuery: string;
  categoryData: Record<string, unknown>;
}

const RESEARCH_CACHE_TTL = 15 * 60; // 15 minutes in seconds
const RESEARCH_KEY_PREFIX = "research:market:";
const EXTRA_SEARCH_KEY_PREFIX = "research:extra:";

// --- Get cached research for a market ---

export async function getCachedResearch(
  marketId: string
): Promise<MarketResearch | null> {
  const key = `${RESEARCH_KEY_PREFIX}${marketId}`;
  const raw = await redis.get(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as MarketResearch;
    const age = (Date.now() - parsed.searchedAt) / 1000;
    if (age > RESEARCH_CACHE_TTL) {
      await redis.del(key);
      return null;
    }
    return parsed;
  } catch {
    await redis.del(key);
    return null;
  }
}

// --- Store research in cache ---

export async function cacheResearch(
  research: MarketResearch
): Promise<void> {
  const key = `${RESEARCH_KEY_PREFIX}${research.marketId}`;
  await redis.setex(key, RESEARCH_CACHE_TTL, JSON.stringify(research));
}

// --- Search and cache for a single market ---

export async function researchMarket(
  marketId: string,
  question: string,
  searchQuery: string,
  extraQueries: string[] = [],
  maxResults: number = 8,
  agentId: string = "system"
): Promise<MarketResearch> {
  // Check cache first
  const cached = await getCachedResearch(marketId);
  if (cached) {
    console.log(`[ResearchCache] Cache HIT for market ${marketId} (age: ${((Date.now() - cached.searchedAt) / 1000).toFixed(0)}s)`);
    return cached;
  }

  console.log(`[ResearchCache] Cache MISS for market ${marketId} — searching: "${searchQuery}"`);

  // Primary search
  const searchResults = await webSearch(searchQuery, maxResults);

  // Extra searches for deep/new markets
  const extraSearchResults: SearchResult[] = [];
  if (extraQueries.length > 0) {
    const extraResults = await Promise.allSettled(
      extraQueries.map((q) => webSearch(q, 5))
    );
    for (const result of extraResults) {
      if (result.status === "fulfilled") {
        extraSearchResults.push(...result.value);
      }
    }
  }

  const research: MarketResearch = {
    marketId,
    question,
    searchResults,
    extraSearchResults,
    searchedAt: Date.now(),
    searchedBy: agentId,
    searchQuery,
    categoryData: {},
  };

  await cacheResearch(research);

  console.log(
    `[ResearchCache] Cached research for ${marketId}: ${searchResults.length} primary + ${extraSearchResults.length} extra results`
  );

  return research;
}

// --- Batch research multiple markets (parallel, with caching) ---

export async function researchMarkets(
  markets: Array<{
    marketId: string;
    question: string;
    searchQuery: string;
    extraQueries: string[];
    maxResults: number;
  }>,
  agentId: string = "system"
): Promise<Map<string, MarketResearch>> {
  const results = new Map<string, MarketResearch>();

  // Check cache for all markets first
  const cacheChecks = await Promise.all(
    markets.map(async (m) => ({
      marketId: m.marketId,
      cached: await getCachedResearch(m.marketId),
    }))
  );

  const cacheHits = cacheChecks.filter((c) => c.cached !== null);
  const cacheMisses = cacheChecks.filter((c) => c.cached === null);

  // Use cached results
  for (const hit of cacheHits) {
    if (hit.cached) {
      results.set(hit.marketId, hit.cached);
    }
  }

  console.log(
    `[ResearchCache] Batch: ${cacheHits.length} cache hits, ${cacheMisses.length} cache misses`
  );

  // Fetch missing markets in parallel (with concurrency limit)
  if (cacheMisses.length > 0) {
    const missMarkets = cacheMisses.map((c) =>
      markets.find((m) => m.marketId === c.marketId)!
    );

    // Process in batches of 3 to avoid rate limits
    const BATCH_SIZE = 3;
    for (let i = 0; i < missMarkets.length; i += BATCH_SIZE) {
      const batch = missMarkets.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map((m) =>
          researchMarket(
            m.marketId,
            m.question,
            m.searchQuery,
            m.extraQueries,
            m.maxResults,
            agentId
          )
        )
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.set(result.value.marketId, result.value);
        }
      }

      // Small delay between batches to respect rate limits
      if (i + BATCH_SIZE < missMarkets.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  return results;
}

// --- Get cache stats ---

export async function getResearchCacheStats(): Promise<{
  cachedMarkets: number;
  oldestAge: number;
  newestAge: number;
}> {
  const keys = await redis.keys(`${RESEARCH_KEY_PREFIX}*`);
  let oldestAge = 0;
  let newestAge = Infinity;

  for (const key of keys) {
    const raw = await redis.get(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as MarketResearch;
        const age = (Date.now() - parsed.searchedAt) / 1000;
        if (age > oldestAge) oldestAge = age;
        if (age < newestAge) newestAge = age;
      } catch {}
    }
  }

  return {
    cachedMarkets: keys.length,
    oldestAge: keys.length > 0 ? oldestAge : 0,
    newestAge: keys.length > 0 ? newestAge : 0,
  };
}

// --- Invalidate research cache for a specific market ---

export async function invalidateResearchCache(marketId: string): Promise<void> {
  await redis.del(`${RESEARCH_KEY_PREFIX}${marketId}`);
  await redis.del(`${EXTRA_SEARCH_KEY_PREFIX}${marketId}`);
}

// --- Invalidate all research caches ---

export async function invalidateAllResearchCaches(): Promise<void> {
  const keys = await redis.keys(`${RESEARCH_KEY_PREFIX}*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  const extraKeys = await redis.keys(`${EXTRA_SEARCH_KEY_PREFIX}*`);
  if (extraKeys.length > 0) {
    await redis.del(...extraKeys);
  }
  console.log(`[ResearchCache] Invalidated all research caches`);
}