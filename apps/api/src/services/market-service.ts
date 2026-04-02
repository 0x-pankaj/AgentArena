import { eq, and, desc, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import {
  jupiterPredict,
  type JupiterEvent,
  type JupiterMarket,
} from "../plugins/polymarket-plugin";

const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes
const EVENTS_CACHE_TTL = 10 * 60; // 10 minutes for raw events

// --- Cache Jupiter events in Redis (shared across agents) ---

export async function getCachedEvents(
  category?: string,
  limit: number = 50
): Promise<JupiterEvent[]> {
  const cacheKey = category
    ? `jupiter:events:${category}:${limit}`
    : `jupiter:events:all:${limit}`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  try {
    const events = await jupiterPredict.listEvents({
      category,
      sortBy: "volume",
      includeMarkets: true,
      limit,
    });

    await redis.setex(cacheKey, EVENTS_CACHE_TTL, JSON.stringify(events));
    return events;
  } catch (err) {
    console.error("Failed to fetch events from Jupiter:", err);
    // Return empty — agents will skip this tick
    return [];
  }
}

// --- Market listing with Redis cache ---

export async function listMarkets(params: {
  category?: string;
  limit?: number;
  offset?: number;
}): Promise<{ markets: typeof schema.marketData.$inferSelect[]; total: number }> {
  const { category, limit = 20, offset = 0 } = params;

  // Try cache first
  const cacheKey = category
    ? `${REDIS_KEYS.MARKET_CACHE}:${category}`
    : REDIS_KEYS.MARKET_CACHE;

  const cached = await redis.get(cacheKey);
  if (cached) {
    const all = JSON.parse(cached) as typeof schema.marketData.$inferSelect[];
    return {
      markets: all.slice(offset, offset + limit),
      total: all.length,
    };
  }

  // Fetch from DB
  const query = category
    ? db
        .select()
        .from(schema.marketData)
        .where(eq(schema.marketData.category, category))
        .orderBy(desc(schema.marketData.volume))
        .limit(limit)
        .offset(offset)
    : db
        .select()
        .from(schema.marketData)
        .orderBy(desc(schema.marketData.volume))
        .limit(limit)
        .offset(offset);

  const markets = await query;

  // Cache results
  if (markets.length > 0) {
    await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(markets));
  }

  return { markets, total: markets.length };
}

// --- Get single market ---

