import { searchGdelt } from "../data-sources/gdelt";

// ============================================================
// Web Search Service
// ============================================================
//
// Two modes:
// 1. Kimi (kimi-k2.5) — has BUILT-IN $web_search tool at $0.005/call
//    We don't need to define it. Kimi handles it natively when we
//    mention "web search" in the system prompt.
//
// 2. Other models (GPT-4o, Claude) — no native search.
//    We provide a fallback using GDELT (news search) or a real
//    search API if configured.
//
// For the AI pipeline:
// - Kimi models: web_search is native, no tool needed
// - Non-Kimi models: we register a web_search tool that uses this service

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  date?: string;
}

// --- Web search via GDELT (free, works for news/geopolitical topics) ---

export async function webSearchViaGdelt(
  query: string,
  maxResults: number = 10
): Promise<SearchResult[]> {
  try {
    const result = await searchGdelt({
      query,
      mode: "artlist",
      timespan: "7d",
      maxRecords: maxResults,
    });

    return (result.articles ?? []).map((a) => ({
      title: a.title,
      url: a.url,
      snippet: `${a.title} — from ${a.domain}`,
      source: a.domain,
      date: a.seendate,
    }));
  } catch {
    return [];
  }
}

// --- Web search via dedicated API (if configured) ---
// Supports: Brave Search API, SerpAPI, or any search API

const SEARCH_API_KEY = process.env.SEARCH_API_KEY ?? "";
const SEARCH_API_PROVIDER = process.env.SEARCH_API_PROVIDER ?? ""; // "brave" | "serpapi"

export async function webSearchViaApi(
  query: string,
  maxResults: number = 10
): Promise<SearchResult[]> {
  if (!SEARCH_API_KEY || !SEARCH_API_PROVIDER) {
    // Fall back to GDELT
    return webSearchViaGdelt(query, maxResults);
  }

  if (SEARCH_API_PROVIDER === "brave") {
    return webSearchBrave(query, maxResults);
  }

  // Default fallback
  return webSearchViaGdelt(query, maxResults);
}

// --- Brave Search API ---

async function webSearchBrave(
  query: string,
  maxResults: number = 10
): Promise<SearchResult[]> {
  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
      {
        headers: {
          "X-Subscription-Token": SEARCH_API_KEY,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      return webSearchViaGdelt(query, maxResults);
    }

    const data = (await response.json()) as {
      web?: {
        results?: Array<{
          title: string;
          url: string;
          description: string;
          age?: string;
        }>;
      };
    };

    return (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
      source: new URL(r.url).hostname,
      date: r.age,
    }));
  } catch {
    return webSearchViaGdelt(query, maxResults);
  }
}

// --- Unified search (picks best available) ---

export async function webSearch(
  query: string,
  maxResults: number = 10
): Promise<SearchResult[]> {
  return webSearchViaApi(query, maxResults);
}
