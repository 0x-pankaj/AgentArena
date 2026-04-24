import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, decimal, integer, bigint, index } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  walletAddress: varchar("wallet_address", { length: 44 }).primaryKey(),
  username: varchar("username", { length: 50 }).unique(),
  privyUserId: varchar("privy_user_id", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const agents = pgTable("agents", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerAddress: varchar("owner_address", { length: 44 }).notNull().references(() => users.walletAddress),
  onChainAddress: varchar("on_chain_address", { length: 44 }), // Deprecated: old PDA address
  assetAddress: varchar("asset_address", { length: 44 }), // 8004 Metaplex Core NFT asset
  atomStatsAddress: varchar("atom_stats_address", { length: 44 }), // ATOM stats PDA
  name: varchar("name", { length: 100 }).notNull(),
  category: varchar("category", { length: 20 }).notNull(),
  description: text("description"),
  pricingModel: jsonb("pricing_model").notNull(),
  capabilities: text("capabilities").array(),
  strategyConfig: jsonb("strategy_config"),
  isActive: boolean("is_active").default(true),
  isVerified: boolean("is_verified").default(false),
  trustTier: varchar("trust_tier", { length: 20 }).default("Unknown"), // ATOM trust tier
  reputationScore: decimal("reputation_score", { precision: 5, scale: 2 }).default("0"), // 0-100
  atomEnabled: boolean("atom_enabled").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  ownerIdx: index("agents_owner_idx").on(table.ownerAddress),
  categoryIdx: index("agents_category_idx").on(table.category),
  activeIdx: index("agents_active_idx").on(table.isActive),
  assetIdx: index("agents_asset_idx").on(table.assetAddress),
}));

export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientAddress: varchar("client_address", { length: 44 }).notNull().references(() => users.walletAddress),
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  privyWalletId: varchar("privy_wallet_id", { length: 200 }),
  privyWalletAddress: varchar("privy_wallet_address", { length: 200 }),
  privyPolicyId: varchar("privy_policy_id", { length: 200 }), // Privy policy ID attached to this job's wallet
  onChainAddress: varchar("on_chain_address", { length: 44 }), // Deprecated: old escrow PDA
  maxCap: decimal("max_cap", { precision: 18, scale: 6 }),
  dailyCap: decimal("daily_cap", { precision: 18, scale: 6 }),
  status: varchar("status", { length: 20 }).default("paused"),
  tradingMode: varchar("trading_mode", { length: 10 }).default("paper").notNull(), // "paper" | "live"
  paperBalance: decimal("paper_balance", { precision: 18, scale: 6 }).default("1000"),
  totalInvested: decimal("total_invested", { precision: 18, scale: 6 }).default("0"),
  totalProfit: decimal("total_profit", { precision: 18, scale: 6 }).default("0"),
  policyExpiryAt: timestamp("policy_expiry_at"), // When the Privy policy expires
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  clientIdx: index("jobs_client_idx").on(table.clientAddress),
  agentIdx: index("jobs_agent_idx").on(table.agentId),
  statusIdx: index("jobs_status_idx").on(table.status),
  modeIdx: index("jobs_mode_idx").on(table.tradingMode),
}));

export const positions = pgTable("positions", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => jobs.id),
  marketId: varchar("market_id", { length: 100 }).notNull(),
  marketQuestion: text("market_question").notNull(),
  side: varchar("side", { length: 10 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 6 }).notNull(),
  entryPrice: decimal("entry_price", { precision: 10, scale: 6 }).notNull(),
  currentPrice: decimal("current_price", { precision: 10, scale: 6 }),
  pnl: decimal("pnl", { precision: 18, scale: 6 }),
  status: varchar("status", { length: 20 }).default("open"),
  isPaperTrade: boolean("is_paper_trade").default(true).notNull(),
  expiresAt: timestamp("expires_at"),
  takeProfitPercent: decimal("take_profit_percent", { precision: 5, scale: 4 }).default("0.20"),
  stopLossPercent: decimal("stop_loss_percent", { precision: 5, scale: 4 }).default("0.15"),
  marketResult: varchar("market_result", { length: 20 }),
  claimableAt: timestamp("claimable_at"),
  claimedAt: timestamp("claimed_at"),
  reasoningSnippet: text("reasoning_snippet"),
  txSignature: varchar("tx_signature", { length: 88 }),
  positionPubkey: varchar("position_pubkey", { length: 44 }),
  simulatedOrderPubkey: varchar("simulated_order_pubkey", { length: 100 }),
  simulatedPositionPubkey: varchar("simulated_position_pubkey", { length: 100 }),
  openedAt: timestamp("opened_at").defaultNow(),
  closedAt: timestamp("closed_at"),
}, (table) => ({
  jobIdx: index("positions_job_idx").on(table.jobId),
  statusIdx: index("positions_status_idx").on(table.status),
  paperIdx: index("positions_paper_idx").on(table.isPaperTrade),
  marketIdx: index("positions_market_idx").on(table.marketId),
}));

