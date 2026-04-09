ALTER TABLE "jobs" ALTER COLUMN "privy_wallet_id" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "privy_wallet_address" SET DATA TYPE varchar(200);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_owner_idx" ON "agents" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_category_idx" ON "agents" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_active_idx" ON "agents" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_client_idx" ON "jobs" USING btree ("client_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_agent_idx" ON "jobs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_job_idx" ON "positions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "positions_status_idx" ON "positions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_job_idx" ON "trades" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_agent_idx" ON "trades" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_executed_at_idx" ON "trades" USING btree ("executed_at");