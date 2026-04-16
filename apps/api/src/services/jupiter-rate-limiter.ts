// ============================================================
// Jupiter Predict API Rate Limiter
// Per-category rate limiting with priority queue, exponential backoff,
// and circuit breaker pattern to prevent rate limit violations
// ============================================================

import { redis } from "../utils/redis";

// --- Rate limit configuration ---

export interface RateLimitConfig {
  maxPerMinute: number;
  maxPerHour: number;
  maxConcurrent: number;
  retryDelayMs: number;
  maxRetries: number;
  backoffMultiplier: number;
}

export const CATEGORY_RATE_LIMITS: Record<string, RateLimitConfig> = {
  sports: {
    maxPerMinute: 30,
    maxPerHour: 500,
    maxConcurrent: 3,
    retryDelayMs: 2000,
    maxRetries: 3,
    backoffMultiplier: 2,
  },
  crypto: {
    maxPerMinute: 20,
    maxPerHour: 300,
    maxConcurrent: 2,
    retryDelayMs: 2500,
    maxRetries: 3,
    backoffMultiplier: 2,
  },
  politics: {
    maxPerMinute: 20,
    maxPerHour: 300,
    maxConcurrent: 2,
    retryDelayMs: 2500,
    maxRetries: 3,
    backoffMultiplier: 2,
  },
  economics: {
    maxPerMinute: 15,
    maxPerHour: 200,
    maxConcurrent: 2,
    retryDelayMs: 3000,
    maxRetries: 3,
    backoffMultiplier: 2,
  },
};

// Default rate limits for unknown categories
const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxPerMinute: 20,
  maxPerHour: 300,
  maxConcurrent: 2,
  retryDelayMs: 2000,
  maxRetries: 3,
  backoffMultiplier: 2,
};

// --- Priority levels ---

export enum RequestPriority {
  HIGH = 0,    // Sports, crypto (fast-moving markets)
  MEDIUM = 1,  // Politics
  LOW = 2,     // Economics, general
}

// --- Rate limiter state ---

interface CategoryLimiterState {
  minuteRequests: number[];  // Timestamps of requests in current minute
  hourRequests: number[];    // Timestamps of requests in current hour
  activeRequests: number;    // Currently executing requests
  queue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    category: string;
    priority: RequestPriority;
    timestamp: number;
  }>;
  consecutiveFailures: number;
  circuitOpenUntil: number;  // Circuit breaker state
}

// ============================================================
// Jupiter Rate Limiter Class
// ============================================================

class JupiterRateLimiter {
  private state = new Map<string, CategoryLimiterState>();
  private globalActiveRequests = 0;
  private globalMaxConcurrent = 10; // Global limit across all categories

  constructor() {
    // Initialize state for all known categories
    for (const category of Object.keys(CATEGORY_RATE_LIMITS)) {
      this.initState(category);
    }
  }

  private initState(category: string): void {
    if (!this.state.has(category)) {
      this.state.set(category, {
        minuteRequests: [],
        hourRequests: [],
        activeRequests: 0,
        queue: [],
        consecutiveFailures: 0,
        circuitOpenUntil: 0,
      });
    }
  }

  private getConfig(category: string): RateLimitConfig {
    return CATEGORY_RATE_LIMITS[category] ?? DEFAULT_RATE_LIMIT;
  }

  private getState(category: string): CategoryLimiterState {
    this.initState(category);
    return this.state.get(category)!;
  }

  // --- Clean old requests from sliding windows ---

  private cleanWindow(timestamps: number[], windowMs: number): number[] {
    const cutoff = Date.now() - windowMs;
    return timestamps.filter(t => t > cutoff);
  }

  // --- Check if request is allowed ---

