// --- CoinGecko Free API Integration ---
// No API key required for basic endpoints
// Rate limit: 10-30 calls/minute on free tier

import { cachedFetch } from "../utils/cache";

const BASE_URL = "https://api.coingecko.com/api/v3";

// --- Types ---

export interface CoinPrice {
  id: string;
  symbol: string;
  name: string;
  currentPrice: number;
  marketCap: number;
  volume24h: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  priceChangePercent7d: number;
  priceChangePercent30d: number;
  high24h: number;
  low24h: number;
  ath: number;
  athChangePercent: number;
  lastUpdated: string;
}

export interface CryptoSignal {
  coin: string;
  symbol: string;
  price: number;
  change24h: number;
  change7d: number;
  change30d: number;
  volume24h: number;
  marketCap: number;
  volumeChange: number;
  volatility: number;
  trend: "bullish" | "bearish" | "neutral";
  fetchedAt: string;
}

export interface MarketOverview {
  totalMarketCap: number;
  totalVolume24h: number;
  btcDominance: number;
  ethDominance: number;
  marketCapChange24h: number;
  activeCryptocurrencies: number;
  fearGreedIndex?: number;
  fetchedAt: string;
}

// --- Fetch top coins with market data ---

export async function getTopCoins(
  limit: number = 20,
  vsCurrency: string = "usd"
): Promise<CoinPrice[]> {
  return cachedFetch("coingecko", ["top", String(limit), vsCurrency], async () => {
    try {
      const url = `${BASE_URL}/coins/markets?vs_currency=${vsCurrency}&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=1h,24h,7d,30d`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
      const data: any = await res.json();

      return data.map((coin: any) => ({
        id: coin.id,
        symbol: coin.symbol?.toUpperCase(),
        name: coin.name,
        currentPrice: coin.current_price ?? 0,
        marketCap: coin.market_cap ?? 0,
        volume24h: coin.total_volume ?? 0,
        priceChange24h: coin.price_change_24h ?? 0,
        priceChangePercent24h: coin.price_change_percentage_24h ?? 0,
        priceChangePercent7d: coin.price_change_percentage_7d_in_currency ?? 0,
        priceChangePercent30d: coin.price_change_percentage_30d_in_currency ?? 0,
        high24h: coin.high_24h ?? 0,
        low24h: coin.low_24h ?? 0,
        ath: coin.ath ?? 0,
        athChangePercent: coin.ath_change_percentage ?? 0,
        lastUpdated: coin.last_updated ?? new Date().toISOString(),
      }));
    } catch (err) {
      console.error("CoinGecko getTopCoins failed:", err);
      return [];
    }
  });
}

// --- Get single coin data ---

