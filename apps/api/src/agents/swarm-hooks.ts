// ============================================================
// Swarm Hooks — Shared delegation & consensus integration
// Called by each agent's tick function before executing trades.
// PRODUCTION-SAFE: All async operations wrapped in try-catch
// so swarm failures never crash the parent agent tick.
// ============================================================

import type { AgentRuntimeContext, AgentTickResult, TradeDecision } from "../ai/types";
import { detectDelegationOpportunity, requestPeerAnalysis, emitPeerCheck } from "../services/agent-delegation";
import { shouldTriggerConsensus, collectSwarmVotes, type ConsensusResult } from "../services/swarm-consensus";
import { IS_SIMULATED } from "@agent-arena/shared";

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

  // Clone decision to avoid mutating the caller's object
  let workingDecision: TradeDecision = { ...decision };
  let delegatedAnalysis: any = null;
  let delegationTarget: string | null = null;
  let consensusFired = false;

  // --- 1. Delegation (wrapped for safety) ---
  try {
    const delegationOpportunity = detectDelegationOpportunity(workingDecision.marketQuestion!, category);

    if (delegationOpportunity) {
      console.log(`[SwarmHooks] ${agentId} detected delegation opportunity to ${delegationOpportunity.targetCategory}`);

      const delegationResult = await requestPeerAnalysis(
        ctx,
        agentId,
        delegationOpportunity.targetCategory,
        {
          marketId: workingDecision.marketId!,
          marketQuestion: workingDecision.marketQuestion!,
        }
      );

      if (delegationResult.success && delegationResult.delegatedAnalysis) {
        delegatedAnalysis = delegationResult.delegatedAnalysis;
        delegationTarget = delegationOpportunity.targetCategory;

        // Merge delegated confidence (simple average)
        const originalConfidence = (workingDecision.confidence ?? 0.5) * 100;
        const peerConfidence = delegatedAnalysis.confidence ?? 50;
        const mergedConfidence = (originalConfidence + peerConfidence) / 2;
        workingDecision = { ...workingDecision, confidence: mergedConfidence / 100 };

        console.log(`[SwarmHooks] Merged confidence: ${originalConfidence.toFixed(0)}% → ${mergedConfidence.toFixed(0)}%`);
      }
    }
  } catch (err: any) {
    console.warn(`[SwarmHooks] Delegation failed safely: ${err.message}`);
    // Continue without delegation — don't crash the parent tick
  }

  // --- 2. Consensus (wrapped for safety) ---
  try {
    const confidencePercent = (workingDecision.confidence ?? 0.5) * 100;

    if (shouldTriggerConsensus(workingDecision.marketQuestion!, confidencePercent, category)) {
      const votingCategories = ["general"];
      if (category !== "crypto") votingCategories.push("crypto");
      if (category !== "politics") votingCategories.push("politics");
      if (category !== "sports") votingCategories.push("sports");

      console.log(`[SwarmHooks] Triggering consensus for "${workingDecision.marketQuestion}"`);

      consensusFired = true;
      const consensus = await collectSwarmVotes(
        {
          marketId: workingDecision.marketId!,
          marketQuestion: workingDecision.marketQuestion!,
        },
        votingCategories,
        ctx,
        agentId,
        category,
      );

      // In traction/simulated mode, consensus is advisory: peer abstentions
      // are common (their domain doesn't apply) and shouldn't block trades —
      // we still want the consensus event recorded for the swarm graph and feed.
      // Production keeps consensus as a hard gate for capital safety.
      const blockOnReject = !IS_SIMULATED && Math.abs(consensus.votesFor - consensus.votesAgainst) >= 2;

      if (!consensus.approved && blockOnReject) {
        return {
          proceed: false,
          decision: workingDecision,
          detail: `Swarm consensus rejected: ${consensus.votesFor}-${consensus.votesAgainst}-${consensus.votesAbstain}`,
          consensus,
          delegation: delegationTarget ? { targetCategory: delegationTarget, delegatedAnalysis } : undefined,
        };
      }

      // Blend swarm confidence into the working decision when we have a signal,
      // but keep the original confidence as a floor (don't let abstentions tank it).
      if (consensus.adjustedConfidence > 0) {
        const blended = Math.max(
          workingDecision.confidence ?? 0,
          consensus.adjustedConfidence / 100,
        );
        workingDecision = { ...workingDecision, confidence: blended };
      }

      return {
        proceed: true,
        decision: workingDecision,
        detail: consensus.approved
          ? `Swarm approved (${consensus.votesFor}-${consensus.votesAgainst}), confidence ${(workingDecision.confidence! * 100).toFixed(0)}%`
          : `Swarm advisory (${consensus.votesFor}-${consensus.votesAgainst}-${consensus.votesAbstain}) — proceeding in traction`,
        consensus,
        delegation: delegationTarget ? { targetCategory: delegationTarget, delegatedAnalysis } : undefined,
      };
    }
  } catch (err: any) {
    console.warn(`[SwarmHooks] Consensus failed safely: ${err.message}`);
    // Continue without consensus — don't crash the parent tick
  }

  // --- 3. Demo-mode peer-check fallback ---
  // If neither delegation nor consensus fired this tick, emit a lightweight
  // passive peer-check so the swarm graph still gets a fresh edge. Gated on
  // IS_SIMULATED so production stays clean. This is a DB-only ping — no LLM
  // call, no on-chain feedback, no trade impact.
  if (IS_SIMULATED && !delegationTarget && !consensusFired) {
    try {
      await emitPeerCheck(
        agentId,
        category,
        {
          marketId: workingDecision.marketId!,
          marketQuestion: workingDecision.marketQuestion!,
        },
        ctx.jobId,
      );
    } catch (err: any) {
      console.warn(`[SwarmHooks] Peer-check failed safely: ${err.message}`);
    }
  }

  return {
    proceed: true,
    decision: workingDecision,
    detail: delegationTarget
      ? `Delegated to ${delegationTarget}, merged analysis`
      : "No swarm intervention needed",
    delegation: delegationTarget ? { targetCategory: delegationTarget, delegatedAnalysis } : undefined,
  };
}
