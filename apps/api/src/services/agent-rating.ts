// ============================================================
// Agent-to-Agent Rating System
// After every delegation or consensus round, agents automatically
// rate each other. This feeds into ATOM reputation with Sybil resistance.
// ============================================================

import { eq, and, desc, sql, gte } from "drizzle-orm";
import { db, schema } from "../db";
import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import { submitAtomFeedback, AtomTag, getAtomSummary, computeReputationScore } from "../utils/atom-reputation";
import { publishFeedEvent, buildFeedEvent } from "../feed";

export interface AgentRating {
  ratingAgentId: string;
  ratedAgentId: string;
  tradeOutcome: "win" | "loss" | "pending";
  qualityScore: number; // 0-100
  interactionId: string;
  marketId?: string;
  reasoning?: string;
}

export interface RatingResult {
  success: boolean;
  txSignature?: string;
  newReputationScore?: number;
  error?: string;
}

// ============================================================
// Rate agent performance after a trade resolves
// ============================================================

export async function rateAgentPerformance(
  ratingAgentId: string,
  ratedAgentId: string,
  tradeOutcome: "win" | "loss" | "pending",
  interactionId: string,
  reviewerAddress: string
): Promise<RatingResult> {
  try {
    // SYBIL RESISTANCE: Verify these agents actually interacted
    const [interaction] = await db
      .select()
      .from(schema.agentInteractions)
      .where(
        and(
          eq(schema.agentInteractions.id, interactionId),
          eq(schema.agentInteractions.interactionType, "delegation"),
          eq(schema.agentInteractions.fromAgentId, ratingAgentId),
          eq(schema.agentInteractions.toAgentId, ratedAgentId)
        )
      )
      .limit(1);

    if (!interaction) {
      return { success: false, error: "No verified interaction found — cannot rate" };
    }

    // Calculate quality score based on trade outcome
    const qualityScore = calculateContributionScore(tradeOutcome, interaction.metadata);

    // Record rating in DB
    await db
      .update(schema.agentInteractions)
      .set({
        qualityScore: String(qualityScore),
        metadata: {
          ...(interaction.metadata as Record<string, any> ?? {}),
          rating: {
            ratedAt: new Date().toISOString(),
            tradeOutcome,
            qualityScore,
            ratedBy: ratingAgentId,
          },
        },
      })
      .where(eq(schema.agentInteractions.id, interactionId));

    // Insert reverse rating record
    const [ratingRecord] = await db
      .insert(schema.agentInteractions)
      .values({
        fromAgentId: ratingAgentId,
        toAgentId: ratedAgentId,
        jobId: interaction.jobId,
        interactionType: "rating",
        marketId: interaction.marketId,
        marketQuestion: interaction.marketQuestion,
        qualityScore: String(qualityScore),
        metadata: {
          originalInteractionId: interactionId,
          tradeOutcome,
          ratedAt: new Date().toISOString(),
          delegationMetadata: interaction.metadata,
        },
      })
      .returning();

    // Submit ATOM feedback on-chain
    const [ratedAgent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, ratedAgentId))
      .limit(1);

    let txSignature: string | undefined;
    if (ratedAgent?.assetAddress) {
      const feedback = await submitAtomFeedback({
        agentAsset: ratedAgent.assetAddress,
        value: String(qualityScore),
        tag1: tradeOutcome === "win" ? AtomTag.accuracy : AtomTag.loss,
        tag2: AtomTag.day,
        reviewerAddress,
      });

      if (feedback) {
        txSignature = feedback.txSignature;
        await db
          .update(schema.agentInteractions)
          .set({ txSignature })
          .where(eq(schema.agentInteractions.id, ratingRecord.id));
      }
    }

    // Refresh reputation from on-chain
    let newReputationScore: number | undefined;
    if (ratedAgent?.assetAddress) {
      const summary = await getAtomSummary(ratedAgent.assetAddress);
      if (summary) {
        newReputationScore = computeReputationScore(summary);
        await db
          .update(schema.agents)
          .set({
            trustTier: summary.trustTier,
            reputationScore: String(newReputationScore),
          })
          .where(eq(schema.agents.id, ratedAgentId));
      }
    }

    // Publish feed event
    const ratingAgentName = await getAgentName(ratingAgentId);
    const ratedAgentName = await getAgentName(ratedAgentId);
    const feedEvent = buildFeedEvent({
      agentId: ratingAgentId,
      agentName: ratingAgentName,
      jobId: interaction.jobId ?? undefined,
      category: "swarm",
      severity: "info",
      content: {
        summary: `[Rating] ${ratingAgentName} rated ${ratedAgentName} ${qualityScore}/100`,
        type: "rating",
        ratingAgent: ratingAgentName,
        ratedAgent: ratedAgentName,
        qualityScore,
        tradeOutcome,
        marketQuestion: interaction.marketQuestion ?? undefined,
      },
      displayMessage: `${ratingAgentName} rated ${ratedAgentName} ${qualityScore}/100 for "${interaction.marketQuestion ?? "delegation"}"`,
    });
    await publishFeedEvent(feedEvent);

    return { success: true, txSignature, newReputationScore };
  } catch (err: any) {
    console.error(`[Rating] Failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
// Calculate contribution quality score
// ============================================================

export function calculateContributionScore(
  tradeOutcome: "win" | "loss" | "pending",
  delegationMetadata?: any
): number {
  if (tradeOutcome === "pending") return 50; // Neutral for unresolved
  if (tradeOutcome === "win") return 85 + Math.floor(Math.random() * 15); // 85-100
  if (tradeOutcome === "loss") return 20 + Math.floor(Math.random() * 30); // 20-50
  return 50;
}

// ============================================================
// Batch submit pending ratings (run by cron or supervisor)
// ============================================================

export async function batchSubmitRatings(
  reviewerAddress: string,
  maxBatchSize: number = 50
): Promise<{ processed: number; errors: number }> {
  const pending = await db
    .select()
    .from(schema.agentInteractions)
    .where(
      and(
        eq(schema.agentInteractions.interactionType, "delegation"),
        sql`${schema.agentInteractions.qualityScore} IS NULL`,
        sql`${schema.agentInteractions.metadata}->>'rating' IS NULL`
      )
    )
    .limit(maxBatchSize);

  let processed = 0;
  let errors = 0;

  for (const interaction of pending) {
    try {
      // For now, auto-rate as pending if no trade outcome known
      // In production, look up the actual trade outcome from trades table
      const outcome = await determineTradeOutcome(interaction.marketId, interaction.jobId);
      const result = await rateAgentPerformance(
        interaction.fromAgentId,
        interaction.toAgentId,
        outcome,
        interaction.id,
        reviewerAddress
      );
      if (result.success) processed++;
      else errors++;
    } catch {
      errors++;
    }
  }

  return { processed, errors };
}

async function determineTradeOutcome(
  marketId: string | null,
  jobId: string | null
): Promise<"win" | "loss" | "pending"> {
  if (!marketId || !jobId) return "pending";

  const trade = await db
    .select()
    .from(schema.trades)
    .where(
      and(
        eq(schema.trades.marketId, marketId),
        eq(schema.trades.jobId, jobId)
      )
    )
    .limit(1);

  if (trade.length === 0) return "pending";
  return trade[0].outcome === "win" ? "win" : trade[0].outcome === "loss" ? "loss" : "pending";
}

// ============================================================
// Get peer ratings for an agent
// ============================================================

export async function getPeerRatings(agentId: string) {
  const received = await db
    .select()
    .from(schema.agentInteractions)
    .where(
      and(
        eq(schema.agentInteractions.toAgentId, agentId),
        eq(schema.agentInteractions.interactionType, "rating")
      )
    )
    .orderBy(desc(schema.agentInteractions.createdAt));

  const sent = await db
    .select()
    .from(schema.agentInteractions)
    .where(
      and(
        eq(schema.agentInteractions.fromAgentId, agentId),
        eq(schema.agentInteractions.interactionType, "rating")
      )
    )
    .orderBy(desc(schema.agentInteractions.createdAt));

  const avgReceived =
    received.length > 0
      ? received.reduce((sum, r) => sum + Number(r.qualityScore ?? 0), 0) / received.length
      : 0;

  return {
    received,
    sent,
    averageReceived: Math.round(avgReceived * 100) / 100,
    count: received.length,
  };
}

// ============================================================
// Get Swarm Score for leaderboard
// Combines reputation, network centrality, and interaction quality
// ============================================================

export async function getSwarmScore(agentId: string): Promise<number> {
  const [agent] = await db
    .select({ reputationScore: schema.agents.reputationScore })
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId))
    .limit(1);

  const reputation = agent?.reputationScore ? Number(agent.reputationScore) : 0;

  // Network activity score
  const totalInteractions = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.agentInteractions)
    .where(
      and(
        sql`${schema.agentInteractions.fromAgentId} = ${agentId} OR ${schema.agentInteractions.toAgentId} = ${agentId}`,
        sql`${schema.agentInteractions.txSignature} IS NOT NULL`
      )
    );

  const activityScore = Math.min((totalInteractions[0]?.count ?? 0) * 2, 30);

  // Rating quality score
  const peerRatings = await getPeerRatings(agentId);
  const ratingScore = (peerRatings.averageReceived / 100) * 20;

  // Diversity score (interacts with different agents)
  const uniquePartners = await db
    .select({
      uniquePartners: sql<number>`count(distinct case when ${schema.agentInteractions.fromAgentId} = ${agentId} then ${schema.agentInteractions.toAgentId} else ${schema.agentInteractions.fromAgentId} end)`,
    })
    .from(schema.agentInteractions)
    .where(
      sql`${schema.agentInteractions.fromAgentId} = ${agentId} OR ${schema.agentInteractions.toAgentId} = ${agentId}`
    );

  const diversityScore = Math.min((uniquePartners[0]?.uniquePartners ?? 0) * 5, 20);

  const swarmScore = reputation * 0.3 + activityScore + ratingScore + diversityScore;
  const finalScore = Number.isNaN(swarmScore) ? 0 : Math.min(swarmScore, 100);
  return Math.round(finalScore * 100) / 100;
}

// --- Helper ---

async function getAgentName(agentId: string): Promise<string> {
  const [agent] = await db
    .select({ name: schema.agents.name })
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId))
    .limit(1);
  return agent?.name ?? "Unknown Agent";
}
