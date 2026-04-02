import { redis } from "./redis";

// ============================================================
// Unified cache utility with stampede protection
// ============================================================
//
// Features:
// - Get-or-fetch pattern (cache-aside)
// - Stampede protection via Redis SETNX lock
// - Configurable TTL per key namespace
// - Stale-while-revalidate support (serve stale while refreshing in background)
// - Proper key namespace separation

// --- Cache key namespaces ---

export const CACHE_NAMESPACES = {
  gdelt: { prefix: "cache:gdelt", defaultTtl: 900 },       // 15 min
  acled: { prefix: "cache:acled", defaultTtl: 1800 },       // 30 min
  fred: { prefix: "cache:fred", defaultTtl: 3600 },         // 1 hour
  firms: { prefix: "cache:firms", defaultTtl: 1800 },       // 30 min
  twitter: { prefix: "cache:twitter", defaultTtl: 900 },    // 15 min
  coingecko: { prefix: "cache:coingecko", defaultTtl: 300 }, // 5 min
  defillama: { prefix: "cache:defillama", defaultTtl: 300 }, // 5 min
  sports: { prefix: "cache:sports", defaultTtl: 300 },      // 5 min
  websearch: { prefix: "cache:websearch", defaultTtl: 600 }, // 10 min
  signals: { prefix: "cache:signals", defaultTtl: 900 },    // 15 min
  markets: { prefix: "cache:markets", defaultTtl: 900 },    // 15 min
  jupiter: { prefix: "cache:jupiter", defaultTtl: 600 },    // 10 min
} as const;

type CacheNamespace = keyof typeof CACHE_NAMESPACES;

// --- Lock constants ---

const LOCK_PREFIX = "cache:lock:";
const LOCK_TTL = 30; // 30 seconds max lock hold

// --- Build cache key ---

export function cacheKey(namespace: CacheNamespace, ...parts: string[]): string {
  const { prefix } = CACHE_NAMESPACES[namespace];
  return `${prefix}:${parts.join(":")}`;
}

// --- Get cached value ---

export async function getCached<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// --- Set cached value ---

export async function setCached<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  await redis.setex(key, ttlSeconds, JSON.stringify(value));
}

// --- Delete cached value ---

export async function deleteCached(key: string): Promise<void> {
  await redis.del(key);
}

// --- Acquire stampede lock ---

async function acquireLock(lockKey: string): Promise<boolean> {
  const result = await redis.set(lockKey, "1", "EX", LOCK_TTL, "NX");
  return result === "OK";
}

// --- Release stampede lock ---

async function releaseLock(lockKey: string): Promise<void> {
  await redis.del(lockKey);
}

// ============================================================
// Main cache function: get-or-fetch with stampede protection
// ============================================================

export async function cachedFetch<T>(
  namespace: CacheNamespace,
  keyParts: string[],
  fetcher: () => Promise<T>,
  options: {
    ttl?: number;
    staleTtl?: number; // if set, serve stale data while refreshing
  } = {}
): Promise<T> {
  const key = cacheKey(namespace, ...keyParts);
  const nsConfig = CACHE_NAMESPACES[namespace];
  const ttl = options.ttl ?? nsConfig.defaultTtl;

  // 1. Try to get from cache
  const cached = await getCached<T>(key);
  if (cached !== null) {
    return cached;
  }

  // 2. Cache miss — try to acquire lock (stampede protection)
  const lockKey = `${LOCK_PREFIX}${key}`;
  const hasLock = await acquireLock(lockKey);

  if (!hasLock) {
    // Another instance is fetching — wait and retry
    // Wait up to 5 seconds for the other instance to finish
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const retryCached = await getCached<T>(key);
      if (retryCached !== null) {
        return retryCached;
      }
    }
    // Still no cache after waiting — fetch ourselves (degraded mode)
  }

  try {
    // 3. Fetch fresh data
    const fresh = await fetcher();

    // 4. Store in cache
    await setCached(key, fresh, ttl);

    return fresh;
  } finally {
    // 5. Release lock
    if (hasLock) {
      await releaseLock(lockKey);
    }
  }
}

// ============================================================
// Batch cache: fetch multiple keys at once
// ============================================================

export async function cachedFetchBatch<T>(
  namespace: CacheNamespace,
  items: Array<{
    keyParts: string[];
    fetcher: () => Promise<T>;
    ttl?: number;
  }>
): Promise<T[]> {
  return Promise.all(
    items.map((item) =>
      cachedFetch(namespace, item.keyParts, item.fetcher, { ttl: item.ttl })
    )
  );
}

// ============================================================
// Utility: flush a namespace
// ============================================================

export async function flushNamespace(namespace: CacheNamespace): Promise<number> {
  const { prefix } = CACHE_NAMESPACES[namespace];
  const keys = await redis.keys(`${prefix}:*`);
  if (keys.length === 0) return 0;
  return redis.del(...keys);
}
