import { eq, and, desc, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import {
  jupiterPredict,
  type JupiterEvent,
  type JupiterMarket,
} from "../plugins/polymarket-plugin";
import { getCachedJupiterEvents, invalidateCategoryCache, AGENT_TO_JUPITER_CATEGORIES } from "./jupiter-cache-manager";

const CACHE_TTL_SECONDS = {
  trending: 60,
  category: 120,
  single: 300,
};

// Re-export for backward compatibility
export { getCachedJupiterEvents as getCachedEvents };

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

  const ttl = category ? CACHE_TTL_SECONDS.category : CACHE_TTL_SECONDS.trending;

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
    await redis.setex(cacheKey, ttl, JSON.stringify(markets));
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
    await redis.setex(cacheKey, CACHE_TTL_SECONDS.single, JSON.stringify(row));
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
    await redis.setex(cacheKey, CACHE_TTL_SECONDS.single, JSON.stringify(mapped));
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

  // Try cache first
  const cacheKey = category
    ? `${REDIS_KEYS.MARKET_CACHE}:trending:${category}`
    : `${REDIS_KEYS.MARKET_CACHE}:trending`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    return { markets: JSON.parse(cached) };
  }

  // Use new cache manager (avoids duplicate Jupiter API calls)
  try {
    // Jupiter doesn't accept "general" — map to valid Jupiter categories
    const jupiterCategories = category
      ? (AGENT_TO_JUPITER_CATEGORIES[category] ?? [category])
      : ['sports', 'crypto', 'politics', 'economics'];

    const allMarkets: typeof schema.marketData.$inferSelect[] = [];
    const results = await Promise.allSettled(
      jupiterCategories.map((cat) =>
        getCachedJupiterEvents(cat, { maxEvents: Math.ceil(limit / jupiterCategories.length) })
      )
    );

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { events } = result.value;
      const markets = eventsToMarkets(events, category);
      allMarkets.push(...markets);
    }

    // Deduplicate by marketId
    const seen = new Set<string>();
    const unique = allMarkets.filter((m) => {
      if (seen.has(m.marketId)) return false;
      seen.add(m.marketId);
      return true;
    });

    await redis.setex(cacheKey, CACHE_TTL_SECONDS.trending, JSON.stringify(unique));
    return { markets: unique };
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
    // Use new cache manager
    const categories = category ? [category] : ['sports', 'crypto', 'politics', 'economics'];
    
    let count = 0;
    for (const cat of categories) {
      const { events } = await getCachedJupiterEvents(cat, { maxEvents: 100 });
      
      if (!events || events.length === 0) continue;
      
      for (const event of events) {
        if (!event.markets) continue;
        for (const market of event.markets) {
          try {
            const mapped = mapJupiterMarketToDb({
              ...market,
              eventId: event.eventId,
              category: event.category ?? cat,
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
    }

    // Invalidate market caches after sync
    const keys = await redis.keys(`${REDIS_KEYS.MARKET_CACHE}*`);
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