  private canRequest(category: string): { allowed: boolean; waitMs?: number; reason?: string } {
    const config = this.getConfig(category);
    const state = this.getState(category);
    const now = Date.now();

    // Check circuit breaker
    if (state.circuitOpenUntil > now) {
      const waitMs = state.circuitOpenUntil - now;
      return { allowed: false, waitMs, reason: 'Circuit breaker open' };
    }

    // Clean windows
    state.minuteRequests = this.cleanWindow(state.minuteRequests, 60_000);
    state.hourRequests = this.cleanWindow(state.hourRequests, 3_600_000);

    // Check per-minute limit
    if (state.minuteRequests.length >= config.maxPerMinute) {
      const oldestInMinute = state.minuteRequests[0];
      const waitMs = 60_000 - (now - oldestInMinute) + 100; // +100ms buffer
      return { allowed: false, waitMs, reason: 'Per-minute limit reached' };
    }

    // Check per-hour limit
    if (state.hourRequests.length >= config.maxPerHour) {
      const oldestInHour = state.hourRequests[0];
      const waitMs = 3_600_000 - (now - oldestInHour) + 100;
      return { allowed: false, waitMs, reason: 'Per-hour limit reached' };
    }

    // Check per-category concurrent limit
    if (state.activeRequests >= config.maxConcurrent) {
      return { allowed: false, waitMs: 500, reason: 'Concurrent request limit' };
    }

    // Check global concurrent limit
    if (this.globalActiveRequests >= this.globalMaxConcurrent) {
      return { allowed: false, waitMs: 500, reason: 'Global concurrent limit' };
    }

    return { allowed: true };
  }

  // --- Record a request ---

  private recordRequest(category: string): void {
    const state = this.getState(category);
    const now = Date.now();
    state.minuteRequests.push(now);
    state.hourRequests.push(now);
    state.activeRequests++;
    this.globalActiveRequests++;
  }

  // --- Release a request slot ---

  private releaseRequest(category: string): void {
    const state = this.getState(category);
    state.activeRequests = Math.max(0, state.activeRequests - 1);
    this.globalActiveRequests = Math.max(0, this.globalActiveRequests - 1);

    // Process next in queue
    this.processQueue(category);
  }

  // --- Process queue for a category ---

