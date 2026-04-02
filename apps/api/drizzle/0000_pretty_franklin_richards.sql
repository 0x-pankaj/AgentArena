CREATE TABLE IF NOT EXISTS "agent_performance" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"total_trades" integer DEFAULT 0,
	"winning_trades" integer DEFAULT 0,
	"total_pnl" numeric(18, 6) DEFAULT '0',
	"win_rate" numeric(5, 4) DEFAULT '0',
	"sharpe_ratio" numeric(10, 4),
	"max_drawdown" numeric(10, 4),
	"total_volume" numeric(18, 6) DEFAULT '0',
	"last_updated" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_type" varchar(20) NOT NULL,
	"pipeline_step" varchar(20) NOT NULL,
	"version_number" integer NOT NULL,
	"system_prompt" text NOT NULL,
	"parent_version_id" uuid,
	"performance_snapshot" jsonb,
	"created_by" varchar(44) DEFAULT 'system' NOT NULL,
	"is_active" boolean DEFAULT false,
	"changelog" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_address" varchar(44) NOT NULL,
	"on_chain_address" varchar(44),
	"name" varchar(100) NOT NULL,
	"category" varchar(20) NOT NULL,
	"description" text,
	"pricing_model" jsonb NOT NULL,
	"capabilities" text[],
	"strategy_config" jsonb,
	"is_active" boolean DEFAULT true,
	"is_verified" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evolution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_type" varchar(20) NOT NULL,
	"pipeline_step" varchar(20) NOT NULL,
	"from_version_id" uuid,
	"to_version_id" uuid,
	"trades_analyzed" integer NOT NULL,
	"old_win_rate" numeric(5, 4),
	"new_projected_win_rate" numeric(5, 4),
	"changelog" text,
	"auto_promoted" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid,
	"agent_name" varchar(100),
	"category" varchar(20),
	"content" jsonb NOT NULL,
	"display_message" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_address" varchar(44) NOT NULL,
	"agent_id" uuid NOT NULL,
	"privy_wallet_id" varchar(100),
	"privy_wallet_address" varchar(44),
	"on_chain_address" varchar(44),
	"max_cap" numeric(18, 6),
	"daily_cap" numeric(18, 6),
	"status" varchar(20) DEFAULT 'paused',
	"total_invested" numeric(18, 6) DEFAULT '0',
	"total_profit" numeric(18, 6) DEFAULT '0',
	"started_at" timestamp,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_data" (
	"market_id" varchar(100) PRIMARY KEY NOT NULL,
	"source" varchar(20) NOT NULL,
	"category" varchar(20),
	"question" text NOT NULL,
	"outcomes" jsonb NOT NULL,
	"volume" numeric(18, 6),
	"liquidity" numeric(18, 6),
	"closes_at" timestamp,
	"resolved_at" timestamp,
	"result" varchar(20),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"market_id" varchar(100) NOT NULL,
	"market_question" text NOT NULL,
	"side" varchar(10) NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"entry_price" numeric(10, 6) NOT NULL,
	"current_price" numeric(10, 6),
	"pnl" numeric(18, 6),
	"status" varchar(20) DEFAULT 'open',
	"reasoning_snippet" text,
	"tx_signature" varchar(88),
	"opened_at" timestamp DEFAULT now(),
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trade_prompt_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid NOT NULL,
	"prompt_version_id" uuid NOT NULL,
	"pipeline_step" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"market_id" varchar(100) NOT NULL,
	"market_question" text NOT NULL,
	"side" varchar(10) NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"entry_price" numeric(10, 6) NOT NULL,
	"exit_price" numeric(10, 6),
	"outcome" varchar(10),
	"profit_loss" numeric(18, 6),
	"reasoning" text,
	"executed_at" timestamp DEFAULT now(),
	"settled_at" timestamp,
	"tx_signature" varchar(88)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"wallet_address" varchar(44) PRIMARY KEY NOT NULL,
	"username" varchar(50),
	"privy_user_id" varchar(100),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_performance" ADD CONSTRAINT "agent_performance_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_address_users_wallet_address_fk" FOREIGN KEY ("owner_address") REFERENCES "public"."users"("wallet_address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evolution_events" ADD CONSTRAINT "evolution_events_from_version_id_agent_prompt_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."agent_prompt_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "evolution_events" ADD CONSTRAINT "evolution_events_to_version_id_agent_prompt_versions_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "public"."agent_prompt_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_address_users_wallet_address_fk" FOREIGN KEY ("client_address") REFERENCES "public"."users"("wallet_address") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "positions" ADD CONSTRAINT "positions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trade_prompt_links" ADD CONSTRAINT "trade_prompt_links_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trade_prompt_links" ADD CONSTRAINT "trade_prompt_links_prompt_version_id_agent_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."agent_prompt_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trades" ADD CONSTRAINT "trades_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trades" ADD CONSTRAINT "trades_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
