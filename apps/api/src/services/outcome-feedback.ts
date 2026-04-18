// ============================================================
// 4. Outcome Feedback Loop
//    Called when a market resolves or position closes.
//    Scores signals, updates calibration, feeds into evolution.
// ============================================================

import { db, schema } from "../db";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import {
  scoreResolvedMarket,
  recordSignalPrediction,
  recordConfidencePrediction,
} from "./calibration-service";
import { runEvolutionCycle } from "./evolution-service";
import { publishFeedEvent, buildFeedEvent } from "../feed";
import type { SharedSignals } from "./signal-cache";
import type { MarketContext } from "../agents/strategy-engine";
import type { TradeDecision } from "../ai/types";

// --- Resolution status for a market ---

export interface MarketResolution {
  marketId: string;
  question: string;
  outcome: boolean; // true = YES resolved, false = NO resolved
  resolvedAt: Date;
}

// --- Track what the agent predicted for later scoring ---

export async function recordAgentPrediction(
  agentType: string,
  agentId: string,
  decision: TradeDecision,
  signals: SharedSignals,
  markets: MarketContext[],
  model: string
): Promise<void> {
  const positionId = `pending:${agentId}:${decision.marketId}:${Date.now()}`;

  // Record signal source predictions
  const signalSources = extractSignalSources(signals);

  for (const [source, pred] of Object.entries(signalSources)) {
    await recordSignalPrediction(agentType, source, pred, decision.marketId ?? "", positionId);
  }

  // Record confidence prediction for calibration
  if (decision.marketId) {
    await recordConfidencePrediction(
      agentType,
      model,
      decision.confidence,
      decision.marketId,
      positionId
    );
  }

  // Store the full decision in Redis for quick lookup
  const key = `${REDIS_KEYS.AGENT_STATS_PREFIX}decision:${agentId}:${decision.marketId}`;
  await redis.setex(
    key,
    7 * 24 * 3600,
    JSON.stringify({
      decision,
      signalSources,
      positionId,
      timestamp: Date.now(),
    })
  );
}

// --- Process a market resolution (call when a market settles) ---

export async function processMarketResolution(
  resolution: MarketResolution
): Promise<{
  agentsScored: number;
  signalsUpdated: string[];
}> {
  let agentsScored = 0;
  const signalsUpdated: string[] = [];
  const agentTypesScored = new Set<string>();

  // Find all positions for this market
  const openPositions = await db
    .select()
    .from(schema.positions)
    .where(
      and(
        eq(schema.positions.marketId, resolution.marketId),
        eq(schema.positions.status, "open")
      )
    );

  for (const position of openPositions) {
    // Get the associated job and agent
    const [job] = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, position.jobId))
      .limit(1);

    if (!job) continue;

    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, job.agentId))
      .limit(1);

    if (!agent) continue;

    const agentType = agent.category;
    agentTypesScored.add(agentType);

    // Score signals for this resolution
    await scoreResolvedMarket(agentType, resolution.marketId, resolution.outcome);

    // Update position status
    const sideWon =
      (resolution.outcome && position.side === "yes") ||
      (!resolution.outcome && position.side === "no");

    const outcome = sideWon ? "win" : "loss";
    const pnl = sideWon
      ? Number(position.amount) * (1 - Number(position.entryPrice))
      : -Number(position.amount) * Number(position.entryPrice);

    await db
      .update(schema.positions)
      .set({
        status: "settled",
        pnl: String(pnl.toFixed(6)),
        currentPrice: resolution.outcome ? "1.000000" : "0.000000",
        closedAt: new Date(),
      })
      .where(eq(schema.positions.id, position.id))
      .catch(() => {});

    // Create trade record
    await db
      .insert(schema.trades)
      .values({
        jobId: position.jobId,
        agentId: job.agentId,
        marketId: position.marketId,
        marketQuestion: position.marketQuestion,
        side: position.side,
        amount: position.amount,
        entryPrice: position.entryPrice,
        exitPrice: String(resolution.outcome ? 1 : 0),
        outcome,
        profitLoss: String(pnl.toFixed(6)),
        reasoning: position.reasoningSnippet ?? undefined,
        settledAt: new Date(),
      })
      .catch(() => {});

    // Publish resolution event
    await publishFeedEvent(
      buildFeedEvent({
        agentId: job.agentId,
        agentName: agent.name,
        jobId: position.jobId,
        category: "position_update",
        severity: sideWon ? "significant" : "critical",
        content: {
          summary: `Market resolved: "${position.marketQuestion}" → ${resolution.outcome ? "YES" : "NO"}`,
          pnl: pnl > 0 ? { value: pnl, percent: Number(position.amount) > 0 ? (pnl / Number(position.amount)) * 100 : 0 } : undefined,
          reasoning_snippet: outcome === "win" ? "Position won" : "Position lost",
        },
        displayMessage: `${agent.name} position resolved: "${position.marketQuestion}" → ${resolution.outcome ? "YES" : "NO"} | PnL: $${pnl.toFixed(2)} (${outcome})`,
      })
    );

    agentsScored++;
  }

  // Also look for pending decisions in Redis and score those
  const decisionKeys = await redis.keys(`${REDIS_KEYS.AGENT_STATS_PREFIX}decision:*:${resolution.marketId}`);
  for (const key of decisionKeys) {
    const raw = await redis.get(key);
    if (!raw) continue;

    try {
      const data = JSON.parse(raw);
      const agentId = key.split(":")[2];

      const [agent] = await db
        .select({ category: schema.agents.category })
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId))
        .limit(1);

      if (agent) {
        await scoreResolvedMarket(agent.category, resolution.marketId, resolution.outcome);
        signalsUpdated.push(agent.category);
      }
    } catch {
      // Skip malformed entries
    }

    await redis.del(key);
  }

  if (agentsScored > 0) {
    const agentTypes = [...new Set(agentTypesScored)];
    for (const agentType of agentTypes) {
      runEvolutionCycle().catch((err) =>
        console.error(`[OutcomeFeedback] Evolution cycle failed for ${agentType}:`, err)
      );
    }
  }

  return { agentsScored, signalsUpdated };
}

