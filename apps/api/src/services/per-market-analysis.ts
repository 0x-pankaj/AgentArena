// ============================================================
// Per-Market Deep Analysis Service (Phase 4)
// Instead of one mega-prompt for all markets, we analyze each
// market individually with focused research context.
// This dramatically improves prediction accuracy because:
//   1. Each market gets dedicated LLM attention
//   2. Research context is specific to that market
//   3. New/low-volume markets get extra scrutiny
//   4. LLM output is structured per-market probability
// ============================================================

import { z } from "zod";
import { quickAnalysis } from "../ai/pipeline";
import type { ModelConfig, AgentPosition } from "../ai/types";
import type { RankedMarket } from "./market-ranking";
import type { PerMarketResearchData } from "./market-research";
import type { SharedSignals } from "./signal-cache";
import { publishFeedEvent, buildFeedEvent } from "../feed";

// --- Structured output schema for per-market analysis ---

export const PerMarketAnalysisSchema = z.object({
  marketId: z.string(),
  probability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  keyFactors: z.array(z.string()),
  risks: z.array(z.string()),
  evidenceQuality: z.enum(["strong", "moderate", "weak"]),
  sourcesUsed: z.number(),
  recommendation: z.enum(["strong_buy", "buy", "speculative", "hold", "avoid"]),
});

export type PerMarketAnalysis = z.infer<typeof PerMarketAnalysisSchema>;

export interface PerMarketAnalysisResult {
  marketId: string;
  question: string;
  analysis: PerMarketAnalysis;
  tokensUsed: number;
  durationMs: number;
  isNewMarket: boolean;
}

// --- Category-specific system prompt variants ---

const CATEGORY_PROMPTS: Record<string, string> = {
  crypto: `You are a senior crypto prediction market analyst. You specialize in cryptocurrency price movements, regulatory decisions, ETF approvals, and DeFi events.
For each market, you must:
1. Estimate the TRUE probability (0-1) based on ALL evidence
2. Identify the key factors that will determine the outcome
3. List specific risks and information gaps
4. Assess evidence quality (how reliable are your sources?)
5. Give a recommendation based on edge vs market price`,

  politics: `You are a senior political prediction market analyst. You specialize in elections, legislative outcomes, geopolitical events, and policy decisions.
For each market, you must:
1. Estimate the TRUE probability (0-1) based on ALL evidence
2. Identify the key factors that will determine the outcome
3. List specific risks and information gaps
4. Assess evidence quality (how reliable are your sources?)
5. Give a recommendation based on edge vs market price`,

  sports: `You are a senior sports prediction market analyst. You specialize in game outcomes, championship odds, player performance, and season outcomes.
For each market, you must:
1. Estimate the TRUE probability (0-1) based on ALL evidence
2. Identify the key factors that will determine the outcome
3. List specific risks and information gaps
4. Assess evidence quality (how reliable are your sources?)
5. Give a recommendation based on edge vs market price`,

  general: `You are a senior prediction market analyst covering politics, crypto, sports, economics, and global events.
For each market, you must:
1. Estimate the TRUE probability (0-1) based on ALL evidence
2. Identify the key factors that will determine the outcome
3. List specific risks and information gaps
4. Assess evidence quality (how reliable are your sources?)
5. Give a recommendation based on edge vs market price`,
};

const NEW_MARKET_EXTRA_PROMPT = `

IMPORTANT: This is a NEW/EMERGING market with limited trading volume.
This means:
1. The market price may be significantly mispriced — few participants have traded yet
2. Information may not be fully absorbed into the price
3. There is potential for large edge IF you can find information the market hasn't priced in
4. Pay EXTRA attention to:
   - Is there breaking news that hasn't been reflected in the price yet?
   - Are there information asymmetries you can exploit?
   - Is the fundamental probability clearly different from the market price?
5. Be MORE specific about your probability estimate — don't hedge
6. If you have strong conviction from the research, state it clearly`;

// --- Build user message for per-market analysis ---

