import { z } from "zod";
import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";

const ACLED_BASE_URL = "https://acleddata.com/api/acled/read";
const CACHE_TTL_SECONDS = 30 * 60; // 30 minutes

const ACLED_EMAIL = process.env.ACLED_EMAIL ?? "";
const ACLED_KEY = process.env.ACLED_KEY ?? "";

// --- Zod schemas ---

export const AcledEventSchema = z.object({
  event_id_cnty: z.string(),
  event_date: z.string(),
  year: z.number(),
  time_precision: z.number().optional(),
  disorder_type: z.string().optional(),
  event_type: z.string(),
  sub_event_type: z.string().optional(),
  actor1: z.string().optional(),
  assoc_actor_1: z.string().optional(),
  inter1: z.number().optional(),
  actor2: z.string().optional(),
  assoc_actor_2: z.string().optional(),
  inter2: z.number().optional(),
  interaction: z.number().optional(),
  civilian_targeting: z.string().optional(),
  country: z.string(),
  admin1: z.string().optional(),
  admin2: z.string().optional(),
  admin3: z.string().optional(),
  location: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
  geo_precision: z.number().optional(),
  source: z.string().optional(),
  source_scale: z.string().optional(),
  notes: z.string().optional(),
  fatalities: z.number(),
  tags: z.string().optional(),
  timestamp: z.number(),
});
export type AcledEvent = z.infer<typeof AcledEventSchema>;

export const AcledResponseSchema = z.object({
  success: z.boolean(),
  count: z.number(),
  data: z.array(AcledEventSchema),
  filename: z.string().optional(),
});
export type AcledResponse = z.infer<typeof AcledResponseSchema>;

// --- Search parameters ---

export interface AcledSearchParams {
  country?: string;
  region?: string;
  eventType?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  limit?: number;
}

// --- Conflict signal (aggregated for agents) ---

export interface AcledConflictSignal {
  totalEvents: number;
  totalFatalities: number;
  eventsByType: Record<string, number>;
  topCountries: Array<{ country: string; events: number; fatalities: number }>;
  delta7d: number; // % change vs 7-day average
  timestamp: string;
}

// --- Core search ---

export async function searchAcled(
  params: AcledSearchParams
): Promise<AcledResponse> {
  const {
    country,
    region,
    eventType,
    startDate,
    endDate,
    limit = 5000,
  } = params;

  const cacheKey = `${REDIS_KEYS.ACLED_CACHE}:${JSON.stringify(params)}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as AcledResponse;
  }

  const searchParams = new URLSearchParams();
  if (ACLED_EMAIL) searchParams.set("email", ACLED_EMAIL);
  if (ACLED_KEY) searchParams.set("key", ACLED_KEY);
  if (country) searchParams.set("country", country);
  if (region) searchParams.set("region", region);
  if (eventType) searchParams.set("event_type", eventType);
  if (startDate) searchParams.set("event_date", startDate);
  if (endDate) searchParams.set("event_date_where", `<${endDate}`);
  searchParams.set("limit", String(limit));

  const url = `${ACLED_BASE_URL}?${searchParams.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`ACLED API error ${response.status}: ${await response.text()}`);
  }

  const raw: unknown = await response.json();
  const rawObj = raw as Record<string, unknown>;

  const parsed: AcledResponse = {
    success: (rawObj.success as boolean) ?? true,
    count: (rawObj.count as number) ?? ((rawObj.data as AcledEvent[])?.length ?? 0),
    data: (rawObj.data as AcledEvent[]) ?? [],
  };

  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(parsed));
  return parsed;
}

// --- Conflict signal (for agent decision-making) ---

export async function getConflictSignal(
  country?: string,
  days: number = 30
): Promise<AcledConflictSignal> {
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - days * 86400000)
    .toISOString()
    .slice(0, 10);

  const cacheKey = `${REDIS_KEYS.ACLED_CACHE}:signal:${country ?? "global"}:${days}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as AcledConflictSignal;
  }

  const current = await searchAcled({ country, startDate, endDate });
  const prevEndDate = startDate;
  const prevStartDate = new Date(Date.now() - days * 2 * 86400000)
    .toISOString()
    .slice(0, 10);
  const previous = await searchAcled({
    country,
    startDate: prevStartDate,
    endDate: prevEndDate,
  });

  // Aggregate
  const eventsByType: Record<string, number> = {};
  const countryMap: Record<string, { events: number; fatalities: number }> = {};
  let totalFatalities = 0;

  for (const event of current.data) {
    eventsByType[event.event_type] =
      (eventsByType[event.event_type] ?? 0) + 1;
    totalFatalities += event.fatalities;

    if (!countryMap[event.country]) {
      countryMap[event.country] = { events: 0, fatalities: 0 };
    }
    countryMap[event.country].events++;
    countryMap[event.country].fatalities += event.fatalities;
  }

  const topCountries = Object.entries(countryMap)
    .map(([country, data]) => ({ country, ...data }))
    .sort((a, b) => b.fatalities - a.fatalities)
    .slice(0, 10);

  const prevCount = previous.data.length;
  const delta7d =
    prevCount > 0
      ? ((current.data.length - prevCount) / prevCount) * 100
      : 0;

  const signal: AcledConflictSignal = {
    totalEvents: current.data.length,
    totalFatalities,
    eventsByType,
    topCountries,
    delta7d: Math.round(delta7d * 100) / 100,
    timestamp: new Date().toISOString(),
  };

  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(signal));
  return signal;
}

// --- Predefined geo regions for Geo Agent ---

export const ACLED_GEO_REGIONS = {
  MIDDLE_EAST: [
    "Israel", "Palestine", "Iran", "Iraq", "Syria", "Yemen", "Saudi Arabia",
    "Lebanon", "Jordan",
  ],
  EASTERN_EUROPE: ["Ukraine", "Russia", "Belarus"],
  AFRICA_SAHARA: ["Nigeria", "Mali", "Niger", "Chad", "Sudan", "Ethiopia"],
  SOUTH_ASIA: ["India", "Pakistan", "Afghanistan", "Bangladesh", "Myanmar"],
  EAST_ASIA: ["Taiwan", "South Korea", "Japan", "China"],
} as const;

export async function getRegionalConflictSignals(): Promise<
  Record<string, AcledConflictSignal>
> {
  const results: Record<string, AcledConflictSignal> = {};

  for (const [region, countries] of Object.entries(ACLED_GEO_REGIONS)) {
    const signals = await Promise.allSettled(
      countries.map((c) => getConflictSignal(c, 30))
    );

    let totalEvents = 0;
    let totalFatalities = 0;
    let deltaSum = 0;
    let deltaCount = 0;

    for (const s of signals) {
      if (s.status === "fulfilled") {
        totalEvents += s.value.totalEvents;
        totalFatalities += s.value.totalFatalities;
        deltaSum += s.value.delta7d;
        deltaCount++;
      }
    }

    results[region] = {
      totalEvents,
      totalFatalities,
      eventsByType: {},
      topCountries: [],
      delta7d: deltaCount > 0 ? Math.round((deltaSum / deltaCount) * 100) / 100 : 0,
      timestamp: new Date().toISOString(),
    };
  }

  return results;
}
