// ============================================================
// Jupiter Predict API Cache Manager
// Category-specific caching with smart TTLs and invalidation
// Single-fetch → broadcast pattern to minimize rate limit hits
// ============================================================

import { redis } from "../utils/redis";
import { jupiterPredict, type JupiterEvent } from "../plugins/polymarket-plugin";

// --- Category-specific cache configuration ---

export interface CategoryCacheConfig {
  ttlSeconds: number;           // How long to cache
  staleTtlSeconds: number;      // Serve stale while refreshing
  maxEvents: number;            // Max events to fetch/store
  filter: 'live' | 'trending' | 'new' | undefined;
  sortBy: 'volume' | 'beginAt' | undefined;
  priority: 'high' | 'medium' | 'low'; // For rate limit prioritization
}

export const CATEGORY_CACHE_CONFIGS: Record<string, CategoryCacheConfig> = {
  sports: {
    ttlSeconds: 180,           // 3 minutes (sports markets move fast)
    staleTtlSeconds: 300,      // Serve stale for 5 min if fetch fails
    maxEvents: 30,
    filter: 'live',            // Only active/live markets
    sortBy: 'volume',
    priority: 'high',
  },
  crypto: {
    ttlSeconds: 120,           // 2 minutes (crypto is very volatile)
    staleTtlSeconds: 240,      // Serve stale for 4 min
    maxEvents: 40,
    filter: 'trending',        // Trending crypto markets
    sortBy: 'volume',
    priority: 'high',
  },
  politics: {
    ttlSeconds: 600,           // 10 minutes (political markets slower)
    staleTtlSeconds: 900,      // Serve stale for 15 min
    maxEvents: 50,
    filter: undefined,
    sortBy: 'volume',
    priority: 'medium',
  },
  economics: {
    ttlSeconds: 900,           // 15 minutes (economic data changes slowly)
    staleTtlSeconds: 1200,     // Serve stale for 20 min
    maxEvents: 30,
    filter: undefined,
    sortBy: 'volume',
    priority: 'low',
  },
};

// Default config for unknown categories
const DEFAULT_CACHE_CONFIG: CategoryCacheConfig = {
  ttlSeconds: 300,
  staleTtlSeconds: 600,
  maxEvents: 20,
  filter: undefined,
  sortBy: 'volume',
  priority: 'medium',
};

// --- Cache keys ---

function categoryCacheKey(category: string): string {
  return `jupiter:events:v2:${category}`;
}

function categoryMetaKey(category: string): string {
  return `jupiter:events:v2:${category}:meta`;
}

// --- Cache metadata ---

interface CacheMetadata {
  fetchedAt: string;
  stalenessTime: number;
  eventCount: number;
  fetchDurationMs: number;
  isStale: boolean;
}

// --- Agent category mapping ---

export const AGENT_TO_JUPITER_CATEGORIES: Record<string, string[]> = {
  sports: ['sports'],
  crypto: ['crypto'],
  politics: ['politics', 'economics'],
  general: ['sports', 'crypto', 'politics', 'economics'],
};

// ============================================================
// Main cache fetch function with smart TTLs and stale-while-revalidate
// ============================================================

export async function getCachedJupiterEvents(
  category: string,
  options?: {
    forceRefresh?: boolean;
    maxEvents?: number;
  }
): Promise<{ events: JupiterEvent[]; metadata: CacheMetadata }> {
  const config = CATEGORY_CACHE_CONFIGS[category] ?? DEFAULT_CACHE_CONFIG;
  const cacheKey = categoryCacheKey(category);
  const metaKey = categoryMetaKey(category);
  const maxEvents = options?.maxEvents ?? config.maxEvents;

  // Check if force refresh is requested
  if (options?.forceRefresh) {
    return fetchAndCacheCategory(category, config, maxEvents);
  }

  // Try to get from cache
  const cachedRaw = await redis.get(cacheKey);
  const metaRaw = await redis.get(metaKey);

  if (cachedRaw && metaRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as JupiterEvent[];
      const metadata = JSON.parse(metaRaw) as CacheMetadata;

      // Check if cache is still fresh
      const age = Date.now() - metadata.stalenessTime;
      if (age < config.ttlSeconds * 1000) {
        return {
          events: cached.slice(0, maxEvents),
          metadata,
        };
      }

      // Cache is stale but within stale TTL - serve stale while refreshing
      if (age < config.staleTtlSeconds * 1000) {
        console.log(`[JupiterCache] Serving stale data for ${category} (age: ${(age / 1000).toFixed(0)}s)`);

        // Trigger background refresh (fire and forget)
        fetchAndCacheCategory(category, config, maxEvents).catch(err => {
          console.warn(`[JupiterCache] Background refresh failed for ${category}:`, err);
        });

        return {
          events: cached.slice(0, maxEvents),
          metadata: { ...metadata, isStale: true },
        };
      }
    } catch (parseErr) {
      console.warn(`[JupiterCache] Failed to parse cached data for ${category}:`, parseErr);
    }
  }

  // Cache miss or expired - fetch fresh data
  return fetchAndCacheCategory(category, config, maxEvents);
}

// ============================================================
// Fetch and cache a single category
// ============================================================

