// --- DeFiLlama Free API Integration ---
// No API key required
// Rate limit: 300 requests/5min

import { cachedFetch } from "../utils/cache";

const BASE_URL = "https://api.llama.fi";
const STABLECOINS_URL = "https://stablecoins.llama.fi";
const YIELDS_URL = "https://yields.llama.fi";

// --- Types ---

export interface ProtocolTVL {
  name: string;
  slug: string;
  tvl: number;
  tvlChange1d: number;
  tvlChange7d: number;
  tvlChange30d: number;
  category: string;
  chains: string[];
  fetchedAt: string;
}

export interface ChainTVL {
  name: string;
  tvl: number;
  tokenSymbol: string;
  tvlChange1d: number;
  tvlChange7d: number;
  fetchedAt: string;
}

export interface StablecoinData {
  name: string;
  symbol: string;
  pegType: string;
  circulating: number;
  chains: string[];
  price: number;
}

export interface DeFiSignal {
  protocol: string;
  tvl: number;
  tvlChange7d: number;
  category: string;
  trend: "growing" | "declining" | "stable";
}

// --- Get top protocols by TVL ---

export async function getTopProtocols(limit: number = 20): Promise<ProtocolTVL[]> {
  return cachedFetch("defillama", ["protocols", String(limit)], async () => {
    try {
      const res = await fetch(`${BASE_URL}/protocols`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`DeFiLlama error: ${res.status}`);
      const data: any = await res.json();

      return data
        .filter((p: any) => p.tvl > 0)
        .sort((a: any, b: any) => b.tvl - a.tvl)
        .slice(0, limit)
        .map((p: any) => ({
          name: p.name,
          slug: p.slug,
          tvl: p.tvl ?? 0,
          tvlChange1d: p.change_1d ?? 0,
          tvlChange7d: p.change_7d ?? 0,
          tvlChange30d: p.change_1m ?? 0,
          category: p.category ?? "Unknown",
          chains: p.chains ?? [],
          fetchedAt: new Date().toISOString(),
        }));
    } catch (err) {
      console.error("DeFiLlama getTopProtocols failed:", err);
      return [];
    }
  });
}

// --- Get chain TVLs ---

export async function getChainTVLs(limit: number = 15): Promise<ChainTVL[]> {
  return cachedFetch("defillama", ["chains", String(limit)], async () => {
    try {
      const res = await fetch(`${BASE_URL}/v2/chains`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`DeFiLlama error: ${res.status}`);
      const data: any = await res.json();

      return data
        .filter((c: any) => c.tvl > 0)
        .sort((a: any, b: any) => b.tvl - a.tvl)
        .slice(0, limit)
        .map((c: any) => ({
          name: c.name,
          tvl: c.tvl ?? 0,
          tokenSymbol: c.tokenSymbol ?? "",
          tvlChange1d: 0,
          tvlChange7d: 0,
          fetchedAt: new Date().toISOString(),
        }));
    } catch (err) {
      console.error("DeFiLlama getChainTVLs failed:", err);
      return [];
    }
  });
}

// --- Get Solana-specific TVL ---

