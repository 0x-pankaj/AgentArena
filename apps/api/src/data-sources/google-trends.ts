// --- Google Trends Integration ---
// FREE — no API key required
// Uses npm package: google-trends-api (unofficial but stable, 1400+ stars)
// Provides search interest data as leading indicators (often 12-48h ahead of market moves)
//
// Category keywords:
// - Crypto: bitcoin, ethereum, solana, crypto ETF, crypto regulation
// - Politics: election polls, trump approval, biden approval, ukraine war, tariffs
// - Sports: NBA playoffs, NFL odds, Super Bowl, UFC, Premier League

import { interestOverTime, relatedQueries } from "google-trends-api";
import { cachedFetch } from "../utils/cache";

// --- Types ---

export interface TrendsTimePoint {
  date: string;
  value: number; // 0-100 relative search interest
}

export interface GoogleTrendsSignal {
  keyword: string;
  currentInterest: number; // most recent value (0-100)
  change7d: number; // % change vs 7 days ago
  change30d: number; // % change vs 30 days ago
  trendDirection: "rising" | "falling" | "stable" | "breakout" | "declining";
  timeSeries: TrendsTimePoint[];
  relatedQueries: string[];
  fetchedAt: string;
}

// --- Category keyword mapping ---

export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  crypto: [
    "bitcoin",
    "ethereum",
    "solana",
    "crypto ETF",
    "crypto regulation",
    "DeFi",
    "altcoin",
    "bitcoin price",
  ],
  politics: [
    "election polls",
    "trump approval",
    "biden approval",
    "ukraine war",
    "tariffs",
    "supreme court",
    "congress",
    "election 2026",
  ],
  sports: [
    "NBA playoffs",
    "NFL odds",
    "Super Bowl",
    "UFC",
    "Premier League",
    "Champions League",
    "World Cup",
    "sports betting",
  ],
  general: [
    "breaking news",
    "world news",
    "economy",
    "stock market",
    "inflation",
  ],
};

// --- Safe JSON parse helpers ---

function isJsonResponse(str: string): boolean {
  const trimmed = str.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function safeJsonParse<T>(jsonStr: string, fallback: T): T {
  if (!isJsonResponse(jsonStr)) return fallback;
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return fallback;
  }
}

function parseTrendsResponse(jsonStr: string): TrendsTimePoint[] {
  const data = safeJsonParse<any>(jsonStr, null);
  if (!data) return [];

  // The response structure varies; try common paths
  const timeline =
    data?.default?.timelineData ??
    data?.timelineData ??
    data?.data ??
    [];

  return timeline.map((point: any) => ({
    date: point.formattedTime ?? point.time ?? point.date ?? "",
    value: Number(point.value?.[0] ?? point.value ?? 0),
  }));
}

// --- Get interest over time for a keyword ---

export async function getInterestOverTime(
  keyword: string,
  timeframe: string = "today 1-m" // Google Trends format: "today 1-m", "today 3-m", "today 12-m"
): Promise<TrendsTimePoint[]> {
  const cacheKey = ["trends", "interest", keyword, timeframe];

  return cachedFetch("trends", cacheKey, async () => {
    try {
      const result = await interestOverTime({
        keyword,
        startTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endTime: new Date(),
        geo: "", // worldwide
      });
      return parseTrendsResponse(result);
    } catch (err) {
      console.error(`[GoogleTrends] interestOverTime failed for "${keyword}":`, err);
      return [];
    }
  });
}

// --- Get related queries (rising/breakout searches) ---

