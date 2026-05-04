/**
 * Hard reset: truncates every data table, flushes Redis caches, and re-seeds
 * the canonical agents. Intended for pre-traction environment resets only.
 *
 * Usage: bun run --env-file=../../.env src/reset.ts [--yes]
 */
import { sql } from 'drizzle-orm';
import { db, schema } from './db';
import { redis } from './utils/redis';
import { seedCanonicalAgents } from './seed';

// Order doesn't matter — TRUNCATE ... CASCADE handles FK chains.
const TABLES_TO_TRUNCATE = [
  'feed_reactions',
  'paper_bets',
  'paper_balances',
  'user_agent_follows',
  'agent_interactions',
  'swarm_consensus',
  'consensus_results',
  'adversarial_reviews',
  'scenario_results',
  'microstructure_checks',
  'confidence_calibration',
  'signal_calibration',
  'evolution_events',
  'trade_prompt_links',
  'agent_prompt_versions',
  'feed_events',
  'trades',
  'paper_orders',
  'positions',
  'jobs',
  'agent_performance',
  'agents',
  'users',
  'market_data',
];

const REDIS_PREFIXES_TO_FLUSH = [
  'cache:markets',
  'cache:gdelt',
  'cache:acled',
  'cache:fred',
  'cache:firms',
  'cache:twitter',
  'cache:global_stats',
  'lb:',
  'agent:stats:',
  'agent:events',
  'feed:recent',
  'feed:category:',
  'feed:agent:',
  'calibration:',
  'consensus:',
  'monitor:',
  'jupiter:',
];

async function flushRedisPrefixes(): Promise<number> {
  let total = 0;
  for (const prefix of REDIS_PREFIXES_TO_FLUSH) {
    const pattern = prefix.endsWith(':') ? `${prefix}*` : `${prefix}*`;
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) {
        await redis.del(...keys);
        total += keys.length;
      }
    } while (cursor !== '0');
  }
  return total;
}

async function reset() {
  const args = process.argv.slice(2);
  if (!args.includes('--yes')) {
    console.error(
      '⚠️  This will DELETE ALL DATA in the database and Redis caches.\n' +
        '    Re-run with --yes to confirm.',
    );
    process.exit(1);
  }

  console.log('1/3  Truncating tables...');
  const tables = TABLES_TO_TRUNCATE.map((t) => `"${t}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`));
  console.log(`     ✓ truncated ${TABLES_TO_TRUNCATE.length} tables`);

  console.log('2/3  Flushing Redis caches...');
  const flushed = await flushRedisPrefixes();
  console.log(`     ✓ deleted ${flushed} keys`);

  console.log('3/3  Seeding canonical agents...');
  await seedCanonicalAgents();

  console.log('\nReset complete.');
}

reset()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Reset failed:', err);
    process.exit(1);
  });
