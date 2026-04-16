import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import { getGeoSignals, type GdeltToneSignal } from "../data-sources/gdelt";
import { getRegionalConflictSignals, type AcledConflictSignal } from "../data-sources/acled";
import { getKeyMacroSignals, type FredMacroSignal } from "../data-sources/fred";
import { getAllRegionalFireSignals, type FireSignal } from "../data-sources/nasa-firms";
import { getSportsSignals, type SportsSignal } from "../data-sources/sports-odds";
import { getCryptoSignals, getGlobalMarket, type CryptoSignal, type MarketOverview } from "../data-sources/coingecko";
import { getDeFiSignals, getSolanaTVL, type DeFiSignal } from "../data-sources/defillama";
import { withCircuitBreaker } from "../utils/circuit-breaker";

// ============================================================
// Agent-aware signal cache — fetch once per agent type, reuse
// ============================================================

const BASE_SIGNALS_KEY = "cache:signals:base";
const SPORTS_SIGNALS_KEY = "cache:signals:sports";
const CRYPTO_SIGNALS_KEY = "cache:signals:crypto";

const SIGNAL_CACHE_TTL: Record<string, number> = {
  base: 5 * 60,
  sports: 3 * 60,
  crypto: 60,
};

// --- Base signals (shared by politics + general agents) ---

export interface BaseSignals {
  gdelt: Record<string, GdeltToneSignal>;
  acled: Record<string, AcledConflictSignal>;
  fred: Record<string, FredMacroSignal>;
  fires: Record<string, FireSignal>;
  fetchedAt: string;
}

// --- Full signals (includes agent-specific data) ---

export interface SharedSignals {
  // Base signals (all agents get these)
  gdelt: Record<string, GdeltToneSignal>;
  acled: Record<string, AcledConflictSignal>;
  fred: Record<string, FredMacroSignal>;
  fires: Record<string, FireSignal>;

  // Agent-specific signals
  sports?: Record<string, SportsSignal>;
  crypto?: {
    prices: Record<string, CryptoSignal>;
    global: MarketOverview | null;
    defi: Awaited<ReturnType<typeof getDeFiSignals>>;
    solana: Awaited<ReturnType<typeof getSolanaTVL>>;
  };

  fetchedAt: string;
  agentType: string;
}

// --- Fetch base signals (GDELT, ACLED, FRED, NASA) ---

async function fetchBaseSignals(): Promise<BaseSignals> {
  const [gdelt, acled, fred, fires] = await Promise.allSettled([
    withCircuitBreaker("gdelt", () => getGeoSignals(), {} as Record<string, GdeltToneSignal>),
    withCircuitBreaker("acled", () => getRegionalConflictSignals(), {} as Record<string, AcledConflictSignal>),
    withCircuitBreaker("fred", () => getKeyMacroSignals(), {} as Record<string, FredMacroSignal>),
    withCircuitBreaker("firms", () => getAllRegionalFireSignals(), {} as Record<string, FireSignal>),
  ]);

  return {
    gdelt: gdelt.status === "fulfilled" ? gdelt.value : {},
    acled: acled.status === "fulfilled" ? acled.value : {},
    fred: fred.status === "fulfilled" ? fred.value : {},
    fires: fires.status === "fulfilled" ? fires.value : {},
    fetchedAt: new Date().toISOString(),
  };
}

// --- Fetch sports signals (The Odds API) ---

async function fetchSportsSignals(): Promise<Record<string, SportsSignal>> {
  try {
    return await getSportsSignals();
  } catch {
    return {};
  }
}

// --- Fetch crypto signals (CoinGecko + DeFiLlama) ---

async function fetchCryptoSignals(): Promise<SharedSignals["crypto"]> {
  try {
    const [prices, global, defi, solana] = await Promise.allSettled([
      getCryptoSignals(),
      getGlobalMarket(),
      getDeFiSignals(),
      getSolanaTVL(),
    ]);

    return {
      prices: prices.status === "fulfilled" ? prices.value : {},
      global: global.status === "fulfilled" ? global.value : null,
      defi: defi.status === "fulfilled" ? defi.value : { protocols: {}, solana: null },
      solana: solana.status === "fulfilled" ? solana.value : null,
    };
  } catch {
    return {
      prices: {},
      global: null,
      defi: { protocols: {}, solana: null },
      solana: null,
    };
  }
}

// --- Cache helper ---

async function getCachedOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds?: number
): Promise<T> {
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached) as T;
  }

  const fresh = await fetcher();
  const ttl = ttlSeconds ?? SIGNAL_CACHE_TTL.base;
  await redis.setex(key, ttl, JSON.stringify(fresh));
  return fresh;
}

// --- Get signals for an agent type ---

export async function getSharedSignals(
  agentType: string = "general"
): Promise<SharedSignals> {
  const base = await getCachedOrFetch(BASE_SIGNALS_KEY, fetchBaseSignals, SIGNAL_CACHE_TTL.base);

  const signals: SharedSignals = {
    ...base,
    agentType,
  };

  switch (agentType) {
    case "sports":
      signals.sports = await getCachedOrFetch(SPORTS_SIGNALS_KEY, fetchSportsSignals, SIGNAL_CACHE_TTL.sports);
      break;

    case "crypto":
      signals.crypto = await getCachedOrFetch(CRYPTO_SIGNALS_KEY, fetchCryptoSignals, SIGNAL_CACHE_TTL.crypto);
      break;

    case "politics":
      break;

    case "general":
      signals.sports = await getCachedOrFetch(SPORTS_SIGNALS_KEY, fetchSportsSignals, SIGNAL_CACHE_TTL.sports);
      signals.crypto = await getCachedOrFetch(CRYPTO_SIGNALS_KEY, fetchCryptoSignals, SIGNAL_CACHE_TTL.crypto);
      break;
  }

  console.log(
    `[Signals] Loaded ${agentType} signals (base + ${agentType === "sports" ? "sports" : agentType === "crypto" ? "crypto" : agentType === "general" ? "all" : "none"})`
  );

  return signals;
}

// --- Force refresh ---

export async function refreshSharedSignals(
  agentType: string = "general"
): Promise<SharedSignals> {
  await redis.del(BASE_SIGNALS_KEY);
  await redis.del(SPORTS_SIGNALS_KEY);
  await redis.del(CRYPTO_SIGNALS_KEY);
  return getSharedSignals(agentType);
}

// --- Check if cache is fresh ---

export async function isSignalCacheFresh(): Promise<boolean> {
  const ttl = await redis.ttl(BASE_SIGNALS_KEY);
  return ttl > 0;
}
