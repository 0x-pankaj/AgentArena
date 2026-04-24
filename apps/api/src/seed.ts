import { db, schema } from './db';
import { eq } from 'drizzle-orm';

const SEED_AGENTS = [
  {
    name: 'GeoSentinel-7',
    category: 'politics',
    description:
      'Analyzes global news tone and conflict data to trade geopolitical markets. Uses GDELT, ACLED, FRED, and Twitter for comprehensive political and geopolitical analysis.',
    pricingModel: { type: 'profit_share', amount: 10 },
    capabilities: ['GDELT Analysis', 'ACLED Conflict', 'FRED Macro', 'Twitter Sentiment', 'Jupiter Predict'],
    isActive: true,
    isVerified: true,
  },
  {
    name: 'ConflictWatch-3',
    category: 'politics',
    description:
      'Monitors ACLED conflict escalation and military movements to trade war and instability prediction markets. Tracks sanctions, ceasefires, and troop deployments.',
    pricingModel: { type: 'subscription', amount: 25 },
    capabilities: ['ACLED Conflict', 'GDELT News', 'Military Intelligence', 'Sanctions Tracking'],
    isActive: true,
    isVerified: true,
  },
  {
    name: 'ElectionEdge-12',
    category: 'politics',
    description:
      'Tracks polling data, voter sentiment, and political trends to trade election and referendum prediction markets. Combines news analysis with social media signals.',
    pricingModel: { type: 'per_trade', amount: 2 },
    capabilities: ['Polling Analysis', 'Twitter Sentiment', 'GDELT Trends', 'Historical Patterns'],
    isActive: true,
    isVerified: false,
  },
  {
    name: 'PolitiBot-5',
    category: 'politics',
    description:
      'Tracks political sentiment and election prediction markets using news analysis and polling data.',
    pricingModel: { type: 'profit_share', amount: 15 },
    capabilities: ['Sentiment Analysis', 'Polling Data', 'News Tracking'],
    isActive: true,
    isVerified: false,
  },
  {
    name: 'SportOracle-9',
    category: 'sports',
    description:
      'Analyzes sports statistics, injury reports, and historical performance to trade on game outcome markets.',
    pricingModel: { type: 'subscription', amount: 20 },
    capabilities: ['Sports Analytics', 'Injury Tracking', 'Historical Stats'],
    isActive: true,
    isVerified: false,
  },
  {
    name: 'CryptoAlpha-1',
    category: 'crypto',
    description:
      'Analyzes crypto price action, DeFi TVL trends, and on-chain signals to trade crypto prediction markets. Uses CoinGecko, DeFiLlama, and Twitter for comprehensive crypto analysis.',
    pricingModel: { type: 'profit_share', amount: 12 },
    capabilities: ['CoinGecko Price', 'DeFiLlama TVL', 'Twitter Sentiment', 'Macro Signals'],
    isActive: true,
    isVerified: true,
  },
  {
    name: 'DegenHunter-4',
    category: 'crypto',
    description:
      'Tracks trending coins, whale movements, and social sentiment to find alpha in crypto prediction markets. Specializes in short-term price targets and meme coin outcomes.',
    pricingModel: { type: 'per_trade', amount: 1 },
    capabilities: ['Trending Coins', 'Social Sentiment', 'Volume Analysis', 'Momentum Detection'],
    isActive: true,
    isVerified: false,
  },
  {
    name: 'OmniTrader-1',
    category: 'general',
    description:
      'General-purpose prediction market agent that scans all categories. Uses GDELT, ACLED, FRED, CoinGecko, DeFiLlama, and Twitter for multi-signal analysis across politics, crypto, sports, and economics.',
    pricingModel: { type: 'profit_share', amount: 15 },
    capabilities: ['GDELT Analysis', 'ACLED Conflict', 'FRED Macro', 'CoinGecko Price', 'DeFiLlama TVL', 'Twitter Sentiment', 'Web Search'],
    isActive: true,
    isVerified: true,
  },
];

async function seed() {
  console.log('Seeding agents...');

  // Create a system user for seed agents
  const systemAddress = '11111111111111111111111111111111';
  await db
    .insert(schema.users)
    .values({ walletAddress: systemAddress })
    .onConflictDoNothing();

  let created = 0;
  let skipped = 0;

  // Insert agents ONLY — no fake performance data
  for (const agentData of SEED_AGENTS) {
    const [existing] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.name, agentData.name))
      .limit(1);

    if (existing) {
      console.log(`Agent "${agentData.name}" already exists, skipping`);
      skipped++;
      continue;
    }

    const [agent] = await db
      .insert(schema.agents)
      .values({
        ownerAddress: systemAddress,
        ...agentData,
      })
      .returning();

    // Initialize performance record with ALL ZEROS — real trades will populate this
    await db
      .insert(schema.agentPerformance)
      .values({
        agentId: agent.id,
        isPaperTrading: true,
        totalTrades: 0,
        winningTrades: 0,
        totalPnl: '0',
        winRate: '0',
        totalVolume: '0',
      })
      .onConflictDoNothing();

    created++;
    console.log(`Created agent: ${agentData.name} (${agent.id})`);
  }

  console.log(`Seeding complete! Created ${created} agents, skipped ${skipped}.`);
  console.log('Note: No fake performance data inserted. Stats will populate from real trades only.');
}

seed()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
