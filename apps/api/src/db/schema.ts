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
  onChainAddress: varchar("on_chain_address", { length: 44 }),
  name: varchar("name", { length: 100 }).notNull(),
  category: varchar("category", { length: 20 }).notNull(),
  description: text("description"),
  pricingModel: jsonb("pricing_model").notNull(),
  capabilities: text("capabilities").array(),
  strategyConfig: jsonb("strategy_config"),
  isActive: boolean("is_active").default(true),
  isVerified: boolean("is_verified").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  ownerIdx: index("agents_owner_idx").on(table.ownerAddress),
  categoryIdx: index("agents_category_idx").on(table.category),
  activeIdx: index("agents_active_idx").on(table.isActive),
}));

export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientAddress: varchar("client_address", { length: 44 }).notNull().references(() => users.walletAddress),
  agentId: uuid("agent_id").notNull().references(() => agents.id),
  privyWalletId: varchar("privy_wallet_id", { length: 100 }),
  privyWalletAddress: varchar("privy_wallet_address", { length: 44 }),
  onChainAddress: varchar("on_chain_address", { length: 44 }),
  maxCap: decimal("max_cap", { precision: 18, scale: 6 }),
  dailyCap: decimal("daily_cap", { precision: 18, scale: 6 }),
  status: varchar("status", { length: 20 }).default("paused"),
  totalInvested: decimal("total_invested", { precision: 18, scale: 6 }).default("0"),
  totalProfit: decimal("total_profit", { precision: 18, scale: 6 }).default("0"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  clientIdx: index("jobs_client_idx").on(table.clientAddress),
  agentIdx: index("jobs_agent_idx").on(table.agentId),
  statusIdx: index("jobs_status_idx").on(table.status),
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
  reasoningSnippet: text("reasoning_snippet"),
  txSignature: varchar("tx_signature", { length: 88 }),
  positionPubkey: varchar("position_pubkey", { length: 44 }),
  openedAt: timestamp("opened_at").defaultNow(),
  closedAt: timestamp("closed_at"),
}, (table) => ({
  jobIdx: index("positions_job_idx").on(table.jobId),
  statusIdx: index("positions_status_idx").on(table.status),
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
  agentId: uuid("agent_id").primaryKey().references(() => agents.id),
  totalTrades: integer("total_trades").default(0),
  winningTrades: integer("winning_trades").default(0),
  totalPnl: decimal("total_pnl", { precision: 18, scale: 6 }).default("0"),
  winRate: decimal("win_rate", { precision: 5, scale: 4 }).default("0"),
  sharpeRatio: decimal("sharpe_ratio", { precision: 10, scale: 4 }),
  maxDrawdown: decimal("max_drawdown", { precision: 10, scale: 4 }),
  totalVolume: decimal("total_volume", { precision: 18, scale: 6 }).default("0"),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

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
