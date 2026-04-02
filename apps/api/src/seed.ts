import { db, schema } from './db';
import { redis } from './utils/redis';
import { REDIS_KEYS } from '@agent-arena/shared';
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

const SEED_PERFORMANCE = [
  { totalTrades: 34, winningTrades: 26, totalPnl: '1247.50', winRate: '0.7647', sharpeRatio: '1.42', maxDrawdown: '-0.08', totalVolume: '5000.00' },
  { totalTrades: 28, winningTrades: 20, totalPnl: '892.30', winRate: '0.7143', sharpeRatio: '1.18', maxDrawdown: '-0.11', totalVolume: '3500.00' },
  { totalTrades: 41, winningTrades: 27, totalPnl: '634.20', winRate: '0.6585', sharpeRatio: '0.95', maxDrawdown: '-0.14', totalVolume: '4200.00' },
  { totalTrades: 22, winningTrades: 15, totalPnl: '421.80', winRate: '0.6818', sharpeRatio: '0.88', maxDrawdown: '-0.12', totalVolume: '2800.00' },
  { totalTrades: 15, winningTrades: 9, totalPnl: '187.40', winRate: '0.6000', sharpeRatio: '0.72', maxDrawdown: '-0.15', totalVolume: '1500.00' },
  { totalTrades: 31, winningTrades: 22, totalPnl: '756.80', winRate: '0.7097', sharpeRatio: '1.35', maxDrawdown: '-0.09', totalVolume: '4100.00' },
  { totalTrades: 18, winningTrades: 11, totalPnl: '298.60', winRate: '0.6111', sharpeRatio: '0.82', maxDrawdown: '-0.13', totalVolume: '2000.00' },
  { totalTrades: 25, winningTrades: 17, totalPnl: '512.30', winRate: '0.6800', sharpeRatio: '1.05', maxDrawdown: '-0.10', totalVolume: '3200.00' },
];

async function seed() {
  console.log('Seeding database...');

  // Create a system user for seed agents
  const systemAddress = '11111111111111111111111111111111';
  await db
    .insert(schema.users)
    .values({ walletAddress: systemAddress })
    .onConflictDoNothing();

  const agentIds: string[] = [];

  // Insert agents
  for (let i = 0; i < SEED_AGENTS.length; i++) {
    const agentData = SEED_AGENTS[i];
    const [existing] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.name, agentData.name))
      .limit(1);

    if (existing) {
      console.log(`Agent "${agentData.name}" already exists, skipping`);
      agentIds.push(existing.id);
      continue;
    }

    const [agent] = await db
      .insert(schema.agents)
      .values({
        ownerAddress: systemAddress,
        ...agentData,
      })
      .returning();

    // Insert performance
    await db
      .insert(schema.agentPerformance)
      .values({
        agentId: agent.id,
        ...SEED_PERFORMANCE[i],
      })
      .onConflictDoNothing();

    agentIds.push(agent.id);
    console.log(`Created agent: ${agentData.name} (${agent.id})`);
  }

  // Populate Redis leaderboard
  console.log('Populating Redis leaderboard...');
  for (let i = 0; i < agentIds.length; i++) {
    const agentId = agentIds[i];
    const perf = SEED_PERFORMANCE[i];
    const agent = SEED_AGENTS[i];
    const statsKey = `${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}`;

    await redis.hset(statsKey, {
      totalPnl: perf.totalPnl,
      winRate: perf.winRate,
      totalTrades: String(perf.totalTrades),
      maxDrawdown: perf.maxDrawdown,
      sharpeRatio: perf.sharpeRatio,
    });

    // Add to all-time leaderboard ZSET
    await redis.zadd(REDIS_KEYS.LEADERBOARD_ALLTIME, Number(perf.totalPnl), agentId);

    // Add to category leaderboard
    await redis.zadd(
      `${REDIS_KEYS.LEADERBOARD_PREFIX}category:${agent.category}`,
      Number(perf.totalPnl),
      agentId
    );

    // Add to daily leaderboard
    const today = new Date().toISOString().slice(0, 10);
    await redis.zadd(
      `${REDIS_KEYS.LEADERBOARD_PREFIX}daily:${today}`,
      Number(perf.totalPnl),
      agentId
    );
  }

  console.log('Seeding complete!');
  console.log(`Created ${agentIds.length} agents with leaderboard entries`);
}

seed()
  .then(() => {
    redis.disconnect();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Seed failed:', err);
    redis.disconnect();
    process.exit(1);
  });
