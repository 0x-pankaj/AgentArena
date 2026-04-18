// ============================================================
// Mock Jupiter API for Test Mode
// Provides realistic mock responses for testing the full pipeline
// without making actual Jupiter API calls
// ============================================================

import { TEST_MODE } from "@agent-arena/shared";
import type { JupiterEvent, JupiterMarket, JupiterOrderbook, JupiterPosition, JupiterOrder, CreateOrderParams, ListEventsParams, SearchEventsParams, ListPositionsParams, HistoryParams } from "../plugins/polymarket-plugin";

// --- Mock data ---

export const MOCK_JUPITER_EVENTS: Record<string, JupiterEvent> = {
  sports: {
    eventId: "mock-sports-event-1",
    category: "sports",
    isActive: true,
    isLive: true,
    volumeUsd: 1000000,
    volume24hr: 250000,
    beginAt: new Date(Date.now() - 86400000).toISOString(),
    metadata: {
      title: "NBA Finals 2026",
      subtitle: "Lakers vs Celtics",
      imageUrl: "https://example.com/nba.jpg",
      closeTime: new Date(Date.now() + 7 * 86400000).toISOString(),
    },
    markets: [
      {
        marketId: "mock-sports-market-1",
        status: "active",
        openTime: Date.now() / 1000 - 86400,
        closeTime: Date.now() / 1000 + 7 * 86400,
        pricing: {
          buyYesPriceUsd: 650000,
          sellYesPriceUsd: 640000,
          buyNoPriceUsd: 350000,
          sellNoPriceUsd: 340000,
          volume: 250000,
        },
        metadata: {
          question: "Will Lakers win NBA Finals 2026?",
          title: "Lakers NBA Champions 2026",
          rulesPrimary: "Lakers must win the NBA Finals",
        },
      },
      {
        marketId: "mock-sports-market-2",
        status: "active",
        openTime: Date.now() / 1000 - 86400,
        closeTime: Date.now() / 1000 + 3 * 86400,
        pricing: {
          buyYesPriceUsd: 550000,
          sellYesPriceUsd: 540000,
          buyNoPriceUsd: 450000,
          sellNoPriceUsd: 440000,
          volume: 180000,
        },
        metadata: {
          question: "Will Celtics beat Lakers in Game 1?",
          title: "Celtics vs Lakers Game 1",
          rulesPrimary: "Celtics must win Game 1",
        },
      },
    ],
  },
  crypto: {
    eventId: "mock-crypto-event-1",
    category: "crypto",
    isActive: true,
    isLive: true,
    volumeUsd: 5000000,
    volume24hr: 1200000,
    beginAt: new Date(Date.now() - 172800000).toISOString(),
    metadata: {
      title: "Bitcoin Price Q2 2026",
      subtitle: "Will BTC exceed $150K?",
      imageUrl: "https://example.com/btc.jpg",
      closeTime: new Date(Date.now() + 30 * 86400000).toISOString(),
    },
    markets: [
      {
        marketId: "mock-crypto-market-1",
        status: "active",
        openTime: Date.now() / 1000 - 172800,
        closeTime: Date.now() / 1000 + 30 * 86400,
        pricing: {
          buyYesPriceUsd: 420000,
          sellYesPriceUsd: 410000,
          buyNoPriceUsd: 580000,
          sellNoPriceUsd: 570000,
          volume: 1200000,
        },
        metadata: {
          question: "Will Bitcoin exceed $150K in Q2 2026?",
          title: "BTC $150K Q2 2026",
          rulesPrimary: "BTC price must exceed $150K on CoinGecko",
        },
      },
      {
        marketId: "mock-crypto-market-2",
        status: "active",
        openTime: Date.now() / 1000 - 86400,
        closeTime: Date.now() / 1000 + 14 * 86400,
        pricing: {
          buyYesPriceUsd: 700000,
          sellYesPriceUsd: 690000,
          buyNoPriceUsd: 300000,
          sellNoPriceUsd: 290000,
          volume: 800000,
        },
        metadata: {
          question: "Will Ethereum ETF be approved by May 2026?",
          title: "ETH ETF Approval May 2026",
          rulesPrimary: "SEC must approve ETH ETF",
        },
      },
    ],
  },
  politics: {
    eventId: "mock-politics-event-1",
    category: "politics",
    isActive: true,
    isLive: true,
    volumeUsd: 3000000,
    volume24hr: 500000,
    beginAt: new Date(Date.now() - 259200000).toISOString(),
    metadata: {
      title: "US Elections 2026",
      subtitle: "Midterm election outcomes",
      imageUrl: "https://example.com/election.jpg",
      closeTime: new Date(Date.now() + 60 * 86400000).toISOString(),
    },
    markets: [
      {
        marketId: "mock-politics-market-1",
        status: "active",
        openTime: Date.now() / 1000 - 259200,
        closeTime: Date.now() / 1000 + 60 * 86400,
        pricing: {
          buyYesPriceUsd: 520000,
          sellYesPriceUsd: 510000,
          buyNoPriceUsd: 480000,
          sellNoPriceUsd: 470000,
          volume: 500000,
        },
        metadata: {
          question: "Will Democrats control Congress after 2026?",
          title: "Democrats control Congress 2026",
          rulesPrimary: "Democrats must have majority in both houses",
        },
      },
    ],
  },
  economics: {
    eventId: "mock-economics-event-1",
    category: "economics",
    isActive: true,
    isLive: false,
    volumeUsd: 2000000,
    volume24hr: 300000,
    beginAt: new Date(Date.now() - 345600000).toISOString(),
    metadata: {
      title: "Fed Interest Rate 2026",
      subtitle: "Federal Reserve rate decisions",
      imageUrl: "https://example.com/fed.jpg",
      closeTime: new Date(Date.now() + 45 * 86400000).toISOString(),
    },
    markets: [
      {
        marketId: "mock-economics-market-1",
        status: "active",
        openTime: Date.now() / 1000 - 345600,
        closeTime: Date.now() / 1000 + 45 * 86400,
        pricing: {
          buyYesPriceUsd: 680000,
          sellYesPriceUsd: 670000,
          buyNoPriceUsd: 320000,
          sellNoPriceUsd: 310000,
          volume: 300000,
        },
        metadata: {
          question: "Will Fed cut interest rates in Q2 2026?",
          title: "Fed rate cut Q2 2026",
          rulesPrimary: "Fed must announce rate cut",
        },
      },
    ],
  },
};