export async function getRelatedQueries(keyword: string): Promise<string[]> {
  const cacheKey = ["trends", "related", keyword];

  return cachedFetch("trends", cacheKey, async () => {
    try {
      const result = await relatedQueries({
        keyword,
        startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        geo: "",
      });

      // google-trends-api often returns HTML error pages (e.g. rate-limit blocks)
      // when Google's internal API changes or rejects the scraper.
      if (!isJsonResponse(result)) {
        console.warn(
          `[GoogleTrends] relatedQueries returned non-JSON (likely HTML error) for "${keyword}". Skipping.`
        );
        return [];
      }

      const data = safeJsonParse<any>(result, null);
      if (!data) return [];

      const queries =
        data?.default?.rankedList?.[0]?.rankedKeyword?.map((k: any) => k.query as string) ??
        data?.rankedList?.[0]?.rankedKeyword?.map((k: any) => k.query as string) ??
        [];
      return queries.slice(0, 10);
    } catch (err) {
      console.error(`[GoogleTrends] relatedQueries failed for "${keyword}":`, err);
      return [];
    }
  });
}

// --- Build signal for a single keyword ---

export async function getKeywordSignal(keyword: string): Promise<GoogleTrendsSignal> {
  const [timeSeries, relatedQueries] = await Promise.all([
    getInterestOverTime(keyword),
    getRelatedQueries(keyword),
  ]);

  if (timeSeries.length === 0) {
    return {
      keyword,
      currentInterest: 0,
      change7d: 0,
      change30d: 0,
      trendDirection: "stable",
      timeSeries: [],
      relatedQueries,
      fetchedAt: new Date().toISOString(),
    };
  }

  const currentInterest = timeSeries[timeSeries.length - 1]?.value ?? 0;

  // Calculate 7d change
  const weekAgoIndex = Math.max(timeSeries.length - 8, 0);
  const weekAgoValue = timeSeries[weekAgoIndex]?.value ?? currentInterest;
  const change7d = weekAgoValue > 0 ? ((currentInterest - weekAgoValue) / weekAgoValue) * 100 : 0;

  // Calculate 30d change (or since start if <30 points)
  const monthAgoValue = timeSeries[0]?.value ?? currentInterest;
  const change30d = monthAgoValue > 0 ? ((currentInterest - monthAgoValue) / monthAgoValue) * 100 : 0;

  // Trend direction
  let trendDirection: GoogleTrendsSignal["trendDirection"] = "stable";
  if (change7d > 30) trendDirection = "breakout";
  else if (change7d > 10) trendDirection = "rising";
  else if (change7d < -30) trendDirection = "declining";
  else if (change7d < -10) trendDirection = "falling";

  return {
    keyword,
    currentInterest,
    change7d,
    change30d,
    trendDirection,
    timeSeries: timeSeries.slice(-30), // last 30 points
    relatedQueries,
    fetchedAt: new Date().toISOString(),
  };
}

// --- Get signals for all keywords in a category ---

export async function getGoogleTrendsSignals(
  category: "crypto" | "politics" | "sports" | "general"
): Promise<Record<string, GoogleTrendsSignal>> {
  const keywords = CATEGORY_KEYWORDS[category] ?? CATEGORY_KEYWORDS.general;
  const signals: Record<string, GoogleTrendsSignal> = {};

  // Fetch in parallel with error handling
  const results = await Promise.allSettled(
    keywords.map(async (kw) => {
      try {
        return await getKeywordSignal(kw);
      } catch (err) {
        console.error(`[GoogleTrends] Failed for "${kw}":`, err);
        return null;
      }
    })
  );

  for (let i = 0; i < keywords.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value) {
      signals[keywords[i]] = result.value;
    }
  }

  return signals;
}

// --- Get a single breakout keyword (highest change7d) ---

export async function getTopBreakoutKeyword(
  category: "crypto" | "politics" | "sports" | "general"
): Promise<{ keyword: string; change7d: number; currentInterest: number } | null> {
  const signals = await getGoogleTrendsSignals(category);
  let top: { keyword: string; change7d: number; currentInterest: number } | null = null;

  for (const [keyword, signal] of Object.entries(signals)) {
    if (!top || signal.change7d > top.change7d) {
      top = { keyword, change7d: signal.change7d, currentInterest: signal.currentInterest };
    }
  }

  return top;
}