export async function getMarket(
  marketId: string
): Promise<typeof schema.marketData.$inferSelect | null> {
  // Try cache
  const cacheKey = `${REDIS_KEYS.MARKET_CACHE}:id:${marketId}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // Try DB
  const [row] = await db
    .select()
    .from(schema.marketData)
    .where(eq(schema.marketData.marketId, marketId))
    .limit(1);

  if (row) {
    await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(row));
    return row;
  }

  // Fetch from Jupiter and cache
  try {
    const jupiterMarket = await jupiterPredict.getMarket(marketId);
    const mapped = mapJupiterMarketToDb(jupiterMarket);
    await db
      .insert(schema.marketData)
      .values(mapped)
      .onConflictDoUpdate({
        target: schema.marketData.marketId,
        set: mapped,
      });
    await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(mapped));
    return mapped;
  } catch {
    return null;
  }
}

// --- Trending markets ---

export async function getTrendingMarkets(params: {
  category?: string;
  limit?: number;
}): Promise<{ markets: typeof schema.marketData.$inferSelect[] }> {
  const { category, limit = 10 } = params;

  // Try cache
  const cacheKey = category
    ? `${REDIS_KEYS.MARKET_CACHE}:trending:${category}`
    : `${REDIS_KEYS.MARKET_CACHE}:trending`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    return { markets: JSON.parse(cached) };
  }

  // Use cached events (avoids duplicate Jupiter API calls)
  try {
    const events = await getCachedEvents(category, limit);

    const markets = eventsToMarkets(events, category);
    await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(markets));
    return { markets };
  } catch {
    // Fall back to DB
    const rows = await db
      .select()
      .from(schema.marketData)
      .where(
        category
          ? eq(schema.marketData.category, category)
          : sql`true`
      )
      .orderBy(desc(schema.marketData.volume))
      .limit(limit);
    return { markets: rows };
  }
}

// --- Search markets ---

export async function searchMarkets(
  query: string,
  limit: number = 20
): Promise<{ markets: typeof schema.marketData.$inferSelect[] }> {
  try {
    const events = await jupiterPredict.searchEvents({ query, limit });
    const markets = eventsToMarkets(events);
    return { markets };
  } catch {
    // Fallback to DB text search
    const rows = await db
      .select()
      .from(schema.marketData)
      .where(sql`${schema.marketData.question} ILIKE ${"%" + query + "%"}`)
      .limit(limit);
    return { markets: rows };
  }
}

// --- Sync markets from Jupiter to DB (background job) ---

export async function syncMarketsFromJupiter(
  category?: string
): Promise<number> {
  try {
    const events = await getCachedEvents(category, 100);

    let count = 0;
    for (const event of events) {
      if (!event.markets) continue;
      for (const market of event.markets) {
        try {
          const mapped = mapJupiterMarketToDb({
            ...market,
            eventId: event.eventId,
            category: event.category ?? undefined,
          });

          await db
            .insert(schema.marketData)
            .values(mapped)
            .onConflictDoUpdate({
              target: schema.marketData.marketId,
              set: mapped,
            });
          count++;
        } catch (dbErr) {
          // Skip individual market failures
        }
      }
    }

    // Invalidate trending cache only
    const keys = await redis.keys(`${REDIS_KEYS.MARKET_CACHE}:trending*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    return count;
  } catch (err) {
    console.error("Failed to sync markets from Jupiter:", err);
    return 0;
  }
}

// --- Helpers ---

function mapJupiterMarketToDb(
  market: JupiterMarket & { eventId?: string; category?: string; eventTitle?: string }
): typeof schema.marketData.$inferSelect {
  // pricing is an object: { buyYesPriceUsd, sellYesPriceUsd, buyNoPriceUsd, sellNoPriceUsd, volume }
  const pricingObj = market.pricing as any;
  const volume = pricingObj?.volume ? Number(pricingObj.volume) : null;
  const buyYesPrice = pricingObj?.buyYesPriceUsd ? Number(pricingObj.buyYesPriceUsd) / 1e6 : null;
  const buyNoPrice = pricingObj?.buyNoPriceUsd ? Number(pricingObj.buyNoPriceUsd) / 1e6 : null;

  const outcomes = [];
  if (buyYesPrice !== null) outcomes.push({ name: "Yes", price: buyYesPrice });
  if (buyNoPrice !== null) outcomes.push({ name: "No", price: buyNoPrice });

  // Question comes from event title + market rules
  const question =
    market.metadata?.rulesPrimary?.slice(0, 200) ??
    market.metadata?.title ??
    market.eventTitle ??
    "Unknown market";

  const closeTime = market.closeTime
    ? typeof market.closeTime === "number"
      ? new Date(market.closeTime * (market.closeTime < 1e12 ? 1000 : 1))
      : new Date(market.closeTime)
    : null;

  return {
    marketId: market.marketId,
    source: "jupiter",
    category: market.category ?? null,
    question,
    outcomes,
    volume: volume ? String(volume) : null,
    liquidity: null,
    closesAt: closeTime,
    resolvedAt: market.result ? new Date() : null,
    result: market.result ?? null,
    updatedAt: new Date(),
  } as typeof schema.marketData.$inferSelect;
}

function eventsToMarkets(
  events: JupiterEvent[],
  category?: string
): typeof schema.marketData.$inferSelect[] {
  const markets: typeof schema.marketData.$inferSelect[] = [];
  for (const event of events) {
    if (!event.markets) continue;
    for (const market of event.markets) {
      markets.push(
        mapJupiterMarketToDb({
          ...market,
          eventId: event.eventId,
          category: event.category ?? undefined,
          eventTitle: event.metadata?.title ?? undefined,
        })
      );
    }
  }
  return markets;
}
