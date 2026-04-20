// ============================================================
// 3. Adversarial Self-Review ("Devil's Advocate" Pass)
//    Runs an opposing LLM to challenge every trade decision
//    before execution. Overturns bad trades.
// ============================================================

import { quickDecision } from "../ai/pipeline";
import type { ModelConfig, TradeDecision } from "../ai/types";
import { MODELS } from "../ai/models";
import { publishFeedEvent, buildFeedEvent } from "../feed";
import type { MarketContext, AgentPosition } from "../agents/strategy-engine";
import { z } from "zod";

export interface AdversarialReviewResult {
  overturn: boolean;
  riskAdjustedConfidence: number;
  reason: string;
  risks: string[];
}

const AdversarialReviewSchema = z.object({
  overturn: z.boolean(),
  risk_adjusted_confidence: z.number().min(0).max(1),
  reason: z.string(),
  risks: z.array(z.string()),
});

const ADVERSARIAL_SYSTEM_PROMPT = `You are a risk auditor reviewing a prediction market trade decision. Your job is to find reasons NOT to take this trade.

Challenge every assumption. Look for:
1. Cognitive biases (anchoring, overconfidence, confirmation bias)
2. Missing information that could invalidate the reasoning
3. Market manipulation or thin liquidity risks
4. Correlated risk with other open positions
5. Adverse selection (why is someone willing to take the other side?)
6. Time decay (is edge shrinking as resolution approaches?)
7. Base rate neglect (is the agent ignoring historical base rates?)
8. Signal staleness (are the data points still fresh?)

Be ruthless but fair. If the decision is genuinely sound, acknowledge it.

You MUST respond with valid JSON matching this exact schema:
{
  "overturn": true/false,
  "risk_adjusted_confidence": 0.XX (your honest assessment, 0-1),
  "reason": "one-sentence summary",
  "risks": ["risk 1", "risk 2", ...]
}`;

export async function runAdversarialReview(
  decision: TradeDecision,
  markets: MarketContext[],
  positions: AgentPosition[],
  balance: number,
  agentId: string,
  agentName: string,
  modelConfig?: ModelConfig
): Promise<AdversarialReviewResult> {
  if (decision.action === "hold") {
    return { overturn: false, riskAdjustedConfidence: decision.confidence, reason: "Hold decision — no review needed", risks: [] };
  }

  const market = markets.find((m) => m.marketId === decision.marketId);
  const marketInfo = market
    ? `"${market.question}" | Outcomes: ${market.outcomes.map((o) => `${o.name}: $${o.price}`).join(", ")} | Volume: $${market.volume} | Liquidity: $${market.liquidity}`
    : `Market ID: ${decision.marketId ?? "unknown"}`;

  const positionInfo =
    positions.length > 0
      ? positions
          .map((p) => `  - ${p.marketId}: ${p.side.toUpperCase()} $${p.amount} @ $${p.entryPrice} (PnL: $${p.pnl.toFixed(2)})`)
          .join("\n")
      : "No open positions";

  const userMessage = `## Trade Decision Under Review
Action: ${decision.action.toUpperCase()} ${decision.isYes ? "YES" : "NO"}
Market: ${marketInfo}
Amount: $${decision.amount ?? 0}
Confidence: ${(decision.confidence * 100).toFixed(0)}%
Reasoning: ${decision.reasoning}
Signals: ${decision.signals?.join(", ") ?? "none"}

## Current Portfolio
Balance: $${balance.toFixed(2)} USDC
Open Positions:
${positionInfo}

## Risk Assessment Required
Should this trade be overturned? Consider all risks above.`;

  try {
    const result = await quickDecision({
      modelConfig: modelConfig ?? MODELS.qwen,
      systemPrompt: ADVERSARIAL_SYSTEM_PROMPT,
      userMessage,
      schema: AdversarialReviewSchema,
      tools: [],
      agentId,
    });

    const parsed = result.decision;

    const overturn =
      typeof parsed.overturn === "boolean"
        ? parsed.overturn
        : false;

    const riskAdjustedConfidence =
      typeof parsed.risk_adjusted_confidence === "number"
        ? Math.max(0, Math.min(1, parsed.risk_adjusted_confidence))
        : decision.confidence * 0.85;

    const risks = Array.isArray(parsed.risks)
      ? parsed.risks.map(String)
      : [];

    await publishFeedEvent(
      buildFeedEvent({
        agentId,
        agentName,
        category: "reasoning",
        severity: overturn ? "critical" : "info",
        content: {
          summary: overturn
            ? `ADVERSARIAL OVERTURN: ${parsed.reason ?? "Risk too high"}`
            : `Adversarial review passed (confidence: ${(riskAdjustedConfidence * 100).toFixed(0)}%)`,
          reasoning_snippet: `risks: ${risks.slice(0, 5).join("; ")}`,
          pipeline_stage: overturn ? "adversarial_overturn" : "adversarial_passed",
        },
        displayMessage: overturn
          ? `🛑 ${agentName} trade OVERTURNED by adversarial review: ${parsed.reason ?? "risk too high"}`
          : `✅ ${agentName} adversarial review passed — risks noted: ${risks.slice(0, 3).join("; ")}`,
      })
    );

    return {
      overturn,
      riskAdjustedConfidence,
      reason: parsed.reason ?? "No reason provided",
      risks,
    };
  } catch (err) {
    console.error("[Adversarial Review] Error:", err);
    // On failure, default to allowing the trade but with reduced confidence
    return {
      overturn: false,
      riskAdjustedConfidence: decision.confidence * 0.85,
      reason: `Adversarial review error: ${err instanceof Error ? err.message : "unknown"}`,
      risks: ["review_error"],
    };
  }
}