CREATE TABLE IF NOT EXISTS "feed_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar(100) NOT NULL,
	"user_wallet" varchar(44) NOT NULL,
	"reaction_type" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "paper_balances" (
	"user_wallet" varchar(44) PRIMARY KEY NOT NULL,
	"balance" numeric(18, 6) DEFAULT '1000' NOT NULL,
	"total_earned" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total_lost" numeric(18, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "paper_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar(100) NOT NULL,
	"user_wallet" varchar(44) NOT NULL,
	"agent_id" varchar(100) NOT NULL,
	"direction" varchar(10) NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_agent_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_wallet" varchar(44) NOT NULL,
	"agent_id" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feed_reactions_event_idx" ON "feed_reactions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feed_reactions_user_idx" ON "feed_reactions" USING btree ("user_wallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feed_reactions_unique_idx" ON "feed_reactions" USING btree ("event_id","user_wallet","reaction_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paper_bets_event_idx" ON "paper_bets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paper_bets_user_idx" ON "paper_bets" USING btree ("user_wallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paper_bets_agent_idx" ON "paper_bets" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paper_bets_status_idx" ON "paper_bets" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follows_user_idx" ON "user_agent_follows" USING btree ("user_wallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follows_agent_idx" ON "user_agent_follows" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follows_unique_idx" ON "user_agent_follows" USING btree ("user_wallet","agent_id");