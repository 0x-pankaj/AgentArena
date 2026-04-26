import { z } from "zod";

export const AgentCategory = z.enum(["politics", "sports", "general", "crypto", "geo"]);
export type AgentCategory = z.infer<typeof AgentCategory>;

export const JobStatus = z.enum([
  "created", "funded", "active", "paused", "completed", "disputed", "resolved", "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const PositionStatus = z.enum(["open", "closed", "settled"]);
export type PositionStatus = z.infer<typeof PositionStatus>;

export const TradeOutcome = z.enum(["win", "loss", "pending"]);
export type TradeOutcome = z.infer<typeof TradeOutcome>;

export const MarketSide = z.enum(["yes", "no"]);
export type MarketSide = z.infer<typeof MarketSide>;

export const AgentState = z.enum([
  "IDLE", "SCANNING", "ANALYZING", "EXECUTING", "MONITORING", "CLOSING", "SETTLING",
]);
export type AgentState = z.infer<typeof AgentState>;

export const FeedCategory = z.enum([
  "analysis", "trade", "decision", "position_update", "reasoning",
  "scanning", "thinking", "signal_update", "edge_detected", "evolution", "swarm",
]);
export type FeedCategory = z.infer<typeof FeedCategory>;

export const FeedSeverity = z.enum(["info", "significant", "critical"]);
export type FeedSeverity = z.infer<typeof FeedSeverity>;

export const AgentDecision = z.object({
  action: z.enum(["buy", "sell", "hold"]),
  marketId: z.string().optional(),
  isYes: z.boolean().optional(),
  amount: z.number().min(0).optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
export type AgentDecision = z.infer<typeof AgentDecision>;

export const AgentProfileSchema = z.object({
  id: z.string().uuid(),
  ownerAddress: z.string(),
  assetAddress: z.string().optional(),
  atomStatsAddress: z.string().optional(),
  name: z.string().min(1).max(100),
  category: AgentCategory,
  description: z.string().max(500),
  pricingModel: z.object({
    type: z.enum(["subscription", "per_trade", "profit_share"]),
    amount: z.number().min(0),
  }),
  capabilities: z.array(z.string()),
  isActive: z.boolean(),
  isVerified: z.boolean(),
  trustTier: z.string().optional(),
  reputationScore: z.number().optional(),
  atomEnabled: z.boolean().optional(),
});
export type AgentProfileSchema = z.infer<typeof AgentProfileSchema>;

export const AtomReputationSchema = z.object({
  trustTier: z.string(),
  qualityScore: z.number(),
  feedbackCount: z.number(),
  uniqueClients: z.number(),
  confidence: z.number(),
  riskScore: z.number(),
  diversityRatio: z.number(),
  formattedTier: z.string(),
  compositeScore: z.number(),
});
export type AtomReputation = z.infer<typeof AtomReputationSchema>;

export const FeedEvent = z.object({
  event_id: z.string(),
  timestamp: z.string(),
  agent_id: z.string(),
  agent_display_name: z.string(),
  job_id: z.string().optional(),
  category: FeedCategory,
  severity: FeedSeverity,
  content: z.object({
    market_analyzed: z.string().optional(),
    summary: z.string().optional(),
    asset: z.string().optional(),
    action: z.enum(["buy", "sell"]).optional(),
    amount: z.string().optional(),
    price: z.string().optional(),
    decision: z.string().optional(),
    reasoning_snippet: z.string().optional(),
    pnl: z.object({ value: z.number(), percent: z.number() }).optional(),
    confidence: z.number().optional(),
    edge_percent: z.number().optional(),
    signals_count: z.number().optional(),
    markets_scanned: z.number().optional(),
    pipeline_stage: z.string().optional(),
    type: z.string().optional(),
    fromAgent: z.string().optional(),
    toAgent: z.string().optional(),
    ratedAgent: z.string().optional(),
    ratingAgent: z.string().optional(),
    qualityScore: z.number().optional(),
    tradeOutcome: z.string().optional(),
    consensusAction: z.string().optional(),
    votesFor: z.number().optional(),
    votesAgainst: z.number().optional(),
    votesAbstain: z.number().optional(),
    approved: z.boolean().optional(),
    marketQuestion: z.string().optional(),
    direction: z.string().optional(),
  }),
  display_message: z.string(),
  is_public: z.boolean(),
});
export type FeedEvent = z.infer<typeof FeedEvent>;

export const LeaderboardEntry = z.object({
  agentId: z.string(),
  agentName: z.string(),
  category: z.string(),
  totalPnl: z.number(),
  winRate: z.number(),
  totalTrades: z.number(),
  totalVolume: z.number().optional(),
  sharpeRatio: z.number().nullable().optional(),
  maxDrawdown: z.number().nullable().optional(),
  recentTrend: z.enum(["up", "down", "flat"]).optional(),
  activePositions: z.number().optional(),
  lastActivityAt: z.string().optional(),
  rank: z.number(),
  trustTier: z.string().optional(),
  reputationScore: z.number().optional(),
  atomEnabled: z.boolean().optional(),
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;

export const GlobalStats = z.object({
  totalVolume: z.number(),
  totalPnl: z.number(),
  activeAgents: z.number(),
  totalTrades: z.number(),
  totalUsers: z.number(),
  topCategory: z.string(),
});
export type GlobalStats = z.infer<typeof GlobalStats>;

export const UserLeaderboardEntry = z.object({
  rank: z.number(),
  walletAddress: z.string(),
  username: z.string().nullable(),
  totalPnl: z.number(),
  totalAgents: z.number(),
  avgWinRate: z.number(),
  totalTrades: z.number(),
  bestAgent: z.object({
    id: z.string(),
    name: z.string(),
    pnl: z.number(),
  }),
});
export type UserLeaderboardEntry = z.infer<typeof UserLeaderboardEntry>;

// --- Evolution Engine ---

export const AgentTypeCategory = z.enum(["politics", "sports", "crypto", "general"]);
export type AgentTypeCategory = z.infer<typeof AgentTypeCategory>;

export const PipelineStep = z.enum(["research", "analysis", "decision"]);
export type PipelineStep = z.infer<typeof PipelineStep>;

export const PromptVersionSchema = z.object({
  id: z.string().uuid(),
  agentType: AgentTypeCategory,
  pipelineStep: PipelineStep,
  versionNumber: z.number(),
  systemPrompt: z.string(),
  parentVersionId: z.string().uuid().nullable(),
  performanceSnapshot: z.object({
    winRate: z.number(),
    totalTrades: z.number(),
    totalPnl: z.number(),
  }).nullable(),
  createdBy: z.string(),
  isActive: z.boolean(),
  changelog: z.string().nullable(),
  createdAt: z.string(),
});
export type PromptVersion = z.infer<typeof PromptVersionSchema>;

export const EvolutionEventSchema = z.object({
  id: z.string().uuid(),
  agentType: AgentTypeCategory,
  pipelineStep: PipelineStep,
  fromVersionId: z.string().uuid().nullable(),
  toVersionId: z.string().uuid().nullable(),
  tradesAnalyzed: z.number(),
  oldWinRate: z.number().nullable(),
  newProjectedWinRate: z.number().nullable(),
  changelog: z.string().nullable(),
  autoPromoted: z.boolean(),
  createdAt: z.string(),
});
export type EvolutionEvent = z.infer<typeof EvolutionEventSchema>;
