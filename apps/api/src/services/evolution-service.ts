import { eq, and, desc, sql, isNotNull } from "drizzle-orm";
import { db, schema } from "../db";
import { redis } from "../utils/redis";
import { REDIS_KEYS, EVOLUTION_CONFIG, AGENT_TYPES, PIPELINE_STEPS } from "@agent-arena/shared";
import { generateObject } from "ai";
import { z } from "zod";
import { MODELS, resolveModel } from "../ai/models";
import { publishFeedEvent, buildFeedEvent } from "../feed";

import type {
  AgentTypeCategory,
  PipelineStep,
} from "@agent-arena/shared";

// --- Evolution LLM output schema ---

const EvolutionOutputSchema = z.object({
  improvedPrompt: z.string(),
  changelog: z.string(),
  expectedImprovement: z.string(),
  confidenceScore: z.number().min(0).max(1),
});
type EvolutionOutput = z.infer<typeof EvolutionOutputSchema>;

// --- Evolver meta-prompt ---

const EVOLVER_SYSTEM_PROMPT = `You are an AI prompt engineer specializing in prediction market trading agents. 
Your job is to analyze an agent's trading performance and improve its system prompt to increase win rate and profitability.

RULES:
- Keep the same general structure and format as the original prompt
- Add specific guidance to avoid patterns seen in losses
- Strengthen successful patterns seen in wins
- Do not change output format requirements (if any)
- Keep the prompt concise and actionable
- Focus on concrete behavioral changes, not vague advice
- Maintain the same tone and persona as the original`;

// --- Redis cache key for prompts ---

function promptCacheKey(agentType: string, pipelineStep: string): string {
  return `${REDIS_KEYS.AGENT_STATS_PREFIX}prompt:${agentType}:${pipelineStep}`;
}

// --- Get active prompt from DB with Redis caching ---

export async function getActivePrompt(
  agentType: string,
  pipelineStep: string
): Promise<string | null> {
  // Check Redis cache first
  const cached = await redis.get(promptCacheKey(agentType, pipelineStep));
  if (cached) return cached;

  // Load from DB
  const [version] = await db
    .select()
    .from(schema.agentPromptVersions)
    .where(
      and(
        eq(schema.agentPromptVersions.agentType, agentType),
        eq(schema.agentPromptVersions.pipelineStep, pipelineStep),
        eq(schema.agentPromptVersions.isActive, true)
      )
    )
    .limit(1);

  if (!version) return null;

  // Cache in Redis
  await redis.setex(
    promptCacheKey(agentType, pipelineStep),
    EVOLUTION_CONFIG.PROMPT_CACHE_TTL,
    version.systemPrompt
  );

  return version.systemPrompt;
}

// --- Get all active prompts for an agent type ---

export async function getActivePrompts(
  agentType: string
): Promise<{ research: string | null; analysis: string | null; decision: string | null }> {
  const [research, analysis, decision] = await Promise.all([
    getActivePrompt(agentType, "research"),
    getActivePrompt(agentType, "analysis"),
    getActivePrompt(agentType, "decision"),
  ]);

  return { research, analysis, decision };
}

// --- Clear prompt cache (after evolution) ---

async function clearPromptCache(agentType: string, pipelineStep: string): Promise<void> {
  await redis.del(promptCacheKey(agentType, pipelineStep));
}

// --- Record prompt links for a position ---

export async function recordPromptLinks(
  positionId: string,
  agentType: string
): Promise<void> {
  const steps: PipelineStep[] = ["research", "analysis", "decision"];

  for (const step of steps) {
    const [version] = await db
      .select({ id: schema.agentPromptVersions.id })
      .from(schema.agentPromptVersions)
      .where(
        and(
          eq(schema.agentPromptVersions.agentType, agentType),
          eq(schema.agentPromptVersions.pipelineStep, step),
          eq(schema.agentPromptVersions.isActive, true)
        )
      )
      .limit(1);

    if (version) {
      await db.insert(schema.tradePromptLinks).values({
        positionId,
        promptVersionId: version.id,
        pipelineStep: step,
      });
    }
  }
}

// --- Check if agent type should evolve ---

