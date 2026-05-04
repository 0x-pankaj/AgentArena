import { db, schema } from './db';
import { sql } from 'drizzle-orm';

// Stable UUIDs for canonical agents — referenced by jobs.agentId FK,
// deep links, feed events, and on-chain ATOM stats. Do NOT change.
export const CANONICAL_AGENT_IDS = {
  politics: '00000000-0000-0000-0000-000000000001',
  sports: '00000000-0000-0000-0000-000000000002',
  crypto: '00000000-0000-0000-0000-000000000003',
  general: '00000000-0000-0000-0000-000000000004',
} as const;

const SYSTEM_OWNER = '11111111111111111111111111111111';

const CANONICAL_AGENTS = [
  {
    id: CANONICAL_AGENT_IDS.politics,
    name: 'Politics Agent',
    category: 'politics',
    description:
      'Analyzes political and geopolitical prediction markets including elections, wars, sanctions, and treaties. Uses GDELT, ACLED, FRED, and Twitter signals.',
    pricingModel: { type: 'per_trade', amount: 0 },
    capabilities: ['GDELT Analysis', 'ACLED Conflict', 'FRED Macro', 'Twitter Sentiment', 'Polling Data'],
    isActive: true,
    isVerified: true,
  },
  {
    id: CANONICAL_AGENT_IDS.sports,
    name: 'Sports Agent',
    category: 'sports',
    description:
      'Analyzes sports prediction markets across NFL, NBA, soccer, MMA, and tennis. Tracks injury reports, team form, and historical matchup data.',
    pricingModel: { type: 'per_trade', amount: 0 },
    capabilities: ['Sports Analytics', 'Injury Tracking', 'Historical Stats', 'Form Analysis'],
    isActive: true,
    isVerified: true,
  },
  {
    id: CANONICAL_AGENT_IDS.crypto,
    name: 'Crypto Agent',
    category: 'crypto',
    description:
      'Analyzes crypto prediction markets including BTC, ETH, SOL, ETFs, and regulations. Combines on-chain signals with macro and sentiment data.',
    pricingModel: { type: 'per_trade', amount: 0 },
    capabilities: ['CoinGecko Price', 'DeFiLlama TVL', 'Twitter Sentiment', 'On-Chain Signals'],
    isActive: true,
    isVerified: true,
  },
  {
    // Hidden from public marketplace; kept in DB for swarm consensus voting.
    id: CANONICAL_AGENT_IDS.general,
    name: 'General Agent',
    category: 'general',
    description:
      'Cross-category generalist scanning politics, crypto, sports, and economics. Used internally for swarm consensus voting.',
    pricingModel: { type: 'per_trade', amount: 0 },
    capabilities: ['Multi-Category', 'Web Search', 'Macro Signals'],
    isActive: true,
    isVerified: true,
  },
] as const;

export async function seedCanonicalAgents(): Promise<void> {
  await db
    .insert(schema.users)
    .values({ walletAddress: SYSTEM_OWNER })
    .onConflictDoNothing();

  for (const a of CANONICAL_AGENTS) {
    await db
      .insert(schema.agents)
      .values({
        id: a.id,
        ownerAddress: SYSTEM_OWNER,
        name: a.name,
        category: a.category,
        description: a.description,
        pricingModel: a.pricingModel,
        capabilities: [...a.capabilities],
        isActive: a.isActive,
        isVerified: a.isVerified,
      })
      .onConflictDoUpdate({
        target: schema.agents.id,
        set: {
          name: a.name,
          category: a.category,
          description: a.description,
          pricingModel: a.pricingModel,
          capabilities: [...a.capabilities],
          isActive: a.isActive,
          isVerified: a.isVerified,
        },
      });

    await db
      .insert(schema.agentPerformance)
      .values({
        agentId: a.id,
        isPaperTrading: true,
        totalTrades: 0,
        winningTrades: 0,
        totalPnl: '0',
        winRate: '0',
        totalVolume: '0',
      })
      .onConflictDoNothing();

    console.log(`  ✓ ${a.name} (${a.id})`);
  }
}

if (import.meta.main) {
  console.log('Seeding canonical agents...');
  seedCanonicalAgents()
    .then(() => {
      console.log('Done.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
