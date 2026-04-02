import { z } from "zod";
import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";

const FRED_BASE_URL = "https://api.stlouisfed.org/fred";
const FRED_API_KEY = process.env.FRED_API_KEY ?? "";
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour (FRED data updates daily)

// --- Zod schemas ---

export const FredObservationSchema = z.object({
  realtime_start: z.string(),
  realtime_end: z.string(),
  date: z.string(),
  value: z.string(),
});
export type FredObservation = z.infer<typeof FredObservationSchema>;

export const FredSeriesSchema = z.object({
  id: z.string(),
  realtime_start: z.string(),
  realtime_end: z.string(),
  title: z.string(),
  observation_start: z.string(),
  observation_end: z.string(),
  frequency: z.string(),
  units: z.string(),
  seasonal_adjustment: z.string(),
  last_updated: z.string(),
  popularity: z.number(),
  notes: z.string().optional(),
});
export type FredSeries = z.infer<typeof FredSeriesSchema>;

export const FredObservationsResponseSchema = z.object({
  realtime_start: z.string(),
  realtime_end: z.string(),
  observation_start: z.string(),
  observation_end: z.string(),
  units: z.string(),
  order_by: z.string(),
  sort_order: z.string(),
  count: z.number(),
  offset: z.number(),
  limit: z.number(),
  observations: z.array(FredObservationSchema),
});
export type FredObservationsResponse = z.infer<typeof FredObservationsResponseSchema>;

// --- Macro signal (aggregated for agents) ---

export interface FredMacroSignal {
  seriesId: string;
  title: string;
  latestValue: number;
  latestDate: string;
  previousValue: number;
  changePercent: number;
  trend: "up" | "down" | "stable";
  timestamp: string;
}

// --- Core API calls ---

export async function getSeriesObservations(
  seriesId: string,
  limit: number = 12
): Promise<FredObservationsResponse> {
  const cacheKey = `${REDIS_KEYS.FRED_CACHE}:${seriesId}:${limit}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as FredObservationsResponse;
  }

  const searchParams = new URLSearchParams({
    series_id: seriesId,
    api_key: FRED_API_KEY,
    file_type: "json",
    sort_order: "desc",
    limit: String(limit),
  });

  const url = `${FRED_BASE_URL}/series/observations?${searchParams.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`FRED API error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const parsed = FredObservationsResponseSchema.parse(data);

  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(parsed));
  return parsed;
}

export async function getSeriesInfo(seriesId: string): Promise<FredSeries> {
  const cacheKey = `${REDIS_KEYS.FRED_CACHE}:info:${seriesId}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as FredSeries;
  }

  const searchParams = new URLSearchParams({
    series_id: seriesId,
    api_key: FRED_API_KEY,
    file_type: "json",
  });

  const url = `${FRED_BASE_URL}/series?${searchParams.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`FRED API error ${response.status}: ${await response.text()}`);
  }

  const data: unknown = await response.json();
  const series = (data as Record<string, unknown>).series as Record<string, unknown>[] | undefined;
  const firstSeries = series?.[0];
  if (!firstSeries) {
    throw new Error(`FRED series ${seriesId} not found`);
  }

  const parsed = FredSeriesSchema.parse(firstSeries);
  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(parsed));
  return parsed;
}

// --- Macro signal (for agent decision-making) ---

export async function getMacroSignal(
  seriesId: string
): Promise<FredMacroSignal> {
  const cacheKey = `${REDIS_KEYS.FRED_CACHE}:signal:${seriesId}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as FredMacroSignal;
  }

  const [observations, info] = await Promise.all([
    getSeriesObservations(seriesId, 2),
    getSeriesInfo(seriesId),
  ]);

  const latest = observations.observations[0];
  const previous = observations.observations[1];

  const latestValue = Number(latest?.value ?? 0);
  const previousValue = Number(previous?.value ?? latestValue);
  const changePercent =
    previousValue !== 0
      ? ((latestValue - previousValue) / Math.abs(previousValue)) * 100
      : 0;

  const signal: FredMacroSignal = {
    seriesId,
    title: info.title,
    latestValue,
    latestDate: latest?.date ?? "",
    previousValue,
    changePercent: Math.round(changePercent * 10000) / 10000,
    trend:
      changePercent > 0.1 ? "up" : changePercent < -0.1 ? "down" : "stable",
    timestamp: new Date().toISOString(),
  };

  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(signal));
  return signal;
}

// --- Key series for Geo Agent ---

export const FRED_KEY_SERIES = {
  CPI: "CPIAUCSL", // Consumer Price Index (inflation)
  UNEMPLOYMENT: "UNRATE", // Unemployment Rate
  GDP: "GDP", // Gross Domestic Product
  FEDERAL_FUNDS: "FEDFUNDS", // Federal Funds Rate
  TREASURY_10Y: "DGS10", // 10-Year Treasury Yield
  TREASURY_2Y: "DGS2", // 2-Year Treasury Yield
  INFLATION_EXPECTATIONS: "T10YIE", // 10Y Breakeven Inflation
  SP500: "SP500", // S&P 500
  OIL_PRICE: "DCOILWTICO", // WTI Crude Oil
  CONSUMER_SENTIMENT: "UMCSENT", // U. of Michigan Consumer Sentiment
  INITIAL_CLAIMS: "ICSA", // Initial Jobless Claims
  HOUSING_STARTS: "HOUST", // Housing Starts
  INDUSTRIAL_PRODUCTION: "INDPRO", // Industrial Production
  TRADE_BALANCE: "BOPGSTB", // Trade Balance: Goods and Services
  M2_MONEY_SUPPLY: "M2SL", // M2 Money Supply
} as const;

// --- Batch macro signals ---

export async function getKeyMacroSignals(): Promise<
  Record<string, FredMacroSignal>
> {
  const results: Record<string, FredMacroSignal> = {};
  const entries = Object.entries(FRED_KEY_SERIES);

  const signals = await Promise.allSettled(
    entries.map(([, seriesId]) => getMacroSignal(seriesId))
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

// --- Search series ---

export async function searchFredSeries(
  searchText: string,
  limit: number = 20
): Promise<FredSeries[]> {
  const cacheKey = `${REDIS_KEYS.FRED_CACHE}:search:${searchText}:${limit}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as FredSeries[];
  }

  const searchParams = new URLSearchParams({
    search_text: searchText,
    api_key: FRED_API_KEY,
    file_type: "json",
    limit: String(limit),
  });

  const url = `${FRED_BASE_URL}/series/search?${searchParams.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`FRED API error ${response.status}: ${await response.text()}`);
  }

  const data: unknown = await response.json();
  const rawSeries = ((data as Record<string, unknown>).series ?? []) as unknown[];
  const series: FredSeries[] = rawSeries.map((s: unknown) =>
    FredSeriesSchema.parse(s)
  );

  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(series));
  return series;
}
