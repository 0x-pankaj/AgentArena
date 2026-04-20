// ============================================================
// Market Event Bus
// Single Jupiter fetch → broadcast to all interested agents
// Prevents duplicate API calls when multiple agents need same data
// ============================================================

import { redis } from "../utils/redis";
import type { JupiterEvent } from "../plugins/polymarket-plugin";
import { getCachedJupiterEvents, AGENT_TO_JUPITER_CATEGORIES } from "./jupiter-cache-manager";
import { jupiterRateLimiter, getAgentPriority } from "./jupiter-rate-limiter";

// --- Event types ---

export type MarketEventType = 
  | 'markets_updated'      // Markets fetched for a category
  | 'cache_invalidated'    // Cache was invalidated
  | 'price_update'         // Price changed significantly
  | 'threshold_triggered'  // Signal threshold triggered

export interface MarketEvent {
  type: MarketEventType;
  category: string;
  timestamp: number;
  data: Record<string, any>;
}

// --- Subscriber callback ---

type MarketEventCallback = (event: MarketEvent) => void | Promise<void>;

// ============================================================
// Market Event Bus Class
// ============================================================

class MarketEventBus {
  private subscribers = new Map<string, Set<MarketEventCallback>>();
  private globalSubscribers = new Set<MarketEventCallback>();
  private isFetching = new Map<string, Promise<any>>(); // Prevent duplicate fetches
  private lastFetchTime = new Map<string, number>();

  // --- Subscribe to specific category ---

