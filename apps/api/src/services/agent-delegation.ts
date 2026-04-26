// ============================================================
// Agent-to-Agent Delegation Protocol
// Enables agents to detect cross-domain markets and delegate
// analysis to peer agents, recording interactions on-chain.
// ============================================================

import { eq, and, desc, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import { submitAtomFeedback, AtomTag } from "../utils/atom-reputation";
import { runAgentTick } from "../agents/registry";
import type { AgentRuntimeContext } from "../ai/types";
import { publishFeedEvent, buildFeedEvent } from "../feed";

// --- Domain keyword overlap mapping ---

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  crypto: ["bitcoin", "btc", "ethereum", "eth", "solana", "sol", "crypto", "defi", "etf", "sec", "regulation", "mining", "blockchain", "altcoin", "token"],
  politics: ["election", "trump", "biden", "president", "congress", "senate", "house", "vote", "policy", "tariff", "trade war", "immigration", "supreme court", "legislation", "midterm"],
  sports: ["nfl", "nba", "soccer", "world cup", "super bowl", "olympics", "ufc", "mma", "tennis", "championship", "playoff", "finals"],
  general: ["weather", "climate", "gdp", "inflation", "recession", "war", "conflict", "natural disaster", "hurricane", "earthquake"],
};

// Maps which categories should be consulted when a market in category X is found
const DELEGATION_TARGETS: Record<string, string[]> = {
  crypto: ["politics", "general"],
  politics: ["general"],
  sports: ["general"],
  general: ["crypto", "politics", "sports"],
};

const CATEGORY_TO_REGISTRY_ID: Record<string, string> = {
  politics: "politics-agent",
  sports: "sports-agent",
  crypto: "crypto-agent",
  general: "general-agent",
  geo: "general-agent",
};

export interface DelegationOpportunity {
  marketId: string;
  marketQuestion: string;
  sourceCategory: string;
  targetCategory: string;
  overlapScore: number;
  targetAgentId?: string;
}

export interface DelegationResult {
  success: boolean;
  interactionId?: string;
  txSignature?: string;
  delegatedAnalysis?: {
    confidence: number;
    direction: string;
    reasoning: string;
  };
  error?: string;
}

// ============================================================
// Detect if a market should be delegated to another agent
// ============================================================

export function detectDelegationOpportunity(
  marketQuestion: string,
  agentCategory: string
): DelegationOpportunity | null {
  const lowerQuestion = marketQuestion.toLowerCase();
  const targets = DELEGATION_TARGETS[agentCategory] ?? [];

  let bestMatch: DelegationOpportunity | null = null;
  let bestScore = 0;

  for (const targetCategory of targets) {
    const keywords = CATEGORY_KEYWORDS[targetCategory] ?? [];
    let matches = 0;
    for (const kw of keywords) {
      if (lowerQuestion.includes(kw.toLowerCase())) {
        matches++;
      }
    }
    if (matches === 0) continue;

    // Normalize by keyword list length to avoid bias toward large lists
    const score = matches / Math.sqrt(keywords.length);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        marketId: "", // filled later
        marketQuestion,
        sourceCategory: agentCategory,
        targetCategory,
        overlapScore: score,
      };
    }
  }

  // Threshold: require at least 2 keyword matches or score > 0.3
  if (bestMatch && (bestScore >= 0.3 || lowerQuestion.split(" ").some(w => {
    const targets = DELEGATION_TARGETS[agentCategory] ?? [];
    return targets.some(tc => CATEGORY_KEYWORDS[tc]?.includes(w.toLowerCase()));
  }))) {
    return bestMatch;
  }

  return null;
}

// ============================================================
// Request peer analysis by running a targeted tick on target agent
// ============================================================

