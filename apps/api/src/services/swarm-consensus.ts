// ============================================================
// Multi-Agent Swarm Consensus
// For cross-domain markets with high confidence, run a consensus
// vote across relevant agents before executing trades.
// ============================================================

import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../db";
import { redis } from "../utils/redis";
import { REDIS_KEYS, IS_SIMULATED } from "@agent-arena/shared";
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
  /** Set when the vote was derived from the decision's directional opinion
   *  (decision.isYes / outcome price) rather than a buy/sell action. */
  forced?: boolean;
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
  /** 0–100 strength score: high when peers agree with high confidence, low
   *  when they disagree or abstain. Designed for UI bars / ticker text. */
  consensusStrength: number;
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
  // Paper-traction: fire consensus on most trades so the swarm graph populates
  // visibly within the first minute of a demo. We still bucket by market question
  // hash so the same market triggers consistently across ticks (avoids flapping).
  // ~80% of markets pass — the 20% skip keeps the graph asymmetric/interesting
  // rather than a uniform fully-connected blob, and saves LLM cost on peer ticks.
  if (IS_SIMULATED) {
    if (confidence < 25) return false;
    let hash = 0;
    for (let i = 0; i < marketQuestion.length; i++) {
      hash = (hash * 31 + marketQuestion.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 5 !== 0; // ~80% of markets
  }

  // Production: trigger for moderately confident or cross-domain markets.
  // Lowered the bar from 70→60 confidence and broadened the keyword set so
  // sports/general markets actually go through the swarm in real workloads,
  // not just simulated demos. Capital safety is preserved by the consensus
  // gate downstream — peers can still reject a bad trade.
  if (confidence < 60) return false;

  const crossDomainKeywords: Record<string, string[]> = {
    crypto: ["tariff", "election", "policy", "regulation", "sec", "fed", "interest rate", "inflation", "war", "etf", "ban"],
    politics: ["bitcoin", "crypto", "stock", "market", "economy", "recession", "etf", "tariff"],
    // Sports markets often hinge on macro factors (injuries during economic
    // downturns, sponsor pullouts, betting volume) — give the swarm a real
    // chance to weigh in instead of letting sports trade alone.
    sports: ["betting", "crypto", "sponsor", "economy", "championship", "playoff", "final", "win", "score", "vs", "match"],
    general: ["bitcoin", "election", "crypto", "etf", "war", "tariff", "sports", "championship"],
  };

  const lower = marketQuestion.toLowerCase();
  const keywords = crossDomainKeywords[agentCategory] ?? [];
  const overlap = keywords.filter((kw) => lower.includes(kw.toLowerCase()));

  // High confidence (>=75) trades always go through consensus regardless of
  // keywords — capital protection floor.
  return confidence >= 75 || (overlap.length >= 1 && confidence >= 60);
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
  initiatingAgentId: string,
  initiatorCategory?: string,
): Promise<ConsensusResult> {
  const votes: SwarmVote[] = [];

  // Pre-compute price signal for the YES outcome (used as a tiebreaker fallback
  // when the peer abstains and has no decision payload). 0.5 = no signal.
  const yesPrice = (() => {
    if (!marketData.outcomes?.length) return 0.5;
    const yes = marketData.outcomes.find((o) => /^yes$/i.test(o.name));
    return yes?.price ?? marketData.outcomes[0].price ?? 0.5;
  })();

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

      // Run a targeted tick on this agent. We reuse the initiating job's UUID
      // so DB queries (positions, feed events) keyed on jobId stay valid; the
      // peer tick is bounded to read-only analysis via consensusTarget so it
      // won't write trades against the initiating job.
      // forceVote tells the aggregator to derive a directional vote from the
      // peer's decision payload (isYes/confidence) when the peer would have
      // abstained — kills the all-zero result on cross-domain markets.
      const ephemeralCtx: AgentRuntimeContext = {
        agentId: agent.id,
        jobId: initiatingCtx.jobId,
        agentWalletId: initiatingCtx.agentWalletId,
        agentWalletAddress: initiatingCtx.agentWalletAddress,
        ownerPubkey: initiatingCtx.ownerPubkey,
        consensusTarget: {
          ...marketData,
          forceVote: true,
          initiatorCategory,
        },
      };

      const tickResult = await runAgentTick(registryId, ephemeralCtx);

      // --- Map tick result → vote with force-vote fallback ---
      const action = tickResult.action?.toLowerCase() ?? "hold";
      let vote: "yes" | "no" | "abstain" = "abstain";
      let forced = false;

      if (action === "buy_yes" || action === "buy" || action === "long") {
        vote = "yes";
      } else if (action === "buy_no" || action === "sell" || action === "short") {
        vote = "no";
      } else {
        // Force-vote: derive directional opinion from richer signals, in order:
        //   1) decision.isYes if the peer expressed a preference
        //   2) decision payload action override (e.g., "hold" with isYes=true)
        //   3) market price tilt (yesPrice >0.55 lean yes; <0.45 lean no)
        const decision = tickResult.decision;
        if (decision?.isYes === true) {
          vote = "yes";
          forced = true;
        } else if (decision?.isYes === false) {
          vote = "no";
          forced = true;
        } else if (yesPrice > 0.55) {
          vote = "yes";
          forced = true;
        } else if (yesPrice < 0.45) {
          vote = "no";
          forced = true;
        }
      }

      // Confidence calibration: peers voting outside their own domain should
      // contribute less weight than the initiator. Cap forced cross-domain
      // votes at 70%, and base-confidence votes at 80% so peer signals never
      // dominate the initiator's own analysis.
      let rawConfidence = tickResult.confidence ?? 50;
      const isCrossDomain = initiatorCategory && category !== initiatorCategory;
      if (forced && isCrossDomain) rawConfidence = Math.min(rawConfidence, 70);
      else if (isCrossDomain) rawConfidence = Math.min(rawConfidence, 80);
      // Forced abstentions still happen when both isYes and price are neutral
      // — keep them as abstain (no spurious vote).
      if (vote === "abstain") rawConfidence = Math.min(rawConfidence, 40);

      votes.push({
        agentId: agent.id,
        agentName: agent.name,
        category,
        vote,
        confidence: rawConfidence,
        reasoning: tickResult.detail ?? "No reasoning provided",
        forced,
      });

      console.log(
        `[Consensus] ${agent.name} voted ${vote.toUpperCase()}${forced ? " (forced)" : ""} (${rawConfidence}% confidence)`
      );
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
      consensusStrength: 0,
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

  // Consensus strength: 0–100 number that combines majority-margin and
  // confidence so the UI can render a real bar instead of a binary
  // approved/rejected pill. Even a unanimous abstain shows a non-zero
  // *participation* score so the swarm graph never reads as "dead".
  const decisiveTotal = votesFor + votesAgainst;
  const margin = decisiveTotal > 0 ? Math.abs(votesFor - votesAgainst) / decisiveTotal : 0;
  const participation = total > 0 ? (decisiveTotal / total) : 0;
  const strengthFromConfidence = Math.abs(adjustedConfidence); // 0..100
  // Blend: 60% confidence × 30% margin × 10% participation (each weight × scale).
  const consensusStrength = Math.max(
    5, // floor: a recorded round always shows ≥5 so the UI never reads "0"
    Math.round(
      strengthFromConfidence * 0.6 +
      margin * 100 * 0.3 +
      participation * 100 * 0.1,
    ),
  );

  return {
    approved,
    consensusAction,
    adjustedConfidence: Math.round(adjustedConfidence * 100) / 100,
    votes,
    votesFor,
    votesAgainst,
    votesAbstain,
    disagreementPenalty: Math.round(disagreementPenalty * 100) / 100,
    consensusStrength,
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
        summary: `[Consensus] ${initiatingAgentName} initiated swarm vote: ${consensus.consensusAction.toUpperCase()} (${consensus.votesFor}-${consensus.votesAgainst}-${consensus.votesAbstain}) · strength ${consensus.consensusStrength}`,
        type: "consensus",
        consensusAction: consensus.consensusAction,
        votesFor: consensus.votesFor,
        votesAgainst: consensus.votesAgainst,
        votesAbstain: consensus.votesAbstain,
        adjustedConfidence: consensus.adjustedConfidence,
        consensusStrength: consensus.consensusStrength,
        approved: consensus.approved,
        marketQuestion,
        // Compact per-vote roll-up so the UI can render names + categories
        // without an extra round-trip when rendering the consensus card.
        voters: consensus.votes.map((v) => ({
          name: v.agentName,
          category: v.category,
          vote: v.vote,
          confidence: v.confidence,
        })),
      },
      displayMessage: `Swarm consensus: ${consensus.consensusAction.replace("_", " ").toUpperCase()} on "${marketQuestion}" (${consensus.votesFor}-${consensus.votesAgainst}) · ${consensus.consensusStrength}/100`,
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
