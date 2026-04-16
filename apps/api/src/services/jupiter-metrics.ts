// ============================================================
// Jupiter API Metrics & Monitoring
// Tracks usage, cache performance, rate limits, and provides
// real-time dashboard data
// ============================================================

import { jupiterRateLimiter } from "./jupiter-rate-limiter";
import { getCacheStats } from "./jupiter-cache-manager";

// --- Metrics data ---

export interface JupiterMetrics {
  // API usage
  apiCalls: {
    total: number;
    lastMinute: number;
    lastHour: number;
    byCategory: Record<string, number>;
    errors: number;
    rateLimits: number;
  };

  // Cache performance
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
    staleServes: number;
    byCategory: Record<string, { hits: number; misses: number; hitRate: number }>;
  };

  // Rate limiter status
  rateLimiter: Record<string, {
    requestsThisMinute: number;
    requestsThisHour: number;
    activeRequests: number;
    queueLength: number;
    circuitOpen: boolean;
    config: { maxPerMinute: number; maxPerHour: number };
  }>;

  // Performance
  performance: {
    avgFetchTimeMs: number;
    p95FetchTimeMs: number;
    p99FetchTimeMs: number;
  };

  // Agents
  agents: {
    activeAgents: number;
    ticksLast5Min: number;
    decisionsLast5Min: number;
    tradesLast5Min: number;
  };

  // Real-time prices
  priceMonitor: {
    isRunning: boolean;
    monitoredPositions: number;
    cachedPrices: number;
    lastPollAgeMs: number | null;
  };

  // LLM cache
  llmCache: {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
  };

  // Timestamp
  timestamp: string;
}

// ============================================================
// Metrics Tracker Class
// ============================================================

class JupiterMetricsTracker {
  private metrics: JupiterMetrics;
  private fetchTimes: number[] = [];
  private llmCacheHits = 0;
  private llmCacheMisses = 0;