function buildAnalysisUserMessage(
  market: RankedMarket,
  researchData: PerMarketResearchData | undefined,
  signals: SharedSignals,
  positions: AgentPosition[],
  balance: number
): string {
  const parts: string[] = [];

  // Market info
  const yesPrice = market.outcomes.find((o) => o.name.toLowerCase() === "yes")?.price ?? 0.5;
  const noPrice = market.outcomes.find((o) => o.name.toLowerCase() === "no")?.price ?? 0.5;
  const hoursToClose = market.closesAt
    ? ((new Date(market.closesAt).getTime() - Date.now()) / 3600000).toFixed(1)
    : "N/A";

  parts.push(`## Market Analysis Request
Market: "${market.question}"
Market ID: ${market.marketId}
YES price: $${yesPrice.toFixed(3)} | NO price: $${noPrice.toFixed(3)}
Volume: $${market.volume.toLocaleString()} | Liquidity: $${market.liquidity.toLocaleString()}
Time to close: ${hoursToClose} hours
NEW MARKET: ${market.isNewMarket ? "YES — limited volume, potential mispricing" : "No"}

## Research Context`);

  // Web search results
  if (researchData?.searchResults && researchData.searchResults.length > 0) {
    parts.push(`### Web Search Results (${researchData.searchResults.length} sources):`);
    for (const r of researchData.searchResults.slice(0, 8)) {
      parts.push(`- ${r.title} (${r.source}${r.date ? `, ${r.date}` : ""})`);
      if (r.snippet) {
        parts.push(`  "${r.snippet.slice(0, 300)}"`);
      }
    }
    parts.push("");
  }

  // Extra search results for deep markets
  if (researchData?.research.extraSearchResults && researchData.research.extraSearchResults.length > 0) {
    parts.push(`### Additional Research (${researchData.research.extraSearchResults.length} sources):`);
    for (const r of researchData.research.extraSearchResults.slice(0, 5)) {
      parts.push(`- ${r.title} (${r.source})`);
      if (r.snippet) {
        parts.push(`  "${r.snippet.slice(0, 200)}"`);
      }
    }
    parts.push("");
  }

  // Twitter sentiment
  if (researchData?.twitterSentiment && researchData.twitterSentiment.length > 0) {
    parts.push(`### Twitter Sentiment (${researchData.twitterSentiment.length} tweets):`);
    for (const t of researchData.twitterSentiment.slice(0, 5)) {
      parts.push(`- "${t.text.slice(0, 120)}" (❤${t.likes} 🔄${t.retweets})`);
    }
    parts.push("");
  }

  // Market microstructure
  if (researchData?.microstructure) {
    const m = researchData.microstructure;
    parts.push(`### Market Microstructure:
- Bid/Ask spread: ${(m.bidAskSpread * 100).toFixed(1)}%
- Depth at 5%: $${m.depthAt5Pct?.toFixed(0) ?? "N/A"}
- Price impact estimate: $${m.priceImpactEstimate?.toFixed(2) ?? "N/A"}
- Mid price: $${m.midPrice?.toFixed(3) ?? "N/A"}`);
    parts.push("");
  }

  // Category-specific signal data (only relevant portions)
  parts.push(`## Signal Data`);

  // GDELT
  if (signals.gdelt && Object.keys(signals.gdelt).length > 0) {
    parts.push(`### Geopolitical Sentiment (GDELT):`);
    for (const [region, signal] of Object.entries(signals.gdelt).slice(0, 3)) {
      parts.push(`- ${region}: tone=${(signal as any).avgTone?.toFixed(2) ?? "?"} (${(signal as any).articleCount ?? "?"} articles)`);
    }
  }

  // FRED
  if (signals.fred && Object.keys(signals.fred).length > 0) {
    parts.push(`### Macro Indicators (FRED):`);
    for (const [key, signal] of Object.entries(signals.fred).slice(0, 3)) {
      parts.push(`- ${key}: trend=${(signal as any).trend ?? "?"} change=${(signal as any).changePercent?.toFixed(2) ?? "?"}% latest=${(signal as any).latestValue ?? "?"}`);
    }
  }

  // Crypto signals (if relevant)
  if (signals.crypto) {
    const question = market.question.toLowerCase();
    const cryptoData = signals.crypto.prices ?? {};
    const relevantCoins = Object.entries(cryptoData).filter(([symbol]) => {
      const s = symbol.toLowerCase();
      return question.includes(s) || question.includes("crypto") || question.includes("market");
    });

    if (relevantCoins.length > 0 || question.includes("crypto") || question.includes("btc") || question.includes("eth") || question.includes("sol")) {
      parts.push(`### Crypto Data:`);
      for (const [symbol, data] of (relevantCoins.length > 0 ? relevantCoins : Object.entries(cryptoData).slice(0, 3))) {
        const d = data as any;
        parts.push(`- ${symbol}: $${d.price} | 24h: ${d.change24h?.toFixed(2) ?? "?"}% | 7d: ${d.change7d?.toFixed(2) ?? "?"}% | Vol: $${((d.volume24h ?? 0) / 1e6).toFixed(1)}M`);
      }
      if (signals.crypto.global) {
        parts.push(`- Market cap change: ${signals.crypto.global.marketCapChange24h?.toFixed(2) ?? "?"}%`);
      }
    }
  }

  // Portfolio context
  parts.push(`
## Portfolio
- Balance: $${balance.toFixed(2)} USDC
- Open positions: ${positions.length}`);
  if (positions.length > 0) {
    for (const p of positions.slice(0, 3)) {
      parts.push(`  - ${p.marketId}: ${p.side.toUpperCase()} $${p.amount} @ ${p.entryPrice} (PnL: $${p.pnl.toFixed(2)})`);
    }
  }

  // Analysis instructions
  parts.push(`
## Analysis Required

Based on ALL the evidence above, provide your analysis as JSON:
{
  "marketId": "${market.marketId}",
  "probability": 0.XX,
  "confidence": 0.XX,
  "reasoning": "Your step-by-step reasoning (2-3 sentences per key factor)",
  "keyFactors": ["factor 1", "factor 2", ...],
  "risks": ["risk 1", "risk 2", ...],
  "evidenceQuality": "strong|moderate|weak",
  "sourcesUsed": NUMBER,
  "recommendation": "strong_buy|buy|speculative|hold|avoid"
}

Be specific and evidence-based. Start with the market price as your prior, then adjust based on your research.`);

  return parts.join("\n");
}

