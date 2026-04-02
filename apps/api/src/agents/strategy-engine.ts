import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { LLM_MODEL, LLM_BASE_URL, AGENT_LIMITS } from "@agent-arena/shared";
import { getGeoSignals, type GdeltToneSignal } from "../data-sources/gdelt";
import { getRegionalConflictSignals, type AcledConflictSignal } from "../data-sources/acled";
import { getKeyMacroSignals, type FredMacroSignal } from "../data-sources/fred";
import { getAllRegionalFireSignals, type FireSignal } from "../data-sources/nasa-firms";

const KIMI_API_KEY = process.env.KIMI_API_KEY ?? "";

const llm = new OpenAI({
  apiKey: KIMI_API_KEY,
  baseURL: LLM_BASE_URL,
});

// --- Zod-validated LLM output ---

const LLMDecisionSchema = z.object({
  action: z.enum(["buy", "sell", "hold"]),
  marketId: z.string().optional(),
  marketQuestion: z.string().optional(),
  isYes: z.boolean().optional(),
  amount: z.number().min(0).optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
export type LLMDecision = z.infer<typeof LLMDecisionSchema>;

// --- Threshold check result ---

export interface ThresholdCheck {
  triggered: boolean;
  reasons: string[];
}

// --- Aggregated signals for the agent ---

export interface GeoSignals {
  gdelt: Record<string, GdeltToneSignal>;
  acled: Record<string, AcledConflictSignal>;
  fred: Record<string, FredMacroSignal>;
  fires: Record<string, FireSignal>;
  fetchedAt: string;
}

// --- Market context for LLM ---

export interface MarketContext {
  marketId: string;
  question: string;
  outcomes: Array<{ name: string; price: number }>;
  volume: number;
  liquidity: number;
  closesAt: string | null;
}

export interface AgentPosition {
  marketId: string;
  side: string;
  amount: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
}

// --- STEP 1: Fetch cheap signals (always, free) ---

export async function fetchSignals(): Promise<GeoSignals> {
  const [gdelt, acled, fred, fires] = await Promise.allSettled([
    getGeoSignals(),
    getRegionalConflictSignals(),
    getKeyMacroSignals(),
    getAllRegionalFireSignals(),
  ]);

  return {
    gdelt: gdelt.status === "fulfilled" ? gdelt.value : {},
    acled: acled.status === "fulfilled" ? acled.value : {},
    fred: fred.status === "fulfilled" ? fred.value : {},
    fires: fires.status === "fulfilled" ? fires.value : {},
    fetchedAt: new Date().toISOString(),
  };
}

import type { SharedSignals } from "../services/signal-cache";

// --- STEP 2: Check thresholds (deterministic, no LLM) ---

export function checkThresholds(
  signals: SharedSignals,
  lastAnalysisTime: number | null,
  markets: MarketContext[],
  positions: AgentPosition[],
  agentType: string = "general"
): ThresholdCheck {
  const reasons: string[] = [];

  // Agent-specific threshold checks

  if (agentType === "sports" || agentType === "general") {
    // Sports: check odds movements and sharp money indicators
    if (signals.sports) {
      for (const [sport, signal] of Object.entries(signals.sports)) {
        if (signal.totalEvents > 0) {
          reasons.push(`Sports: ${sport} has ${signal.totalEvents} upcoming events`);
          if (Math.abs(signal.sharpMoneyIndicator) > 0.3) {
            reasons.push(
              `Sharp money detected on ${sport}: indicator=${signal.sharpMoneyIndicator.toFixed(2)}`
            );
          }
        }
      }
    }
  }

  if (agentType === "crypto" || agentType === "general") {
    // Crypto: check price movements and market cap changes
    if (signals.crypto) {
      for (const [coin, signal] of Object.entries(signals.crypto.prices)) {
        if (Math.abs(signal.change24h) > 5) {
          reasons.push(
            `Crypto move: ${coin} ${signal.change24h > 0 ? "up" : "down"} ${Math.abs(signal.change24h).toFixed(1)}% (vol: $${(signal.volume24h / 1e6).toFixed(1)}M)`
          );
        }
        if (Math.abs(signal.change7d) > 15) {
          reasons.push(
            `Crypto weekly: ${coin} ${signal.change7d > 0 ? "up" : "down"} ${Math.abs(signal.change7d).toFixed(1)}% in 7d`
          );
        }
      }
      if (signals.crypto.global) {
        const capChange = signals.crypto.global.marketCapChange24h;
        if (Math.abs(capChange) > 3) {
          reasons.push(
            `Global crypto market cap ${capChange > 0 ? "up" : "down"} ${Math.abs(capChange).toFixed(1)}%`
          );
        }
      }
    }
  }

  if (agentType === "politics" || agentType === "general") {
    // Politics: GDELT, ACLED, FRED thresholds
    for (const [key, signal] of Object.entries(signals.gdelt)) {
      if (Math.abs(signal.avgTone) > 3) {
        reasons.push(
          `GDELT tone spike: ${key} tone=${signal.avgTone.toFixed(2)} (${signal.articleCount} articles)`
        );
      }
    }

    for (const [region, signal] of Object.entries(signals.acled)) {
      if (Math.abs(signal.delta7d) > 50) {
        reasons.push(
          `ACLED conflict delta: ${region} change=${signal.delta7d.toFixed(1)}% (${signal.totalEvents} events, ${signal.totalFatalities} fatalities)`
        );
      }
    }

    for (const [key, signal] of Object.entries(signals.fred)) {
      if (Math.abs(signal.changePercent) > 1) {
        reasons.push(
          `FRED macro surprise: ${key} ${signal.trend} ${signal.changePercent.toFixed(2)}% (latest: ${signal.latestValue})`
        );
      }
    }

    for (const [region, signal] of Object.entries(signals.fires)) {
      if (signal.hotspotCount > 50) {
        reasons.push(
          `NASA FIRMS: ${region} ${signal.hotspotCount} hotspots (FRP=${signal.totalFrp.toFixed(1)} MW)`
        );
      }
    }
  }

  // Always check: positions with edge narrowing
  for (const pos of positions) {
    if (pos.entryPrice <= 0) continue;
    let lossPct: number;
    if (pos.side === "yes") {
      lossPct = ((pos.entryPrice - pos.currentPrice) / pos.entryPrice) * 100;
    } else {
      lossPct = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    }
    if (lossPct > 5) {
      reasons.push(
        `Position edge narrowing: ${pos.marketId} (${pos.side.toUpperCase()}) loss=${lossPct.toFixed(1)}%`
      );
    }
  }

  // Check if enough time passed since last analysis (at least 5 min)
  if (lastAnalysisTime) {
    const elapsed = Date.now() - lastAnalysisTime;
    if (elapsed < 5 * 60 * 1000 && reasons.length === 0) {
      return { triggered: false, reasons: [] };
    }
  }

  return { triggered: reasons.length > 0, reasons };
}

// --- STEP 3: LLM call (only if threshold triggered) ---

const SYSTEM_PROMPT = `You are a Geo Agent specializing in geopolitical prediction markets on Solana.
You analyze global news tone (GDELT), conflict data (ACLED), economic indicators (FRED), and satellite fire data (NASA FIRMS) to make prediction market trading decisions.

RULES:
- Only act if confidence > ${AGENT_LIMITS.MIN_CONFIDENCE * 100}%
- Max position size: ${AGENT_LIMITS.MAX_PORTFOLIO_PERCENT_PER_MARKET * 100}% of portfolio per market
- Max ${AGENT_LIMITS.MAX_CONCURRENT_POSITIONS} concurrent positions
- Only trade markets settling within ${AGENT_LIMITS.MAX_MARKET_DAYS_TO_RESOLUTION} days
- Only trade markets with >$${AGENT_LIMITS.MIN_MARKET_VOLUME.toLocaleString()} volume
- Be specific in your reasoning — cite data signals
- If uncertain, choose "hold"

OUTPUT FORMAT:
Return a JSON object with: action ("buy"|"sell"|"hold"), marketId, marketQuestion, isYes (boolean), amount (USDC), confidence (0-1), reasoning (string).`;

export async function analyzeWithLLM(
  signals: GeoSignals,
  markets: MarketContext[],
  positions: AgentPosition[],
  portfolioBalance: number,
  thresholdReasons: string[]
): Promise<LLMDecision> {
  const userMessage = buildAnalysisPrompt(
    signals,
    markets,
    positions,
    portfolioBalance,
    thresholdReasons
  );

  try {
    const completion = await llm.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 1000,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return {
        action: "hold",
        confidence: 0,
        reasoning: "LLM returned empty response",
      };
    }

    const parsed = JSON.parse(content);
    const decision = LLMDecisionSchema.parse(parsed);

    // Enforce confidence threshold
    if (decision.confidence < AGENT_LIMITS.MIN_CONFIDENCE) {
      return {
        action: "hold",
        confidence: decision.confidence,
        reasoning: `Confidence ${decision.confidence} below threshold ${AGENT_LIMITS.MIN_CONFIDENCE}. Original: ${decision.reasoning}`,
      };
    }

    return decision;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("LLM analysis failed:", message);
    return {
      action: "hold",
      confidence: 0,
      reasoning: `LLM error: ${message}`,
    };
  }
}

function buildAnalysisPrompt(
  signals: GeoSignals,
  markets: MarketContext[],
  positions: AgentPosition[],
  portfolioBalance: number,
  thresholdReasons: string[]
): string {
  const sections: string[] = [];

  sections.push(`## Portfolio
- Balance: $${portfolioBalance.toFixed(2)} USDC
- Open positions: ${positions.length}/${AGENT_LIMITS.MAX_CONCURRENT_POSITIONS}`);

  if (positions.length > 0) {
    sections.push("### Open Positions:");
    for (const pos of positions) {
      sections.push(
        `- ${pos.marketId}: ${pos.side} $${pos.amount} @ ${pos.entryPrice} (current: ${pos.currentPrice}, PnL: $${pos.pnl.toFixed(2)})`
      );
    }
  }

  sections.push(`\n## Threshold Triggers`);
  for (const reason of thresholdReasons) {
    sections.push(`- ${reason}`);
  }

  sections.push(`\n## GDELT News Tone`);
  for (const [topic, signal] of Object.entries(signals.gdelt)) {
    sections.push(
      `- ${topic}: tone=${signal.avgTone} (${signal.articleCount} articles)`
    );
    for (const article of signal.topArticles.slice(0, 3)) {
      sections.push(`  - "${article.title}"`);
    }
  }

  sections.push(`\n## ACLED Conflict Data`);
  for (const [region, signal] of Object.entries(signals.acled)) {
    sections.push(
      `- ${region}: ${signal.totalEvents} events, ${signal.totalFatalities} fatalities, 7d delta=${signal.delta7d}%`
    );
  }

  sections.push(`\n## FRED Economic Indicators`);
  for (const [key, signal] of Object.entries(signals.fred)) {
    sections.push(
      `- ${key} (${signal.seriesId}): ${signal.latestValue} (${signal.trend}, ${signal.changePercent}% change)`
    );
  }

  sections.push(`\n## NASA FIRMS Wildfire Data`);
  for (const [region, signal] of Object.entries(signals.fires)) {
    sections.push(
      `- ${region}: ${signal.hotspotCount} hotspots, FRP=${signal.totalFrp} MW`
    );
  }

  sections.push(`\n## Available Markets`);
  for (const market of markets.slice(0, 10)) {
    const prices = market.outcomes
      .map((o) => `${o.name}: $${o.price}`)
      .join(", ");
    sections.push(
      `- [${market.marketId}] "${market.question}" | ${prices} | Vol: $${market.volume} | Closes: ${market.closesAt ?? "N/A"}`
    );
  }

  sections.push(`\n## Decision Required
Analyze the signals above. If you find an edge in any market, recommend a buy/sell. Otherwise, recommend hold.
Remember: confidence must be >${AGENT_LIMITS.MIN_CONFIDENCE * 100}% to trade.`);

  return sections.join("\n");
}
