// ============================================================
// 3. Adversarial Self-Review ("Devil's Advocate" Pass)
//    Runs an opposing LLM to challenge every trade decision
//    before execution. Overturns bad trades.
// ============================================================

import { quickAnalysis } from "../ai/pipeline";
import type { ModelConfig, TradeDecision } from "../ai/types";
import { MODELS } from "../ai/models";
import { publishFeedEvent, buildFeedEvent } from "../feed";
import type { MarketContext, AgentPosition } from "../agents/strategy-engine";

export interface AdversarialReviewResult {
  overturn: boolean;
  riskAdjustedConfidence: number;
  reason: string;
  risks: string[];
}

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

OUTPUT FORMAT (must be valid JSON):
{
  "overturn": true/false,
  "risk_adjusted_confidence": 0.XX (your honest assessment of actual probability, 0-1),
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
    const result = await quickAnalysis({
      modelConfig: modelConfig ?? MODELS.qwen,
      systemPrompt: ADVERSARIAL_SYSTEM_PROMPT,
      userMessage,
      tools: [],
      agentId,
    });

    const jsonText = extractJsonFromText(result.text);

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      try {
        const repaired = repairAdversarialJson(jsonText);
        parsed = JSON.parse(repaired);
      } catch {
        return {
          overturn: false,
          riskAdjustedConfidence: decision.confidence,
          reason: "Adversarial review failed to parse — allowing trade",
          risks: ["review_parse_failed"],
        };
      }
    }

    const overturn =
      typeof parsed.overturn === "string"
        ? parsed.overturn.toLowerCase() === "true"
        : !!parsed.overturn;

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
    return {
      overturn: false,
      riskAdjustedConfidence: decision.confidence,
      reason: `Adversarial review error: ${err instanceof Error ? err.message : "unknown"}`,
      risks: ["review_error"],
    };
  }
}

function repairAdversarialJson(raw: string): string {
  let s = raw;
  s = s.replace(/\/\/.*$/gm, "");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/,\s*([}\]])/g, "$1");
  s = s.replace(/:\s*'([^']*)'/g, ': "$1"');
  s = s.replace(/\bTrue\b/g, "true");
  s = s.replace(/\bFalse\b/g, "false");
  s = s.replace(/\bNone\b/g, "null");
  s = s.replace(/\bNaN\b/g, "null");
  s = s.replace(/\bInfinity\b/g, "null");
  s = s.replace(/(?<=[{,]\s*)([a-zA-Z_]\w*)\s*:/g, '"$1":');
  return s;
}

function extractJsonFromText(text: string): string {
  if (!text || !text.trim()) return "";
  const codeBlockPatterns = [
    /```(?:json)?\s*\n?([\s\S]*?)\n?```/,
    /```\s*\n?([\s\S]*?)\n?```/,
  ];
  for (const pattern of codeBlockPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim();
      if (candidate.startsWith("{")) return candidate;
    }
  }
  const firstBrace = text.indexOf("{");
  if (firstBrace !== -1) {
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = firstBrace; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { if (inStr) escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (depth === 0) return text.slice(firstBrace, i + 1);
    }
  }
  const greedyMatch = text.match(/\{[\s\S]*\}/);
  if (greedyMatch) return greedyMatch[0];
  return text.trim();
}