export async function requestPeerAnalysis(
  fromCtx: AgentRuntimeContext,
  fromAgentId: string,
  toCategory: string,
  marketData: {
    marketId: string;
    marketQuestion: string;
    outcomes?: { name: string; price: number }[];
    volume?: number;
    liquidity?: number;
  }
): Promise<DelegationResult> {
  try {
    // Find target agent in DB
    const targetAgents = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.category, toCategory))
      .limit(1);

    if (targetAgents.length === 0) {
      return { success: false, error: `No ${toCategory} agent found` };
    }

    const targetAgent = targetAgents[0];
    const registryId = CATEGORY_TO_REGISTRY_ID[toCategory] ?? CATEGORY_TO_REGISTRY_ID.general;

    // Build ephemeral context for the target agent tick
    const ephemeralCtx: AgentRuntimeContext = {
      agentId: targetAgent.id,
      jobId: `delegation-${fromCtx.jobId}-${Date.now()}`,
      agentWalletId: fromCtx.agentWalletId,
      agentWalletAddress: fromCtx.agentWalletAddress,
      ownerPubkey: fromCtx.ownerPubkey,
      delegationTarget: marketData,
    };

    console.log(`[Delegation] ${fromAgentId} → ${targetAgent.id} (${toCategory}) for "${marketData.marketQuestion}"`);

    // Run a single tick on the target agent with delegation context
    const tickResult = await runAgentTick(registryId, ephemeralCtx);

    // Extract analysis from tick result
    const delegatedAnalysis = {
      confidence: tickResult.confidence ?? 50,
      direction: tickResult.action ?? "hold",
      reasoning: tickResult.detail ?? "No detailed reasoning returned",
    };

    // Record the delegation in DB
    const [interaction] = await db
      .insert(schema.agentInteractions)
      .values({
        fromAgentId,
        toAgentId: targetAgent.id,
        jobId: fromCtx.jobId,
        interactionType: "delegation",
        marketId: marketData.marketId,
        marketQuestion: marketData.marketQuestion,
        metadata: {
          delegatedAnalysis,
          sourceCategory: fromCtx.agentId,
          targetCategory: toCategory,
          tickState: tickResult.state,
        },
      })
      .returning();

    // Publish feed event
    const fromAgentName = await getAgentName(fromAgentId);
    const toAgentName = await getAgentName(targetAgent.id);
    const feedEvent = buildFeedEvent({
      agentId: fromAgentId,
      agentName: fromAgentName,
      jobId: fromCtx.jobId,
      category: "swarm",
      severity: "significant",
      content: {
        summary: `[Delegation] ${fromAgentName} → ${toAgentName}: "${marketData.marketQuestion}"`,
        type: "delegation",
        fromAgent: fromAgentName,
        toAgent: toAgentName,
        marketQuestion: marketData.marketQuestion,
        confidence: delegatedAnalysis.confidence,
        direction: delegatedAnalysis.direction,
      },
      displayMessage: `${fromAgentName} delegated analysis to ${toAgentName} for "${marketData.marketQuestion}"`,
    });
    await publishFeedEvent(feedEvent);

    return {
      success: true,
      interactionId: interaction.id,
      delegatedAnalysis,
    };
  } catch (err: any) {
    console.error(`[Delegation] Failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
// Record delegation on-chain via ATOM feedback
// ============================================================

export async function recordDelegationOnChain(
  fromAgentId: string,
  toAgentId: string,
  marketId: string,
  quality: number,
  reviewerAddress: string
): Promise<{ txSignature?: string; error?: string }> {
  try {
    const [fromAgent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, fromAgentId))
      .limit(1);

    if (!fromAgent?.assetAddress) {
      return { error: "From agent not registered on 8004" };
    }

    const feedback = await submitAtomFeedback({
      agentAsset: fromAgent.assetAddress,
      value: Math.abs(quality).toFixed(2),
      tag1: quality >= 0 ? AtomTag.accuracy : AtomTag.loss,
      tag2: AtomTag.day,
      reviewerAddress,
    });

    if (feedback) {
      // Update the interaction with tx signature
      await db
        .update(schema.agentInteractions)
        .set({ txSignature: feedback.txSignature })
        .where(
          and(
            eq(schema.agentInteractions.fromAgentId, fromAgentId),
            eq(schema.agentInteractions.toAgentId, toAgentId),
            eq(schema.agentInteractions.marketId, marketId),
            eq(schema.agentInteractions.interactionType, "delegation")
          )
        );

      return { txSignature: feedback.txSignature };
    }

    return { error: "ATOM feedback submission returned null" };
  } catch (err: any) {
    console.error(`[Delegation] On-chain record failed: ${err.message}`);
    return { error: err.message };
  }
}

// ============================================================
// Get delegation history for an agent
// ============================================================

export async function getDelegationHistory(agentId: string) {
  const sent = await db
    .select()
    .from(schema.agentInteractions)
    .where(
      and(
        eq(schema.agentInteractions.fromAgentId, agentId),
        eq(schema.agentInteractions.interactionType, "delegation")
      )
    )
    .orderBy(desc(schema.agentInteractions.createdAt));

  const received = await db
    .select()
    .from(schema.agentInteractions)
    .where(
      and(
        eq(schema.agentInteractions.toAgentId, agentId),
        eq(schema.agentInteractions.interactionType, "delegation")
      )
    )
    .orderBy(desc(schema.agentInteractions.createdAt));

  return { sent, received, total: sent.length + received.length };
}

// ============================================================
// Get pending delegations for a job (for supervisor tracking)
// ============================================================

export async function getPendingDelegationsForJob(jobId: string) {
  return db
    .select()
    .from(schema.agentInteractions)
    .where(
      and(
        eq(schema.agentInteractions.jobId, jobId),
        eq(schema.agentInteractions.interactionType, "delegation"),
        sql`${schema.agentInteractions.txSignature} IS NULL`
      )
    )
    .orderBy(desc(schema.agentInteractions.createdAt));
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
