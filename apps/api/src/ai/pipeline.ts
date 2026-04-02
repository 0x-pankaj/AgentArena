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

// --- Convert AgentTool to AI SDK tool format ---
// We use `any` casts throughout because AI SDK v6 has extremely deep generic types
// that cause TypeScript to OOM. The runtime behavior is correct.

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

// --- Quick analysis (single LLM call with tools) ---

export async function quickAnalysis(params: {
  modelConfig: ModelConfig;
  systemPrompt: string;
  userMessage: string;
  tools?: string[];
}): Promise<{ text: string; tokensUsed: number; toolCalls: number }> {
  const { modelConfig, systemPrompt, userMessage, tools = [] } = params;

  const model = resolveModel(modelConfig);
  const agentTools = toAITools(tools);
  const sdkTools = toSdkTools(agentTools);
  const hasTools = Object.keys(sdkTools).length > 0;

  const result = await (generateText as any)({
    model,
    system: systemPrompt,
    prompt: userMessage,
    tools: hasTools ? sdkTools : undefined,
    temperature: modelConfig.temperature ?? 0.3,
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(90_000),
  });

  return {
    text: result.text as string,
    tokensUsed: (result.usage?.totalTokens ?? 0) as number,
    toolCalls: (result.toolCalls?.length ?? 0) as number,
  };
}

// --- Quick structured decision (single LLM call with schema) ---

export async function quickDecision<T>(params: {
  modelConfig: ModelConfig;
  systemPrompt: string;
  userMessage: string;
  schema: z.ZodType<T>;
  tools?: string[];
}): Promise<{ decision: T; tokensUsed: number; toolCalls: number }> {
  const { modelConfig, systemPrompt, userMessage, schema, tools = [] } = params;

  const model = resolveModel(modelConfig);
  const agentTools = toAITools(tools);
  const sdkTools = toSdkTools(agentTools);
  const hasTools = Object.keys(sdkTools).length > 0;

  const result = await (generateObject as any)({
    model,
    system: systemPrompt,
    prompt: userMessage,
    schema,
    tools: hasTools ? sdkTools : undefined,
    temperature: modelConfig.temperature ?? 0.3,
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(90_000),
  });

  return {
    decision: result.object as T,
    tokensUsed: (result.usage?.totalTokens ?? 0) as number,
    toolCalls: (result.toolCalls?.length ?? 0) as number,
  };
}