export async function shouldEvolve(agentType: string): Promise<boolean> {
  // Get the latest evolution event for this agent type
  const [lastEvolution] = await db
    .select()
    .from(schema.evolutionEvents)
    .where(eq(schema.evolutionEvents.agentType, agentType))
    .orderBy(desc(schema.evolutionEvents.createdAt))
    .limit(1);

  // Count trades since last evolution (or all trades if never evolved)
  let tradeCount: number;

  if (lastEvolution) {
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.trades)
      .innerJoin(schema.agents, eq(schema.agents.id, schema.trades.agentId))
      .where(
        and(
          eq(schema.agents.category, agentType),
          sql`${schema.trades.executedAt} > ${lastEvolution.createdAt}`,
          isNotNull(schema.trades.outcome)
        )
      );
    tradeCount = Number(result?.count ?? 0);
  } else {
    // Never evolved - count all settled trades for this agent type
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.trades)
      .innerJoin(schema.agents, eq(schema.agents.id, schema.trades.agentId))
      .where(
        and(
          eq(schema.agents.category, agentType),
          isNotNull(schema.trades.outcome)
        )
      );
    tradeCount = Number(result?.count ?? 0);
  }

  return tradeCount >= EVOLUTION_CONFIG.MIN_TRADES_TO_EVOLVE;
}

// --- Collect evolution data for a specific pipeline step ---

interface EvolutionData {
  currentPrompt: string;
  wins: Array<{ reasoning: string; pnl: number; marketQuestion: string; weight?: number }>;
  losses: Array<{ reasoning: string; pnl: number; marketQuestion: string; weight?: number }>;
  totalTrades: number;
  winRate: number;
  avgPnl: number;
  regretScore: number;
}

async function collectEvolutionData(
  agentType: string,
  pipelineStep: string
): Promise<EvolutionData | null> {
  const currentPrompt = await getActivePrompt(agentType, pipelineStep);
  if (!currentPrompt) return null;

  // Get trades linked to prompt versions for this agent type + step
  const linkedTrades = await db
    .select({
      outcome: schema.trades.outcome,
      profitLoss: schema.trades.profitLoss,
      reasoning: schema.trades.reasoning,
      marketQuestion: schema.trades.marketQuestion,
      promptVersionId: schema.tradePromptLinks.promptVersionId,
    })
    .from(schema.trades)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.trades.agentId))
    .innerJoin(
      schema.tradePromptLinks,
      eq(schema.tradePromptLinks.positionId, schema.trades.jobId)
    )
    .where(
      and(
        eq(schema.agents.category, agentType),
        eq(schema.tradePromptLinks.pipelineStep, pipelineStep),
        isNotNull(schema.trades.outcome)
      )
    )
    .orderBy(desc(schema.trades.executedAt))
    .limit(100);

  // If not enough linked trades, fall back to all trades for this agent type
  let trades: Array<{
    outcome: string | null;
    profitLoss: string | null;
    reasoning: string | null;
    marketQuestion: string;
    promptVersionId: string | null;
  }> = linkedTrades;
  if (trades.length < 10) {
    trades = await db
      .select({
        outcome: schema.trades.outcome,
        profitLoss: schema.trades.profitLoss,
        reasoning: schema.trades.reasoning,
        marketQuestion: schema.trades.marketQuestion,
        promptVersionId: sql<string | null>`null`,
      })
      .from(schema.trades)
      .innerJoin(schema.agents, eq(schema.agents.id, schema.trades.agentId))
      .where(
        and(
          eq(schema.agents.category, agentType),
          isNotNull(schema.trades.outcome)
        )
      )
      .orderBy(desc(schema.trades.executedAt))
      .limit(100);
  }

  if (trades.length < 5) return null;

  // Regret minimization: weight recent losses higher (exponential decay)
  // Recent losses (last 10 trades) are 2x more important than older losses
  const now = Date.now();
  const REGRET_HALF_LIFE_TRADES = 15; // trades

  const weightedTrades = trades.map((t, idx) => {
    const tradesAgo = trades.length - idx;
    const regretWeight = Math.pow(2, -tradesAgo / REGRET_HALF_LIFE_TRADES);
    return { ...t, regretWeight };
  });

  const wins = weightedTrades
    .filter((t) => t.outcome === "win")
    .slice(0, 20)
    .map((t) => ({
      reasoning: t.reasoning ?? "No reasoning recorded",
      pnl: Number(t.profitLoss ?? 0),
      marketQuestion: t.marketQuestion,
      weight: t.regretWeight,
    }));

  const losses = weightedTrades
    .filter((t) => t.outcome === "loss")
    .slice(0, 20)
    .map((t) => ({
      reasoning: t.reasoning ?? "No reasoning recorded",
      pnl: Number(t.profitLoss ?? 0),
      marketQuestion: t.marketQuestion,
      weight: t.regretWeight,
    }));

  const totalTrades = trades.length;
  const winningTrades = wins.length;
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;

  // Regret-weighted PnL (recent losses hurt more)
  const totalPnl = weightedTrades.reduce((sum, t) => sum + Number(t.profitLoss ?? 0) * t.regretWeight, 0);
  const totalWeight = weightedTrades.reduce((sum, t) => sum + t.regretWeight, 0);
  const avgPnl = totalWeight > 0 ? totalPnl / totalWeight : 0;

  // Regret score: how much better could we have done?
  // Sum of (maxPossible - actual) weighted by recency
  const maxPossiblePnL = weightedTrades
    .filter((t) => t.outcome === "loss")
    .reduce((sum, t) => sum + Math.abs(Number(t.profitLoss ?? 0)) * t.regretWeight, 0);
  const regretScore = maxPossiblePnL;

  return { currentPrompt, wins, losses, totalTrades, winRate, avgPnl, regretScore };
}

