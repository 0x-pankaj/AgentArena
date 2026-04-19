import { generateText, generateObject } from "ai";
import { z } from "zod";
import type { ModelConfig, AgentTool } from "./types";
import { resolveModel } from "./models";
import { toAITools } from "./tools";
import { getCachedLLMResponse, cacheLLMResponse } from "../services/llm-cache";

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

// --- Per-agent token bucket rate limiter for LLM calls ---

const AGENT_LLM_LIMITERS = new Map<string, {
  maxConcurrent: number;
  active: number;
  queue: Array<{ resolve: () => void; reject: (err: Error) => void }>;
}>();

function getAgentLimiter(agentId: string = "global") {
  if (!AGENT_LLM_LIMITERS.has(agentId)) {
    AGENT_LLM_LIMITERS.set(agentId, {
      maxConcurrent: 5,
      active: 0,
      queue: [],
    });
  }
  return AGENT_LLM_LIMITERS.get(agentId)!;
}

async function acquireLLMSlot(agentId: string = "global"): Promise<void> {
  const limiter = getAgentLimiter(agentId);
  if (limiter.active < limiter.maxConcurrent) {
    limiter.active++;
    return;
  }
  const timeoutMs = 90_000;
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`LLM slot acquisition timeout after ${timeoutMs}ms for agent ${agentId}`)), timeoutMs)
  );
  const slotPromise = new Promise<void>((resolve) => {
    limiter.queue.push({ resolve, reject: () => resolve() }); // reject used as "skip" on timeout
  });
  return Promise.race([slotPromise, timeoutPromise]) as Promise<void>;
}

function releaseLLMSlot(agentId: string = "global"): void {
  const limiter = getAgentLimiter(agentId);
  if (limiter.active <= 0) {
    limiter.active = 0;
    return;
  }
  limiter.active--;
  const next = limiter.queue.shift();
  if (next) {
    limiter.active++;
    next.resolve();
  }
}