  subscribe(category: string, callback: MarketEventCallback): () => void {
    if (!this.subscribers.has(category)) {
      this.subscribers.set(category, new Set());
    }
    this.subscribers.get(category)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.subscribers.get(category)?.delete(callback);
    };
  }

  // --- Subscribe to all events ---

  subscribeGlobal(callback: MarketEventCallback): () => void {
    this.globalSubscribers.add(callback);
    return () => {
      this.globalSubscribers.delete(callback);
    };
  }

  // --- Publish event ---

  async publish(event: MarketEvent): Promise<void> {
    const categorySubs = this.subscribers.get(event.category) ?? new Set();

    // Notify category subscribers
    const promises = Array.from(categorySubs).map(async (cb) => {
      try {
        await cb(event);
      } catch (err) {
        console.error(`[MarketEventBus] Subscriber error for ${event.category}:`, err);
      }
    });

    // Notify global subscribers
    const globalPromises = Array.from(this.globalSubscribers).map(async (cb) => {
      try {
        await cb(event);
      } catch (err) {
        console.error(`[MarketEventBus] Global subscriber error:`, err);
      }
    });

    await Promise.allSettled([...promises, ...globalPromises]);
  }

  // --- Fetch and broadcast for a category (prevents duplicates) ---

  async fetchAndBroadcast(
    category: string,
    options?: { forceRefresh?: boolean; maxEvents?: number }
  ): Promise<{ events: JupiterEvent[]; eventCount: number }> {
    // Check if there's already an in-flight fetch for this category
    const inFlight = this.isFetching.get(category);
    if (inFlight) {
      // Even for forceRefresh, wait for the existing fetch to complete first
      // to avoid duplicating API calls. Then decide if we need to re-fetch.
      console.log(`[MarketEventBus] Waiting for in-flight fetch for ${category}${options?.forceRefresh ? " (forceRefresh pending)" : ""}...`);
      try {
        const result = await inFlight;
        // If forceRefresh was requested, check if the cached data is fresh enough
        if (options?.forceRefresh) {
          const lastFetch = this.lastFetchTime.get(category) ?? 0;
          const age = Date.now() - lastFetch;
          // If the in-flight fetch completed recently (within 10s), use it
          if (age < 10_000) {
            return result;
          }
          // Otherwise fall through to start a new fetch below
        } else {
          return result;
        }
      } catch {
        // In-flight fetch failed — proceed to start a new one
      }
    }

    // Check if we fetched recently (debounce)
    const lastFetch = this.lastFetchTime.get(category) ?? 0;
    const timeSinceLastFetch = Date.now() - lastFetch;
    
    // Debounce window: 30 seconds (prevent rapid re-fetches)
    if (timeSinceLastFetch < 30_000 && !options?.forceRefresh) {
      console.log(`[MarketEventBus] Debouncing fetch for ${category} (${(timeSinceLastFetch / 1000).toFixed(0)}s since last fetch)`);
      // Return cached data without fetching
      const cached = await getCachedJupiterEvents(category);
      return { events: cached.events, eventCount: cached.events.length };
    }

    // Create new fetch promise
    const fetchPromise = this.doFetchAndBroadcast(category, options);
    this.isFetching.set(category, fetchPromise);

    try {
      const result = await fetchPromise;
      return result;
    } finally {
      // Clear in-flight marker
      this.isFetching.delete(category);
    }
  }

  // --- Actual fetch and broadcast ---

  private async doFetchAndBroadcast(
    category: string,
    options?: { forceRefresh?: boolean; maxEvents?: number }
  ): Promise<{ events: JupiterEvent[]; eventCount: number }> {
    const startTime = Date.now();

    try {
      // Fetch with cache logic
      const result = await getCachedJupiterEvents(category, options);
      
      this.lastFetchTime.set(category, Date.now());

      // Publish event
      await this.publish({
        type: 'markets_updated',
        category,
        timestamp: Date.now(),
        data: {
          eventCount: result.events.length,
          fetchDurationMs: result.metadata.fetchDurationMs,
          isStale: result.metadata.isStale,
          cacheAge: Date.now() - new Date(result.metadata.fetchedAt).getTime(),
        },
      });

      const duration = Date.now() - startTime;
      console.log(
        `[MarketEventBus] Broadcast ${result.events.length} events for ${category} (${duration}ms)`
      );

      return { events: result.events, eventCount: result.events.length };
    } catch (err) {
      console.error(`[MarketEventBus] Fetch failed for ${category}:`, err);
      
      // Publish error event
      await this.publish({
        type: 'markets_updated',
        category,
        timestamp: Date.now(),
        data: {
          eventCount: 0,
          error: err instanceof Error ? err.message : String(err),
          fetchDurationMs: Date.now() - startTime,
        },
      });

      return { events: [], eventCount: 0 };
    }
  }

  // --- Fetch for all agent categories at once (batch) ---

  async fetchAndBroadcastForAgent(
    agentCategory: string,
    options?: { forceRefresh?: boolean }
  ): Promise<Record<string, { events: JupiterEvent[]; eventCount: number }>> {
    const jupiterCategories = AGENT_TO_JUPITER_CATEGORIES[agentCategory] ?? [agentCategory];

    // Fetch all categories in parallel
    const results = await Promise.allSettled(
      jupiterCategories.map(async (cat) => {
        const result = await this.fetchAndBroadcast(cat, {
          forceRefresh: options?.forceRefresh,
        });
        return { category: cat, result };
      })
    );

    // Build result map
    const result: Record<string, { events: JupiterEvent[]; eventCount: number }> = {};
    results.forEach((r) => {
      if (r.status === 'fulfilled') {
        result[r.value.category] = r.value.result;
      }
    });

    const totalEvents = Object.values(result).reduce((sum, r) => sum + r.eventCount, 0);
    console.log(
      `[MarketEventBus] Fetched ${totalEvents} events across ${jupiterCategories.length} categories for ${agentCategory} agent`
    );

    return result;
  }

  // --- Invalidate and re-fetch ---

  async invalidateAndRefetch(category: string): Promise<void> {
    const { invalidateCategoryCache } = await import('./jupiter-cache-manager');
    await invalidateCategoryCache(category);

    await this.publish({
      type: 'cache_invalidated',
      category,
      timestamp: Date.now(),
      data: { reason: 'manual_invalidation' },
    });

    // Immediately re-fetch
    await this.fetchAndBroadcast(category, { forceRefresh: true });
  }

  // --- Get fetch status ---

  getFetchStatus(category: string): {
    isFetching: boolean;
    lastFetchAgeMs: number | null;
  } {
    const lastFetch = this.lastFetchTime.get(category);
    return {
      isFetching: this.isFetching.has(category),
      lastFetchAgeMs: lastFetch ? Date.now() - lastFetch : null,
    };
  }
}

// ============================================================
// Singleton instance
// ============================================================

export const marketEventBus = new MarketEventBus();

// ============================================================
// Convenience function: Get markets for agent with EventBus
// This replaces direct getCachedEvents calls
// ============================================================

export async function getMarketsForAgent(
  agentCategory: string,
  options?: { forceRefresh?: boolean }
): Promise<Record<string, JupiterEvent[]>> {
  const results = await marketEventBus.fetchAndBroadcastForAgent(agentCategory, options);
  
  // Extract events from results
  const events: Record<string, JupiterEvent[]> = {};
  for (const [category, result] of Object.entries(results)) {
    events[category] = result.events;
  }
  
  return events;
}

// ============================================================
// Helper: Subscribe to market updates
// ============================================================

export function onMarketUpdate(
  category: string,
  callback: (events: JupiterEvent[]) => void | Promise<void>
): () => void {
  return marketEventBus.subscribe(category, async (event) => {
    if (event.type === 'markets_updated' && event.data.eventCount > 0) {
      // Events are not included in the broadcast, need to fetch from cache
      const { getCachedJupiterEvents } = await import('./jupiter-cache-manager');
      const cached = await getCachedJupiterEvents(category);
      await callback(cached.events);
    }
  });
}
