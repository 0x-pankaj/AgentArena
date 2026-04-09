import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import type { AgentModels, ModelConfig } from "./types";

export type { ModelConfig, AgentModels } from "./types";

const openaiProviders = new Map<string, ReturnType<typeof createOpenAI>>();
const anthropicProviders = new Map<string, ReturnType<typeof createAnthropic>>();
let openrouterProvider: ReturnType<typeof createOpenRouter> | null = null;

function getOpenAIProvider(baseURL?: string, apiKeyEnv?: string) {
  const key = `${baseURL ?? "default"}:${apiKeyEnv ?? "default"}`;
  if (!openaiProviders.has(key)) {
    const apiKey = apiKeyEnv
      ? (process.env[apiKeyEnv] ?? "")
      : (process.env.OPENAI_API_KEY ?? "");

    if (!apiKey) {
      console.warn(`[Models] Missing API key: ${apiKeyEnv ?? "OPENAI_API_KEY"}`);
    }

    openaiProviders.set(
      key,
      createOpenAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      })
    );
  }
  return openaiProviders.get(key)!;
}

function getAnthropicProvider(apiKeyEnv?: string) {
  const key = apiKeyEnv ?? "default";
  if (!anthropicProviders.has(key)) {
    const apiKey = apiKeyEnv
      ? (process.env[apiKeyEnv] ?? "")
      : (process.env.ANTHROPIC_API_KEY ?? "");

    if (!apiKey) {
      console.warn(`[Models] Missing API key: ${apiKeyEnv ?? "ANTHROPIC_API_KEY"}`);
    }

    anthropicProviders.set(key, createAnthropic({ apiKey }));
  }
  return anthropicProviders.get(key)!;
}

function getOpenRouterProvider() {
  if (!openrouterProvider) {
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";
    if (!apiKey) {
      console.warn("[Models] Missing API key: OPENROUTER_API_KEY");
    }
    openrouterProvider = createOpenRouter({ apiKey });
  }
  return openrouterProvider;
}

export function resolveModel(config: ModelConfig): LanguageModel {
  if (config.provider === "openrouter") {
    const provider = getOpenRouterProvider();
    return provider(config.model);
  }

  if (config.provider === "anthropic") {
    const provider = getAnthropicProvider(config.apiKeyEnv);
    return provider(config.model);
  }

  const provider = getOpenAIProvider(config.baseURL, config.apiKeyEnv);
  return provider(config.model);
}

import { LLM_MODEL, LLM_BASE_URL } from "@agent-arena/shared";

export const MODELS = {
  minimax: {
    model: "minimax/minimax-m2.5:free",
    provider: "openrouter" as const,
    temperature: 0.3,
    maxTokens: 4000,
  } satisfies ModelConfig,

  qwen: {
    model: "qwen/qwen3.6-plus:free",
    provider: "openrouter" as const,
    temperature: 0.3,
    maxTokens: 4000,
  } satisfies ModelConfig,

  kimi: {
    model: LLM_MODEL,
    provider: "openai" as const,
    baseURL: LLM_BASE_URL,
    apiKeyEnv: "KIMI_API_KEY",
    temperature: 0.3,
    maxTokens: 2000,
  } satisfies ModelConfig,

  gpt4o: {
    model: "gpt-4o",
    provider: "openai" as const,
    temperature: 0.2,
    maxTokens: 4000,
  } satisfies ModelConfig,

  gpt4oMini: {
    model: "gpt-4o-mini",
    provider: "openai" as const,
    temperature: 0.3,
    maxTokens: 1000,
  } satisfies ModelConfig,

  claudeSonnet: {
    model: "claude-sonnet-4-20250514",
    provider: "anthropic" as const,
    temperature: 0.3,
    maxTokens: 4000,
  } satisfies ModelConfig,

  claudeHaiku: {
    model: "claude-haiku-4-20250414",
    provider: "anthropic" as const,
    temperature: 0.3,
    maxTokens: 1000,
  } satisfies ModelConfig,
} as const;

export const DEFAULT_POLITICS_AGENT_MODELS: AgentModels = {
  analysis: MODELS.qwen,
  decision: MODELS.qwen,
  search: MODELS.qwen,
};

export const DEFAULT_SPORTS_AGENT_MODELS: AgentModels = {
  analysis: MODELS.qwen,
  decision: MODELS.qwen,
  search: MODELS.qwen,
};

export const DEFAULT_CRYPTO_AGENT_MODELS: AgentModels = {
  analysis: MODELS.qwen,
  decision: MODELS.qwen,
  search: MODELS.qwen,
};

export const DEFAULT_GENERAL_AGENT_MODELS: AgentModels = {
  analysis: MODELS.qwen,
  decision: MODELS.qwen,
  search: MODELS.qwen,
};

export function getModelOverrides(): Partial<Record<string, ModelConfig>> {
  const overrides: Partial<Record<string, ModelConfig>> = {};

  const analysisModel = process.env.AGENT_MODEL_ANALYSIS;
  if (analysisModel && analysisModel in MODELS) {
    overrides.analysis = MODELS[analysisModel as keyof typeof MODELS];
  }

  const decisionModel = process.env.AGENT_MODEL_DECISION;
  if (decisionModel && decisionModel in MODELS) {
    overrides.decision = MODELS[decisionModel as keyof typeof MODELS];
  }

  return overrides;
}

export function resolveAgentModels(
  defaults: AgentModels
): AgentModels {
  const overrides = getModelOverrides();
  return { ...defaults, ...overrides } as AgentModels;
}