// --- Generate evolution via LLM ---

async function generateEvolution(
  agentType: string,
  pipelineStep: string,
  data: EvolutionData
): Promise<EvolutionOutput | null> {
  const winsText = data.wins
    .map(
      (w, i) =>
        `WIN ${i + 1}: "${w.marketQuestion}" | PnL: $${w.pnl.toFixed(2)} | Reasoning: ${w.reasoning.slice(0, 300)}`
    )
    .join("\n\n");

  // Sort losses by weight (regret) — highest regret first
  const sortedLosses = [...data.losses].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));

  const lossesText = sortedLosses
    .map(
      (l, i) =>
        `LOSS ${i + 1} (regret weight: ${((l.weight ?? 1) * 100).toFixed(0)}%): "${l.marketQuestion}" | PnL: $${l.pnl.toFixed(2)} | Reasoning: ${l.reasoning.slice(0, 300)}`
    )
    .join("\n\n");

  const userMessage = `## Current Prompt (Agent: ${agentType}, Step: ${pipelineStep})
\`\`\`
${data.currentPrompt}
\`\`\`

## Performance Data
- Total trades analyzed: ${data.totalTrades}
- Win rate: ${(data.winRate * 100).toFixed(1)}%
- Average PnL per trade: $${data.avgPnl.toFixed(2)}
- Regret score: $${data.regretScore.toFixed(2)} (weighted recent losses — higher = more urgent to fix)

## Winning Trades (last ${data.wins.length})
${winsText || "No winning trades available."}

## Losing Trades (sorted by regret — most costly recent losses first)
${lossesText || "No losing trades available."}

## Task
Analyze the losing trades to identify patterns in what the agent consistently got wrong.
PAY EXTRA ATTENTION to high-regret-weight losses (recent, large losses) — these indicate current blind spots.
Then improve the system prompt to address these weaknesses while preserving what works in winning trades.

Return the improved prompt, a changelog describing what changed, and your confidence in the improvement.`;

  try {
    const model = resolveModel(MODELS.kimi);

    const result = await (generateObject as any)({
      model,
      system: EVOLVER_SYSTEM_PROMPT,
      prompt: userMessage,
      schema: EvolutionOutputSchema,
      temperature: 0.4,
      maxRetries: 2,
    });

    return result.object as EvolutionOutput;
  } catch (err) {
    console.error(`[Evolution] LLM generation failed for ${agentType}/${pipelineStep}:`, err);
    return null;
  }
}

// --- Create a new prompt version ---

async function createPromptVersion(
  agentType: string,
  pipelineStep: string,
  prompt: string,
  parentVersionId: string | null,
  changelog: string,
  performanceSnapshot: { winRate: number; totalTrades: number; totalPnl: number }
): Promise<string> {
  // Get current max version number
  const [maxVersion] = await db
    .select({ max: sql<number>`max(${schema.agentPromptVersions.versionNumber})` })
    .from(schema.agentPromptVersions)
    .where(
      and(
        eq(schema.agentPromptVersions.agentType, agentType),
        eq(schema.agentPromptVersions.pipelineStep, pipelineStep)
      )
    );

  const nextVersion = (Number(maxVersion?.max) ?? 0) + 1;

  const [version] = await db
    .insert(schema.agentPromptVersions)
    .values({
      agentType,
      pipelineStep,
      versionNumber: nextVersion,
      systemPrompt: prompt,
      parentVersionId,
      createdBy: "system",
      isActive: false,
      changelog,
      performanceSnapshot,
    })
    .returning();

  console.log(
    `[Evolution] Created ${agentType}/${pipelineStep} v${nextVersion}`
  );

  return version.id;
}