// --- Analyze a single market ---

export async function analyzeSingleMarket(
  market: RankedMarket,
  researchData: PerMarketResearchData | undefined,
  signals: SharedSignals,
  positions: AgentPosition[],
  balance: number,
  modelConfig: ModelConfig,
  agentId: string,
  agentName: string,
  category: string
): Promise<PerMarketAnalysisResult> {
  const startTime = Date.now();

  const categoryPrompt = CATEGORY_PROMPTS[category] ?? CATEGORY_PROMPTS.general;
  const isNewMarketPrompt = market.isNewMarket ? NEW_MARKET_EXTRA_PROMPT : "";
  const systemPrompt = categoryPrompt + isNewMarketPrompt;

  const userMessage = buildAnalysisUserMessage(market, researchData, signals, positions, balance);

  try {
    await publishFeedEvent(buildFeedEvent({
      agentId,
      agentName,
      jobId: "",
      category: "thinking",
      severity: "info",
      content: { summary: `${agentName} Deep-analyzing: "${market.question.slice(0, 50)}..."${market.isNewMarket ? " [NEW MARKET]" : ""}`, pipeline_stage: "per_market_analysis" },
      displayMessage: `${agentName} Deep-analyzing: "${market.question.slice(0, 50)}..."${market.isNewMarket ? " [NEW MARKET]" : ""}`,
    }));
    const result = await quickAnalysis({
      modelConfig,
      systemPrompt,
      userMessage,
      tools: [],
      agentId: `${agentId}:analysis:${market.marketId}`,
    });

    // Parse the structured output
    const jsonText = extractJsonFromText(result.text);
    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      // Try to extract probability from free text
      parsed = {
        marketId: market.marketId,
        probability: extractProbabilityFromText(result.text),
        confidence: 0.5,
        reasoning: result.text.slice(0, 500),
        keyFactors: [],
        risks: [],
        evidenceQuality: "moderate",
        sourcesUsed: researchData?.searchResults?.length ?? 0,
        recommendation: "speculative",
      };
    }

    // Validate and clamp values
    const probability = Math.max(0, Math.min(1, typeof parsed.probability === "number" ? parsed.probability : 0.5));
    const confidence = Math.max(0.1, Math.min(1, typeof parsed.confidence === "number" ? parsed.confidence : 0.5));

    const analysis: PerMarketAnalysis = {
      marketId: parsed.marketId ?? market.marketId,
      probability,
      confidence,
      reasoning: parsed.reasoning ?? result.text.slice(0, 500),
      keyFactors: Array.isArray(parsed.keyFactors) ? parsed.keyFactors : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      evidenceQuality: ["strong", "moderate", "weak"].includes(parsed.evidenceQuality) ? parsed.evidenceQuality : "moderate",
      sourcesUsed: typeof parsed.sourcesUsed === "number" ? parsed.sourcesUsed : (researchData?.searchResults?.length ?? 0),
      recommendation: ["strong_buy", "buy", "speculative", "hold", "avoid"].includes(parsed.recommendation) ? parsed.recommendation : "speculative",
    };

    const durationMs = Date.now() - startTime;

    await publishFeedEvent(buildFeedEvent({
      agentId,
      agentName,
      jobId: "",
      category: "thinking",
      severity: "info",
      content: {
        summary: `${agentName} Analysis complete: "${market.question.slice(0, 40)}..." -> ${(analysis.probability * 100).toFixed(0)}% (confidence: ${(analysis.confidence * 100).toFixed(0)}%, quality: ${analysis.evidenceQuality})`,
        pipeline_stage: "per_market_analysis_complete",
        confidence: analysis.confidence,
      },
      displayMessage: `${agentName} Analysis complete: "${market.question.slice(0, 40)}..." -> ${(analysis.probability * 100).toFixed(0)}%`,
    }));

    return {
      marketId: market.marketId,
      question: market.question,
      analysis,
      tokensUsed: result.tokensUsed,
      durationMs,
      isNewMarket: market.isNewMarket,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error(`[PerMarketAnalysis] Error analyzing ${market.marketId}:`, err);

    return {
      marketId: market.marketId,
      question: market.question,
      analysis: {
        marketId: market.marketId,
        probability: 0.5, // neutral prior on error
        confidence: 0.2, // low confidence
        reasoning: `Analysis failed: ${err instanceof Error ? err.message : "unknown error"}`,
        keyFactors: [],
        risks: ["analysis_error"],
        evidenceQuality: "weak",
        sourcesUsed: 0,
        recommendation: "avoid",
      },
      tokensUsed: 0,
      durationMs,
      isNewMarket: market.isNewMarket,
    };
  }
}

