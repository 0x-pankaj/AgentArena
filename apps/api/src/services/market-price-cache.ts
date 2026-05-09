// ============================================================
// Per-market price cache.
// ----------------------------------------------------------------
// Wraps `jupiterPredict.getMarket(marketId)` with a Redis-backed
// cache so that repeated lookups for the same market (different
// open positions, multiple agents, tight monitor loops) don't
// each push a slot onto the Jupiter rate-limit queue.
//
// Modeled on jupiter-cache-manager.ts (the per-category list
// cache). Uses fresh + stale TTLs with stale-while-revalidate;
// surfaces a StaleOkError from the rate limiter as "serve stale,
// don't error".
// ============================================================

import { redis } from "../utils/redis";
import { jupiterPredict, type JupiterMarket } from "../plugins/polymarket-plugin";
import { StaleOkError } from "./jupiter-rate-limiter";

const KEY_PREFIX = "mkt:price:v1:";
const FRESH_TTL_MS = 20_000;   // 20s — fresh, returned without revalidation
const STALE_TTL_MS = 90_000;   // 90s — stale-while-revalidate window
const REDIS_TTL_SEC = 120;     // Redis TTL covers fresh+stale + small slack

interface CachedEntry {
  market: JupiterMarket;
  fetchedAt: number;
}

function key(marketId: string): string {
  return `${KEY_PREFIX}${marketId}`;
}

async function readCache(marketId: string): Promise<CachedEntry | null> {
  try {
    const raw = await redis.get(key(marketId));
    if (!raw) return null;
    return JSON.parse(raw) as CachedEntry;
  } catch {
    return null;
  }
}

async function writeCache(marketId: string, market: JupiterMarket): Promise<void> {
  const entry: CachedEntry = { market, fetchedAt: Date.now() };
  try {
    await redis.setex(key(marketId), REDIS_TTL_SEC, JSON.stringify(entry));
  } catch {
    // Cache write is best-effort; do not break the caller on Redis hiccup.
  }
}

// In-flight fetch dedupe: when N positions on the same market all miss the
// cache simultaneously, we want one upstream call, not N. Resolves with the
// shared promise's result.
const inFlight = new Map<string, Promise<JupiterMarket | null>>();

async function fetchUpstream(marketId: string): Promise<JupiterMarket | null> {
  try {
    const market = await jupiterPredict.getMarket(marketId);
    await writeCache(marketId, market);
    return market;
  } catch (err) {
    // Saturated queue — let the caller serve stale. Other errors propagate
    // to the caller so they can DB-fall-back as needed.
    if (err instanceof StaleOkError) {
      return null;
    }
    throw err;
  }
}

function dedupedFetch(marketId: string): Promise<JupiterMarket | null> {
  const existing = inFlight.get(marketId);
  if (existing) return existing;
  const p = fetchUpstream(marketId).finally(() => {
    inFlight.delete(marketId);
  });
  inFlight.set(marketId, p);
  return p;
}

export interface CachedMarketResult {
  market: JupiterMarket | null;
  source: "fresh" | "stale" | "miss" | "fallback-stale" | "error";
  ageMs: number | null;
}

/**
 * Returns the latest market data for `marketId`, preferring the in-process
 * cache when fresh, serving stale + revalidating in the background otherwise.
 *
 * Never throws for transient upstream failures — callers should treat
 * `market === null` as "no data right now, use last-known DB value".
 */
export async function getCachedMarket(marketId: string): Promise<CachedMarketResult> {
  const cached = await readCache(marketId);
  const now = Date.now();

  if (cached) {
    const age = now - cached.fetchedAt;
    if (age < FRESH_TTL_MS) {
      return { market: cached.market, source: "fresh", ageMs: age };
    }
    if (age < STALE_TTL_MS) {
      // Stale-while-revalidate: kick off background refresh and serve cache.
      void dedupedFetch(marketId).catch(() => {
        // Background refresh failures are silent; we already have stale data
        // good enough to return.
      });
      return { market: cached.market, source: "stale", ageMs: age };
    }
  }

  // Cold or fully expired — fetch synchronously (deduped across positions).
  try {
    const fresh = await dedupedFetch(marketId);
    if (fresh) {
      return { market: fresh, source: "miss", ageMs: 0 };
    }
    // Saturated queue: serve whatever we have, even if past STALE_TTL_MS.
    if (cached) {
      return {
        market: cached.market,
        source: "fallback-stale",
        ageMs: now - cached.fetchedAt,
      };
    }
    return { market: null, source: "error", ageMs: null };
  } catch {
    if (cached) {
      return {
        market: cached.market,
        source: "fallback-stale",
        ageMs: now - cached.fetchedAt,
      };
    }
    return { market: null, source: "error", ageMs: null };
  }
}

/**
 * Bulk variant: dedupes by marketId and runs fetches in parallel. Useful in
 * monitor loops that need prices for many positions at once.
 */
export async function getCachedMarketsBulk(
  marketIds: string[],
): Promise<Map<string, CachedMarketResult>> {
  const unique = Array.from(new Set(marketIds));
  const entries = await Promise.all(
    unique.map(async (id) => [id, await getCachedMarket(id)] as const),
  );
  return new Map(entries);
}
