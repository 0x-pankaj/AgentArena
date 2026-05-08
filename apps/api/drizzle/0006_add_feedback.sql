CREATE TABLE IF NOT EXISTS "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(20) NOT NULL,
	"rating" integer,
	"message" text NOT NULL,
	"contact" varchar(200),
	"source" varchar(20) DEFAULT 'web' NOT NULL,
	"page_url" text,
	"user_agent" text,
	"ip_hash" varchar(64),
	"wallet_address" varchar(44),
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_created_idx" ON "feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_type_idx" ON "feedback" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_status_idx" ON "feedback" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_ip_idx" ON "feedback" USING btree ("ip_hash");