// --- Analyze multiple markets in parallel (batched) ---

export async function analyzeMarketsBatch(
  deepMarkets: RankedMarket[],
  researchDataMap: Map<string, PerMarketResearchData>,
  signals: SharedSignals,
  positions: AgentPosition[],
  balance: number,
  modelConfig: ModelConfig,
  agentId: string,
  agentName: string,
  category: string,
  concurrency: number = 3
): Promise<PerMarketAnalysisResult[]> {
  const results: PerMarketAnalysisResult[] = [];

  // Process in batches of `concurrency` to avoid rate limits
  for (let i = 0; i < deepMarkets.length; i += concurrency) {
    const batch = deepMarkets.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((market) =>
        analyzeSingleMarket(
          market,
          researchDataMap.get(market.marketId),
          signals,
          positions,
          balance,
          modelConfig,
          agentId,
          agentName,
          category
        )
      )
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      }
    }

    // Small delay between batches
    if (i + concurrency < deepMarkets.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  console.log(
    `[PerMarketAnalysis] Completed analysis for ${results.length}/${deepMarkets.length} markets`
  );

  return results;
}

// --- JSON extraction helpers ---

function extractJsonFromText(text: string): string {
  if (!text || !text.trim()) return "{}";

  const codeBlockPatterns = [
    /```(?:json)?\s*\n?([\s\S]*?)\n?```/,
    /```\s*\n?([\s\S]*?)\n?```/,
  ];
  for (const pattern of codeBlockPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim();
      if (candidate.startsWith("{")) return candidate;
    }
  }

  const firstBrace = text.indexOf("{");
  if (firstBrace !== -1) {
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = firstBrace; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { if (inStr) escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (depth === 0) return text.slice(firstBrace, i + 1);
    }
  }

  const greedyMatch = text.match(/\{[\s\S]*\}/);
  if (greedyMatch) return greedyMatch[0];
  return text.trim();
}

