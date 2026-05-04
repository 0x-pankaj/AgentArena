/**
 * One-shot backfill: rewrite leftover `Market <id>` placeholder
 * marketQuestion values across positions, trades, agent_interactions,
 * and swarm_consensus rows. Idempotent — only touches rows still
 * matching the placeholder pattern.
 *
 * The placeholder was inserted before the scan-time drop landed in
 * execution-engine.ts — Jupiter sometimes returns markets with no
 * readable title, and we used to fall back to `Market ${marketId}`
 * which then propagated all the way onto persisted rows.
 *
 * For each row, we first try to recover a real question from the
 * marketData table (synced from Jupiter). If marketData also carries
 * the placeholder (same upstream gap), we substitute a clean
 * "Untitled prediction market" label so the UI stops showing raw IDs.
 *
 * Usage: bun run --env-file=../../.env src/cleanup-market-questions.ts
 */
import { sql } from "drizzle-orm";
import { db } from "./db";

// Two placeholder shapes have leaked into market_question over time:
//   1. `Market <id>` — fallback from execution-engine when Jupiter returned
//      a market with no readable title (now blocked at scan).
//   2. `Batch analysis partial output ...` / `Batch analysis failed ...` —
//      the LLM's malformed-batch placeholder leaked into the question
//      column for a few legacy rows (separate from the reasoning leak
//      already handled by cleanup-reasoning.ts).
const ID_PLACEHOLDER_RE = "^Market [A-Za-z0-9_-]+$";
const BATCH_PLACEHOLDER_RE = "^[Bb]atch analysis";
const FALLBACK_LABEL = "Untitled prediction market";

async function backfill(table: string, column: string): Promise<number> {
  // Prefer a real question from market_data when available; otherwise the
  // clean fallback label. COALESCE skips market_data rows whose own question
  // is null OR is itself one of the placeholder patterns.
  const res = await db.execute(sql`
    UPDATE ${sql.raw(table)} t
       SET ${sql.raw(column)} = COALESCE(
         (SELECT md.question
            FROM market_data md
           WHERE md.market_id = t.market_id
             AND md.question IS NOT NULL
             AND md.question !~ ${ID_PLACEHOLDER_RE}
             AND md.question !~ ${BATCH_PLACEHOLDER_RE}
           LIMIT 1),
         ${FALLBACK_LABEL}
       )
     WHERE ${sql.raw(column)} ~ ${ID_PLACEHOLDER_RE}
        OR ${sql.raw(column)} ~ ${BATCH_PLACEHOLDER_RE}
  `);
  return (res as any).rowCount ?? 0;
}

async function main() {
  console.log("[Cleanup] Rewriting placeholder marketQuestion rows...");

  const positionsCount = await backfill("positions", "market_question");
  const tradesCount = await backfill("trades", "market_question");
  const interactionsCount = await backfill("agent_interactions", "market_question");
  const consensusCount = await backfill("swarm_consensus", "market_question");

  console.log(
    `[Cleanup] Rewrote positions=${positionsCount}, trades=${tradesCount}, ` +
    `agent_interactions=${interactionsCount}, swarm_consensus=${consensusCount}`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("[Cleanup] Failed:", err);
  process.exit(1);
});
