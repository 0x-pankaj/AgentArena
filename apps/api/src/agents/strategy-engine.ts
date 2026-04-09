import { AGENT_LIMITS } from "@agent-arena/shared";
import { getGeoSignals, type GdeltToneSignal } from "../data-sources/gdelt";
import { getRegionalConflictSignals, type AcledConflictSignal } from "../data-sources/acled";
import { getKeyMacroSignals, type FredMacroSignal } from "../data-sources/fred";
import { getAllRegionalFireSignals, type FireSignal } from "../data-sources/nasa-firms";
import type { TradeDecision } from "../ai/types";

export type LLMDecision = TradeDecision;

// --- Threshold check result ---

export interface ThresholdCheck {
  triggered: boolean;
  reasons: string[];
  skippedReasons?: string[];
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
  agentType: string = "general",
  consecutiveNoEdge: number = 0
): ThresholdCheck {
  const reasons: string[] = [];
  const skippedReasons: string[] = [];

  if (agentType === "sports" || agentType === "general") {
    if (signals.sports) {
      let sportsDetected = false;
      for (const [sport, signal] of Object.entries(signals.sports)) {
        if (signal.totalEvents > 0) {
          sportsDetected = true;
          reasons.push(`Sports: ${sport} has ${signal.totalEvents} upcoming events`);
          if (Math.abs(signal.sharpMoneyIndicator) > 0.3) {
            reasons.push(
              `Sharp money detected on ${sport}: indicator=${signal.sharpMoneyIndicator.toFixed(2)}`
            );
          }
        }
      }
      if (!sportsDetected) {
        skippedReasons.push("Sports: no upcoming events detected");
      }
    } else {
      skippedReasons.push("Sports: signal data not available");
    }
  }

  if (agentType === "crypto" || agentType === "general") {
    if (signals.crypto) {
      let cryptoDetected = false;
      for (const [coin, signal] of Object.entries(signals.crypto.prices)) {
        if (Math.abs(signal.change24h) > 5) {
          cryptoDetected = true;
          reasons.push(
            `Crypto move: ${coin} ${signal.change24h > 0 ? "up" : "down"} ${Math.abs(signal.change24h).toFixed(1)}% (vol: $${(signal.volume24h / 1e6).toFixed(1)}M)`
          );
        }
        if (Math.abs(signal.change7d) > 15) {
          cryptoDetected = true;
          reasons.push(
            `Crypto weekly: ${coin} ${signal.change7d > 0 ? "up" : "down"} ${Math.abs(signal.change7d).toFixed(1)}% in 7d`
          );
        }
      }
      if (signals.crypto.global) {
        const capChange = signals.crypto.global.marketCapChange24h;
        if (Math.abs(capChange) > 3) {
          cryptoDetected = true;
          reasons.push(
            `Global crypto market cap ${capChange > 0 ? "up" : "down"} ${Math.abs(capChange).toFixed(1)}%`
          );
        }
      }
      if (!cryptoDetected) {
        skippedReasons.push("Crypto: no significant price movement (24h <5%, 7d <15%)");
      }
    } else {
      skippedReasons.push("Crypto: signal data not available");
    }
  }

  if (agentType === "politics" || agentType === "general") {
    let politicsDetected = false;
    
    for (const [key, signal] of Object.entries(signals.gdelt)) {
      if (Math.abs(signal.avgTone) > 3) {
        politicsDetected = true;
        reasons.push(
          `GDELT tone spike: ${key} tone=${signal.avgTone.toFixed(2)} (${signal.articleCount} articles)`
        );
      }
    }
    if (Object.keys(signals.gdelt).length === 0) {
      skippedReasons.push("GDELT: no tone data available");
    }

    for (const [region, signal] of Object.entries(signals.acled)) {
      if (Math.abs(signal.delta7d) > 50) {
        politicsDetected = true;
        reasons.push(
          `ACLED conflict delta: ${region} change=${signal.delta7d.toFixed(1)}% (${signal.totalEvents} events, ${signal.totalFatalities} fatalities)`
        );
      }
    }
    if (Object.keys(signals.acled).length === 0) {
      skippedReasons.push("ACLED: no conflict delta data available");
    }

    for (const [key, signal] of Object.entries(signals.fred)) {
      if (Math.abs(signal.changePercent) > 1) {
        politicsDetected = true;
        reasons.push(
          `FRED macro surprise: ${key} ${signal.trend} ${signal.changePercent.toFixed(2)}% (latest: ${signal.latestValue})`
        );
      }
    }

    for (const [region, signal] of Object.entries(signals.fires)) {
      if (signal.hotspotCount > 50) {
        politicsDetected = true;
        reasons.push(
          `NASA FIRMS: ${region} ${signal.hotspotCount} hotspots (FRP=${signal.totalFrp.toFixed(1)} MW)`
        );
      }
    }
    if (!politicsDetected && Object.keys(signals.gdelt).length === 0 && Object.keys(signals.acled).length === 0) {
      skippedReasons.push("Politics: no GDELT/ACLED/FRED thresholds exceeded (tone ≤3, conflict ≤50%, FRED ≤1%)");
    }
  }

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

  if (consecutiveNoEdge >= 3 && markets.length > 0) {
    reasons.push(`Forced analysis after ${consecutiveNoEdge} no-edge cycles — reviewing best available markets`);
    return { triggered: true, reasons, skippedReasons };
  }

  if (lastAnalysisTime) {
    const elapsed = Date.now() - lastAnalysisTime;
    const minInterval = 5 * 60 * 1000;
    const maxInterval = 15 * 60 * 1000;
    
    if (elapsed < minInterval && reasons.length === 0) {
      return { triggered: false, reasons: [], skippedReasons: [`Analysis cooldown: ${Math.round((minInterval - elapsed) / 1000)}s remaining`] };
    }
    
    if (elapsed >= maxInterval && markets.length > 0) {
      reasons.push(`Extended review — ${Math.round(elapsed / 60000)}min since last analysis, ${markets.length} markets to review`);
      return { triggered: true, reasons, skippedReasons };
    }
    
    if (elapsed >= minInterval && markets.length > 0 && reasons.length === 0) {
      reasons.push(`Periodic analysis — ${markets.length} markets to review (${Math.round(elapsed / 60000)}min since last)`);
    }
  }

  if (!lastAnalysisTime && reasons.length === 0) {
    reasons.push("Initial analysis — first run");
  }

  return { triggered: reasons.length > 0, reasons, skippedReasons };
}