export const paperOrders = pgTable("paper_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => jobs.id),
  marketId: varchar("market_id", { length: 100 }).notNull(),
  side: varchar("side", { length: 10 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 6 }).notNull(),
  depositAmount: decimal("deposit_amount", { precision: 18, scale: 6 }).notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(), // pending | filled | failed
  simulatedTxSignature: varchar("simulated_tx_signature", { length: 100 }),
  simulatedOrderPubkey: varchar("simulated_order_pubkey", { length: 100 }),
  simulatedPositionPubkey: varchar("simulated_position_pubkey", { length: 100 }),
  fillPrice: decimal("fill_price", { precision: 10, scale: 6 }),
  filledAt: timestamp("filled_at"),
  failedReason: text("failed_reason"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  jobIdx: index("paper_orders_job_idx").on(table.jobId),
  statusIdx: index("paper_orders_status_idx").on(table.status),
  marketIdx: index("paper_orders_market_idx").on(table.marketId),
}));

export const trades = pgTable("trades", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => jobs.id),
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  marketId: varchar("market_id", { length: 100 }).notNull(),
  marketQuestion: text("market_question").notNull(),
  side: varchar("side", { length: 10 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 6 }).notNull(),
  entryPrice: decimal("entry_price", { precision: 10, scale: 6 }).notNull(),
  exitPrice: decimal("exit_price", { precision: 10, scale: 6 }),
  outcome: varchar("outcome", { length: 10 }),
  profitLoss: decimal("profit_loss", { precision: 18, scale: 6 }),
  reasoning: text("reasoning"),
  executedAt: timestamp("executed_at").defaultNow(),
  settledAt: timestamp("settled_at"),
  txSignature: varchar("tx_signature", { length: 88 }),
}, (table) => ({
  jobIdx: index("trades_job_idx").on(table.jobId),
  agentIdx: index("trades_agent_idx").on(table.agentId),
  executedAtIdx: index("trades_executed_at_idx").on(table.executedAt),
}));

export const agentPerformance = pgTable("agent_performance", {
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  isPaperTrading: boolean("is_paper_trading").default(true).notNull(),
  totalTrades: integer("total_trades").default(0),
  winningTrades: integer("winning_trades").default(0),
  totalPnl: decimal("total_pnl", { precision: 18, scale: 6 }).default("0"),
  winRate: decimal("win_rate", { precision: 5, scale: 4 }).default("0"),
  sharpeRatio: decimal("sharpe_ratio", { precision: 10, scale: 4 }),
  maxDrawdown: decimal("max_drawdown", { precision: 10, scale: 4 }),
  totalVolume: decimal("total_volume", { precision: 18, scale: 6 }).default("0"),
  lastUpdated: timestamp("last_updated").defaultNow(),
}, (table) => ({
  pk: index("agent_perf_pk").on(table.agentId, table.isPaperTrading),
}));

