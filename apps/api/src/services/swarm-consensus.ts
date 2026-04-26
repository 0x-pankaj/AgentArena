// ============================================================
// Multi-Agent Swarm Consensus
// For cross-domain markets with high confidence, run a consensus
// vote across relevant agents before executing trades.
// ============================================================

import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../db";
import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import { submitAtomFeedback, AtomTag } from "../utils/atom-reputation";
import { runAgentTick } from "../agents/registry";
import type { AgentRuntimeContext } from "../ai/types";
import { publishFeedEvent, buildFeedEvent } from "../feed";

const CATEGORY_TO_REGISTRY_ID: Record<string, string> = {
  politics: "politics-agent",
  sports: "sports-agent",
  crypto: "crypto-agent",
  general: "general-agent",
  geo: "general-agent",
};

export interface SwarmVote {
  agentId: string;
  agentName: string;
  category: string;
  vote: "yes" | "no" | "abstain";
  confidence: number;
  reasoning: string;
}

export interface ConsensusResult {
  approved: boolean;
  consensusAction: "buy_yes" | "buy_no" | "skip";
  adjustedConfidence: number;
  votes: SwarmVote[];
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  disagreementPenalty: number;
  swarmId?: string;
}

// ============================================================
// Should we trigger consensus?
// High confidence + cross-domain = trigger
// ============================================================

export function shouldTriggerConsensus(
  marketQuestion: string,
  confidence: number,
  agentCategory: string
): boolean {
  // Always trigger for high-confidence cross-domain markets
  if (confidence < 70) return false;

  const crossDomainKeywords: Record<string, string[]> = {
    crypto: ["tariff", "election", "policy", "regulation", "sec", "fed", "interest rate", "inflation", "war"],
    politics: ["bitcoin", "crypto", "stock", "market", "economy", "recession"],
    sports: ["betting", "crypto", "sponsor", "economy"],
    general: ["bitcoin", "election", "crypto", "etf", "war", "tariff"],
  };

  const lower = marketQuestion.toLowerCase();
  const keywords = crossDomainKeywords[agentCategory] ?? [];
  const overlap = keywords.filter((kw) => lower.includes(kw.toLowerCase()));

  return overlap.length >= 1 && confidence >= 70;
}

// ============================================================
// Collect votes from relevant agents
// ============================================================

export async function collectSwarmVotes(
  marketData: {
    marketId: string;
    marketQuestion: string;
    outcomes?: { name: string; price: number }[];
    volume?: number;
  },
  votingAgentCategories: string[],
  initiatingCtx: AgentRuntimeContext,
  initiatingAgentId: string
): Promise<ConsensusResult> {
  const votes: SwarmVote[] = [];

  for (const category of votingAgentCategories) {
    try {
      const agents = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.category, category))
        .limit(1);

      if (agents.length === 0) continue;

      const agent = agents[0];
      const registryId = CATEGORY_TO_REGISTRY_ID[category] ?? CATEGORY_TO_REGISTRY_ID.general;

      // Run a targeted tick on this agent
      const ephemeralCtx: AgentRuntimeContext = {
        agentId: agent.id,
        jobId: `consensus-${initiatingCtx.jobId}-${Date.now()}`,
        agentWalletId: initiatingCtx.agentWalletId,
        agentWalletAddress: initiatingCtx.agentWalletAddress,
        ownerPubkey: initiatingCtx.ownerPubkey,
        consensusTarget: marketData,
      };

      const tickResult = await runAgentTick(registryId, ephemeralCtx);

      // Map tick result to vote
      const action = tickResult.action?.toLowerCase() ?? "hold";
      let vote: "yes" | "no" | "abstain" = "abstain";
      if (action === "buy_yes" || action === "buy" || action === "long") vote = "yes";
      else if (action === "buy_no" || action === "sell" || action === "short") vote = "no";

      votes.push({
        agentId: agent.id,
        agentName: agent.name,
        category,
        vote,
        confidence: tickResult.confidence ?? 50,
        reasoning: tickResult.detail ?? "No reasoning provided",
      });

      console.log(`[Consensus] ${agent.name} voted ${vote.toUpperCase()} (${tickResult.confidence ?? 50}% confidence)`);
    } catch (err: any) {
      console.error(`[Consensus] Failed to collect vote from ${category}: ${err.message}`);
    }
  }

  // Aggregate votes
  return aggregateConsensus(votes, initiatingAgentId);
}

// ============================================================
// Aggregate consensus with confidence-weighted majority
// ============================================================

export function aggregateConsensus(
  votes: SwarmVote[],
  initiatingAgentId: string
): ConsensusResult {
  const votesFor = votes.filter((v) => v.vote === "yes").length;
  const votesAgainst = votes.filter((v) => v.vote === "no").length;
  const votesAbstain = votes.filter((v) => v.vote === "abstain").length;
  const total = votes.length;

  if (total === 0) {
    return {
      approved: false,
      consensusAction: "skip",
      adjustedConfidence: 0,
      votes: [],
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      disagreementPenalty: 0,
    };
  }

  // Weighted confidence calculation
  let weightedConfidence = 0;
  let totalWeight = 0;

  for (const v of votes) {
    const weight = v.confidence / 100;
    const direction = v.vote === "yes" ? 1 : v.vote === "no" ? -1 : 0;
    weightedConfidence += direction * weight;
    totalWeight += weight;
  }

  const normalizedConfidence = totalWeight > 0 ? (weightedConfidence / totalWeight) * 100 : 0;
  const disagreementPenalty = calculateDisagreementPenalty(votes);

  // Majority rules: need >50% non-abstain votes in one direction
  const decisiveVotes = votesFor + votesAgainst;
  const majorityThreshold = decisiveVotes > 0 ? decisiveVotes / 2 : 0;

  let approved = false;
  let consensusAction: "buy_yes" | "buy_no" | "skip" = "skip";

  if (votesFor > majorityThreshold && normalizedConfidence > 0) {
    approved = true;
    consensusAction = "buy_yes";
  } else if (votesAgainst > majorityThreshold && normalizedConfidence < 0) {
    approved = true;
    consensusAction = "buy_no";
  }

  const adjustedConfidence = Math.abs(normalizedConfidence) * (1 - disagreementPenalty);

  return {
    approved,
    consensusAction,
    adjustedConfidence: Math.round(adjustedConfidence * 100) / 100,
    votes,
    votesFor,
    votesAgainst,
    votesAbstain,
    disagreementPenalty: Math.round(disagreementPenalty * 100) / 100,
  };
}

