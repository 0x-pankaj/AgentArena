interface MockAgent {
  id: string;
  name: string;
  category: string;
  description: string;
  ownerAddress: string;
  isActive: boolean;
  isVerified: boolean;
  capabilities: string[];
  pricingModel: { type: string; amount: number };
  performance: {
    totalTrades: number;
    winningTrades: number;
    totalPnl: number;
    winRate: number;
    sharpeRatio: number;
    maxDrawdown: number;
  };
}

interface MockFeedEvent {
  event_id: string;
  timestamp: string;
  agent_id: string;
  agent_display_name: string;
  category: 'analysis' | 'trade' | 'decision' | 'position_update' | 'reasoning' | 'scanning' | 'thinking' | 'signal_update' | 'edge_detected';
  severity: 'info' | 'significant' | 'critical';
  content: Record<string, any>;
  display_message: string;
}

interface MockJob {
  id: string;
  agentId: string;
  agentName: string;
  status: string;
  totalInvested: number;
  totalProfit: number;
  startedAt: string;
  positions: Array<{
    id: string;
    marketQuestion: string;
    side: string;
    amount: number;
    entryPrice: number;
    currentPrice: number;
    pnl: number;
    status: string;
  }>;
}

interface MockLeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  category: string;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  streak: number;
}

// ---- AGENTS ----
export const mockAgents: MockAgent[] = [
  {
    id: 'agent-1',
    name: 'GeoSentinel-7',
    category: 'politics',
    description: 'Analyzes global news tone and conflict data to trade geopolitical markets. Uses GDELT, ACLED, FRED, and Twitter for comprehensive political and geopolitical analysis.',
    ownerAddress: '5xK9m...2af1',
    isActive: true,
    isVerified: true,
    capabilities: ['GDELT Analysis', 'ACLED Conflict', 'FRED Macro', 'Twitter Sentiment', 'Jupiter Predict'],
    pricingModel: { type: 'profit_share', amount: 10 },
    performance: {
      totalTrades: 34,
      winningTrades: 26,
      totalPnl: 1247.50,
      winRate: 0.78,
      sharpeRatio: 1.42,
      maxDrawdown: -0.08,
    },
  },
  {
    id: 'agent-2',
    name: 'ConflictWatch-3',
    category: 'politics',
    description: 'Monitors ACLED conflict escalation and military movements to trade war and instability prediction markets. Tracks sanctions, ceasefires, and troop deployments.',
    ownerAddress: '7bR2p...9cd3',
    isActive: true,
    isVerified: true,
    capabilities: ['ACLED Conflict', 'GDELT News', 'Military Intelligence', 'Sanctions Tracking'],
    pricingModel: { type: 'subscription', amount: 25 },
    performance: {
      totalTrades: 28,
      winningTrades: 20,
      totalPnl: 892.30,
      winRate: 0.71,
      sharpeRatio: 1.18,
      maxDrawdown: -0.11,
    },
  },
  {
    id: 'agent-3',
    name: 'ElectionEdge-12',
    category: 'politics',
    description: 'Tracks polling data, voter sentiment, and political trends to trade election and referendum prediction markets. Combines news analysis with social media signals.',
    ownerAddress: '3mP5k...7ef2',
    isActive: true,
    isVerified: false,
    capabilities: ['Polling Analysis', 'Twitter Sentiment', 'GDELT Trends', 'Historical Patterns'],
    pricingModel: { type: 'per_trade', amount: 2 },
    performance: {
      totalTrades: 41,
      winningTrades: 27,
      totalPnl: 634.20,
      winRate: 0.65,
      sharpeRatio: 0.95,
      maxDrawdown: -0.14,
    },
  },
  {
    id: 'agent-4',
    name: 'PolitiBot-5',
    category: 'politics',
    description: 'Tracks political sentiment and election prediction markets using news analysis and polling data.',
    ownerAddress: '9kL1n...4gh8',
    isActive: true,
    isVerified: false,
    capabilities: ['Sentiment Analysis', 'Polling Data', 'News Tracking'],
    pricingModel: { type: 'profit_share', amount: 15 },
    performance: {
      totalTrades: 22,
      winningTrades: 15,
      totalPnl: 421.80,
      winRate: 0.69,
      sharpeRatio: 0.88,
      maxDrawdown: -0.12,
    },
  },
  {
    id: 'agent-5',
    name: 'SportOracle-9',
    category: 'sports',
    description: 'Analyzes sports statistics, injury reports, and historical performance to trade on game outcome markets.',
    ownerAddress: '2pQ8r...1jk5',
    isActive: false,
    isVerified: false,
    capabilities: ['Sports Analytics', 'Injury Tracking', 'Historical Stats'],
    pricingModel: { type: 'subscription', amount: 20 },
    performance: {
      totalTrades: 15,
      winningTrades: 9,
      totalPnl: 187.40,
      winRate: 0.60,
      sharpeRatio: 0.72,
      maxDrawdown: -0.15,
    },
  },
];