  constructor() {
    this.metrics = {
      apiCalls: {
        total: 0,
        lastMinute: 0,
        lastHour: 0,
        byCategory: {},
        errors: 0,
        rateLimits: 0,
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0,
        staleServes: 0,
        byCategory: {},
      },
      rateLimiter: {},
      performance: {
        avgFetchTimeMs: 0,
        p95FetchTimeMs: 0,
        p99FetchTimeMs: 0,
      },
      agents: {
        activeAgents: 0,
        ticksLast5Min: 0,
        decisionsLast5Min: 0,
        tradesLast5Min: 0,
      },
      priceMonitor: {
        isRunning: false,
        monitoredPositions: 0,
        cachedPrices: 0,
        lastPollAgeMs: null,
      },
      llmCache: {
        size: 0,
        hits: 0,
        misses: 0,
        hitRate: 0,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // --- Record API call ---

  recordApiCall(category: string): void {
    this.metrics.apiCalls.total++;
    this.metrics.apiCalls.lastMinute++;
    this.metrics.apiCalls.lastHour++;

    if (!this.metrics.apiCalls.byCategory[category]) {
      this.metrics.apiCalls.byCategory[category] = 0;
    }
    this.metrics.apiCalls.byCategory[category]++;
  }

  // --- Record API error ---

  recordApiError(category: string, isRateLimit: boolean = false): void {
    this.metrics.apiCalls.errors++;
    if (isRateLimit) {
      this.metrics.apiCalls.rateLimits++;
    }
  }

  // --- Record cache hit/miss ---

  recordCacheHit(category: string): void {
    this.metrics.cache.hits++;
    
    if (!this.metrics.cache.byCategory[category]) {
      this.metrics.cache.byCategory[category] = { hits: 0, misses: 0, hitRate: 0 };
    }
    this.metrics.cache.byCategory[category].hits++;
    this.updateCacheHitRate(category);
  }

  recordCacheMiss(category: string): void {
    this.metrics.cache.misses++;
    
    if (!this.metrics.cache.byCategory[category]) {
      this.metrics.cache.byCategory[category] = { hits: 0, misses: 0, hitRate: 0 };
    }
    this.metrics.cache.byCategory[category].misses++;
    this.updateCacheHitRate(category);
  }

  recordStaleServe(category: string): void {
    this.metrics.cache.staleServes++;
  }

  private updateCacheHitRate(category: string): void {
    const cat = this.metrics.cache.byCategory[category];
    const total = cat.hits + cat.misses;
    cat.hitRate = total > 0 ? cat.hits / total : 0;

    // Update global
    const globalTotal = this.metrics.cache.hits + this.metrics.cache.misses;
    this.metrics.cache.hitRate = globalTotal > 0 ? this.metrics.cache.hits / globalTotal : 0;
  }

  // --- Record fetch time ---

  recordFetchTime(category: string, durationMs: number): void {
    this.fetchTimes.push(durationMs);
    
    // Keep only last 1000 fetch times
    if (this.fetchTimes.length > 1000) {
      this.fetchTimes = this.fetchTimes.slice(-1000);
    }

    this.updatePerformanceMetrics();
  }

  private updatePerformanceMetrics(): void {
    if (this.fetchTimes.length === 0) return;

    const sorted = [...this.fetchTimes].sort((a, b) => a - b);
    
    this.metrics.performance.avgFetchTimeMs = 
      this.fetchTimes.reduce((sum, t) => sum + t, 0) / this.fetchTimes.length;
    
    const p95Idx = Math.floor(sorted.length * 0.95);
    this.metrics.performance.p95FetchTimeMs = sorted[p95Idx] ?? 0;
    
    const p99Idx = Math.floor(sorted.length * 0.99);
    this.metrics.performance.p99FetchTimeMs = sorted[p99Idx] ?? 0;
  }

  // --- Record LLM cache hit/miss ---

  recordLLMCacheHit(): void {
    this.llmCacheHits++;
    this.updateLLMCacheHitRate();
  }

  recordLLMCacheMiss(): void {
    this.llmCacheMisses++;
    this.updateLLMCacheHitRate();
  }

  private updateLLMCacheHitRate(): void {
    const total = this.llmCacheHits + this.llmCacheMisses;
    this.metrics.llmCache.hitRate = total > 0 ? this.llmCacheHits / total : 0;
    this.metrics.llmCache.hits = this.llmCacheHits;
    this.metrics.llmCache.misses = this.llmCacheMisses;
  }

  // --- Record agent tick ---

  recordAgentTick(): void {
    this.metrics.agents.ticksLast5Min++;
  }

  recordAgentDecision(): void {
    this.metrics.agents.decisionsLast5Min++;
  }

  recordAgentTrade(): void {
    this.metrics.agents.tradesLast5Min++;
  }

  // --- Get full metrics ---

  async getMetrics(): Promise<JupiterMetrics> {
    // Get live data from rate limiter
    this.metrics.rateLimiter = jupiterRateLimiter.getAllStatus();

    // Get live cache stats
    const cacheStats = await getCacheStats();
    
    // Update timestamp
    this.metrics.timestamp = new Date().toISOString();

    return this.metrics;
  }

  // --- Get summary for logging ---

  getSummary(): string {
    const m = this.metrics;
    return [
      `Jupiter API Metrics:`,
      `  API calls: ${m.apiCalls.total} total, ${m.apiCalls.lastMinute}/min, ${m.apiCalls.lastHour}/hour`,
      `  Errors: ${m.apiCalls.errors} (${m.apiCalls.rateLimits} rate limits)`,
      `  Cache: ${m.cache.hits} hits, ${m.cache.misses} misses (${(m.cache.hitRate * 100).toFixed(1)}% hit rate)`,
      `  Performance: avg=${m.performance.avgFetchTimeMs.toFixed(0)}ms, p95=${m.performance.p95FetchTimeMs.toFixed(0)}ms, p99=${m.performance.p99FetchTimeMs.toFixed(0)}ms`,
      `  LLM Cache: ${m.llmCache.hits} hits, ${m.llmCache.misses} misses (${(m.llmCache.hitRate * 100).toFixed(1)}% hit rate)`,
    ].join('\n');
  }

  // --- Reset counters (call periodically) ---

  resetCounters(): void {
    this.metrics.apiCalls.lastMinute = 0;
    this.metrics.apiCalls.lastHour = 0;
    this.metrics.agents.ticksLast5Min = 0;
    this.metrics.agents.decisionsLast5Min = 0;
    this.metrics.agents.tradesLast5Min = 0;

    console.log('[JupiterMetrics] Counters reset');
  }
}

// ============================================================
// Singleton instance
// ============================================================

export const jupiterMetrics = new JupiterMetricsTracker();

// ============================================================
// Convenience functions
// ============================================================

export async function getJupiterMetrics(): Promise<JupiterMetrics> {
  return jupiterMetrics.getMetrics();
}

export function logJupiterSummary(): void {
  console.log(jupiterMetrics.getSummary());
}

// Auto-log every 5 minutes
let loggingInterval: NodeJS.Timeout | null = null;

export function startMetricsLogging(intervalMs: number = 5 * 60 * 1000): void {
  if (loggingInterval) return;
  
  loggingInterval = setInterval(() => {
    logJupiterSummary();
    jupiterMetrics.resetCounters();
  }, intervalMs);

  console.log(`[JupiterMetrics] Auto-logging started (every ${intervalMs / 60000} minutes)`);
}