  private processQueue(category: string): void {
    const state = this.getState(category);

    // Sort queue by priority (HIGH first), then by timestamp (FIFO)
    state.queue.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.timestamp - b.timestamp;
    });

    // Try to process next request
    while (state.queue.length > 0) {
      const check = this.canRequest(category);
      if (!check.allowed) break;

      const next = state.queue.shift()!;
      this.recordRequest(category);
      next.resolve();
    }
  }

  // ============================================================
  // Public API: Acquire rate limit slot
  // ============================================================

  async acquire(
    category: string,
    priority: RequestPriority = RequestPriority.MEDIUM
  ): Promise<void> {
    const config = this.getConfig(category);

    // Check if we can request immediately
    const check = this.canRequest(category);
    if (check.allowed) {
      this.recordRequest(category);
      return;
    }

    // Need to wait - add to queue
    return new Promise((resolve, reject) => {
      this.getState(category).queue.push({
        resolve,
        reject,
        category,
        priority,
        timestamp: Date.now(),
      });

      // Set timeout to prevent indefinite waiting
      setTimeout(() => {
        const idx = this.getState(category).queue.findIndex(
          q => q.resolve === resolve
        );
        if (idx !== -1) {
          this.getState(category).queue.splice(idx, 1);
          reject(new Error(`Rate limit wait timeout for ${category}`));
        }
      }, 60_000); // 1 minute max wait

      // Try to process queue
      this.processQueue(category);
    });
  }

  // ============================================================
  // Public API: Release rate limit slot
  // ============================================================

  release(category: string): void {
    this.releaseRequest(category);
  }

  // ============================================================
  // Public API: Record success/failure for circuit breaker
  // ============================================================

  recordSuccess(category: string): void {
    const state = this.getState(category);
    state.consecutiveFailures = Math.max(0, state.consecutiveFailures - 1);
  }

  recordFailure(category: string, statusCode?: number): void {
    const state = this.getState(category);
    state.consecutiveFailures++;

    // If rate limited (429), open circuit breaker
    if (statusCode === 429) {
      const backoffMs = Math.min(
        state.consecutiveFailures * 10_000,
        60_000
      );
      state.circuitOpenUntil = Date.now() + backoffMs;
      console.warn(
        `[JupiterRateLimiter] Circuit breaker opened for ${category} (${backoffMs / 1000}s backoff)`
      );
    }
  }

  // ============================================================
  // Public API: Execute request with automatic retry and backoff
  // ============================================================

  async executeWithRetry<T>(
    category: string,
    fn: () => Promise<T>,
    priority: RequestPriority = RequestPriority.MEDIUM
  ): Promise<T> {
    const config = this.getConfig(category);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        // Acquire rate limit slot
        await this.acquire(category, priority);

        try {
          // Execute the request
          const result = await fn();
          this.recordSuccess(category);
          return result;
        } finally {
          // Always release the slot
          this.release(category);
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Check if it's a rate limit error
        const isRateLimit =
          lastError.message.includes('429') ||
          lastError.message.includes('rate limit') ||
          lastError.message.includes('Too Many Requests');

        if (isRateLimit) {
          this.recordFailure(category, 429);
        } else {
          this.recordFailure(category);
        }

        // Don't retry if it's not a rate limit / transient error
        if (!isRateLimit && attempt > 0) {
          throw lastError;
        }

        // Calculate backoff delay
        const delay =
          attempt === 0
            ? 0
            : config.retryDelayMs *
              Math.pow(config.backoffMultiplier, attempt - 1);

        if (attempt < config.maxRetries) {
          console.warn(
            `[JupiterRateLimiter] Attempt ${attempt + 1}/${config.maxRetries + 1} failed for ${category}, retrying in ${delay}ms...`,
            lastError.message
          );
          await this.sleep(delay);
        }
      }
    }

    throw lastError ?? new Error('Unknown error in executeWithRetry');
  }

  // ============================================================
  // Public API: Get rate limit status
  // ============================================================

  getStatus(category: string): {
    requestsThisMinute: number;
    requestsThisHour: number;
    activeRequests: number;
    queueLength: number;
    circuitOpen: boolean;
    config: RateLimitConfig;
  } {
    const state = this.getState(category);
    const config = this.getConfig(category);

    state.minuteRequests = this.cleanWindow(state.minuteRequests, 60_000);
    state.hourRequests = this.cleanWindow(state.hourRequests, 3_600_000);

    return {
      requestsThisMinute: state.minuteRequests.length,
      requestsThisHour: state.hourRequests.length,
      activeRequests: state.activeRequests,
      queueLength: state.queue.length,
      circuitOpen: state.circuitOpenUntil > Date.now(),
      config,
    };
  }

  // ============================================================
  // Public API: Get all categories status
  // ============================================================

  getAllStatus(): Record<string, ReturnType<JupiterRateLimiter['getStatus']>> {
    const status: Record<string, ReturnType<JupiterRateLimiter['getStatus']>> = {};
    for (const category of Object.keys(CATEGORY_RATE_LIMITS)) {
      status[category] = this.getStatus(category);
    }
    return status;
  }

  // ============================================================
  // Helper: Sleep
  // ============================================================

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================
// Singleton instance
// ============================================================

export const jupiterRateLimiter = new JupiterRateLimiter();

// ============================================================
// Convenience wrapper for use in API client
// ============================================================

export async function withJupiterRateLimit<T>(
  category: string,
  fn: () => Promise<T>,
  priority?: RequestPriority
): Promise<T> {
  return jupiterRateLimiter.executeWithRetry(category, fn, priority);
}

// Map agent categories to Jupiter request priorities
export function getAgentPriority(agentCategory: string): RequestPriority {
  switch (agentCategory) {
    case 'sports':
    case 'crypto':
      return RequestPriority.HIGH;
    case 'politics':
      return RequestPriority.MEDIUM;
    default:
      return RequestPriority.LOW;
  }
}
