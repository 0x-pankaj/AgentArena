// ============================================================
// Real-Time Price Monitor
// Fast price polling (10-30s interval) for open positions
// Enables near-real-time stop-loss and PnL tracking
// ============================================================

import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import { getMarket } from "../services/market-service";
import { jupiterPredict } from "../plugins/polymarket-plugin";
import { checkStopLoss, type PortfolioSnapshot } from "../plugins/risk-plugin";
import { closePosition } from "../services/trade-service";
import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { publishFeedEvent, buildFeedEvent } from "../feed";
import { signalInvalidationManager, invalidateOnPriceSpike } from "./signal-invalidation";

// --- Configuration ---

export interface PriceMonitorConfig {
  pollIntervalMs: number;         // How often to poll prices
  cacheTtlMs: number;             // How long to cache prices
  stopLossCheckIntervalMs: number; // How often to check stop-loss
  priceSpikeThreshold: number;    // % change to trigger cache invalidation
  maxPositionsPerMonitor: number;  // Max positions to monitor
}

const DEFAULT_CONFIG: PriceMonitorConfig = {
  pollIntervalMs: 15_000,         // 15 seconds
  cacheTtlMs: 30_000,             // 30 seconds
  stopLossCheckIntervalMs: 30_000, // 30 seconds
  priceSpikeThreshold: 0.10,      // 10% price change
  maxPositionsPerMonitor: 20,
};

// --- Price data ---

export interface PriceData {
  marketId: string;
  yesPrice: number;
  noPrice: number;
  timestamp: number;
  volume?: number;
}

// --- Position to monitor ---

export interface MonitoredPosition {
  positionId: string;
  marketId: string;
  marketQuestion: string;
  agentId: string;
  agentName: string;
  jobId: string;
  agentWalletId: string;
  side: 'yes' | 'no';
  entryPrice: number;
  amount: number;
  ownerPubkey: string;
  lastPriceCheck: number;
  lastStopLossCheck: number;
}

// ============================================================
// Real-Time Price Monitor Class
// ============================================================

class RealTimePriceMonitor {
  private config: PriceMonitorConfig;
  private monitoredPositions = new Map<string, MonitoredPosition>();
  private priceCache = new Map<string, { price: PriceData; cachedAt: number }>();
  private pollTimers = new Map<string, NodeJS.Timeout>();
  private isRunning = false;
  private lastPriceUpdates = new Map<string, number>(); // marketId -> timestamp