function calculateDisagreementPenalty(votes: SwarmVote[]): number {
  if (votes.length < 2) return 0;
  const decisive = votes.filter((v) => v.vote !== "abstain");
  if (decisive.length < 2) return 0;

  // Calculate variance in vote direction (-1 to 1)
  const directions = decisive.map((v) => (v.vote === "yes" ? 1 : -1));
  const mean = directions.reduce((a, b) => a + b, 0) / directions.length;
  const variance = directions.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / directions.length;

  // Scale variance to penalty (0 to 0.5)
  return Math.min(variance * 0.5, 0.5);
}

// ============================================================
// Record consensus on-chain via ATOM feedback for each participant
// ============================================================

export async function recordConsensusOnChain(
  consensus: ConsensusResult,
  marketId: string,
  marketQuestion: string,
  initiatingAgentId: string,
  reviewerAddress: string
): Promise<string | undefined> {
  try {
    const [initiatingAgent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, initiatingAgentId))
      .limit(1);

    if (!initiatingAgent?.assetAddress) {
      console.warn("[Consensus] Initiating agent not on 8004, skipping on-chain record");
      return;
    }

    // Record consensus result in DB
    const [swarmRecord] = await db
      .insert(schema.swarmConsensus)
      .values({
        marketId,
        marketQuestion,
        initiatingAgentId,
        consensusAction: consensus.consensusAction,
        adjustedConfidence: String(consensus.adjustedConfidence),
        approved: consensus.approved,
        votesFor: consensus.votesFor,
        votesAgainst: consensus.votesAgainst,
        votesAbstain: consensus.votesAbstain,
        participatingAgents: consensus.votes.map((v) => v.agentId),
        details: consensus.votes,
      })
      .returning();

    // ATOM feedback for initiating agent
    const feedback = await submitAtomFeedback({
      agentAsset: initiatingAgent.assetAddress,
      value: String(consensus.adjustedConfidence),
      tag1: consensus.approved ? AtomTag.accuracy : AtomTag.loss,
      tag2: AtomTag.day,
      reviewerAddress,
    });

    // Record individual interactions for each voter
    for (const vote of consensus.votes) {
      const [interaction] = await db
        .insert(schema.agentInteractions)
        .values({
          fromAgentId: initiatingAgentId,
          toAgentId: vote.agentId,
          interactionType: "consensus",
          marketId,
          marketQuestion,
          confidence: String(vote.confidence),
          metadata: {
            vote: vote.vote,
            reasoning: vote.reasoning,
            consensusId: swarmRecord.id,
            category: vote.category,
          },
          txSignature: feedback?.txSignature,
        })
        .returning();

      // Also record reverse interaction (voter → initiator)
      await db.insert(schema.agentInteractions).values({
        fromAgentId: vote.agentId,
        toAgentId: initiatingAgentId,
        interactionType: "consensus",
        marketId,
        marketQuestion,
        confidence: String(vote.confidence),
        metadata: {
          vote: vote.vote,
          consensusId: swarmRecord.id,
          category: vote.category,
          reverse: true,
        },
        txSignature: feedback?.txSignature,
      });
    }

    // Publish feed event
    const initiatingAgentName = initiatingAgent.name;
    const feedEvent = buildFeedEvent({
      agentId: initiatingAgentId,
      agentName: initiatingAgentName,
      category: "swarm",
      severity: "significant",
      content: {
        summary: `[Consensus] ${initiatingAgentName} initiated swarm vote: ${consensus.consensusAction.toUpperCase()} (${consensus.votesFor}-${consensus.votesAgainst}-${consensus.votesAbstain})`,
        type: "consensus",
        consensusAction: consensus.consensusAction,
        votesFor: consensus.votesFor,
        votesAgainst: consensus.votesAgainst,
        votesAbstain: consensus.votesAbstain,
        adjustedConfidence: consensus.adjustedConfidence,
        approved: consensus.approved,
        marketQuestion,
      },
      displayMessage: `Swarm consensus: ${consensus.consensusAction.replace("_", " ").toUpperCase()} on "${marketQuestion}" (${consensus.votesFor}-${consensus.votesAgainst})`,
    });
    await publishFeedEvent(feedEvent);

    console.log(
      `[Consensus] Recorded for market ${marketId}: ${consensus.consensusAction} | Approved: ${consensus.approved} | Confidence: ${consensus.adjustedConfidence}%`
    );

    return feedback?.txSignature;
  } catch (err: any) {
    console.error(`[Consensus] On-chain record failed: ${err.message}`);
    return;
  }
}

// ============================================================
// Get consensus history
// ============================================================

export async function getConsensusHistory(agentId?: string) {
  if (agentId) {
    return db
      .select()
      .from(schema.swarmConsensus)
      .where(eq(schema.swarmConsensus.initiatingAgentId, agentId))
      .orderBy(desc(schema.swarmConsensus.createdAt));
  }
  return db.select().from(schema.swarmConsensus).orderBy(desc(schema.swarmConsensus.createdAt));
}