// Mock positions
export const MOCK_POSITIONS: JupiterPosition[] = [
  {
    id: "mock-position-1",
    marketId: "mock-sports-market-1",
    marketQuestion: "Will Lakers win NBA Finals 2026?",
    side: "yes",
    size: "100",
    avgPrice: "0.65",
    currentPrice: "0.68",
    unrealizedPnl: "3",
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

// Mock orderbook
export const MOCK_ORDERBOOK: JupiterOrderbook = {
  marketId: "mock-sports-market-1",
  bids: [
    { price: "0.64", size: "500" },
    { price: "0.63", size: "1000" },
    { price: "0.62", size: "1500" },
  ],
  asks: [
    { price: "0.66", size: "500" },
    { price: "0.67", size: "1000" },
    { price: "0.68", size: "1500" },
  ],
};

// ============================================================
// Mock Jupiter Client
// ============================================================

export class MockJupiterPredictClient {
  async listEvents(params: ListEventsParams = {}): Promise<JupiterEvent[]> {
    console.log(`[MockJupiter] listEvents called with category: ${params.category}`);
    
    const category = params.category;
    if (category && MOCK_JUPITER_EVENTS[category]) {
      return [MOCK_JUPITER_EVENTS[category]];
    }
    
    // Return all events
    return Object.values(MOCK_JUPITER_EVENTS);
  }

  async searchEvents(params: SearchEventsParams): Promise<JupiterEvent[]> {
    console.log(`[MockJupiter] searchEvents called with query: ${params.query}`);
    
    const query = params.query.toLowerCase();
    return Object.values(MOCK_JUPITER_EVENTS).filter(event => {
      return event.metadata?.title?.toLowerCase().includes(query) ||
             event.category?.toLowerCase().includes(query);
    }).slice(0, params.limit ?? 10);
  }

  async getEvent(eventId: string): Promise<JupiterEvent> {
    console.log(`[MockJupiter] getEvent called: ${eventId}`);
    
    const event = Object.values(MOCK_JUPITER_EVENTS).find(e => e.eventId === eventId);
    if (!event) throw new Error(`Event ${eventId} not found`);
    return event;
  }

  async getMarket(marketId: string): Promise<JupiterMarket> {
    console.log(`[MockJupiter] getMarket called: ${marketId}`);
    
    for (const event of Object.values(MOCK_JUPITER_EVENTS)) {
      const market = event.markets?.find(m => m.marketId === marketId);
      if (market) return market;
    }
    
    throw new Error(`Market ${marketId} not found`);
  }

  async getOrderbook(marketId: string): Promise<JupiterOrderbook> {
    console.log(`[MockJupiter] getOrderbook called: ${marketId}`);
    return MOCK_ORDERBOOK;
  }

  async createOrder(params: CreateOrderParams): Promise<JupiterOrder> {
    console.log(`[MockJupiter] createOrder called:`, params);
    
    return {
      orderPubkey: `mock-order-${Date.now()}`,
      positionPubkey: `mock-position-${Date.now()}`,
      transaction: "mock-transaction-base64",
    };
  }

  async getOrderStatus(orderPubkey: string): Promise<any> {
    console.log(`[MockJupiter] getOrderStatus called: ${orderPubkey}`);
    return { status: "filled", orderPubkey };
  }

  async listPositions(params: ListPositionsParams = {}): Promise<JupiterPosition[]> {
    console.log(`[MockJupiter] listPositions called`);
    
    if (params.marketId) {
      return MOCK_POSITIONS.filter(p => p.marketId === params.marketId);
    }
    
    return MOCK_POSITIONS.slice(0, params.limit ?? 100);
  }

  async closePosition(positionPubkey: string): Promise<any> {
    console.log(`[MockJupiter] closePosition called: ${positionPubkey}`);
    return { success: true, positionPubkey };
  }

  async claimPayout(positionPubkey: string): Promise<any> {
    console.log(`[MockJupiter] claimPayout called: ${positionPubkey}`);
    return { success: true };
  }

  async getHistory(params: HistoryParams = {}): Promise<any> {
    console.log(`[MockJupiter] getHistory called`);
    return { trades: [], limit: params.limit ?? 100, offset: params.offset ?? 0 };
  }

  async getTradingStatus(): Promise<{ isTrading: boolean }> {
    return { isTrading: true };
  }
}

// ============================================================
// Apply mock if TEST_MODE is enabled
// ============================================================

let mockApplied = false;

export function applyMockJupiter(): void {
  if (mockApplied || !TEST_MODE) return;

  console.log("[MockJupiter] TEST_MODE enabled - applying mock Jupiter API");

  // Import the real client
  import("../plugins/polymarket-plugin").then(module => {
    // Replace the singleton instance methods
    const mockClient = new MockJupiterPredictClient();
    
    module.jupiterPredict.listEvents = mockClient.listEvents.bind(mockClient);
    module.jupiterPredict.searchEvents = mockClient.searchEvents.bind(mockClient);
    module.jupiterPredict.getEvent = mockClient.getEvent.bind(mockClient);
    module.jupiterPredict.getMarket = mockClient.getMarket.bind(mockClient);
    module.jupiterPredict.getOrderbook = mockClient.getOrderbook.bind(mockClient);
    module.jupiterPredict.createOrder = mockClient.createOrder.bind(mockClient);
    module.jupiterPredict.getOrderStatus = mockClient.getOrderStatus.bind(mockClient);
    module.jupiterPredict.listPositions = mockClient.listPositions.bind(mockClient);
    module.jupiterPredict.closePosition = mockClient.closePosition.bind(mockClient);
    module.jupiterPredict.claimPayout = mockClient.claimPayout.bind(mockClient);
    module.jupiterPredict.getHistory = mockClient.getHistory.bind(mockClient);
    module.jupiterPredict.getTradingStatus = mockClient.getTradingStatus.bind(mockClient);

    mockApplied = true;
    console.log("[MockJupiter] Mock Jupiter API applied successfully");
  });
}

// Auto-apply if TEST_MODE
if (TEST_MODE && typeof process !== 'undefined') {
  // Defer to avoid circular imports
  setTimeout(() => applyMockJupiter(), 0);
}
