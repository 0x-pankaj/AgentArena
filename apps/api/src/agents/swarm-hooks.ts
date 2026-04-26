// ============================================================
// Swarm Hooks — Shared delegation & consensus integration
// Called by each agent's tick function before executing trades.
// ============================================================

import type { AgentRuntimeContext, AgentTickResult, TradeDecision } from "../ai/types";
import { detectDelegationOpportunity, requestPeerAnalysis } from "../services/agent-delegation";
import { shouldTriggerConsensus, collectSwarmVotes, type ConsensusResult } from "../services/swarm-consensus";

export interface SwarmHookResult {
  proceed: boolean;
  decision?: TradeDecision;
  detail: string;
  consensus?: ConsensusResult;
  delegation?: {
    targetCategory: string;
    delegatedAnalysis: any;
  };
}

// ============================================================
// Run swarm hooks before trade execution
// ============================================================

export async function runSwarmHooks(
  ctx: AgentRuntimeContext,
  agentId: string,
  category: string,
  decision: TradeDecision
): Promise<SwarmHookResult> {
  if (!decision.marketId || !decision.marketQuestion) {
    return { proceed: true, decision, detail: "No market data for swarm hooks" };
  }

  // --- 1. Delegation ---
  const delegationOpportunity = detectDelegationOpportunity(decision.marketQuestion, category);
  let delegatedAnalysis: any = null;
  let delegationTarget: string | null = null;

  if (delegationOpportunity) {
    console.log(`[SwarmHooks] ${agentId} detected delegation opportunity to ${delegationOpportunity.targetCategory}`);

    const delegationResult = await requestPeerAnalysis(
      ctx,
      agentId,
      delegationOpportunity.targetCategory,
      {
        marketId: decision.marketId,
        marketQuestion: decision.marketQuestion,
      }
    );

    if (delegationResult.success && delegationResult.delegatedAnalysis) {
      delegatedAnalysis = delegationResult.delegatedAnalysis;
      delegationTarget = delegationOpportunity.targetCategory;

      // Merge delegated confidence (simple average for now)
      const originalConfidence = (decision.confidence ?? 0.5) * 100;
      const peerConfidence = delegatedAnalysis.confidence ?? 50;
      const mergedConfidence = (originalConfidence + peerConfidence) / 2;

      decision.confidence = mergedConfidence / 100;

      console.log(`[SwarmHooks] Merged confidence: ${originalConfidence.toFixed(0)}% → ${mergedConfidence.toFixed(0)}%`);
    }
  }

  // --- 2. Consensus ---
  const confidencePercent = (decision.confidence ?? 0.5) * 100;

  if (shouldTriggerConsensus(decision.marketQuestion, confidencePercent, category)) {
    const votingCategories = ["general"];
    if (category !== "crypto") votingCategories.push("crypto");
    if (category !== "politics") votingCategories.push("politics");
    if (category !== "sports") votingCategories.push("sports");

    console.log(`[SwarmHooks] Triggering consensus for "${decision.marketQuestion}"`);

    const consensus = await collectSwarmVotes(
      {
        marketId: decision.marketId,
        marketQuestion: decision.marketQuestion,
      },
      votingCategories,
      ctx,
      agentId
    );

    if (!consensus.approved) {
      return {
        proceed: false,
        decision,
        detail: `Swarm consensus rejected: ${consensus.votesFor}-${consensus.votesAgainst}-${consensus.votesAbstain}`,
        consensus,
        delegation: delegationTarget ? { targetCategory: delegationTarget, delegatedAnalysis } : undefined,
      };
    }

    // Adjust confidence based on consensus
    decision.confidence = (consensus.adjustedConfidence / 100);

    return {
      proceed: true,
      decision,
      detail: `Swarm approved (${consensus.votesFor}-${consensus.votesAgainst}), confidence adjusted to ${consensus.adjustedConfidence}%`,
      consensus,
      delegation: delegationTarget ? { targetCategory: delegationTarget, delegatedAnalysis } : undefined,
    };
  }

  return {
    proceed: true,
    decision,
    detail: delegationTarget
      ? `Delegated to ${delegationTarget}, merged analysis`
      : "No swarm intervention needed",
    delegation: delegationTarget ? { targetCategory: delegationTarget, delegatedAnalysis } : undefined,
  };
}