async function fetchAndCacheCategory(
  category: string,
  config: CategoryCacheConfig,
  maxEvents: number
): Promise<{ events: JupiterEvent[]; metadata: CacheMetadata }> {
  const cacheKey = categoryCacheKey(category);
  const metaKey = categoryMetaKey(category);
  const startTime = Date.now();

  try {
    console.log(`[JupiterCache] Fetching fresh events for ${category}...`);

    const events = await jupiterPredict.listEvents({
      category,
      sortBy: config.sortBy,
      sortDirection: 'desc',
      includeMarkets: true,
      filter: config.filter,
      start: 0,
      end: maxEvents,
    });

    const fetchDuration = Date.now() - startTime;

    // Store events in cache
    await redis.setex(cacheKey, config.ttlSeconds, JSON.stringify(events));

    // Store metadata
    const metadata: CacheMetadata = {
      fetchedAt: new Date().toISOString(),
      stalenessTime: Date.now(),
      eventCount: events.length,
      fetchDurationMs: fetchDuration,
      isStale: false,
    };
    await redis.setex(metaKey, config.staleTtlSeconds, JSON.stringify(metadata));

    console.log(`[JupiterCache] Cached ${events.length} events for ${category} (${fetchDuration}ms)`);

    return { events, metadata };
  } catch (err) {
    console.error(`[JupiterCache] Failed to fetch ${category} events:`, err);

    // Try to serve stale data if available
    const cachedRaw = await redis.get(cacheKey);
    const metaRaw = await redis.get(metaKey);

    if (cachedRaw && metaRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as JupiterEvent[];
        const metadata = JSON.parse(metaRaw) as CacheMetadata;
        console.warn(`[JupiterCache] Serving expired stale data for ${category} after fetch failure`);
        return {
          events: cached.slice(0, maxEvents),
          metadata: { ...metadata, isStale: true },
        };
      } catch {}
    }

    // Return empty as last resort
    const errorMetadata: CacheMetadata = {
      fetchedAt: new Date().toISOString(),
      stalenessTime: Date.now(),
      eventCount: 0,
      fetchDurationMs: Date.now() - startTime,
      isStale: false,
    };
    return { events: [], metadata: errorMetadata };
  }
}

// ============================================================
// Batch fetch all categories for an agent type (single call)
// ============================================================

export async function getCachedEventsForAgent(
  agentCategory: string
): Promise<Record<string, { events: JupiterEvent[]; metadata: CacheMetadata }>> {
  const jupiterCategories = AGENT_TO_JUPITER_CATEGORIES[agentCategory] ?? [agentCategory];

  // Fetch all categories in parallel
  const results = await Promise.allSettled(
    jupiterCategories.map(async (cat) => {
      const result = await getCachedJupiterEvents(cat);
      return { category: cat, result };
    })
  );

  // Build result map
  const result: Record<string, { events: JupiterEvent[]; metadata: CacheMetadata }> = {};
  results.forEach((r) => {
    if (r.status === 'fulfilled') {
      result[r.value.category] = r.value.result;
    }
  });

  return result;
}

// ============================================================
// Cache invalidation helpers
// ============================================================

export async function invalidateCategoryCache(category: string): Promise<void> {
  const cacheKey = categoryCacheKey(category);
  const metaKey = categoryMetaKey(category);
  await redis.del(cacheKey);
  await redis.del(metaKey);
  console.log(`[JupiterCache] Invalidated cache for ${category}`);
}

export async function invalidateAllJupiterCaches(): Promise<void> {
  const categories = Object.keys(CATEGORY_CACHE_CONFIGS);
  await Promise.all(categories.map(invalidateCategoryCache));
  console.log('[JupiterCache] Invalidated all category caches');
}

export async function invalidateAgentCategoryCaches(agentCategory: string): Promise<void> {
  const jupiterCategories = AGENT_TO_JUPITER_CATEGORIES[agentCategory] ?? [agentCategory];
  await Promise.all(jupiterCategories.map(invalidateCategoryCache));
  console.log(`[JupiterCache] Invalidated caches for agent category: ${agentCategory}`);
}

// ============================================================
// Cache statistics
// ============================================================

export async function getCacheStats(): Promise<Record<string, { age: number; eventCount: number; isStale: boolean } | null>> {
  const stats: Record<string, { age: number; eventCount: number; isStale: boolean } | null> = {};

  for (const category of Object.keys(CATEGORY_CACHE_CONFIGS)) {
    const metaRaw = await redis.get(categoryMetaKey(category));
    if (metaRaw) {
      try {
        const meta = JSON.parse(metaRaw) as CacheMetadata;
        const config = CATEGORY_CACHE_CONFIGS[category];
        const age = (Date.now() - meta.stalenessTime) / 1000;
        stats[category] = {
          age: Math.round(age),
          eventCount: meta.eventCount,
          isStale: age > config.ttlSeconds,
        };
      } catch {
        stats[category] = null;
      }
    } else {
      stats[category] = null;
    }
  }

  return stats;
}

// ============================================================
// Pre-warm cache (call this before agent tick cycle)
// ============================================================

export async function preWarmCategoryCaches(): Promise<void> {
  console.log('[JupiterCache] Pre-warming caches for all categories...');

  const startTime = Date.now();
  const categories = Object.keys(CATEGORY_CACHE_CONFIGS);

  await Promise.allSettled(
    categories.map(async (cat) => {
      const config = CATEGORY_CACHE_CONFIGS[cat];
      try {
        await fetchAndCacheCategory(cat, config, config.maxEvents);
      } catch (err) {
        console.warn(`[JupiterCache] Failed to pre-warm ${cat}:`, err);
      }
    })
  );

  const duration = Date.now() - startTime;
  console.log(`[JupiterCache] Pre-warming complete in ${duration}ms`);
}
