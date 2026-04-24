CREATE TABLE IF NOT EXISTS "adversarial_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar(100) NOT NULL,
	"market_id" varchar(100),
	"action" varchar(10) NOT NULL,
	"overturned" boolean NOT NULL,
	"original_confidence" numeric(10, 6),
	"risk_adjusted_confidence" numeric(10, 6),
	"reason" text,
	"risks" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "confidence_calibration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_type" varchar(20) NOT NULL,
	"model" varchar(100) NOT NULL,
	"predicted_confidence" numeric(10, 6) NOT NULL,
	"actual_outcome" varchar(10) NOT NULL,
	"position_id" varchar(100),
	"market_id" varchar(100),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consensus_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar(100) NOT NULL,
	"market_id" varchar(100),
	"consensus" varchar(10) NOT NULL,
	"models_agreed" integer NOT NULL,
	"models_queried" integer NOT NULL,
	"confidence_adjustment" numeric(10, 6),
	"decision_action" varchar(10),
	"decision_confidence" numeric(10, 6),
	"details" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "microstructure_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" varchar(100) NOT NULL,
	"allowed" boolean NOT NULL,
	"reason" text,
	"bid_ask_spread" numeric(10, 6),
	"depth_at_5_pct" numeric(18, 6),
	"liquidity_score" numeric(10, 6),
	"price_impact_estimate" numeric(10, 6),
	"mid_price" numeric(10, 6),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "paper_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"market_id" varchar(100) NOT NULL,
	"side" varchar(10) NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"deposit_amount" numeric(18, 6) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"simulated_tx_signature" varchar(100),
	"simulated_order_pubkey" varchar(100),
	"simulated_position_pubkey" varchar(100),
	"fill_price" numeric(10, 6),
	"filled_at" timestamp,
	"failed_reason" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scenario_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar(100) NOT NULL,
	"job_id" varchar(100) NOT NULL,
	"market_id" varchar(100),
	"action" varchar(10) NOT NULL,
	"estimated_probability" numeric(10, 6),
	"total_expected_value" numeric(18, 6),
	"risk_reward_ratio" numeric(10, 4),
	"should_trade" boolean NOT NULL,
	"reason" text,
	"scenarios" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signal_calibration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_type" varchar(20) NOT NULL,
	"source" varchar(50) NOT NULL,
	"predicted" numeric(10, 6) NOT NULL,
	"actual" numeric(10, 6) NOT NULL,
	"brier_score" numeric(10, 6),
	"market_id" varchar(100),
	"position_id" varchar(100),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
/* 
    Unfortunately in current drizzle-kit version we can't automatically get name for primary key.
    We are working on making it available!

    Meanwhile you can:
        1. Check pk name in your database, by running
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_schema = 'public'
                AND table_name = 'agent_performance'
                AND constraint_type = 'PRIMARY KEY';
        2. Uncomment code below and paste pk name manually
        
    Hope to release this update as soon as possible
*/

-- ALTER TABLE "agent_performance" DROP CONSTRAINT "<constraint_name>";--> statement-breakpoint
ALTER TABLE "agent_performance" ADD COLUMN "is_paper_trading" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "privy_policy_id" varchar(200);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "trading_mode" varchar(10) DEFAULT 'paper' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "paper_balance" numeric(18, 6) DEFAULT '1000';--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "is_paper_trade" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "take_profit_percent" numeric(5, 4) DEFAULT '0.20';--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "stop_loss_percent" numeric(5, 4) DEFAULT '0.15';--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "market_result" varchar(20);--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "claimable_at" timestamp;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "simulated_order_pubkey" varchar(100);--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "simulated_position_pubkey" varchar(100);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adversarial_agent_idx" ON "adversarial_reviews" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adversarial_overturned_idx" ON "adversarial_reviews" USING btree ("overturned");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conf_cal_agent_model_idx" ON "confidence_calibration" USING btree ("agent_type","model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consensus_consensus_idx" ON "consensus_results" USING btree ("consensus");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "micro_market_idx" ON "microstructure_checks" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paper_orders_job_idx" ON "paper_orders" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paper_orders_status_idx" ON "paper_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paper_orders_market_idx" ON "paper_orders" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scenario_market_idx" ON "scenario_results" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_cal_agent_type_idx" ON "signal_calibration" USING btree ("agent_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_cal_source_idx" ON "signal_calibration" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_cal_market_idx" ON "signal_calibration" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_perf_pk" ON "agent_performance" USING btree ("agent_id","is_paper_trading");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_mode_idx" ON "jobs" USING btree ("trading_mode");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_paper_idx" ON "positions" USING btree ("is_paper_trade");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_market_idx" ON "positions" USING btree ("market_id");