// ---- FEED EVENTS ----
export const mockFeedEvents: MockFeedEvent[] = [
  {
    event_id: 'evt-1',
    timestamp: new Date(Date.now() - 2 * 60000).toISOString(),
    agent_id: 'agent-1',
    agent_display_name: 'GeoSentinel-7',
    category: 'trade',
    severity: 'significant',
    content: {
      action: 'buy',
      amount: '$25 USDC',
      price: '$0.63',
      market_analyzed: 'Will ceasefire hold through March?',
    },
    display_message: 'GeoSentinel-7 placed order: BUY YES, $25 USDC on "Will ceasefire hold through March?"',
  },
  {
    event_id: 'evt-2',
    timestamp: new Date(Date.now() - 5 * 60000).toISOString(),
    agent_id: 'agent-1',
    agent_display_name: 'GeoSentinel-7',
    category: 'analysis',
    severity: 'info',
    content: {
      summary: 'GDELT tone: -0.42 (negative spike). ACLED: 3 conflict events in region (up 150% vs 7d avg)',
      market_analyzed: 'Middle East markets',
    },
    display_message: 'GeoSentinel-7 analyzed Middle East markets — detected negative tone spike and conflict escalation',
  },
  {
    event_id: 'evt-3',
    timestamp: new Date(Date.now() - 8 * 60000).toISOString(),
    agent_id: 'agent-2',
    agent_display_name: 'ConflictWatch-3',
    category: 'decision',
    severity: 'significant',
    content: {
      reasoning_snippet: 'ACLED detected 12 new conflict events in Eastern Europe. GDELT tone shifted -0.8. Market underpricing escalation risk. Current YES: $0.31, estimate: $0.45 (14% edge)',
    },
    display_message: 'ConflictWatch-3 decided: BUY YES on "Will conflict escalate in Eastern Europe?" — 14% edge detected',
  },
  {
    event_id: 'evt-4',
    timestamp: new Date(Date.now() - 15 * 60000).toISOString(),
    agent_id: 'agent-1',
    agent_display_name: 'GeoSentinel-7',
    category: 'position_update',
    severity: 'info',
    content: {
      pnl: { value: 12.50, percent: 8.3 },
      market_analyzed: 'Will Iran nuclear talks resume?',
    },
    display_message: 'GeoSentinel-7 position update: +$12.50 (+8.3%) on "Will Iran nuclear talks resume?"',
  },
  {
    event_id: 'evt-5',
    timestamp: new Date(Date.now() - 22 * 60000).toISOString(),
    agent_id: 'agent-3',
    agent_display_name: 'ElectionEdge-12',
    category: 'trade',
    severity: 'critical',
    content: {
      action: 'sell',
      amount: '$40 USDC',
      price: '$0.78',
      market_analyzed: 'Will PM win vote of no confidence?',
    },
    display_message: 'ElectionEdge-12 closed position: SOLD at $0.78 on "Will PM win vote of no confidence?" — stop-loss triggered',
  },
  {
    event_id: 'evt-6',
    timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
    agent_id: 'agent-4',
    agent_display_name: 'PolitiBot-5',
    category: 'reasoning',
    severity: 'info',
    content: {
      reasoning_snippet: 'Polling data shows 3% swing in key battleground state. Media sentiment shifted negative. Monitoring for confirmation before taking position.',
    },
    display_message: 'PolitiBot-5 reasoning: Detected 3% polling swing, monitoring for confirmation',
  },
  {
    event_id: 'evt-7',
    timestamp: new Date(Date.now() - 45 * 60000).toISOString(),
    agent_id: 'agent-2',
    agent_display_name: 'ConflictWatch-3',
    category: 'trade',
    severity: 'significant',
    content: {
      action: 'buy',
      amount: '$15 USDC',
      price: '$0.42',
    },
    display_message: 'ConflictWatch-3 placed order: BUY YES, $15 USDC on "Will new sanctions be imposed on Russia?"',
  },
  {
    event_id: 'evt-8',
    timestamp: new Date(Date.now() - 60 * 60000).toISOString(),
    agent_id: 'agent-1',
    agent_display_name: 'GeoSentinel-7',
    category: 'analysis',
    severity: 'info',
    content: {
      summary: 'FRED data: VIX rising. Oil futures up 2.4%. Regional instability indicators elevated.',
      market_analyzed: 'Energy markets',
    },
    display_message: 'GeoSentinel-7 analyzed Energy markets — VIX rising, oil futures up 2.4%',
  },
];

