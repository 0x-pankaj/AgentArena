// ============================================================
// LLM Response Cache
// Caches LLM responses for similar market questions
// Uses simple string similarity to avoid redundant LLM calls
// ============================================================

import { redis } from "../utils/redis";

// --- Configuration ---

const LLM_CACHE_PREFIX = "cache:llm:";
const LLM_CACHE_TTL = 30 * 60; // 30 minutes
const SIMILARITY_THRESHOLD = 0.85; // 85% similarity to use cached response
const MAX_CACHE_ENTRIES = 500;

// --- Cached response ---

export interface CachedLLMResponse {
  question: string;
  response: string;
  timestamp: number;
  usageCount: number;
  model: string;
  tokensUsed: number;
}

// ============================================================
// Simple string similarity (Jaccard similarity on word sets)
// Fast enough for market question comparison
// ============================================================

function calculateSimilarity(str1: string, str2: string): number {
  // Normalize strings
  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .trim();

  const norm1 = normalize(str1);
  const norm2 = normalize(str2);

  // Quick exact match
  if (norm1 === norm2) return 1.0;

  // Split into words
  const words1 = new Set(norm1.split(/\s+/));
  const words2 = new Set(norm2.split(/\s+/));

  // Jaccard similarity
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

// ============================================================
// LLM Response Cache Class
// ============================================================

class LLMResponseCache {
  // In-memory index for fast similarity search
  private index = new Map<string, CachedLLMResponse>();
  private initialized = false;

  // --- Initialize from Redis ---

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const keys = await redis.keys(`${LLM_CACHE_PREFIX}*`);
      if (keys.length === 0) {
        this.initialized = true;
        return;
      }

      // Load all into memory
      const values = await Promise.all(
        keys.map(async (key) => {
          const raw = await redis.get(key);
          return raw ? JSON.parse(raw) as CachedLLMResponse : null;
        })
      );

      for (const value of values) {
        if (value) {
          this.index.set(value.question, value);
        }
      }

      // Enforce max size
      this.enforceMaxSize();

      this.initialized = true;
      console.log(`[LLMCache] Initialized with ${this.index.size} entries`);
    } catch (err) {
      console.error('[LLMCache] Initialization failed:', err);
      this.initialized = true; // Don't block on failure
    }
  }

  // --- Get cached response for a question ---

  async get(
    question: string,
    model?: string,
    marketKey?: string
  ): Promise<CachedLLMResponse | null> {
    await this.initialize();

    // Use marketKey as exact cache key if provided
    if (marketKey) {
      const exact = this.index.get(marketKey);
      if (exact && (!model || exact.model === model)) {
        exact.usageCount++;
        await this.save(exact);
        return exact;
      }
      return null;
    }

    // Check exact match first (legacy question-based)
    const exact = this.index.get(question);
    if (exact && (!model || exact.model === model)) {
      exact.usageCount++;
      await this.save(exact);
      return exact;
    }

    // Find similar question
    const similar = this.findSimilar(question);
    if (similar && (!model || similar.model === model)) {
      console.log(
        `[LLMCache] Cache hit for similar question: "${question.slice(0, 50)}..." (similarity to "${similar.question.slice(0, 50)}...")`
      );
      similar.usageCount++;
      await this.save(similar);
      return similar;
    }

    return null;
  }

  // --- Save response ---

  async set(
    question: string,
    response: string,
    model: string,
    tokensUsed: number,
    marketKey?: string
  ): Promise<void> {
    await this.initialize();

    const entry: CachedLLMResponse = {
      question,
      response,
      timestamp: Date.now(),
      usageCount: 1,
      model,
      tokensUsed,
    };

    // Use marketKey as index key if provided, otherwise question
    const indexKey = marketKey ?? question;
    this.index.set(indexKey, entry);
    await this.save(entry);

    // Enforce max size
    this.enforceMaxSize();
  }

  // --- Find similar question ---

  private findSimilar(question: string): CachedLLMResponse | null {
    let bestMatch: CachedLLMResponse | null = null;
    let bestScore = 0;

    for (const entry of this.index.values()) {
      const score = calculateSimilarity(question, entry.question);
      if (score > bestScore && score >= SIMILARITY_THRESHOLD) {
        bestScore = score;
        bestMatch = entry;
      }
    }

    return bestMatch;
  }

  // --- Save to Redis ---

  private async save(entry: CachedLLMResponse): Promise<void> {
    const key = this.getKey(entry.question);
    await redis.setex(key, LLM_CACHE_TTL, JSON.stringify(entry));
  }

  // --- Get cache key ---

  private getKey(question: string): string {
    // Use hash of question for key
    const hash = this.simpleHash(question);
    return `${LLM_CACHE_PREFIX}${hash}`;
  }

  // --- Enforce max cache size ---

  private enforceMaxSize(): void {
    if (this.index.size <= MAX_CACHE_ENTRIES) return;

    // Remove least recently used (lowest usageCount)
    const sorted = Array.from(this.index.entries())
      .sort((a, b) => a[1].usageCount - b[1].usageCount);

    const toRemove = sorted.slice(0, sorted.length - MAX_CACHE_ENTRIES);
    for (const [key] of toRemove) {
      this.index.delete(key);
    }

    console.log(`[LLMCache] Enforced max size, removed ${toRemove.length} entries`);
  }

  // --- Simple hash function ---

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // --- Get stats ---

  getStats(): {
    size: number;
    ttl: number;
    similarityThreshold: number;
  } {
    return {
      size: this.index.size,
      ttl: LLM_CACHE_TTL,
      similarityThreshold: SIMILARITY_THRESHOLD,
    };
  }

  // --- Clear cache ---

  async clear(): Promise<void> {
    const keys = await redis.keys(`${LLM_CACHE_PREFIX}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    this.index.clear();
    console.log('[LLMCache] Cleared');
  }
}

// ============================================================
// Singleton instance
// ============================================================

export const llmResponseCache = new LLMResponseCache();

// ============================================================
// Helper functions for use in pipeline
// ============================================================

export async function getCachedLLMResponse(
  question: string,
  model?: string,
  marketKey?: string
): Promise<string | null> {
  const cached = await llmResponseCache.get(question, model, marketKey);
  return cached?.response ?? null;
}

export async function cacheLLMResponse(
  question: string,
  response: string,
  model: string,
  tokensUsed: number,
  marketKey?: string
): Promise<void> {
  await llmResponseCache.set(question, response, model, tokensUsed, marketKey);
}
