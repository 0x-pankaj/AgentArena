import { z } from "zod";
import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";

const GDELT_BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes

// --- Zod schemas ---

export const GdeltArticleSchema = z.object({
  url: z.string(),
  url_mobile: z.string().optional(),
  title: z.string(),
  seendate: z.string(),
  socialimage: z.string().optional(),
  domain: z.string(),
  language: z.string().optional(),
  sourcecountry: z.string().optional(),
});
export type GdeltArticle = z.infer<typeof GdeltArticleSchema>;

export const GdeltResponseSchema = z.object({
  articles: z.array(GdeltArticleSchema).optional(),
  timeseries: z
    .array(
      z.object({
        date: z.string(),
        value: z.number(),
      })
    )
    .optional(),
});
export type GdeltResponse = z.infer<typeof GdeltResponseSchema>;

// --- Search parameters ---

export interface GdeltSearchParams {
  query: string;
  mode?: "artlist" | "timelinevol" | "timelinetone" | "tonechart";
  maxRecords?: number;
  timespan?: string; // e.g. "24h", "7d"
  format?: "json";
}

// --- GDELT tone summary (aggregated signal for agents) ---

export interface GdeltToneSignal {
  avgTone: number; // -100 to +100
  articleCount: number;
  topArticles: Array<{ title: string; url: string; tone: number }>;
  timestamp: string;
}

// --- Core search ---

export async function searchGdelt(
  params: GdeltSearchParams
): Promise<GdeltResponse> {
  const {
    query,
    mode = "artlist",
    maxRecords = 25,
    timespan = "24h",
    format = "json",
  } = params;

  const cacheKey = `${REDIS_KEYS.GDELT_CACHE}:${mode}:${query}:${timespan}:${maxRecords}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as GdeltResponse;
  }

  const searchParams = new URLSearchParams({
    query,
    mode,
    maxrecords: String(maxRecords),
    timespan,
    format,
  });

  const url = `${GDELT_BASE_URL}?${searchParams.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`GDELT API error ${response.status}: ${await response.text()}`);
  }

  const data: unknown = await response.json();

  // GDELT returns articles array directly or timeseries data
  const parsed: GdeltResponse = {
    articles: Array.isArray(data) ? data : (data as Record<string, unknown>).articles ? (data as Record<string, unknown>).articles as GdeltArticle[] : [],
    timeseries: (data as Record<string, unknown>).timeseries as GdeltResponse["timeseries"] ?? undefined,
  };

  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(parsed));
  return parsed;
}

// --- Tone analysis (for agent decision signals) ---

export async function getGdeltToneSignal(
  topic: string,
  timespan: string = "24h"
): Promise<GdeltToneSignal> {
  const cacheKey = `${REDIS_KEYS.GDELT_CACHE}:tone:${topic}:${timespan}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as GdeltToneSignal;
  }

  // Fetch tone timeline
  const timeline = await searchGdelt({
    query: topic,
    mode: "timelinetone",
    timespan,
    maxRecords: 100,
  });

  // Fetch articles for context
  const articles = await searchGdelt({
    query: topic,
    mode: "artlist",
    timespan,
    maxRecords: 10,
  });

  // Calculate average tone from timeseries
  const toneValues = timeline.timeseries ?? [];
  const avgTone =
    toneValues.length > 0
      ? toneValues.reduce((sum, t) => sum + t.value, 0) / toneValues.length
      : 0;

  const signal: GdeltToneSignal = {
    avgTone: Math.round(avgTone * 100) / 100,
    articleCount: articles.articles?.length ?? 0,
    topArticles: (articles.articles ?? []).slice(0, 5).map((a) => ({
      title: a.title,
      url: a.url,
      tone: 0, // individual article tone not available in v2 DOC API
    })),
    timestamp: new Date().toISOString(),
  };

  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(signal));
  return signal;
}

// --- Predefined geo queries (for Geo Agent) ---

export const GDELT_GEO_QUERIES = {
  MIDDLE_EAST_CONFLICT: 'sourcecountry:EG OR sourcecountry:IL OR sourcecountry:IR OR sourcecountry:SA theme:"CONFLICT"',
  UKRAINE_RUSSIA: 'sourcecountry:UA OR sourcecountry:RU theme:"MILITARY"',
  TRADE_WAR: 'theme:"TRADE" OR theme:"TARIFF"',
  NATURAL_DISASTER: 'theme:"DISASTER" OR theme:"EARTHQUAKE" OR theme:"FLOOD"',
  PANDEMIC: 'theme:"HEALTH" OR theme:"PANDEMIC" OR theme:"EPIDEMIC"',
  ELECTION: 'theme:"ELECTION" OR theme:"POLITICAL"',
  ECONOMIC_CRISIS: 'theme:"ECON_CRISIS" OR theme:"RECESSION"',
  CLIMATE: 'theme:"CLIMATE" OR theme:"EMISSIONS"',
} as const;

export async function getGeoSignals(): Promise<Record<string, GdeltToneSignal>> {
  const results: Record<string, GdeltToneSignal> = {};
  const entries = Object.entries(GDELT_GEO_QUERIES);

  const signals = await Promise.allSettled(
    entries.map(([key, query]) => getGdeltToneSignal(query, "24h"))
  );

  for (let i = 0; i < entries.length; i++) {
    const [key] = entries[i];
    const result = signals[i];
    if (result.status === "fulfilled") {
      results[key] = result.value;
    }
  }

  return results;
}
