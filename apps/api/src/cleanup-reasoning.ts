/**
 * One-shot backfill: rewrite leftover "Batch analysis ..." placeholder
 * reasoning rows on positions + trades so historical feed entries don't
 * surface them to judges. Safe to re-run (idempotent — only touches rows
 * still matching the placeholder pattern).
 *
 * Usage: bun run --env-file=../../.env src/cleanup-reasoning.ts
 */
import { sql } from "drizzle-orm";
import { db } from "./db";

const PLACEHOLDER_LIKE = "Batch analysis%";

async function main() {
  console.log("[Cleanup] Rewriting placeholder reasoning rows...");

  const positionsRes = await db.execute(sql`
    UPDATE positions
       SET reasoning_snippet = 'Taking ' || side || ' on "' || left(market_question, 140) || '" based on prevailing signals.'
     WHERE reasoning_snippet ILIKE ${PLACEHOLDER_LIKE}
  `);

  const tradesRes = await db.execute(sql`
    UPDATE trades
       SET reasoning = 'Taking ' || side || ' on "' || left(market_question, 140) || '" based on prevailing signals.'
     WHERE reasoning ILIKE ${PLACEHOLDER_LIKE}
  `);

  console.log(
    `[Cleanup] Rewrote positions=${(positionsRes as any).rowCount ?? "?"}, trades=${(tradesRes as any).rowCount ?? "?"}`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("[Cleanup] Failed:", err);
  process.exit(1);
});
