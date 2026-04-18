// ============================================================
// Signal Cache Invalidation Manager
// Invalidates signal caches when significant events occur
// Ensures agents get fresh data when markets move
// ============================================================

import { redis } from "../utils/redis";
import { marketEventBus } from "./market-event-bus";

// --- Signal cache keys (matching signal-cache.ts) ---

const SIGNAL_CACHE_KEYS = {
  base: "cache:signals:base",
  sports: "cache:signals:sports",
  crypto: "cache:signals:crypto",
};

// --- Invalidation triggers ---

export interface InvalidationTrigger {
  type: 'threshold_triggered' | 'breaking_news' | 'price_spike' | 'volume_surge' | 'manual';
  category: string;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// --- Invalidation rules ---

interface InvalidationRule {
  triggerType: InvalidationTrigger['type'];
  categories: string[];
  cooldownMs: number; // Prevent spam invalidations
}

const INVALIDATION_RULES: InvalidationRule[] = [
  {
    triggerType: 'threshold_triggered',
    categories: ['sports', 'crypto', 'politics', 'general'],
    cooldownMs: 60_000, // 1 min cooldown
  },
  {
    triggerType: 'breaking_news',
    categories: ['politics', 'general'],
    cooldownMs: 120_000, // 2 min cooldown
  },
  {
    triggerType: 'price_spike',
    categories: ['crypto', 'sports'],
    cooldownMs: 30_000, // 30 sec cooldown
  },
  {
    triggerType: 'volume_surge',
    categories: ['crypto', 'sports', 'politics'],
    cooldownMs: 60_000, // 1 min cooldown
  },
  {
    triggerType: 'manual',
    categories: ['sports', 'crypto', 'politics', 'economics', 'general'],
    cooldownMs: 0, // No cooldown for manual
  },
];

// --- Track last invalidation time ---

const lastInvalidation = new Map<string, number>();

// ============================================================
// Signal Invalidation Manager Class
// ============================================================

class SignalInvalidationManager {
  private invalidationQueue: Array<{
    trigger: InvalidationTrigger;
    timestamp: number;
    promise: Promise<void>;
  }> = [];

  // --- Invalidate signal cache for a category ---

  async invalidateCategory(
    category: string,
    trigger: InvalidationTrigger
  ): Promise<void> {
    const rule = INVALIDATION_RULES.find(r => 
      r.triggerType === trigger.type && r.categories.includes(category)
    );

    if (!rule) {
      console.log(`[SignalInvalidation] No rule for ${trigger.type} → ${category}, skipping`);
      return;
    }

    // Check cooldown
    const cacheKey = this.getCacheKey(category);
    const lastTime = lastInvalidation.get(cacheKey) ?? 0;
    const timeSinceLastInvalidation = Date.now() - lastTime;

    if (timeSinceLastInvalidation < rule.cooldownMs) {
      console.log(
        `[SignalInvalidation] Cooldown active for ${category} (${(timeSinceLastInvalidation / 1000).toFixed(0)}s < ${(rule.cooldownMs / 1000).toFixed(0)}s), skipping`
      );
      return;
    }

    console.log(
      `[SignalInvalidation] Invalidating ${category} signals (trigger: ${trigger.type}, reason: ${trigger.reason})`
    );

    // Delete cache
    await redis.del(cacheKey);
    lastInvalidation.set(cacheKey, Date.now());

    // Also invalidate related Jupiter events cache
    const { invalidateCategoryCache } = await import('./jupiter-cache-manager');
    await invalidateCategoryCache(category);

    // Publish event
    await marketEventBus.publish({
      type: 'cache_invalidated',
      category,
      timestamp: Date.now(),
      data: {
        trigger: trigger.type,
        reason: trigger.reason,
        severity: trigger.severity,
      },
    });
  }

  // --- Invalidate multiple categories ---