// ---- JOBS ----
export const mockJobs: MockJob[] = [
  {
    id: 'job-1',
    agentId: 'agent-1',
    agentName: 'GeoSentinel-7',
    status: 'active',
    totalInvested: 100,
    totalProfit: 37.50,
    startedAt: new Date(Date.now() - 3 * 24 * 60 * 60000).toISOString(),
    positions: [
      {
        id: 'pos-1',
        marketQuestion: 'Will ceasefire hold through March?',
        side: 'yes',
        amount: 25,
        entryPrice: 0.63,
        currentPrice: 0.71,
        pnl: 12.50,
        status: 'open',
      },
      {
        id: 'pos-2',
        marketQuestion: 'Will Iran nuclear talks resume?',
        side: 'yes',
        amount: 30,
        entryPrice: 0.45,
        currentPrice: 0.52,
        pnl: 18.40,
        status: 'open',
      },
    ],
  },
  {
    id: 'job-2',
    agentId: 'agent-2',
    agentName: 'ConflictWatch-3',
    status: 'active',
    totalInvested: 50,
    totalProfit: 12.80,
    startedAt: new Date(Date.now() - 1 * 24 * 60 * 60000).toISOString(),
    positions: [
      {
        id: 'pos-3',
        marketQuestion: 'Will new sanctions be imposed on Russia?',
        side: 'yes',
        amount: 15,
        entryPrice: 0.31,
        currentPrice: 0.38,
        pnl: 8.20,
        status: 'open',
      },
    ],
  },
];

// ---- LEADERBOARD ----
export const mockLeaderboard: MockLeaderboardEntry[] = [
  { rank: 1, agentId: 'agent-1', agentName: 'GeoSentinel-7', category: 'politics', totalPnl: 1247.50, winRate: 0.78, totalTrades: 34, streak: 5 },
  { rank: 2, agentId: 'agent-2', agentName: 'ConflictWatch-3', category: 'politics', totalPnl: 892.30, winRate: 0.71, totalTrades: 28, streak: 3 },
  { rank: 3, agentId: 'agent-3', agentName: 'ElectionEdge-12', category: 'politics', totalPnl: 634.20, winRate: 0.65, totalTrades: 41, streak: -2 },
  { rank: 4, agentId: 'agent-4', agentName: 'PolitiBot-5', category: 'politics', totalPnl: 421.80, winRate: 0.69, totalTrades: 22, streak: 4 },
  { rank: 5, agentId: 'agent-5', agentName: 'SportOracle-9', category: 'sports', totalPnl: 187.40, winRate: 0.60, totalTrades: 15, streak: -1 },
];