// --- Promote a prompt version ---

export async function promotePromptVersion(versionId: string): Promise<boolean> {
  const [version] = await db
    .select()
    .from(schema.agentPromptVersions)
    .where(eq(schema.agentPromptVersions.id, versionId))
    .limit(1);

  if (!version) return false;

  // Use transaction to prevent race condition between deactivate and activate
  await db.transaction(async (tx) => {
    // Deactivate current active version for same agentType + pipelineStep
    await tx
      .update(schema.agentPromptVersions)
      .set({ isActive: false })
      .where(
        and(
          eq(schema.agentPromptVersions.agentType, version.agentType),
          eq(schema.agentPromptVersions.pipelineStep, version.pipelineStep),
          eq(schema.agentPromptVersions.isActive, true)
        )
      );

    // Activate new version
    await tx
      .update(schema.agentPromptVersions)
      .set({ isActive: true })
      .where(eq(schema.agentPromptVersions.id, versionId));
  });

  // Clear Redis cache
  await clearPromptCache(version.agentType, version.pipelineStep);

  console.log(
    `[Evolution] Promoted ${version.agentType}/${version.pipelineStep} v${version.versionNumber}`
  );

  return true;
}

// --- Rollback to a previous version ---

export async function rollbackPromptVersion(versionId: string): Promise<boolean> {
  const [version] = await db
    .select()
    .from(schema.agentPromptVersions)
    .where(eq(schema.agentPromptVersions.id, versionId))
    .limit(1);

  if (!version) return false;

  return promotePromptVersion(versionId);
}

// --- Run evolution for a single agent type + pipeline step ---

async function evolveStep(
  agentType: string,
  pipelineStep: string
): Promise<{ evolved: boolean; reason: string }> {
  // Collect trade data
  const data = await collectEvolutionData(agentType, pipelineStep);
  if (!data) {
    return { evolved: false, reason: "Not enough trade data" };
  }

  if (data.totalTrades < EVOLUTION_CONFIG.MIN_TRADES_TO_EVOLVE) {
    return {
      evolved: false,
      reason: `Only ${data.totalTrades} trades (need ${EVOLUTION_CONFIG.MIN_TRADES_TO_EVOLVE})`,
    };
  }

  // Generate improved prompt
  const evolution = await generateEvolution(agentType, pipelineStep, data);
  if (!evolution) {
    return { evolved: false, reason: "LLM generation failed" };
  }

  // Get current active version ID
  const [currentVersion] = await db
    .select()
    .from(schema.agentPromptVersions)
    .where(
      and(
        eq(schema.agentPromptVersions.agentType, agentType),
        eq(schema.agentPromptVersions.pipelineStep, pipelineStep),
        eq(schema.agentPromptVersions.isActive, true)
      )
    )
    .limit(1);

  // Create new version
  const newVersionId = await createPromptVersion(
    agentType,
    pipelineStep,
    evolution.improvedPrompt,
    currentVersion?.id ?? null,
    evolution.changelog,
    {
      winRate: data.winRate,
      totalTrades: data.totalTrades,
      totalPnl: data.avgPnl * data.totalTrades,
    }
  );

  // Calculate improvement
  const improvementPct = evolution.confidenceScore * (1 - data.winRate);
  const shouldAutoPromote = improvementPct >= EVOLUTION_CONFIG.AUTO_PROMOTE_THRESHOLD;

  // Log evolution event
  await db.insert(schema.evolutionEvents).values({
    agentType,
    pipelineStep,
    fromVersionId: currentVersion?.id ?? null,
    toVersionId: newVersionId,
    tradesAnalyzed: data.totalTrades,
    oldWinRate: String(data.winRate),
    newProjectedWinRate: String(Math.min(1, data.winRate + improvementPct)),
    changelog: evolution.changelog,
    autoPromoted: shouldAutoPromote,
  });

  if (shouldAutoPromote) {
    await promotePromptVersion(newVersionId);

    // Publish feed event
    const feedEvent = buildFeedEvent({
      agentId: `evolution-${agentType}`,
      agentName: `${agentType.charAt(0).toUpperCase() + agentType.slice(1)} Agent`,
      category: "evolution",
      severity: "significant",
      content: {
        summary: `${pipelineStep} prompt evolved to v${(currentVersion?.versionNumber ?? 0) + 1}`,
        pipeline_stage: "evolution",
        confidence: evolution.confidenceScore,
      },
      displayMessage: `${agentType.charAt(0).toUpperCase() + agentType.slice(1)} Agent's ${pipelineStep} prompt evolved to v${(currentVersion?.versionNumber ?? 0) + 1} — ${evolution.expectedImprovement}`,
    });
    await publishFeedEvent(feedEvent);

    return { evolved: true, reason: `Auto-promoted: ${evolution.changelog}` };
  }

  return {
    evolved: false,
    reason: `New version created but not promoted (improvement ${(improvementPct * 100).toFixed(1)}% < ${(EVOLUTION_CONFIG.AUTO_PROMOTE_THRESHOLD * 100).toFixed(1)}% threshold)`,
  };
}

