import { generateText, generateObject } from "ai";
import { z } from "zod";
import type { ModelConfig, AgentTool } from "./types";
import { resolveModel } from "./models";
import { toAITools } from "./tools";

export interface PipelineResult {
  step: string;
  output: unknown;
  tokensUsed: number;
  toolCalls: number;
}

function toSdkTools(tools: Record<string, AgentTool>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [name, t] of Object.entries(tools)) {
    result[name] = {
      description: t.description,
      inputSchema: t.parameters,
      execute: async (params: Record<string, unknown>) => t.execute(params),
    };
  }
  return result;
}

// --- Token bucket rate limiter for LLM calls ---

const LLM_RATE_LIMITER = {
  maxConcurrent: 3,
  active: 0,
  queue: [] as Array<{ resolve: () => void; reject: (err: Error) => void }>,

  async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return;
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
    });
  },

  release(): void {
    if (this.active <= 0) {
      this.active = 0;
      return;
    }
    this.active--;
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next.resolve();
    }
  },
};

// Check if error is a rate limit / upstream error that should be retried
function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("rate-limited") || msg.includes("429") || msg.includes("overloaded") || msg.includes("timeout");
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries: number = 2, label: string = "LLM call"): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      if (!isRetryableError(err)) throw err;
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.warn(`[Pipeline] ${label} attempt ${attempt + 1}/${maxRetries + 1} failed (${err instanceof Error ? err.message : String(err)}), retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export async function quickAnalysis(params: {
  modelConfig: ModelConfig;
  systemPrompt: string;
  userMessage: string;
  tools?: string[];
}): Promise<{ text: string; tokensUsed: number; toolCalls: number }> {
  const { modelConfig, systemPrompt, userMessage, tools = [] } = params;

  await LLM_RATE_LIMITER.acquire();
  try {
    const model = resolveModel(modelConfig);
    const agentTools = toAITools(tools);
    const sdkTools = toSdkTools(agentTools);
    const hasTools = Object.keys(sdkTools).length > 0;

    const result = await withRetry(
      () => generateText({
        model,
        system: systemPrompt,
        prompt: userMessage,
        tools: hasTools ? sdkTools : undefined,
        temperature: modelConfig.temperature ?? 0.3,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(90_000),
      }),
      2,
      "quickAnalysis"
    );

    return {
      text: result.text ?? "",
      tokensUsed: result.usage?.totalTokens ?? 0,
      toolCalls: result.toolCalls?.length ?? 0,
    };
  } finally {
    LLM_RATE_LIMITER.release();
  }
}

function extractJsonFromText(text: string): string {
  // Try to find JSON object in markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Try to find JSON object directly
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];

  return text.trim();
}

export async function quickDecision<T>(params: {
  modelConfig: ModelConfig;
  systemPrompt: string;
  userMessage: string;
  schema: z.ZodType<T>;
  tools?: string[];
}): Promise<{ decision: T; tokensUsed: number; toolCalls: number }> {
  const { modelConfig, systemPrompt, userMessage, schema, tools = [] } = params;

  await LLM_RATE_LIMITER.acquire();
  try {
    const model = resolveModel(modelConfig);
    const agentTools = toAITools(tools);
    const sdkTools = toSdkTools(agentTools);
    const hasTools = Object.keys(sdkTools).length > 0;

    // Qwen requires the word "json" in the prompt when using response_format json_object
    const systemWithJsonHint = systemPrompt.toLowerCase().includes("json")
      ? systemPrompt
      : `${systemPrompt}\n\nReturn your response as valid JSON matching the required schema.`;

    let decision: T;
    let tokensUsed = 0;
    let toolCalls = 0;

    // Try generateObject first (structured output)
    try {
      const result: any = await withRetry(
        () => (generateObject as any)({
          model,
          system: systemWithJsonHint,
          prompt: userMessage,
          schema,
          mode: "json",
          temperature: modelConfig.temperature ?? 0.3,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(60_000),
        }),
        2,
        "quickDecision.generateObject"
      );

      if (result.object) {
        decision = result.object as T;
        tokensUsed = (result.usage?.totalTokens ?? 0) as number;
        toolCalls = (result.toolCalls?.length ?? 0) as number;
        return { decision, tokensUsed, toolCalls };
      }
    } catch (objErr) {
      console.warn("[Pipeline] generateObject failed, falling back to generateText:", objErr instanceof Error ? objErr.message : String(objErr));
    }

    // Fallback: use generateText and parse JSON manually
    const textResult = await withRetry(
      () => generateText({
        model,
        system: systemWithJsonHint,
        prompt: userMessage,
        temperature: modelConfig.temperature ?? 0.3,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(60_000),
      }),
      2,
      "quickDecision.generateText"
    );

    const rawText = textResult.text ?? "";
    const jsonText = extractJsonFromText(rawText);
    if (!jsonText.startsWith("{")) {
      console.error("[Pipeline] LLM response was not JSON:", rawText.slice(0, 500));
      throw new Error(`LLM did not return JSON. Response: ${rawText.slice(0, 200)}`);
    }

    const parsed = JSON.parse(jsonText);

    // Normalize field names from various LLM output formats
    const normalized: Record<string, unknown> = { ...parsed };

    // Map "decision" → "action" if action is missing/null
    if (!normalized.action && normalized.decision) {
      normalized.action = normalized.decision;
    }

    // Map snake_case to camelCase
    if (normalized.market_id && !normalized.marketId) normalized.marketId = normalized.market_id;
    if (normalized.market_question && !normalized.marketQuestion) normalized.marketQuestion = normalized.market_question;
    if (normalized.size_usdc && !normalized.amount) normalized.amount = normalized.size_usdc;
    if (normalized.is_yes !== undefined && normalized.isYes === undefined) normalized.isYes = normalized.is_yes;

    // Normalize confidence: if > 1, assume percentage and convert to decimal
    if (typeof normalized.confidence === "number" && normalized.confidence > 1) {
      normalized.confidence = normalized.confidence / 100;
    }

    // Ensure reasoning exists
    if (!normalized.reasoning) {
      normalized.reasoning = normalized.reason || normalized.explanation || `Decision: ${normalized.action ?? "hold"}`;
    }

    // Clamp confidence to valid range
    const conf = typeof normalized.confidence === "number" ? normalized.confidence : 0;
    normalized.confidence = Math.max(0, Math.min(1, conf));

    // Ensure action is valid
    if (!normalized.action || !["buy", "sell", "hold"].includes(normalized.action as string)) {
      normalized.action = "hold";
    }

    decision = schema.parse(normalized);

    return {
      decision,
      tokensUsed: textResult.usage?.totalTokens ?? 0,
      toolCalls: textResult.toolCalls?.length ?? 0,
    };
  } catch (err) {
    console.error("[Pipeline] quickDecision failed:", err);
    throw err;
  } finally {
    LLM_RATE_LIMITER.release();
  }
}