function extractProbabilityFromText(text: string): number {
  const pctMatch = text.match(/(\d{1,3})\s*%/);
  if (pctMatch) {
    const val = parseInt(pctMatch[1], 10);
    if (val >= 0 && val <= 100) return val / 100;
  }
  const probMatch = text.match(/probability\s*(?:of|:)?\s*(\d+\.?\d*)/i);
  if (probMatch) {
    const val = parseFloat(probMatch[1]);
    if (val >= 0 && val <= 1) return val;
    if (val > 1 && val <= 100) return val / 100;
  }
  return 0.5;
}

// ============================================================
// BATCH ANALYSIS: Multiple markets in ONE LLM call with tools
// This replaces the per-market approach when USE_ENHANCED_PIPELINE
// is enabled. Benefits:
//   1. 1-2 LLM calls instead of 5-7 → faster, cheaper
//   2. LLM can compare markets across the batch
//   3. Tools available — LLM can verify with web_search if needed
//   4. Same category → natural cross-referencing
//   5. Research already done → LLM just evaluates + can dig deeper
// ============================================================

import { toAITools } from "../ai/tools";

// Tool sets for batch analysis — focused on verification, not discovery
const BATCH_ANALYSIS_TOOLS: Record<string, string[]> = {
  crypto: [
    "web_search",
    "coingecko_price", "coingecko_global",
    "twitter_search",
    "market_detail",
  ],
  politics: [
    "web_search",
    "gdelt_search", "gdelt_tone",
    "acled_search",
    "fred_series", "fred_macro_signal",
    "twitter_search",
    "market_detail",
  ],
  sports: [
    "web_search",
    "twitter_search",
    "market_detail",
  ],
  general: [
    "web_search",
    "gdelt_search",
    "coingecko_price",
    "twitter_search",
    "market_detail",
  ],
};

// --- Structured output schema for batch analysis ---

export const BatchMarketAnalysisSchema = z.object({
  analyses: z.array(z.object({
    marketId: z.string(),
    probability: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
    keyFactors: z.array(z.string()),
    risks: z.array(z.string()),
    evidenceQuality: z.enum(["strong", "moderate", "weak"]),
    sourcesUsed: z.number(),
    recommendation: z.enum(["strong_buy", "buy", "speculative", "hold", "avoid"]),
  })),
  crossMarketInsight: z.string().optional(),
});

export type BatchMarketAnalysis = z.infer<typeof BatchMarketAnalysisSchema>;

// --- System prompt for batch analysis ---