export async function getCoinData(coinId: string): Promise<CoinPrice | null> {
  return cachedFetch("coingecko", ["coin", coinId], async () => {
    try {
      const url = `${BASE_URL}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
      const data: any = await res.json();

      const md = data.market_data;
      return {
        id: data.id,
        symbol: data.symbol?.toUpperCase(),
        name: data.name,
        currentPrice: md?.current_price?.usd ?? 0,
        marketCap: md?.market_cap?.usd ?? 0,
        volume24h: md?.total_volume?.usd ?? 0,
        priceChange24h: md?.price_change_24h ?? 0,
        priceChangePercent24h: md?.price_change_percentage_24h ?? 0,
        priceChangePercent7d: md?.price_change_percentage_7d ?? 0,
        priceChangePercent30d: md?.price_change_percentage_30d ?? 0,
        high24h: md?.high_24h?.usd ?? 0,
        low24h: md?.low_24h?.usd ?? 0,
        ath: md?.ath?.usd ?? 0,
        athChangePercent: md?.ath_change_percentage?.usd ?? 0,
        lastUpdated: data.last_updated ?? new Date().toISOString(),
      };
    } catch (err) {
      console.error("CoinGecko getCoinData failed:", err);
      return null;
    }
  });
}

// --- Get global crypto market overview ---

export async function getGlobalMarket(): Promise<MarketOverview | null> {
  return cachedFetch("coingecko", ["global"], async () => {
    try {
      const url = `${BASE_URL}/global`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
      const data: any = await res.json();
      const d = data.data;

      return {
        totalMarketCap: d?.total_market_cap?.usd ?? 0,
        totalVolume24h: d?.total_volume?.usd ?? 0,
        btcDominance: d?.market_cap_percentage?.btc ?? 0,
        ethDominance: d?.market_cap_percentage?.eth ?? 0,
        marketCapChange24h: d?.market_cap_change_percentage_24h_usd ?? 0,
        activeCryptocurrencies: d?.active_cryptocurrencies ?? 0,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.error("CoinGecko getGlobalMarket failed:", err);
      return null;
    }
  });
}

// --- Get price history for a coin ---

export async function getPriceHistory(
  coinId: string,
  days: number = 30,
  vsCurrency: string = "usd"
): Promise<Array<{ timestamp: number; price: number }>> {
  try {
    const url = `${BASE_URL}/coins/${coinId}/market_chart?vs_currency=${vsCurrency}&days=${days}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
    const data: any = await res.json();
    return (data.prices ?? []).map((p: [number, number]) => ({
      timestamp: p[0],
      price: p[1],
    }));
  } catch (err) {
    console.error("CoinGecko getPriceHistory failed:", err);
    return [];
  }
}

// --- Get trending coins ---

export async function getTrendingCoins(): Promise<Array<{ id: string; symbol: string; name: string; score: number }>> {
  try {
    const url = `${BASE_URL}/search/trending`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
    const data: any = await res.json();
    return (data.coins ?? []).map((c: any) => ({
      id: c.item?.id,
      symbol: c.item?.symbol?.toUpperCase(),
      name: c.item?.name,
      score: c.item?.score ?? 0,
    }));
  } catch (err) {
    console.error("CoinGecko getTrendingCoins failed:", err);
    return [];
  }
}

// --- Predefined crypto queries for signals ---

const CRYPTO_QUERIES = [
  { coin: "bitcoin", symbol: "BTC", label: "Bitcoin" },
  { coin: "ethereum", symbol: "ETH", label: "Ethereum" },
  { coin: "solana", symbol: "SOL", label: "Solana" },
  { coin: "ripple", symbol: "XRP", label: "XRP" },
  { coin: "cardano", symbol: "ADA", label: "Cardano" },
  { coin: "dogecoin", symbol: "DOGE", label: "Dogecoin" },
  { coin: "polkadot", symbol: "DOT", label: "Polkadot" },
  { coin: "avalanche-2", symbol: "AVAX", label: "Avalanche" },
];

// --- Build signals from coin data ---

export async function getCryptoSignals(): Promise<Record<string, CryptoSignal>> {
  const coins = await getTopCoins(20);
  const signals: Record<string, CryptoSignal> = {};

  for (const coin of coins) {
    const volatility = coin.high24h > 0 && coin.low24h > 0
      ? ((coin.high24h - coin.low24h) / coin.low24h) * 100
      : 0;

    const trend = coin.priceChangePercent24h > 2 ? "bullish"
      : coin.priceChangePercent24h < -2 ? "bearish"
      : "neutral";

    signals[coin.symbol] = {
      coin: coin.name,
      symbol: coin.symbol,
      price: coin.currentPrice,
      change24h: coin.priceChangePercent24h,
      change7d: coin.priceChangePercent7d,
      change30d: coin.priceChangePercent30d,
      volume24h: coin.volume24h,
      marketCap: coin.marketCap,
      volumeChange: 0,
      volatility: Math.round(volatility * 100) / 100,
      trend,
      fetchedAt: new Date().toISOString(),
    };
  }

  return signals;
}

// --- Get Solana-specific signals ---

export async function getSolanaSignals(): Promise<{
  price: CryptoSignal | null;
  global: MarketOverview | null;
}> {
  const [solData, globalData] = await Promise.allSettled([
    getCoinData("solana"),
    getGlobalMarket(),
  ]);

  let price: CryptoSignal | null = null;
  if (solData.status === "fulfilled" && solData.value) {
    const c = solData.value;
    const volatility = c.high24h > 0 && c.low24h > 0
      ? ((c.high24h - c.low24h) / c.low24h) * 100
      : 0;
    price = {
      coin: c.name,
      symbol: c.symbol,
      price: c.currentPrice,
      change24h: c.priceChangePercent24h,
      change7d: c.priceChangePercent7d,
      change30d: c.priceChangePercent30d,
      volume24h: c.volume24h,
      marketCap: c.marketCap,
      volumeChange: 0,
      volatility: Math.round(volatility * 100) / 100,
      trend: c.priceChangePercent24h > 2 ? "bullish" : c.priceChangePercent24h < -2 ? "bearish" : "neutral",
      fetchedAt: new Date().toISOString(),
    };
  }

  return {
    price,
    global: globalData.status === "fulfilled" ? globalData.value : null,
  };
}
