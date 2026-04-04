import { z } from "zod";
import type { AgentTool } from "./types";
import {
  searchGdelt,
  getGdeltToneSignal,
  getGeoSignals,
} from "../data-sources/gdelt";
import {
  searchAcled,
  getConflictSignal,
  getRegionalConflictSignals,
} from "../data-sources/acled";
import {
  getSeriesObservations,
  getMacroSignal,
  getKeyMacroSignals,
} from "../data-sources/fred";
import {
  getRegionalFireSignal,
  getAllRegionalFireSignals,
} from "../data-sources/nasa-firms";
import { jupiterPredict } from "../plugins/polymarket-plugin";
import { getTrendingMarkets, getMarket } from "../services/market-service";
import {
  searchTweets,
  getSocialSignal,
  getUserTweets,
  getKeyAccountSignals,
} from "../data-sources/twitter";
import { webSearch } from "../services/web-search";
import { getTopCoins, getCoinData, getGlobalMarket, getTrendingCoins, getCryptoSignals } from "../data-sources/coingecko";
import { getTopProtocols, getChainTVLs, getSolanaTVL, getDeFiSignals } from "../data-sources/defillama";

// --- Helper to create AgentTool entries ---

function makeTool(params: {
  name: string;
  description: string;
  schema: z.ZodType;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
  costPerCall?: number;
}): AgentTool {
  return {
    name: params.name,
    description: params.description,
    parameters: params.schema,
    execute: params.execute,
    costPerCall: params.costPerCall,
  };
}

// --- Web search (real implementation) ---

export const webSearchTool = makeTool({
  name: "web_search",
  description: "Search the web for real-time information using Exa AI (news-focused) with GDELT fallback.",
  schema: z.object({ query: z.string(), maxResults: z.number().default(10) }),
  execute: async ({ query, maxResults }) => {
    const results = await webSearch(String(query), Number(maxResults) || 10);
    return results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      source: r.source,
      date: r.date,
    }));
  },
  costPerCall: 0,
});

// --- GDELT tools ---

export const gdeltSearchTool = makeTool({
  name: "gdelt_search",
  description: "Search GDELT global news for articles and tone analysis.",
  schema: z.object({
    query: z.string(),
    timespan: z.string().default("24h"),
    mode: z.enum(["artlist", "timelinetone"]).default("artlist"),
  }),
  execute: async ({ query, timespan, mode }) => {
    const result = await searchGdelt({ query: String(query), timespan: String(timespan), mode: mode as "artlist" | "timelinetone", maxRecords: 10 });
    return {
      articles: result.articles?.slice(0, 10).map(a => ({
        title: a.title, url: a.url, date: a.seendate, source: a.domain,
      })),
      timeseries: result.timeseries,
    };
  },
});

export const gdeltToneTool = makeTool({
  name: "gdelt_tone",
  description: "Get aggregated GDELT tone signal for a topic (-100 to +100).",
  schema: z.object({ topic: z.string(), timespan: z.string().default("24h") }),
  execute: async ({ topic, timespan }) => getGdeltToneSignal(String(topic), String(timespan)),
});

export const gdeltAllSignalsTool = makeTool({
  name: "gdelt_all_signals",
  description: "Get GDELT tone signals for all predefined geopolitical regions.",
  schema: z.object({}),
  execute: () => getGeoSignals(),
});

// --- ACLED tools ---

export const acledSearchTool = makeTool({
  name: "acled_search",
  description: "Search ACLED conflict database for armed conflict events.",
  schema: z.object({
    country: z.string().optional(),
    eventType: z.string().optional(),
    days: z.number().default(30),
  }),
  execute: async ({ country, eventType, days }) => {
    const d = Number(days) || 30;
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const result = await searchAcled({ country: country as string | undefined, eventType: eventType as string | undefined, startDate, endDate, limit: 100 });
    return {
      totalEvents: result.count,
      events: result.data.slice(0, 20).map(e => ({
        date: e.event_date, type: e.event_type, country: e.country,
        location: e.location, fatalities: e.fatalities,
        notes: e.notes?.slice(0, 200),
      })),
    };
  },
});

export const acledConflictSignalTool = makeTool({
  name: "acled_conflict_signal",
  description: "Get conflict escalation signal for a country.",
  schema: z.object({ country: z.string().optional(), days: z.number().default(30) }),
  execute: async ({ country, days }) => getConflictSignal(country as string | undefined, Number(days) || 30),
});

export const acledRegionalTool = makeTool({
  name: "acled_regional",
  description: "Get conflict signals for all predefined regions.",
  schema: z.object({}),
  execute: () => getRegionalConflictSignals(),
});

// --- FRED tools ---

export const fredSeriesTool = makeTool({
  name: "fred_series",
  description: "Get FRED economic data for a series (CPI, GDP, unemployment, etc.).",
  schema: z.object({ seriesId: z.string(), limit: z.number().default(12) }),
  execute: async ({ seriesId, limit }) => {
    const result = await getSeriesObservations(String(seriesId), Number(limit) || 12);
    return { seriesId, observations: result.observations.slice(0, 10) };
  },
});