function buildBatchSystemPrompt(category: string, hasNewMarkets: boolean): string {
  const categoryContext: Record<string, string> = {
    crypto: "You are analyzing crypto prediction markets. These markets are correlated — BTC movement affects most altcoins, ETF decisions affect the whole sector. Use this to your advantage.",
    politics: "You are analyzing political prediction markets. Elections, legislation, and geopolitical events are interconnected. Use cross-market reasoning.",
    sports: "You are analyzing sports prediction markets. Team form, injuries, and scheduling affect multiple markets. Compare across markets.",
    general: "You are analyzing prediction markets across multiple categories. Look for cross-category correlations.",
  };

  let prompt = `${categoryContext[category] ?? categoryContext.general}

You are analyzing MULTIPLE markets in a single batch. This gives you a UNIQUE advantage:
- You can COMPARE markets to find the best opportunity
- You can identify CORRELATIONS (e.g., if BTC drops, SOL likely follows)
- You can spot which market has the BIGGEST edge vs the market price
- You can DETERMINE which single market to trade

For EACH market, provide your analysis as a structured JSON object.

Your available tools: web_search, twitter_search, coingecko_price, market_detail${category === "politics" ? ", gdelt_search, fred_series" : ""}${category === "crypto" ? ", coingecko_global" : ""}

IMPORTANT: Only use tools when you need to VERIFY a critical claim or check for breaking news that could shift your probability estimate by >5%. The research context already contains pre-fetched data. Do NOT search for every market — only search when the provided research is insufficient or contradictory.

OUTPUT FORMAT (must be valid JSON):
{
  "analyses": [
    {
      "marketId": "market_id_here",
      "probability": 0.XX,
      "confidence": 0.XX,
      "reasoning": "2-3 sentences explaining your probability estimate",
      "keyFactors": ["factor 1", "factor 2", "factor 3"],
      "risks": ["risk 1", "risk 2"],
      "evidenceQuality": "strong|moderate|weak",
      "sourcesUsed": NUMBER,
      "recommendation": "strong_buy|buy|speculative|hold|avoid"
    }
  ],
  "crossMarketInsight": "1-2 sentences about correlations or the best opportunity across all markets"
}`;

  if (hasNewMarkets) {
    prompt += `\n\n⚠️ Some markets are marked [NEW] — they have low volume and may be MISPRICED. Pay extra attention to information asymmetry. If your research reveals news the market hasn't priced in yet, be BOLD with your probability estimate.`;
  }

  return prompt;
}

// --- Build user message for batch analysis ---

function buildBatchUserMessage(
  markets: RankedMarket[],
  researchDataMap: Map<string, PerMarketResearchData>,
  signals: SharedSignals,
  positions: AgentPosition[],
  balance: number,
  category: string
): string {
  const parts: string[] = [];

  parts.push(`## Batch Analysis: ${markets.length} Markets\n`);
  parts.push(`Analyze ALL ${markets.length} markets below. For each, estimate the TRUE probability based on the evidence provided.`);
  parts.push(`Then identify which market has the BIGGEST edge (difference between your estimate and the market price).`);
  parts.push(`Use tools ONLY if you need to verify a critical claim or check for very recent breaking news.\n`);

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const research = researchDataMap.get(m.marketId);
    const yesPrice = m.outcomes.find(o => o.name.toLowerCase() === "yes")?.price ?? 0.5;
    const noPrice = m.outcomes.find(o => o.name.toLowerCase() === "no")?.price ?? 0.5;
    const hoursToClose = m.closesAt
      ? ((new Date(m.closesAt).getTime() - Date.now()) / 3600000).toFixed(1)
      : "N/A";

    parts.push(`### Market ${i + 1}${m.isNewMarket ? " ⚡ NEW/EMERGING" : ""}: "${m.question}"`);
    parts.push(`| ID: ${m.marketId} | YES: $${yesPrice.toFixed(3)} | NO: $${noPrice.toFixed(3)} | Vol: $${m.volume.toLocaleString()} | Closes: ${hoursToClose}h | Score: ${m.score.toFixed(3)}`);

    // Research context
    if (research?.searchResults && research.searchResults.length > 0) {
      parts.push(`| News sources (${research.searchResults.length}):`);
      for (const r of research.searchResults.slice(0, 5)) {
        parts.push(`  - ${r.title} (${r.source}${r.date ? `, ${r.date}` : ""}): "${r.snippet?.slice(0, 180) ?? ""}"`);
      }
    }
    if (research?.research.extraSearchResults && research.research.extraSearchResults.length > 0) {
      parts.push(`| Extra research (${research.research.extraSearchResults.length}):`);
      for (const r of research.research.extraSearchResults.slice(0, 3)) {
        parts.push(`  - ${r.title} (${r.source}): "${r.snippet?.slice(0, 150) ?? ""}"`);
      }
    }
    if (research?.twitterSentiment && research.twitterSentiment.length > 0) {
      parts.push(`| Twitter (${research.twitterSentiment.length} tweets):`);
      for (const t of research.twitterSentiment.slice(0, 3)) {
        parts.push(`  - "${t.text.slice(0, 100)}" (❤${t.likes} 🔄${t.retweets})`);
      }
    }

    // Category-specific signals (keyword-matched)
    if (signals.crypto && (category === "crypto" || category === "general")) {
      const q = m.question.toLowerCase();
      if (signals.crypto?.prices) {
        const relevantCoins = Object.entries(signals.crypto.prices).filter(([sym]) => {
          return q.includes(sym.toLowerCase()) || q.includes("crypto") || q.includes("market");
        }).slice(0, 2);
        if (relevantCoins.length > 0) {
          parts.push(`| Crypto: ${relevantCoins.map(([sym, d]: [string, any]) => `${sym}: ${d.change24h?.toFixed(1)}% 24h`).join(", ")}`);
        }
      }
    }
    parts.push("");
  }

  // Portfolio context (brief)
  parts.push(`## Portfolio: $${balance.toFixed(2)} USDC | ${positions.length}/${3} positions`);
  if (positions.length > 0) {
    parts.push(positions.slice(0, 3).map(p => `  - ${p.marketId}: ${p.side} $${p.amount}`).join("\n"));
  }

  parts.push("\n## IMPORTANT REMINDER");
  parts.push("- Start with the market price as your prior (baseline), then adjust based on evidence");
  parts.push("- If evidence is strong and clear, be confident. If evidence is weak or contradictory, be less confident");
  parts.push("- The market with the BIGGEST gap between your probability and the market price is the best trading opportunity");
  parts.push("- Only use tools when necessary — research is already provided above");

  return parts.join("\n");
}