  constructor(config?: Partial<PriceMonitorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // --- Start the price monitor ---

  start(): void {
    if (this.isRunning) {
      console.log('[PriceMonitor] Already running');
      return;
    }

    this.isRunning = true;
    console.log(`[PriceMonitor] Started with ${this.config.pollIntervalMs / 1000}s poll interval`);

    // Start global polling loop
    this.startPollingLoop();
  }

  // --- Stop the price monitor ---

  stop(): void {
    this.isRunning = false;

    // Clear all timers
    for (const [id, timer] of this.pollTimers.entries()) {
      clearInterval(timer);
    }
    this.pollTimers.clear();

    console.log('[PriceMonitor] Stopped');
  }

  // --- Register a position for monitoring ---

  registerPosition(position: MonitoredPosition): void {
    if (this.monitoredPositions.size >= this.config.maxPositionsPerMonitor) {
      console.warn(`[PriceMonitor] Max positions reached (${this.config.maxPositionsPerMonitor}), skipping`);
      return;
    }

    this.monitoredPositions.set(position.positionId, {
      ...position,
      lastPriceCheck: 0,
      lastStopLossCheck: 0,
    });

    console.log(`[PriceMonitor] Registered position: ${position.positionId} (${position.marketQuestion?.slice(0, 50)})`);
  }

  // --- Unregister a position ---

  unregisterPosition(positionId: string): void {
    this.monitoredPositions.delete(positionId);
    console.log(`[PriceMonitor] Unregistered position: ${positionId}`);
  }

  // --- Get monitored positions ---

  getMonitoredPositions(): MonitoredPosition[] {
    return Array.from(this.monitoredPositions.values());
  }

  // --- Get cached price for a market ---

  getCachedPrice(marketId: string): PriceData | null {
    const cached = this.priceCache.get(marketId);
    if (!cached) return null;

    // Check if cache is still valid
    const age = Date.now() - cached.cachedAt;
    if (age > this.config.cacheTtlMs) {
      this.priceCache.delete(marketId);
      return null;
    }

    return cached.price;
  }

  // --- Start global polling loop ---

  private startPollingLoop(): void {
    const poll = async () => {
      if (!this.isRunning) return;

      try {
        await this.pollAllPositions();
      } catch (err) {
        console.error('[PriceMonitor] Polling error:', err);
      }

      // Schedule next poll
      setTimeout(poll, this.config.pollIntervalMs);
    };

    // Start immediately
    poll();
  }

  // --- Poll all positions ---

  private async pollAllPositions(): Promise<void> {
    const positions = Array.from(this.monitoredPositions.values());
    if (positions.length === 0) return;

    console.log(`[PriceMonitor] Polling ${positions.length} positions...`);

    // Group by marketId to avoid duplicate fetches
    const marketPositions = new Map<string, MonitoredPosition[]>();
    for (const pos of positions) {
      if (!marketPositions.has(pos.marketId)) {
        marketPositions.set(pos.marketId, []);
      }
      marketPositions.get(pos.marketId)!.push(pos);
    }

    // Fetch prices for all unique markets
    const pricePromises = Array.from(marketPositions.keys()).map(async (marketId) => {
      try {
        const price = await this.fetchPrice(marketId);
        return { marketId, price, error: null };
      } catch (err) {
        return { marketId, price: null, error: err };
      }
    });

    const results = await Promise.allSettled(pricePromises);

    // Update positions with new prices
    for (const result of results) {
      if (result.status === 'rejected') continue;

      const { marketId, price, error } = result.value;
      if (error) {
        console.warn(`[PriceMonitor] Failed to fetch price for ${marketId}:`, error);
        continue;
      }
      if (!price) continue;

      // Update cache
      this.priceCache.set(marketId, { price, cachedAt: Date.now() });

      // Check for price spike
      await this.checkPriceSpike(marketId, price);

      // Check stop-loss for all positions in this market
      const positions = marketPositions.get(marketId) ?? [];
      for (const pos of positions) {
        await this.checkStopLossForPosition(pos, price);
      }
    }
  }

  // --- Fetch price for a market ---

  private async fetchPrice(marketId: string): Promise<PriceData | null> {
    try {
      const market = await getMarket(marketId);
      if (!market) return null;

      const outcomes = (market.outcomes ?? []) as Array<{ name: string; price: number }>;
      const yesOutcome = outcomes.find(o => o.name?.toLowerCase() === 'yes');
      const noOutcome = outcomes.find(o => o.name?.toLowerCase() === 'no');

      return {
        marketId,
        yesPrice: yesOutcome?.price ?? 0.5,
        noPrice: noOutcome?.price ?? 0.5,
        timestamp: Date.now(),
        volume: Number(market.volume ?? 0),
      };
    } catch (err) {
      console.error(`[PriceMonitor] Price fetch failed for ${marketId}:`, err);
      return null;
    }
  }

  // --- Check for price spike ---

  private async checkPriceSpike(marketId: string, newPrice: PriceData): Promise<void> {
    const lastUpdate = this.lastPriceUpdates.get(marketId);
    
    // Only check if we have a previous price
    if (lastUpdate) {
      const cached = this.priceCache.get(marketId);
      if (cached) {
        const oldPrice = cached.price;
        const priceChange = Math.abs(newPrice.yesPrice - oldPrice.yesPrice) / oldPrice.yesPrice;

        if (priceChange > this.config.priceSpikeThreshold) {
          console.log(
            `[PriceMonitor] ⚡ Price spike detected for ${marketId}: ${(priceChange * 100).toFixed(1)}%`
          );

          // Invalidate signal cache
          await invalidateOnPriceSpike(
            'crypto', // Default to crypto, can be made smarter
            `Price spike ${marketId}: ${(priceChange * 100).toFixed(1)}%`
          );
        }
      }
    }

    this.lastPriceUpdates.set(marketId, Date.now());
  }

  // --- Check stop-loss for a position ---

  private async checkStopLossForPosition(
    pos: MonitoredPosition,
    currentPrice: PriceData
  ): Promise<void> {
    const now = Date.now();

    // Check if enough time has passed since last check
    if (now - pos.lastStopLossCheck < this.config.stopLossCheckIntervalMs) {
      return;
    }

    // Get current price for the position's side
    const price = pos.side === 'yes' ? currentPrice.yesPrice : currentPrice.noPrice;

    // Check stop-loss
    const stopLossResult = checkStopLoss(pos.entryPrice, price, pos.side);

    if (!stopLossResult.allowed) {
      console.log(
        `[PriceMonitor] 🛑 Stop-loss triggered for ${pos.positionId}: ${pos.side.toUpperCase()} @ $${price.toFixed(4)} (entry: $${pos.entryPrice.toFixed(4)})`
      );

      // Execute stop-loss
      await this.executeStopLoss(pos, price, stopLossResult.reason ?? 'Stop-loss triggered');

      pos.lastStopLossCheck = now;
    }
  }

  // --- Execute stop-loss ---

  private async executeStopLoss(
    pos: MonitoredPosition,
    currentPrice: number,
    reason: string
  ): Promise<void> {
    try {
      const result = await closePosition({
        positionId: pos.positionId,
        agentId: pos.agentId,
        agentWalletId: pos.agentWalletId,
        reason,
      });

      if (result.success) {
        // Publish feed event
        await publishFeedEvent(
          buildFeedEvent({
            agentId: pos.agentId,
            agentName: pos.agentName,
            jobId: pos.jobId,
            category: 'position_update',
            severity: 'critical',
            content: {
              summary: `REAL-TIME STOP-LOSS: ${pos.marketId} ${pos.side.toUpperCase()} @ $${currentPrice.toFixed(4)} (entry: $${pos.entryPrice.toFixed(4)})`,
              action: 'sell',
              pnl: result.trade
                ? {
                    value: Number(result.trade.profitLoss ?? 0),
                    percent: Number(result.trade.profitLoss ?? 0) / Number(pos.amount),
                  }
                : undefined,
            },
            displayMessage: `🛑 REAL-TIME STOP-LOSS triggered for ${pos.agentName}: ${pos.side.toUpperCase()} on "${pos.marketQuestion ?? pos.marketId}" at $${currentPrice.toFixed(4)}`,
          })
        );

        // Remove from monitoring
        this.unregisterPosition(pos.positionId);
      }
    } catch (err) {
      console.error(`[PriceMonitor] Failed to execute stop-loss for ${pos.positionId}:`, err);
    }
  }

  // --- Get status ---

  getStatus(): {
    isRunning: boolean;
    monitoredPositions: number;
    cachedPrices: number;
    config: PriceMonitorConfig;
  } {
    return {
      isRunning: this.isRunning,
      monitoredPositions: this.monitoredPositions.size,
      cachedPrices: this.priceCache.size,
      config: this.config,
    };
  }
}

// ============================================================
// Singleton instance
// ============================================================

export const realTimePriceMonitor = new RealTimePriceMonitor();

// ============================================================
// Integration helper: Register positions from DB
// ============================================================

export async function registerOpenPositionsFromDB(
  jobId: string,
  agentId: string,
  agentName: string
): Promise<number> {
  try {
    const { getActivePositions } = await import('../services/trade-service');
    const { positions } = await getActivePositions(jobId);

    let registered = 0;
    for (const pos of positions) {
      realTimePriceMonitor.registerPosition({
        positionId: pos.id,
        marketId: pos.marketId,
        marketQuestion: pos.marketQuestion,
        agentId,
        agentName,
        jobId,
        agentWalletId: (pos as any).agentWalletId ?? '',
        side: (pos.side as 'yes' | 'no'),
        entryPrice: Number(pos.entryPrice),
        amount: Number(pos.amount),
        ownerPubkey: (pos as any).ownerPubkey ?? '',
        lastPriceCheck: 0,
        lastStopLossCheck: 0,
      });
      registered++;
    }

    console.log(`[PriceMonitor] Registered ${registered} open positions for ${jobId}`);
    return registered;
  } catch (err) {
    console.error('[PriceMonitor] Failed to register positions:', err);
    return 0;
  }
}
