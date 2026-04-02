import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import type { AgentModels, ModelConfig } from "./types";

// Re-export for convenience
export type { ModelConfig, AgentModels } from "./types";

// --- Provider instances (lazy, cached) ---

const openaiProviders = new Map<string, ReturnType<typeof createOpenAI>>();
const anthropicProviders = new Map<string, ReturnType<typeof createAnthropic>>();

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

// --- Resolve model config to a LanguageModel ---

export function resolveModel(config: ModelConfig): LanguageModel {
  if (config.provider === "anthropic") {
    const provider = getAnthropicProvider(config.apiKeyEnv);
    return provider(config.model);
  }

  // Default: OpenAI-compatible (works for Kimi, OpenAI, etc.)
  const provider = getOpenAIProvider(config.baseURL, config.apiKeyEnv);
  return provider(config.model);
}

// --- Preset model configs ---

import { LLM_MODEL, LLM_BASE_URL } from "@agent-arena/shared";

export const MODELS = {
  /** Kimi K2.5 — cheap, capable, built-in web search */
  kimi: {
    model: LLM_MODEL,
    provider: "openai",
    baseURL: LLM_BASE_URL,
    apiKeyEnv: "KIMI_API_KEY",
    temperature: 0.3,
    maxTokens: 2000,
  } satisfies ModelConfig,

  /** GPT-4o — best for complex reasoning */
  gpt4o: {
    model: "gpt-4o",
    provider: "openai",
    temperature: 0.2,
    maxTokens: 4000,
  } satisfies ModelConfig,

  /** GPT-4o-mini — fast, cheap for simple tasks */
  gpt4oMini: {
    model: "gpt-4o-mini",
    provider: "openai",
    temperature: 0.3,
    maxTokens: 1000,
  } satisfies ModelConfig,

  /** Claude Sonnet — strong analysis */
  claudeSonnet: {
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    temperature: 0.3,
    maxTokens: 4000,
  } satisfies ModelConfig,

  /** Claude Haiku — fast, cheap */
  claudeHaiku: {
    model: "claude-haiku-4-20250414",
    provider: "anthropic",
    temperature: 0.3,
    maxTokens: 1000,
  } satisfies ModelConfig,
} as const;

// --- Default model configs per agent role ---

export const DEFAULT_POLITICS_AGENT_MODELS: AgentModels = {
  analysis: MODELS.kimi,
  decision: MODELS.claudeSonnet,
  search: MODELS.kimi,
};

export const DEFAULT_SPORTS_AGENT_MODELS: AgentModels = {
  analysis: MODELS.gpt4o,
  decision: MODELS.gpt4oMini,
  search: MODELS.kimi,
};

export const DEFAULT_CRYPTO_AGENT_MODELS: AgentModels = {
  analysis: MODELS.kimi,
  decision: MODELS.kimi,
  search: MODELS.kimi,
};

export const DEFAULT_GENERAL_AGENT_MODELS: AgentModels = {
  analysis: MODELS.kimi,
  decision: MODELS.kimi,
  search: MODELS.kimi,
};

// --- Environment overrides (for hot-swapping models) ---

export function getModelOverrides(): Partial<Record<string, ModelConfig>> {
  const overrides: Partial<Record<string, ModelConfig>> = {};

  // Check env vars like AGENT_MODEL_ANALYSIS=kimi
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

// --- Merge overrides into agent models ---

export function resolveAgentModels(
  defaults: AgentModels
): AgentModels {
  const overrides = getModelOverrides();
  return { ...defaults, ...overrides } as AgentModels;
}