  async invalidateMultiple(
    categories: string[],
    trigger: InvalidationTrigger
  ): Promise<void> {
    await Promise.allSettled(
      categories.map(cat => this.invalidateCategory(cat, trigger))
    );
  }

  // --- Invalidate all signal caches ---

  async invalidateAll(trigger: InvalidationTrigger): Promise<void> {
    const categories = ['base', 'sports', 'crypto'];
    
    for (const cat of categories) {
      await redis.del(SIGNAL_CACHE_KEYS[cat as keyof typeof SIGNAL_CACHE_KEYS]);
    }

    console.log(`[SignalInvalidation] Invalidated ALL signal caches (trigger: ${trigger.type})`);

    await marketEventBus.publish({
      type: 'cache_invalidated',
      category: 'all',
      timestamp: Date.now(),
      data: {
        trigger: trigger.type,
        reason: trigger.reason,
        severity: trigger.severity,
        categories: categories,
      },
    });
  }

  // --- Queue invalidation (for batch processing) ---

  queueInvalidation(trigger: InvalidationTrigger): Promise<void> {
    const promise = this.processInvalidationQueue();
    this.invalidationQueue.push({
      trigger,
      timestamp: Date.now(),
      promise,
    });
    return promise;
  }

  // --- Process queue ---

  private async processInvalidationQueue(): Promise<void> {
    if (this.invalidationQueue.length === 0) return;

    // Sort by severity (critical first)
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    this.invalidationQueue.sort((a, b) => 
      severityOrder[a.trigger.severity] - severityOrder[b.trigger.severity]
    );

    // Process all
    const currentQueue = [...this.invalidationQueue];
    this.invalidationQueue = [];

    for (const item of currentQueue) {
      await this.invalidateMultiple(
        INVALIDATION_RULES.find(r => r.triggerType === item.trigger.type)?.categories ?? [item.trigger.category],
        item.trigger
      );
    }
  }

  // --- Helper: Get cache key ---

  private getCacheKey(category: string): string {
    switch (category) {
      case 'sports':
        return SIGNAL_CACHE_KEYS.sports;
      case 'crypto':
        return SIGNAL_CACHE_KEYS.crypto;
      default:
        return SIGNAL_CACHE_KEYS.base;
    }
  }

  // --- Get invalidation stats ---

  getStats(): Record<string, { lastInvalidation: number | null; ageMs: number | null }> {
    const stats: Record<string, { lastInvalidation: number | null; ageMs: number | null }> = {};
    
    for (const [key, time] of lastInvalidation.entries()) {
      stats[key] = {
        lastInvalidation: time,
        ageMs: Date.now() - time,
      };
    }

    return stats;
  }

  // --- Reset stats ---

  resetStats(): void {
    lastInvalidation.clear();
  }
}

// ============================================================
// Singleton instance
// ============================================================

export const signalInvalidationManager = new SignalInvalidationManager();

// ============================================================
// Convenience functions for common invalidation scenarios
// ============================================================

export async function invalidateOnThreshold(
  category: string,
  reason: string
): Promise<void> {
  await signalInvalidationManager.invalidateCategory(category, {
    type: 'threshold_triggered',
    category,
    reason,
    severity: 'high',
  });
}

export async function invalidateOnBreakingNews(
  reason: string
): Promise<void> {
  await signalInvalidationManager.invalidateMultiple(
    ['politics', 'general'],
    {
      type: 'breaking_news',
      category: 'politics',
      reason,
      severity: 'critical',
    }
  );
}

export async function invalidateOnPriceSpike(
  category: string,
  reason: string
): Promise<void> {
  await signalInvalidationManager.invalidateCategory(category, {
    type: 'price_spike',
    category,
    reason,
    severity: 'high',
  });
}

export async function invalidateOnVolumeSurge(
  category: string,
  reason: string
): Promise<void> {
  await signalInvalidationManager.invalidateCategory(category, {
    type: 'volume_surge',
    category,
    reason,
    severity: 'medium',
  });
}
