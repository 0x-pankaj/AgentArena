import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";

const FIRMS_BASE_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const FIRMS_MAP_KEY = process.env.NASA_FIRMS_MAP_KEY ?? "";
const CACHE_TTL_SECONDS = 30 * 60; // 30 minutes

// --- Types (parsed from CSV) ---

export interface FireHotspot {
  latitude: number;
  longitude: number;
  brightness: number;
  scan: number;
  track: number;
  acqDate: string;
  acqTime: string;
  satellite: string;
  confidence: number;
  version: string;
  brightT31: number;
  frp: number; // Fire Radiative Power (MW)
  daynight: "D" | "N";
}

export interface FireSignal {
  region: string;
  hotspotCount: number;
  avgConfidence: number;
  totalFrp: number;
  hotspots: FireHotspot[];
  timestamp: string;
}

// --- Parse CSV response ---

function parseFirmsCsv(csv: string): FireHotspot[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const hotspots: FireHotspot[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    if (values.length < headers.length) continue;

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j]?.trim() ?? "";
    }

    hotspots.push({
      latitude: Number(row.latitude ?? 0),
      longitude: Number(row.longitude ?? 0),
      brightness: Number(row.brightness ?? 0),
      scan: Number(row.scan ?? 0),
      track: Number(row.track ?? 0),
      acqDate: row.acq_date ?? "",
      acqTime: row.acq_time ?? "",
      satellite: row.satellite ?? "",
      confidence: Number(row.confidence ?? 0),
      version: row.version ?? "",
      brightT31: Number(row.bright_t31 ?? 0),
      frp: Number(row.frp ?? 0),
      daynight: (row.daynight ?? "D") as "D" | "N",
    });
  }

  return hotspots;
}

// --- Core fetch ---

export async function getFireHotspots(
  area: string = "-180,-90,180,90", // global by default
  days: number = 1,
  source: string = "VIIRS_SNPP_NRT"
): Promise<FireHotspot[]> {
  const cacheKey = `${REDIS_KEYS.FIRMS_CACHE}:${area}:${days}:${source}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as FireHotspot[];
  }

  const url = `${FIRMS_BASE_URL}/${source}/${area}/${days}?api_key=${FIRMS_MAP_KEY}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `NASA FIRMS API error ${response.status}: ${await response.text()}`
    );
  }

  const csv = await response.text();
  const hotspots = parseFirmsCsv(csv);

  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(hotspots));
  return hotspots;
}

// --- Regional fire signal (for Geo Agent) ---

const FIRE_REGIONS: Record<string, string> = {
  CALIFORNIA: "-124.5,32.5,-114.1,42.0",
  AMAZON: "-80,-20,-35,5",
  AUSTRALIA: "113,-44,154,-10",
  SIBERIA: "60,50,180,75",
  MEDITERRANEAN: "-6,35,36,46",
  INDONESIA: "95,-11,141,6",
  CANADA: "-141,42,-52,83",
};

export async function getRegionalFireSignal(
  region: string
): Promise<FireSignal | null> {
  const bounds = FIRE_REGIONS[region];
  if (!bounds) return null;

  const cacheKey = `${REDIS_KEYS.FIRMS_CACHE}:signal:${region}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as FireSignal;
  }

  try {
    const hotspots = await getFireHotspots(bounds, 1);

    const avgConfidence =
      hotspots.length > 0
        ? hotspots.reduce((s, h) => s + h.confidence, 0) / hotspots.length
        : 0;

    const totalFrp = hotspots.reduce((s, h) => s + h.frp, 0);

    const signal: FireSignal = {
      region,
      hotspotCount: hotspots.length,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      totalFrp: Math.round(totalFrp * 100) / 100,
      hotspots: hotspots.slice(0, 20),
      timestamp: new Date().toISOString(),
    };

    await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(signal));
    return signal;
  } catch {
    return null;
  }
}

// --- All regions fire signals ---

export async function getAllRegionalFireSignals(): Promise<
  Record<string, FireSignal>
> {
  const results: Record<string, FireSignal> = {};
  const entries = Object.keys(FIRE_REGIONS);

  const signals = await Promise.allSettled(
    entries.map((region) => getRegionalFireSignal(region))
  );

  for (let i = 0; i < entries.length; i++) {
    const result = signals[i];
    if (result.status === "fulfilled" && result.value) {
      results[entries[i]] = result.value;
    }
  }

  return results;
}