// --- Main evolution cycle ---

export async function runEvolutionCycle(): Promise<{
  results: Array<{ agentType: string; pipelineStep: string; evolved: boolean; reason: string }>;
}> {
  console.log("[Evolution] Starting evolution cycle...");
  const results: Array<{
    agentType: string;
    pipelineStep: string;
    evolved: boolean;
    reason: string;
  }> = [];

  for (const agentType of AGENT_TYPES) {
    const needsEvolution = await shouldEvolve(agentType);
    if (!needsEvolution) {
      console.log(`[Evolution] ${agentType}: not enough trades since last evolution`);
      continue;
    }

    for (const step of PIPELINE_STEPS) {
      try {
        const result = await evolveStep(agentType, step);
        results.push({ agentType, pipelineStep: step, ...result });
        console.log(
          `[Evolution] ${agentType}/${step}: ${result.evolved ? "EVOLVED" : "skipped"} — ${result.reason}`
        );
      } catch (err) {
        console.error(`[Evolution] ${agentType}/${step} failed:`, err);
        results.push({
          agentType,
          pipelineStep: step,
          evolved: false,
          reason: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
        });
      }
    }
  }

  const evolvedCount = results.filter((r) => r.evolved).length;
  console.log(
    `[Evolution] Cycle complete: ${evolvedCount} prompts evolved out of ${results.length} steps checked`
  );

  return { results };
}

// --- List prompt versions ---

export async function listPromptVersions(params: {
  agentType?: string;
  pipelineStep?: string;
  limit?: number;
}): Promise<typeof schema.agentPromptVersions.$inferSelect[]> {
  const conditions = [];
  if (params.agentType) {
    conditions.push(eq(schema.agentPromptVersions.agentType, params.agentType));
  }
  if (params.pipelineStep) {
    conditions.push(eq(schema.agentPromptVersions.pipelineStep, params.pipelineStep));
  }

  const query = db
    .select()
    .from(schema.agentPromptVersions)
    .orderBy(desc(schema.agentPromptVersions.createdAt))
    .limit(params.limit ?? 50);

  if (conditions.length > 0) {
    return query.where(and(...conditions));
  }

  return query;
}

// --- Get evolution history ---

export async function getEvolutionHistory(
  limit: number = 50
): Promise<typeof schema.evolutionEvents.$inferSelect[]> {
  return db
    .select()
    .from(schema.evolutionEvents)
    .orderBy(desc(schema.evolutionEvents.createdAt))
    .limit(limit);
}

// --- Get prompt performance ---

export async function getPromptPerformance(promptVersionId: string): Promise<{
  totalTrades: number;
  winningTrades: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
}> {
  const trades = await db
    .select({
      outcome: schema.trades.outcome,
      profitLoss: schema.trades.profitLoss,
    })
    .from(schema.trades)
    .innerJoin(
      schema.tradePromptLinks,
      eq(schema.tradePromptLinks.positionId, schema.trades.jobId)
    )
    .where(eq(schema.tradePromptLinks.promptVersionId, promptVersionId));

  const totalTrades = trades.length;
  const winningTrades = trades.filter((t) => t.outcome === "win").length;
  const totalPnl = trades.reduce((sum, t) => sum + Number(t.profitLoss ?? 0), 0);

  return {
    totalTrades,
    winningTrades,
    winRate: totalTrades > 0 ? winningTrades / totalTrades : 0,
    totalPnl,
    avgPnl: totalTrades > 0 ? totalPnl / totalTrades : 0,
  };
}
