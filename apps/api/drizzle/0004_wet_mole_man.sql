CREATE TABLE IF NOT EXISTS "agent_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_agent_id" uuid NOT NULL,
	"to_agent_id" uuid NOT NULL,
	"job_id" uuid,
	"interaction_type" varchar(20) NOT NULL,
	"market_id" varchar(100),
	"market_question" text,
	"quality_score" numeric(5, 2),
	"confidence" numeric(5, 2),
	"tx_signature" varchar(88),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "swarm_consensus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" varchar(100) NOT NULL,
	"market_question" text,
	"initiating_agent_id" uuid NOT NULL,
	"consensus_action" varchar(10) NOT NULL,
	"adjusted_confidence" numeric(5, 2),
	"approved" boolean NOT NULL,
	"votes_for" integer DEFAULT 0,
	"votes_against" integer DEFAULT 0,
	"votes_abstain" integer DEFAULT 0,
	"participating_agents" uuid[],
	"details" jsonb,
	"executed" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "asset_address" varchar(44);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "atom_stats_address" varchar(44);--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "trust_tier" varchar(20) DEFAULT 'Unknown';--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "reputation_score" numeric(5, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "atom_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "policy_expiry_at" timestamp;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "explorer_links" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_interactions" ADD CONSTRAINT "agent_interactions_from_agent_id_agents_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_interactions" ADD CONSTRAINT "agent_interactions_to_agent_id_agents_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_interactions" ADD CONSTRAINT "agent_interactions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "swarm_consensus" ADD CONSTRAINT "swarm_consensus_initiating_agent_id_agents_id_fk" FOREIGN KEY ("initiating_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interactions_from_idx" ON "agent_interactions" USING btree ("from_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interactions_to_idx" ON "agent_interactions" USING btree ("to_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interactions_type_idx" ON "agent_interactions" USING btree ("interaction_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interactions_market_idx" ON "agent_interactions" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "interactions_job_idx" ON "agent_interactions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "swarm_consensus_market_idx" ON "swarm_consensus" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "swarm_consensus_agent_idx" ON "swarm_consensus" USING btree ("initiating_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_asset_idx" ON "agents" USING btree ("asset_address");