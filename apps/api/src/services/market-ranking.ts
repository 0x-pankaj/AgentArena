// ============================================================
// Market Ranking & Scoring Service
// Deterministic scoring of markets to prioritize research.
// No LLM calls — pure math based on market data.
// Handles NEW/low-volume markets with bonus scoring for
// information asymmetry opportunities.
// ============================================================

import type { MarketContext } from "../ai/types";

export interface RankedMarket extends MarketContext {
  rank: number;
  score: number;
  scoreBreakdown: {
    edgePotential: number;
    volumeConfidence: number;
    timeSweetSpot: number;
    freshnessBonus: number;
    newMarketBonus: number;
  };
  isNewMarket: boolean;
  researchPriority: "deep" | "standard" | "brief";
}

// --- Extract search-friendly query from market question ---

const STOP_WORDS = new Set([
  "will", "by", "the", "a", "an", "in", "on", "at", "to", "for",
  "of", "is", "are", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "would", "could", "should", "may", "might",
  "shall", "can", "this", "that", "these", "those", "it", "its",
  "from", "with", "or", "and", "but", "not", "no", "yes", "if",
  "then", "than", "so", "as", "up", "out", "about", "into", "over",
  "after", "before", "between", "under", "again", "further", "once",
]);

export function extractSearchQuery(question: string): string {
  const cleaned = question
    .replace(/[?.!(),;:'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const words = cleaned.split(" ").filter((w) => !STOP_WORDS.has(w) && w.length > 1);
  return words.slice(0, 8).join(" ");
}

// --- Score a single market ---

export function scoreMarket(market: MarketContext, now: number = Date.now()): RankedMarket {
  const yesPrice = market.outcomes.find((o) => o.name.toLowerCase() === "yes")?.price ?? 0.5;
  const noPrice = market.outcomes.find((o) => o.name.toLowerCase() === "no")?.price ?? 0.5;

  // 1. Edge potential: markets priced near 0.5 have more room for mispricing
  //    0.3-0.7 range = high edge, extreme prices = low edge
  const distFromExtreme = Math.min(yesPrice, 1 - yesPrice);
  const edgePotential = Math.min(distFromExtreme * 2, 1); // 0 at extremes, peaks at 0.5

  // 2. Volume confidence: higher volume = more reliable market
  //    sqrt scaling: $10K -> 1.0, $100K -> 3.16, $1M -> 10
  const volumeConfidence = Math.max(0.3, Math.min(1.0, Math.sqrt(market.volume / 10000)));

  // 3. Time sweet spot: markets 1-5 days from resolution are ideal
  //    <6h: too risky (0.7), 1-5d: perfect (1.0), >5d: uncertain (0.9)
  let timeSweetSpot = 1.0;
  if (market.closesAt) {
    const hoursToClose = (new Date(market.closesAt).getTime() - now) / 3600000;
    if (hoursToClose < 1) timeSweetSpot = 0.6;
    else if (hoursToClose < 6) timeSweetSpot = 0.7;
    else if (hoursToClose < 24) timeSweetSpot = 0.95;
    else if (hoursToClose <= 120) timeSweetSpot = 1.0;
    else if (hoursToClose <= 168) timeSweetSpot = 0.9;
    else timeSweetSpot = 0.75;
  } else {
    timeSweetSpot = 0.8;
  }

  // 4. Freshness bonus: new markets (< 24h in system) are potentially mispriced
  //    We approximate this: if volume < 5K * daysOpen, it's likely new
  //    Since we don't have creation time, use volume < 20K as proxy
  const isNewMarket = market.volume < 20000 && yesPrice > 0.2 && yesPrice < 0.8;
  const freshnessBonus = isNewMarket ? 1.3 : 1.0;

  // 5. New/low-volume market bonus: information asymmetry opportunity
  //    Low volume + uncertain price = market may not have absorbed all info
  //    If our research can find an edge, these are the biggest wins
  let newMarketBonus = 1.0;
  if (market.volume < 50000 && yesPrice >= 0.25 && yesPrice <= 0.75) {
    // Moderate volume, price in uncertainty zone
    if (market.volume < 15000) {
      newMarketBonus = 1.6; // Very new/thin market — biggest mispricing potential
    } else if (market.volume < 30000) {
      newMarketBonus = 1.4; // Low volume, moderate uncertainty
    } else {
      newMarketBonus = 1.15; // Approaching normal
    }
  }

  // Composite score
  const score = edgePotential * volumeConfidence * timeSweetSpot * freshnessBonus * newMarketBonus;

  // Research priority based on combined score
  let researchPriority: "deep" | "standard" | "brief";
  if (newMarketBonus >= 1.4 || score >= 0.6) {
    researchPriority = "deep";
  } else if (score >= 0.3) {
    researchPriority = "standard";
  } else {
    researchPriority = "brief";
  }

  return {
    ...market,
    rank: 0,
    score,
    scoreBreakdown: {
      edgePotential,
      volumeConfidence,
      timeSweetSpot,
      freshnessBonus,
      newMarketBonus,
    },
    isNewMarket,
    researchPriority,
  };
}

// --- Rank an array of markets ---

export function rankMarkets(
  markets: MarketContext[],
  topN: number = 7,
  briefN: number = 10
): { deep: RankedMarket[]; brief: RankedMarket[] } {
  const scored = markets.map((m) => scoreMarket(m));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Assign ranks
  scored.forEach((m, i) => {
    m.rank = i + 1;
  });

  // Ensure deep research markets include all new/emerging markets
  // even if they didn't make top N by score
  const deepSet = new Set<number>();
  scored.forEach((m, i) => {
    if (i < topN) deepSet.add(i);
    if (m.isNewMarket && m.researchPriority === "deep" && i < topN + 3) {
      deepSet.add(i);
    }
  });

  const deep = scored.filter((_, i) => deepSet.has(i)).slice(0, topN + 3);
  const brief = scored.filter((m) => !deepSet.has(scored.indexOf(m))).slice(0, briefN);

  return { deep, brief };
}

// --- Generate additional search queries for new/low-volume markets ---

export function generateExtraSearchQueries(market: RankedMarket): string[] {
  const queries: string[] = [];
  const baseQuery = extractSearchQuery(market.question);

  if (market.researchPriority === "deep") {
    queries.push(`${baseQuery} prediction odds`);
    queries.push(`${baseQuery} latest news today`);
  }

  if (market.isNewMarket) {
    queries.push(`${baseQuery} new prediction market`);
  }

  return queries;
}