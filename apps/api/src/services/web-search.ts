import Exa from "exa-js";
import { searchGdelt } from "../data-sources/gdelt";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  date?: string;
}

let exaInstance: Exa | null = null;

function getExa(): Exa | null {
  if (!exaInstance) {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      console.warn("[WebSearch] Missing EXA_API_KEY — falling back to GDELT");
      return null;
    }
    exaInstance = new Exa(apiKey);
  }
  return exaInstance;
}

async function webSearchViaExa(
  query: string,
  maxResults: number = 10
): Promise<SearchResult[]> {
  const exa = getExa();
  if (!exa) return [];

  try {
    const results = await exa.searchAndContents(query, {
      type: "auto",
      numResults: maxResults,
      category: "news",
      highlights: { maxCharacters: 4000 },
    });

    return (results.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: (r as any).highlights?.[0] ?? (r as any).text?.slice(0, 300) ?? "",
      source: r.url ? new URL(r.url).hostname : "unknown",
      date: r.publishedDate,
    }));
  } catch (err) {
    console.error("[WebSearch] Exa search failed:", err);
    return [];
  }
}

async function webSearchViaGdelt(
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

export async function webSearch(
  query: string,
  maxResults: number = 10
): Promise<SearchResult[]> {
  const exaResults = await webSearchViaExa(query, maxResults);
  if (exaResults.length > 0) return exaResults;
  return webSearchViaGdelt(query, maxResults);
}