export async function getSolanaTVL(): Promise<{
  totalTvl: number;
  topProtocols: ProtocolTVL[];
  tvlChange7d: number;
} | null> {
  try {
    const res = await fetch(`${BASE_URL}/v2/chains`);
    if (!res.ok) throw new Error(`DeFiLlama error: ${res.status}`);
    const chains: any = await res.json();
    const solana = chains.find((c: any) => c.name === "Solana");

    if (!solana) return null;

    // Get Solana protocols
    const protocolsRes = await fetch(`${BASE_URL}/protocols`);
    const protocols: any = await protocolsRes.json();
    const solProtocols = protocols
      .filter((p: any) => p.chains?.includes("Solana") && p.tvl > 0)
      .sort((a: any, b: any) => b.tvl - a.tvl)
      .slice(0, 10)
      .map((p: any) => ({
        name: p.name,
        slug: p.slug,
        tvl: p.tvl ?? 0,
        tvlChange1d: p.change_1d ?? 0,
        tvlChange7d: p.change_7d ?? 0,
        tvlChange30d: p.change_1m ?? 0,
        category: p.category ?? "Unknown",
        chains: p.chains ?? [],
        fetchedAt: new Date().toISOString(),
      }));

    const avgChange = solProtocols.length > 0
      ? solProtocols.reduce((sum: number, p: ProtocolTVL) => sum + p.tvlChange7d, 0) / solProtocols.length
      : 0;

    return {
      totalTvl: solana.tvl,
      topProtocols: solProtocols,
      tvlChange7d: Math.round(avgChange * 100) / 100,
    };
  } catch (err) {
    console.error("DeFiLlama getSolanaTVL failed:", err);
    return null;
  }
}

// --- Get stablecoin data ---

export async function getStablecoinData(): Promise<StablecoinData[]> {
  try {
    const res = await fetch(`${STABLECOINS_URL}/stablecoins?includePrices=true`);
    if (!res.ok) throw new Error(`DeFiLlama error: ${res.status}`);
    const data: any = await res.json();

    return (data.peggedAssets ?? [])
      .filter((s: any) => s.circulating?.peggedUSD > 100_000_000)
      .sort((a: any, b: any) => (b.circulating?.peggedUSD ?? 0) - (a.circulating?.peggedUSD ?? 0))
      .slice(0, 10)
      .map((s: any) => ({
        name: s.name,
        symbol: s.symbol,
        pegType: s.pegType,
        circulating: s.circulating?.peggedUSD ?? 0,
        chains: Object.keys(s.chainCirculating ?? {}),
        price: s.price ?? 1,
      }));
  } catch (err) {
    console.error("DeFiLlama getStablecoinData failed:", err);
    return [];
  }
}

// --- Get DeFi yields ---

export async function getTopYields(limit: number = 10): Promise<Array<{
  pool: string;
  project: string;
  chain: string;
  tvl: number;
  apy: number;
  symbol: string;
}>> {
  try {
    const res = await fetch(`${YIELDS_URL}/pools`);
    if (!res.ok) throw new Error(`DeFiLlama error: ${res.status}`);
    const data: any = await res.json();

    return (data.data ?? [])
      .filter((p: any) => p.tvlUsd > 1_000_000 && p.apy > 0)
      .sort((a: any, b: any) => b.tvlUsd - a.tvlUsd)
      .slice(0, limit)
      .map((p: any) => ({
        pool: p.pool,
        project: p.project,
        chain: p.chain,
        tvl: p.tvlUsd ?? 0,
        apy: p.apy ?? 0,
        symbol: p.symbol ?? "",
      }));
  } catch (err) {
    console.error("DeFiLlama getTopYields failed:", err);
    return [];
  }
}

// --- Build DeFi signals ---

export async function getDeFiSignals(): Promise<{
  protocols: Record<string, DeFiSignal>;
  solana: { totalTvl: number; change7d: number } | null;
}> {
  const [protocols, solanaTvl] = await Promise.allSettled([
    getTopProtocols(15),
    getSolanaTVL(),
  ]);

  const protocolSignals: Record<string, DeFiSignal> = {};
  if (protocols.status === "fulfilled") {
    for (const p of protocols.value) {
      const trend = p.tvlChange7d > 5 ? "growing"
        : p.tvlChange7d < -5 ? "declining"
        : "stable";
      protocolSignals[p.name] = {
        protocol: p.name,
        tvl: p.tvl,
        tvlChange7d: p.tvlChange7d,
        category: p.category,
        trend,
      };
    }
  }

  return {
    protocols: protocolSignals,
    solana: solanaTvl.status === "fulfilled" && solanaTvl.value
      ? { totalTvl: solanaTvl.value.totalTvl, change7d: solanaTvl.value.tvlChange7d }
      : null,
  };
}