// --- Batch analysis: multiple markets in ONE or TWO LLM calls ---

export async function analyzeMarketsInBatch(
  markets: RankedMarket[],
  researchDataMap: Map<string, PerMarketResearchData>,
  signals: SharedSignals,
  positions: AgentPosition[],
  balance: number,
  modelConfig: ModelConfig,
  agentId: string,
  agentName: string,
  categoryArg: string,
  maxPerBatch: number = 4
): Promise<PerMarketAnalysisResult[]> {
  const startTime = Date.now();
  const results: PerMarketAnalysisResult[] = [];

  if (markets.length === 0) return results;

  const toolNames = BATCH_ANALYSIS_TOOLS[categoryArg] ?? BATCH_ANALYSIS_TOOLS.general;
  const hasNewMarkets = markets.some(m => m.isNewMarket);
  const systemPrompt = buildBatchSystemPrompt(categoryArg, hasNewMarkets);

  // Split into batches of maxPerBatch
  for (let i = 0; i < markets.length; i += maxPerBatch) {
    const batch = markets.slice(i, i + maxPerBatch);
    const batchLabel = batch.length === 1
      ? `"${batch[0].question.slice(0, 40)}..."`
      : `${batch.length} markets (${batch.map(m => `"${m.question.slice(0, 25)}..."`).join(", ")})`;

    await publishFeedEvent(buildFeedEvent({
      agentId,
      agentName,
      jobId: "",
      category: "thinking",
      severity: "info",
      content: { summary: `${agentName} Batch-analyzing ${batch.length} markets: ${batchLabel}${hasNewMarkets ? " [incl. NEW]" : ""}`, pipeline_stage: "batch_analysis" },
      displayMessage: `${agentName} Analyzing ${batch.length} markets in batch`,
    }));

    const userMessage = buildBatchUserMessage(batch, researchDataMap, signals, positions, balance, categoryArg);

    try {
      const result = await quickAnalysis({
        modelConfig,
        systemPrompt,
        userMessage,
        tools: toolNames,
        agentId: `${agentId}:batch:${i}-${i + batch.length}`,
      });

      // Parse structured JSON output
      const jsonText = extractJsonFromText(result.text);
      let parsed: any;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        // Fallback: try to find an array in the text
        const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try {
            parsed = { analyses: JSON.parse(arrayMatch[0]) };
          } catch {
            parsed = null;
          }
        }
      }

      // Extract analyses from parsed result
      const analysesArray = Array.isArray(parsed?.analyses) ? parsed.analyses : Array.isArray(parsed) ? parsed : [];

      for (let j = 0; j < batch.length; j++) {
        const market = batch[j];
        const analysisData = analysesArray[j];

        if (analysisData && typeof analysisData === "object" && analysisData.marketId) {
          const probability = Math.max(0, Math.min(1, typeof analysisData.probability === "number" ? analysisData.probability : 0.5));
          const confidence = Math.max(0.1, Math.min(1, typeof analysisData.confidence === "number" ? analysisData.confidence : 0.5));

          results.push({
            marketId: market.marketId,
            question: market.question,
            analysis: {
              marketId: analysisData.marketId ?? market.marketId,
              probability,
              confidence,
              reasoning: analysisData.reasoning ?? result.text.slice(0, 300),
              keyFactors: Array.isArray(analysisData.keyFactors) ? analysisData.keyFactors : [],
              risks: Array.isArray(analysisData.risks) ? analysisData.risks : [],
              evidenceQuality: ["strong", "moderate", "weak"].includes(analysisData.evidenceQuality) ? analysisData.evidenceQuality : "moderate",
              sourcesUsed: typeof analysisData.sourcesUsed === "number" ? analysisData.sourcesUsed : result.toolCalls ?? 0,
              recommendation: ["strong_buy", "buy", "speculative", "hold", "avoid"].includes(analysisData.recommendation) ? analysisData.recommendation : "speculative",
            },
            tokensUsed: j === 0 ? result.tokensUsed : 0, // Only count tokens once per batch
            durationMs: Date.now() - startTime,
            isNewMarket: market.isNewMarket,
          });
        } else {
          // Fallback for markets where LLM didn't provide structured output
          const probFromText = analysisData?.probability ?? extractProbabilityFromText(result.text);
          results.push({
            marketId: market.marketId,
            question: market.question,
            analysis: {
              marketId: market.marketId,
              probability: Math.max(0, Math.min(1, probFromText)),
              confidence: 0.4, // Low confidence for fallback
              reasoning: `Batch analysis partial output — market ${j + 1} of ${batch.length}`,
              keyFactors: [],
              risks: ["batch_fallback"],
              evidenceQuality: "weak",
              sourcesUsed: result.toolCalls ?? 0,
              recommendation: "speculative",
            },
            tokensUsed: 0,
            durationMs: Date.now() - startTime,
            isNewMarket: market.isNewMarket,
          });
        }
      }

      // Log cross-market insight if provided
      if (parsed?.crossMarketInsight) {
        console.log(`[BatchAnalysis] Cross-market insight: ${parsed.crossMarketInsight}`);
      }

      // Small delay between batches
      if (i + maxPerBatch < markets.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } catch (err) {
      console.error(`[BatchAnalysis] Error analyzing batch ${i}-${i + batch.length}:`, err);

      // Fallback: create neutral analyses for all markets in the batch
      for (const market of batch) {
        results.push({
          marketId: market.marketId,
          question: market.question,
          analysis: {
            marketId: market.marketId,
            probability: 0.5,
            confidence: 0.2,
            reasoning: `Batch analysis failed: ${err instanceof Error ? err.message : "unknown error"}`,
            keyFactors: [],
            risks: ["batch_analysis_error"],
            evidenceQuality: "weak",
            sourcesUsed: 0,
            recommendation: "avoid",
          },
          tokensUsed: 0,
          durationMs: Date.now() - startTime,
          isNewMarket: market.isNewMarket,
        });
      }
    }
  }

  console.log(`[BatchAnalysis] Completed ${results.length}/${markets.length} markets in ${Date.now() - startTime}ms (${Math.ceil(markets.length / maxPerBatch)} batches)`);
  return results;
}