export const marketData = pgTable("market_data", {
  marketId: varchar("market_id", { length: 100 }).primaryKey(),
  source: varchar("source", { length: 20 }).notNull(),
  category: varchar("category", { length: 20 }),
  question: text("question").notNull(),
  outcomes: jsonb("outcomes").notNull(),
  volume: decimal("volume", { precision: 18, scale: 6 }),
  liquidity: decimal("liquidity", { precision: 18, scale: 6 }),
  closesAt: timestamp("closes_at"),
  resolvedAt: timestamp("resolved_at"),
  result: varchar("result", { length: 20 }),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const feedEvents = pgTable("feed_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: uuid("agent_id").references(() => agents.id),
  agentName: varchar("agent_name", { length: 100 }),
  category: varchar("category", { length: 20 }),
  content: jsonb("content").notNull(),
  displayMessage: text("display_message").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// --- Evolution Engine: Prompt Versioning ---

export const agentPromptVersions = pgTable("agent_prompt_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentType: varchar("agent_type", { length: 20 }).notNull(),
  pipelineStep: varchar("pipeline_step", { length: 20 }).notNull(),
  versionNumber: integer("version_number").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  parentVersionId: uuid("parent_version_id"),
  performanceSnapshot: jsonb("performance_snapshot"),
  createdBy: varchar("created_by", { length: 44 }).notNull().default("system"),
  isActive: boolean("is_active").default(false),
  changelog: text("changelog"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const tradePromptLinks = pgTable("trade_prompt_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  positionId: uuid("position_id").notNull().references(() => positions.id),
  promptVersionId: uuid("prompt_version_id").notNull().references(() => agentPromptVersions.id),
  pipelineStep: varchar("pipeline_step", { length: 20 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const evolutionEvents = pgTable("evolution_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentType: varchar("agent_type", { length: 20 }).notNull(),
  pipelineStep: varchar("pipeline_step", { length: 20 }).notNull(),
  fromVersionId: uuid("from_version_id").references(() => agentPromptVersions.id),
  toVersionId: uuid("to_version_id").references(() => agentPromptVersions.id),
  tradesAnalyzed: integer("trades_analyzed").notNull(),
  oldWinRate: decimal("old_win_rate", { precision: 5, scale: 4 }),
  newProjectedWinRate: decimal("new_projected_win_rate", { precision: 5, scale: 4 }),
  changelog: text("changelog"),
  autoPromoted: boolean("auto_promoted").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// --- Signal Calibration: Track per-source accuracy ---

export const signalCalibration = pgTable("signal_calibration", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentType: varchar("agent_type", { length: 20 }).notNull(),
  source: varchar("source", { length: 50 }).notNull(),
  predicted: decimal("predicted", { precision: 10, scale: 6 }).notNull(),
  actual: decimal("actual", { precision: 10, scale: 6 }).notNull(),
  brierScore: decimal("brier_score", { precision: 10, scale: 6 }),
  marketId: varchar("market_id", { length: 100 }),
  positionId: varchar("position_id", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  agentTypeIdx: index("signal_cal_agent_type_idx").on(table.agentType),
  sourceIdx: index("signal_cal_source_idx").on(table.source),
  marketIdx: index("signal_cal_market_idx").on(table.marketId),
}));

// --- Confidence Calibration: Track LLM confidence vs actual outcomes ---

export const confidenceCalibration = pgTable("confidence_calibration", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentType: varchar("agent_type", { length: 20 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  predictedConfidence: decimal("predicted_confidence", { precision: 10, scale: 6 }).notNull(),
  actualOutcome: varchar("actual_outcome", { length: 10 }).notNull(),
  positionId: varchar("position_id", { length: 100 }),
  marketId: varchar("market_id", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  agentModelIdx: index("conf_cal_agent_model_idx").on(table.agentType, table.model),
}));

// --- Scenario Analysis Results: Track pre-trade EV predictions ---

export const scenarioResults = pgTable("scenario_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: varchar("agent_id", { length: 100 }).notNull(),
  jobId: varchar("job_id", { length: 100 }).notNull(),
  marketId: varchar("market_id", { length: 100 }),
  action: varchar("action", { length: 10 }).notNull(),
  estimatedProbability: decimal("estimated_probability", { precision: 10, scale: 6 }),
  totalExpectedValue: decimal("total_expected_value", { precision: 18, scale: 6 }),
  riskRewardRatio: decimal("risk_reward_ratio", { precision: 10, scale: 4 }),
  shouldTrade: boolean("should_trade").notNull(),
  reason: text("reason"),
  scenarios: jsonb("scenarios"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  marketIdx: index("scenario_market_idx").on(table.marketId),
}));

// --- Adversarial Review Results ---

export const adversarialReviews = pgTable("adversarial_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: varchar("agent_id", { length: 100 }).notNull(),
  marketId: varchar("market_id", { length: 100 }),
  action: varchar("action", { length: 10 }).notNull(),
  overturned: boolean("overturned").notNull(),
  originalConfidence: decimal("original_confidence", { precision: 10, scale: 6 }),
  riskAdjustedConfidence: decimal("risk_adjusted_confidence", { precision: 10, scale: 6 }),
  reason: text("reason"),
  risks: jsonb("risks"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  agentIdx: index("adversarial_agent_idx").on(table.agentId),
  overturnedIdx: index("adversarial_overturned_idx").on(table.overturned),
}));

// --- Multi-Model Consensus Results ---

export const consensusResults = pgTable("consensus_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentId: varchar("agent_id", { length: 100 }).notNull(),
  marketId: varchar("market_id", { length: 100 }),
  consensus: varchar("consensus", { length: 10 }).notNull(),
  modelsAgreed: integer("models_agreed").notNull(),
  modelsQueried: integer("models_queried").notNull(),
  confidenceAdjustment: decimal("confidence_adjustment", { precision: 10, scale: 6 }),
  decisionAction: varchar("decision_action", { length: 10 }),
  decisionConfidence: decimal("decision_confidence", { precision: 10, scale: 6 }),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  consensusIdx: index("consensus_consensus_idx").on(table.consensus),
}));

// --- Microstructure Check Results ---

export const microstructureChecks = pgTable("microstructure_checks", {
  id: uuid("id").defaultRandom().primaryKey(),
  marketId: varchar("market_id", { length: 100 }).notNull(),
  allowed: boolean("allowed").notNull(),
  reason: text("reason"),
  bidAskSpread: decimal("bid_ask_spread", { precision: 10, scale: 6 }),
  depthAt5Pct: decimal("depth_at_5_pct", { precision: 18, scale: 6 }),
  liquidityScore: decimal("liquidity_score", { precision: 10, scale: 6 }),
  priceImpactEstimate: decimal("price_impact_estimate", { precision: 10, scale: 6 }),
  midPrice: decimal("mid_price", { precision: 10, scale: 6 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  marketIdx: index("micro_market_idx").on(table.marketId),
}));