// --- Check for market resolutions (called periodically) ---

export async function checkMarketResolutions(): Promise<number> {
  // Find all markets that are still open but may have resolved
  const openPositions = await db
    .selectDistinct({ marketId: schema.positions.marketId })
    .from(schema.positions)
    .where(eq(schema.positions.status, "open"));

  // For each open market, check if it's resolved via Jupiter Predict
  // (This would be called from a cron job or supervisor tick)
  // The actual API check is done by the caller — this just processes results

  return openPositions.length;
}

// --- Extract per-source predictions from signals ---

function extractSignalSources(signals: SharedSignals): Record<string, number> {
  const sources: Record<string, number> = {};

  // GDELT signals → probability estimates
  for (const [key, signal] of Object.entries(signals.gdelt)) {
    if ((signal as any).avgTone !== undefined) {
      const tone = (signal as any).avgTone as number;
      sources[`gdelt_${key}`] = Math.max(0.01, Math.min(0.99, 0.5 + tone / 20));
    }
  }

  // ACLED signals
  for (const [key, signal] of Object.entries(signals.acled)) {
    if ((signal as any).delta7d !== undefined) {
      const delta = (signal as any).delta7d as number;
      sources[`acled_${key}`] = Math.max(0.01, Math.min(0.99, 0.5 + delta / 200));
    }
  }

  // FRED signals
  for (const [key, signal] of Object.entries(signals.fred)) {
    if ((signal as any).changePercent !== undefined) {
      const change = (signal as any).changePercent as number;
      sources[`fred_${key}`] = Math.max(0.01, Math.min(0.99, 0.5 + change / 20));
    }
  }

  // Crypto signals
  if (signals.crypto) {
    for (const [coin, data] of Object.entries(signals.crypto.prices)) {
      const change = (data as any).change24h ?? 0;
      sources[`crypto_${coin}`] = Math.max(0.01, Math.min(0.99, 0.5 + change / 30));
    }
  }

  // Sports signals
  if (signals.sports) {
    for (const [sport, data] of Object.entries(signals.sports)) {
      const events = (data as any).totalEvents ?? 0;
      if (events > 0) {
        sources[`sports_${sport}`] = 0.6;
      }
    }
  }

  return sources;
}