export const fredMacroSignalTool = makeTool({
  name: "fred_macro_signal",
  description: "Get macro signal for a FRED series (trend, percent change).",
  schema: z.object({ seriesId: z.string() }),
  execute: async ({ seriesId }) => getMacroSignal(String(seriesId)),
});

export const fredAllSignalsTool = makeTool({
  name: "fred_all_signals",
  description: "Get signals for all key FRED economic indicators.",
  schema: z.object({}),
  execute: () => getKeyMacroSignals(),
});

// --- NASA FIRMS tools ---

export const firmsHotspotsTool = makeTool({
  name: "firms_hotspots",
  description: "Get NASA satellite fire detection data for a region.",
  schema: z.object({
    region: z.enum(["CALIFORNIA", "AMAZON", "AUSTRALIA", "SIBERIA", "MEDITERRANEAN", "INDONESIA", "CANADA"]),
  }),
  execute: async ({ region }) => getRegionalFireSignal(String(region)),
});

export const firmsAllRegionsTool = makeTool({
  name: "firms_all_regions",
  description: "Get fire signals for all predefined wildfire regions.",
  schema: z.object({}),
  execute: () => getAllRegionalFireSignals(),
});

// --- Market tools ---

export const marketSearchTool = makeTool({
  name: "market_search",
  description: "Search prediction markets on Jupiter Predict.",
  schema: z.object({ query: z.string(), limit: z.number().default(10) }),
  execute: async ({ query, limit }) => {
    const events = await jupiterPredict.searchEvents({ query: String(query), limit: Number(limit) || 10 });
    return events.map(e => ({
      id: e.eventId, title: e.metadata?.title, category: e.category,
      markets: e.markets?.map(m => ({ id: m.marketId, question: m.metadata?.question, status: m.status })),
    }));
  },
});

export const marketTrendingTool = makeTool({
  name: "market_trending",
  description: "Get trending prediction markets by category.",
  schema: z.object({ category: z.string().optional(), limit: z.number().default(10) }),
  execute: async ({ category, limit }) => {
    const { markets } = await getTrendingMarkets({ category: category as string | undefined, limit: Number(limit) || 10 });
    return markets.map(m => ({ marketId: m.marketId, question: m.question, volume: m.volume, outcomes: m.outcomes, closesAt: m.closesAt }));
  },
});

export const marketDetailTool = makeTool({
  name: "market_detail",
  description: "Get detailed info about a prediction market including prices and orderbook.",
  schema: z.object({ marketId: z.string() }),
  execute: async ({ marketId }) => {
    const [market, orderbook] = await Promise.all([
      getMarket(String(marketId)),
      jupiterPredict.getOrderbook(String(marketId)).catch(() => null),
    ]);
    return { market, orderbook };
  },
});

// --- Twitter tools ---

export const twitterSearchTool = makeTool({
  name: "twitter_search",
  description: "Search Twitter for recent tweets about a topic.",
  schema: z.object({ query: z.string(), maxResults: z.number().default(20) }),
  execute: async ({ query, maxResults }) => {
    const tweets = await searchTweets(String(query), Number(maxResults) || 20);
    return tweets.map(t => ({ id: t.id, text: t.text, createdAt: t.createdAt, likes: t.publicMetrics.likeCount, retweets: t.publicMetrics.retweetCount }));
  },
});

export const twitterSocialSignalTool = makeTool({
  name: "twitter_social_signal",
  description: "Get social signal for a topic (tweet count, engagement, sentiment).",
  schema: z.object({ topic: z.string(), maxResults: z.number().default(50) }),
  execute: async ({ topic, maxResults }) => getSocialSignal(String(topic), Number(maxResults) || 50),
});

export const twitterKeyAccountsTool = makeTool({
  name: "twitter_key_accounts",
  description: "Get latest tweets from key news accounts (Reuters, AP, BBC, NYT, Pentagon, NATO).",
  schema: z.object({}),
  execute: () => getKeyAccountSignals(),
});

export const twitterUserTweetsTool = makeTool({
  name: "twitter_user_tweets",
  description: "Get recent tweets from a specific Twitter user.",
  schema: z.object({ userId: z.string(), maxResults: z.number().default(10) }),
  execute: async ({ userId, maxResults }) => {
    const tweets = await getUserTweets(String(userId), Number(maxResults) || 10);
    return tweets.map(t => ({ text: t.text, createdAt: t.createdAt, likes: t.publicMetrics.likeCount, retweets: t.publicMetrics.retweetCount }));
  },
});

// --- CoinGecko tools ---

export const coingeckoPriceTool = makeTool({
  name: "coingecko_price",
  description: "Get current price, market cap, volume, and price change data for a cryptocurrency.",
  schema: z.object({ coinId: z.string() }),
  execute: async ({ coinId }) => {
    const data = await getCoinData(String(coinId));
    if (!data) return { error: "Coin not found" };
    return { id: data.id, symbol: data.symbol, name: data.name, price: data.currentPrice, marketCap: data.marketCap, volume24h: data.volume24h, change24h: data.priceChangePercent24h, change7d: data.priceChangePercent7d, change30d: data.priceChangePercent30d, high24h: data.high24h, low24h: data.low24h };
  },
});

