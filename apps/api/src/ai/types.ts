import { z } from "zod";
import type { AgentState } from "@agent-arena/shared";

// --- Agent identity ---

export interface AgentIdentity {
  id: string;
  name: string;
  category: "politics" | "sports" | "tech" | "general" | "crypto";
  description: string;
}

// --- Model config per pipeline step ---

export interface ModelConfig {
  /** Model identifier — e.g. "kimi-k2.5", "gpt-4o", "claude-sonnet-4-20250514" */
  model: string;
  /** Provider — "openai" (compatible: Kimi, etc.), "anthropic" */
  provider: "openai" | "anthropic";
  /** Base URL override (for Kimi, etc.) */
  baseURL?: string;
  /** API key env var name */
  apiKeyEnv?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentModels {
  /** Model for signal analysis (heavy reasoning) */
  analysis: ModelConfig;
  /** Model for trade decisions (fast, structured output) */
  decision: ModelConfig;
  /** Model for web search + synthesis (needs search capability) */
  search: ModelConfig;
}

// --- Tool definition (composable data sources) ---

export interface AgentTool {
  name: string;
  description: string;
  /** Zod schema for tool parameters */
  parameters: z.ZodType;
  /** Execute the tool */
  execute: (params: Record<string, unknown>) => Promise<unknown>;
  /** Cost per call (for tracking) */
  costPerCall?: number;
}

// --- Pipeline step ---

export interface PipelineStep {
  name: string;
  /** Which model to use for this step */
  modelKey: keyof AgentModels;
  /** System prompt for this step */
  systemPrompt: string;
  /** Tools available in this step */
  toolNames: string[];
  /** Zod schema for structured output */
  outputSchema?: z.ZodType;
  /** Max tokens for this step */
  maxTokens?: number;
}

// --- Trade decision (standardized across all agents) ---

export const TradeDecisionSchema = z.object({
  action: z.enum(["buy", "sell", "hold"]),
  marketId: z.string().optional(),
  marketQuestion: z.string().optional(),
  isYes: z.boolean().optional(),
  amount: z.number().min(0).optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  signals: z.array(z.string()).optional(), // which signals triggered the decision
});
export type TradeDecision = z.infer<typeof TradeDecisionSchema>;

// --- Market context ---

export interface MarketContext {
  marketId: string;
  question: string;
  outcomes: Array<{ name: string; price: number }>;
  volume: number;
  liquidity: number;
  closesAt: string | null;
}

// --- Position context ---

export interface AgentPosition {
  marketId: string;
  side: string;
  amount: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
}

// --- Agent tick result ---

export interface AgentTickResult {
  state: AgentState;
  action: "scanned" | "analyzed" | "executed" | "monitored" | "skipped" | "stopped";
  detail: string;
  decision?: TradeDecision;
  tokensUsed?: number;
}

// --- Agent config ---

export interface AgentConfig {
  identity: AgentIdentity;
  models: AgentModels;
  tools: AgentTool[];
  pipeline: PipelineStep[];
  /** Minimum confidence to trade */
  minConfidence: number;
  /** Scan interval in ms */
  scanIntervalMs: number;
  /** Monitor interval in ms */
  monitorIntervalMs: number;
}

// --- Agent runtime context (passed to tick) ---

export interface AgentRuntimeContext {
  agentId: string;
  jobId: string;
  agentWalletId: string;
  agentWalletAddress: string;
  ownerPubkey: string;
}