// Check if error is a rate limit / upstream error that should be retried
function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("rate-limited") ||
    msg.includes("429") ||
    msg.includes("overloaded") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("connection") ||
    msg.includes("ECONNRESET") ||
    msg.includes("upstream") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("service unavailable") ||
    msg.includes("gateway") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504")
  );
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries: number = 2, label: string = "LLM call"): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      if (!isRetryableError(err)) {
        console.error(`[Pipeline] ${label} failed with non-retryable error: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
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
  agentId?: string;
  marketContext?: { marketId: string; yesPrice: number; noPrice: number };
}): Promise<{ text: string; tokensUsed: number; toolCalls: number }> {
  const { modelConfig, systemPrompt, userMessage, tools = [], agentId, marketContext } = params;

  const marketKey = marketContext
    ? `${marketContext.marketId}:${marketContext.yesPrice}:${marketContext.noPrice}`
    : undefined;

  // Check cache first (only for analysis without tools, as tool calls are dynamic)
  if (!tools || tools.length === 0) {
    const cached = await getCachedLLMResponse(userMessage, modelConfig.model, marketKey);
    if (cached) {
      console.log(`[Pipeline] Using cached LLM response for analysis`);
      return { text: cached, tokensUsed: 0, toolCalls: 0 }; // Cached, no tokens charged
    }
  }

  await acquireLLMSlot(agentId);
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

    // Cache the response (only if no tools were used)
    if (!tools || tools.length === 0) {
      await cacheLLMResponse(
        userMessage,
        result.text ?? "",
        modelConfig.model,
        result.usage?.totalTokens ?? 0,
        marketKey
      );
    }

    return {
      text: result.text ?? "",
      tokensUsed: result.usage?.totalTokens ?? 0,
      toolCalls: result.toolCalls?.length ?? 0,
    };
  } finally {
    releaseLLMSlot(agentId);
  }
}

// ============================================================
// Robust JSON extraction — multiple strategies to handle LLM
// output that may contain markdown, prose, trailing commas,
// single-quoted strings, comments, or wrapped JSON.
// ============================================================

function extractJsonFromText(text: string): string {
  if (!text || !text.trim()) return "";

  // Strategy 1: Extract from markdown code blocks (```json ... ```)
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

  // Strategy 2: Find balanced brace pairs (handles nested objects)
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
      if (depth === 0) {
        return text.slice(firstBrace, i + 1);
      }
    }
  }

  // Strategy 3: Greedy regex as last resort
  const greedyMatch = text.match(/\{[\s\S]*\}/);
  if (greedyMatch) return greedyMatch[0];

  return text.trim();
}

// ============================================================
// JSON repair — fixes common LLM output issues:
//   - Trailing commas before } or ]
//   - Single-quoted strings → double-quoted
//   - JS-style comments (// and /* */)
//   - Missing quotes around keys
//   - True/False/None → true/false/null
//   - NaN / Infinity → null
//   - Unquoted string values
// ============================================================

function repairJson(raw: string): string {
  let s = raw;

  // Remove JS line/block comments (not inside strings)
  s = s.replace(/\/\/.*$/gm, "");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");

  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, "$1");

  // Replace single-quoted strings with double-quoted (simple cases only)
  s = s.replace(/:\s*'([^']*)'/g, ': "$1"');

  // Replace True → true, False → false, None → null
  s = s.replace(/\bTrue\b/g, "true");
  s = s.replace(/\bFalse\b/g, "false");
  s = s.replace(/\bNone\b/g, "null");
  s = s.replace(/\bNaN\b/g, "null");
  s = s.replace(/\bInfinity\b/g, "null");

  // Fix unquoted keys: word chars followed by colon (not already quoted)
  s = s.replace(/(?<=[{,]\s*)([a-zA-Z_]\w*)\s*:/g, '"$1":');

  return s;
}

// ============================================================
// Parse JSON with progressive repair attempts.
// Returns parsed object or null if all attempts fail.
// ============================================================

function parseJsonWithRepair(raw: string): Record<string, unknown> | null {
  // Attempt 1: parse as-is
  try { return JSON.parse(raw); } catch {}

  // Attempt 2: repair + parse
  try { return JSON.parse(repairJson(raw)); } catch {}

  // Attempt 3: extract + repair + parse (in case extraction was imperfect)
  const reExtracted = extractJsonFromText(repairJson(raw));
  try { return JSON.parse(reExtracted); } catch {}

  // Attempt 4: aggressive — strip all non-JSON characters outside braces
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = raw.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(repairJson(candidate)); } catch {}
  }

  return null;
}

// ============================================================
// Normalize LLM output into a consistent shape for schema validation.
// Handles: snake_case → camelCase, wrong field names, type mismatches,
// missing fields, etc.
// ============================================================

function normalizeDecisionFields(raw: Record<string, unknown>): Record<string, unknown> {
  const n: Record<string, unknown> = { ...raw };

  // --- action ---
  if (!n.action || typeof n.action !== "string") {
    if (typeof n.decision === "string") n.action = n.decision;
    else if (typeof n.trade_action === "string") n.action = n.trade_action;
    else n.action = "hold";
  }
  const actionStr = String(n.action).toLowerCase().trim();
  if (!["buy", "sell", "hold"].includes(actionStr)) n.action = "hold";
  else n.action = actionStr;

  // --- marketId ---
  if (!n.marketId) {
    if (n.market_id) n.marketId = n.market_id;
    else if (n.id) n.marketId = n.id;
  }
  if (typeof n.marketId === "string") n.marketId = n.marketId.trim() || undefined;

  // --- marketQuestion ---
  if (!n.marketQuestion) {
    if (n.market_question) n.marketQuestion = n.market_question;
    else if (n.question) n.marketQuestion = n.question;
  }

  // --- isYes ---
  if (n.isYes === undefined) {
    if (n.is_yes !== undefined) n.isYes = n.is_yes;
    else if (n.side === "yes" || n.side === "Yes") n.isYes = true;
    else if (n.side === "no" || n.side === "No") n.isYes = false;
  }
  if (typeof n.isYes === "string") n.isYes = n.isYes.toLowerCase() === "true" || n.isYes === "yes";

  // --- amount ---
  if (n.amount === undefined || n.amount === null) {
    if (n.size_usdc !== undefined) n.amount = Number(n.size_usdc);
    else if (n.size !== undefined) n.amount = Number(n.size);
    else if (n.trade_amount !== undefined) n.amount = Number(n.trade_amount);
  }
  if (typeof n.amount === "string") n.amount = parseFloat(n.amount);
  if (typeof n.amount === "number" && (isNaN(n.amount) || !isFinite(n.amount))) n.amount = undefined;

  // --- confidence ---
  let conf: number;
  if (typeof n.confidence === "string") conf = parseFloat(n.confidence);
  else if (typeof n.confidence === "number") conf = n.confidence;
  else conf = 0;
  if (isNaN(conf)) conf = 0;
  if (conf > 1 && conf <= 100) conf = conf / 100;
  n.confidence = Math.max(0, Math.min(1, conf));

  // --- reasoning ---
  if (!n.reasoning || typeof n.reasoning !== "string") {
    n.reasoning = typeof n.reason === "string" ? n.reason
      : typeof n.explanation === "string" ? n.explanation
      : typeof n.rationale === "string" ? n.rationale
      : `Hold decision — LLM reasoning field missing`;
  }

  // --- signals ---
  if (!Array.isArray(n.signals)) {
    if (typeof n.signal === "string") n.signals = [n.signal];
    else if (typeof n.signal_list === "string") n.signals = [n.signal_list];
    else n.signals = undefined;
  }

  // Strip unknown extra keys that schemas won't expect
  delete n.decision;
  delete n.market_id;
  delete n.market_question;
  delete n.is_yes;
  delete n.size_usdc;
  delete n.size;
  delete n.trade_amount;
  delete n.reason;
  delete n.explanation;
  delete n.rationale;
  delete n.signal;
  delete n.signal_list;
  delete n.side;
  delete n.id;
  delete n.question;

  return n;
}

const STRICT_JSON_PROMPT = `\n\nCRITICAL: Return ONLY valid JSON. No explanations, no conversational text, no markdown, no code fences. Start your response with { and end with }. The response must be a single JSON object.`;

export async function quickDecision<T>(params: {
  modelConfig: ModelConfig;
  systemPrompt: string;
  userMessage: string;
  schema: z.ZodType<T>;
  tools?: string[];
  agentId?: string;
}): Promise<{ decision: T; tokensUsed: number; toolCalls: number }> {
  const { modelConfig, systemPrompt, userMessage, schema, tools = [], agentId } = params;

  await acquireLLMSlot(agentId);
  try {
    const model = resolveModel(modelConfig);

    // Qwen requires the word "json" in the prompt when using response_format json_object
    const systemWithJsonHint = systemPrompt.toLowerCase().includes("json")
      ? systemPrompt
      : `${systemPrompt}\n\nReturn your response as valid JSON matching the required schema.`;

    let decision: T;
    let tokensUsed = 0;
    let toolCalls = 0;

    // ---- Attempt 1: generateObject (structured output) ----
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
        const normalized = normalizeDecisionFields(result.object as Record<string, unknown>);
        decision = schema.parse(normalized);
        tokensUsed = (result.usage?.totalTokens ?? 0) as number;
        toolCalls = (result.toolCalls?.length ?? 0) as number;
        return { decision, tokensUsed, toolCalls };
      }
    } catch (objErr) {
      console.warn("[Pipeline] generateObject failed, falling back to generateText:", objErr instanceof Error ? objErr.message : String(objErr));
    }

    // ---- Attempt 2: generateText + parse with repair ----
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
    let jsonText = extractJsonFromText(rawText);

    // Try parsing with repair
    let parsed: Record<string, unknown> | null = null;

    if (jsonText.startsWith("{")) {
      parsed = parseJsonWithRepair(jsonText);
    }

    // ---- Attempt 3: strict retry if parsing failed ----
    if (!parsed) {
      console.warn("[Pipeline] LLM response was not valid JSON, retrying with strict prompt. Raw preview:", rawText.slice(0, 300));

      const strictResult = await withRetry(
        () => generateText({
          model,
          system: systemWithJsonHint + STRICT_JSON_PROMPT,
          prompt: userMessage + "\n\nRespond with ONLY the JSON object. No other text, no markdown.",
          temperature: 0.1,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(45_000),
        }),
        1,
        "quickDecision.strictRetry"
      );

      const strictText = strictResult.text ?? "";
      const strictJson = extractJsonFromText(strictText);
      parsed = parseJsonWithRepair(strictJson);
      tokensUsed += strictResult.usage?.totalTokens ?? 0;

      if (!parsed) {
        console.error("[Pipeline] LLM still did not return parseable JSON after strict retry. Raw:", strictText.slice(0, 500));
      }
    }

    // ---- Attempt 4: final aggressive extraction — scan all substrings ----
    if (!parsed) {
      // Look for any substring that might be a JSON object with "action" key
      const actionJsonMatch = rawText.match(/\{[^{}]*"action"\s*:\s*"(?:buy|sell|hold)"[^{}]*\}/);
      if (actionJsonMatch) {
        parsed = parseJsonWithRepair(actionJsonMatch[0]);
      }
    }

    // ---- All parsing attempts failed — safe hold fallback ----
    if (!parsed) {
      console.error("[Pipeline] All JSON parsing attempts failed. Returning safe hold decision.");
      const safeHold: Record<string, unknown> = {
        action: "hold",
        confidence: 0,
        reasoning: `Pipeline parse failure — LLM output could not be parsed. Raw: ${rawText.slice(0, 200)}`,
        signals: [],
      };
      const normalized = normalizeDecisionFields(safeHold);
      decision = schema.parse(normalized);
      return { decision, tokensUsed: textResult.usage?.totalTokens ?? 0, toolCalls: 0 };
    }

    // ---- Normalize and validate ----
    const normalized = normalizeDecisionFields(parsed);
    decision = schema.parse(normalized);

    return {
      decision,
      tokensUsed: textResult.usage?.totalTokens ?? 0,
      toolCalls: textResult.toolCalls?.length ?? 0,
    };
  } catch (err) {
    // ---- Outer catch: schema validation or unrecoverable error ----
    console.error("[Pipeline] quickDecision failed, returning safe hold:", err instanceof Error ? err.message : String(err));

    // Last resort: try to return a safe hold so the agent doesn't crash
    try {
      const safeHold: Record<string, unknown> = {
        action: "hold",
        confidence: 0,
        reasoning: `Pipeline error — ${err instanceof Error ? err.message.slice(0, 200) : "unknown error"}`,
        signals: [],
      };
      const normalized = normalizeDecisionFields(safeHold);
      const decision = schema.parse(normalized);
      return { decision, tokensUsed: 0, toolCalls: 0 };
    } catch (schemaErr) {
      // Schema parse itself failed — re-throw original error
      throw err;
    }
  } finally {
    releaseLLMSlot(agentId);
  }
}