export const coingeckoTrendingTool = makeTool({
  name: "coingecko_trending",
  description: "Get currently trending cryptocurrencies on CoinGecko.",
  schema: z.object({}),
  execute: () => getTrendingCoins(),
});

export const coingeckoGlobalTool = makeTool({
  name: "coingecko_global",
  description: "Get global crypto market overview: total market cap, volume, BTC/ETH dominance.",
  schema: z.object({}),
  execute: () => getGlobalMarket(),
});

// --- DeFiLlama tools ---

export const defillamaTvlTool = makeTool({
  name: "defillama_tvl",
  description: "Get top DeFi protocols by TVL with change data.",
  schema: z.object({ limit: z.number().default(15) }),
  execute: async ({ limit }) => {
    const protocols = await getTopProtocols(Number(limit) || 15);
    return protocols.map(p => ({ name: p.name, tvl: p.tvl, change1d: p.tvlChange1d, change7d: p.tvlChange7d, category: p.category }));
  },
});

export const defillamaSolanaTool = makeTool({
  name: "defillama_solana",
  description: "Get Solana ecosystem TVL data and top Solana protocols.",
  schema: z.object({}),
  execute: () => getSolanaTVL(),
});

export const defillamaProtocolsTool = makeTool({
  name: "defillama_protocols",
  description: "Get chain TVL rankings across all blockchains.",
  schema: z.object({ limit: z.number().default(10) }),
  execute: async ({ limit }) => {
    const chains = await getChainTVLs(Number(limit) || 10);
    return chains.map(c => ({ name: c.name, tvl: c.tvl, symbol: c.tokenSymbol }));
  },
});

// ============================================================
// TOOL REGISTRY (all tools as AgentTool)
// ============================================================

export const ALL_TOOLS: Record<string, AgentTool> = {
  web_search: webSearchTool,
  gdelt_search: gdeltSearchTool,
  gdelt_tone: gdeltToneTool,
  gdelt_all_signals: gdeltAllSignalsTool,
  acled_search: acledSearchTool,
  acled_conflict_signal: acledConflictSignalTool,
  acled_regional: acledRegionalTool,
  fred_series: fredSeriesTool,
  fred_macro_signal: fredMacroSignalTool,
  fred_all_signals: fredAllSignalsTool,
  firms_hotspots: firmsHotspotsTool,
  firms_all_regions: firmsAllRegionsTool,
  market_search: marketSearchTool,
  market_trending: marketTrendingTool,
  market_detail: marketDetailTool,
  twitter_search: twitterSearchTool,
  twitter_social_signal: twitterSocialSignalTool,
  twitter_key_accounts: twitterKeyAccountsTool,
  twitter_user_tweets: twitterUserTweetsTool,
  coingecko_price: coingeckoPriceTool,
  coingecko_trending: coingeckoTrendingTool,
  coingecko_global: coingeckoGlobalTool,
  defillama_tvl: defillamaTvlTool,
  defillama_solana: defillamaSolanaTool,
  defillama_protocols: defillamaProtocolsTool,
};

// --- Convert AgentTool names to record ---

export function toAITools(toolNames: string[]): Record<string, AgentTool> {
  const result: Record<string, AgentTool> = {};
  for (const name of toolNames) {
    const t = ALL_TOOLS[name];
    if (t) {
      result[name] = t;
    }
  }
  return result;
}

// --- Tool sets for different agent types ---

export const POLITICS_AGENT_TOOLS = [
  "web_search",
  "gdelt_search", "gdelt_tone", "gdelt_all_signals",
  "acled_search", "acled_conflict_signal", "acled_regional",
  "fred_series", "fred_macro_signal", "fred_all_signals",
  "twitter_search", "twitter_social_signal", "twitter_key_accounts", "twitter_user_tweets",
  "market_search", "market_trending", "market_detail",
];

export const SPORTS_AGENT_TOOLS = [
  "web_search",
  "market_search", "market_trending", "market_detail",
  "twitter_search", "twitter_social_signal",
];

export const CRYPTO_AGENT_TOOLS = [
  "web_search",
  "coingecko_price", "coingecko_trending", "coingecko_global",
  "defillama_tvl", "defillama_solana", "defillama_protocols",
  "twitter_search", "twitter_social_signal",
  "fred_series", "fred_macro_signal",
  "gdelt_search",
  "market_search", "market_trending", "market_detail",
];

export const GENERAL_AGENT_TOOLS = [
  "web_search",
  "gdelt_search", "gdelt_tone", "gdelt_all_signals",
  "acled_search", "acled_conflict_signal", "acled_regional",
  "fred_series", "fred_macro_signal", "fred_all_signals",
  "firms_hotspots", "firms_all_regions",
  "market_search", "market_trending", "market_detail",
  "twitter_search", "twitter_social_signal", "twitter_key_accounts",
];
