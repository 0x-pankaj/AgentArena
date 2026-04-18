# Quick Reference: AI Pipeline Optimizations

## 🚀 Quick Start

All optimizations are automatically activated on server startup. No configuration needed.

### Test Mode
```bash
TEST_MODE=true npm run dev:api
```
Mock Jupiter API activates automatically with realistic test data.

---

## 📊 Monitoring

### View Live Metrics (every 5 minutes in logs)
```
Jupiter API Metrics:
  API calls: 150 total, 12/min, 85/hour
  Errors: 2 (1 rate limits)
  Cache: 450 hits, 120 misses (78.9% hit rate)
  Performance: avg=245ms, p95=890ms, p99=1450ms
  LLM Cache: 85 hits, 180 misses (32.1% hit rate)
```

### Check Cache Status (code)
```typescript
import { getCacheStats } from './services/jupiter-cache-manager';
const stats = await getCacheStats();
// Returns: { sports: { age: 45, eventCount: 25, isStale: false }, ... }
```

### Check Rate Limiter (code)
```typescript
import { jupiterRateLimiter } from './services/jupiter-rate-limiter';
const status = jupiterRateLimiter.getStatus('sports');
// Returns: { requestsThisMinute: 5, requestsThisHour: 120, queueLength: 0, ... }
```

---

## 🔧 Manual Cache Control

### Invalidate Cache
```typescript
import { invalidateCategoryCache } from './services/jupiter-cache-manager';
await invalidateCategoryCache('sports');
```

### Force Refresh
```typescript
import { getCachedJupiterEvents } from './services/jupiter-cache-manager';
const { events } = await getCachedJupiterEvents('sports', { forceRefresh: true });
```

### Pre-Warm All Caches
```typescript
import { preWarmCategoryCaches } from './services/jupiter-cache-manager';
await preWarmCategoryCaches();
```

---

## 📁 File Reference

### New Services
| File | Purpose |
|------|---------|
| `jupiter-cache-manager.ts` | Category-specific caching with smart TTLs |
| `jupiter-rate-limiter.ts` | Rate limiting with retry & circuit breaker |
| `market-event-bus.ts` | Single-fetch → broadcast pattern |
| `signal-invalidation.ts` | Event-driven cache invalidation |
| `realtime-price-monitor.ts` | 15-second price polling |
| `llm-cache.ts` | LLM response caching |
| `parallel-analysis.ts` | Parallel market analysis |
| `mock-jupiter.ts` | Test mode mock API |
| `jupiter-metrics.ts` | Usage metrics tracking |

### Modified Files
| File | Changes |
|------|---------|
| `polymarket-plugin.ts` | Integrated rate limiter |
| `market-service.ts` | Use new cache manager |
| `sports-agent.ts` | Added signal invalidation |
| `pipeline.ts` | Added LLM caching |
| `models.ts` | Added specialized models |
| `index.ts` | Startup integrations |

---

## ⚙️ Configuration (Code-Level)

### Cache TTLs
**File:** `jupiter-cache-manager.ts`
```typescript
CATEGORY_CACHE_CONFIGS = {
  sports: { ttlSeconds: 180 },     // 3 min
  crypto: { ttlSeconds: 120 },     // 2 min
  politics: { ttlSeconds: 600 },   // 10 min
  economics: { ttlSeconds: 900 },  // 15 min
}
```

### Rate Limits
**File:** `jupiter-rate-limiter.ts`
```typescript
CATEGORY_RATE_LIMITS = {
  sports: { maxPerMinute: 30, maxPerHour: 500 },
  crypto: { maxPerMinute: 20, maxPerHour: 300 },
  politics: { maxPerMinute: 20, maxPerHour: 300 },
  economics: { maxPerMinute: 15, maxPerHour: 200 },
}
```

### Price Monitor
**File:** `realtime-price-monitor.ts`
```typescript
DEFAULT_CONFIG = {
  pollIntervalMs: 15_000,         // 15 seconds
  cacheTtlMs: 30_000,             // 30 seconds
  stopLossCheckIntervalMs: 30_000,
  priceSpikeThreshold: 0.10,      // 10%
}
```

### LLM Cache
**File:** `llm-cache.ts`
```typescript
const LLM_CACHE_TTL = 30 * 60;              // 30 minutes
const SIMILARITY_THRESHOLD = 0.85;          // 85% similarity
const MAX_CACHE_ENTRIES = 500;
```

### Parallel Analysis
**File:** `parallel-analysis.ts`
```typescript
DEFAULT_CONFIG = {
  maxChunkSize: 3,            // 3 markets per LLM call
  maxConcurrent: 3,           // 3 concurrent LLM calls
  timeoutMs: 120_000,         // 2 minute timeout
}
```

---

## 🎯 Usage Examples

### Get Markets for Agent (Automatic Caching + Rate Limiting)
```typescript
import { getMarketsForAgent } from './services/market-event-bus';

// Fetches with caching, rate limiting, and broadcast
const events = await getMarketsForAgent('sports', { forceRefresh: false });
// Returns: { sports: [JupiterEvent, ...] }
```

### Parallel Market Analysis
```typescript
import { smartAnalyzeMarkets } from './services/parallel-analysis';

// Automatically chooses parallel vs sequential based on market count
const results = await smartAnalyzeMarkets(
  markets, signals, positions, portfolio,
  modelConfig, systemPrompt
);
```

### Invalidate on Signal Trigger
```typescript
import { invalidateOnThreshold } from './services/signal-invalidation';

// When agent detects significant signal change
await invalidateOnThreshold('sports', 'GDELT sentiment spike detected');
```

### Real-Time Price Monitoring (Automatic)
```typescript
import { realTimePriceMonitor } from './services/realtime-price-monitor';

// Started automatically on server boot
// Polls every 15 seconds for all registered positions
// Executes stop-loss immediately when triggered

// Manual position registration (usually automatic)
await realTimePriceMonitor.registerPosition({
  positionId: 'pos_123',
  marketId: 'market_456',
  // ... other fields
});
```

---

## 🧪 Testing

### Run with Mock Jupiter API
```bash
TEST_MODE=true npm run dev:api
```

Mock data includes:
- ✅ Sports markets (NBA, soccer, MMA)
- ✅ Crypto markets (BTC, ETH)
- ✅ Politics markets (elections)
- ✅ Economics markets (Fed rates)
- ✅ Positions and orderbooks

### Verify Caching
```bash
# Start server
npm run dev:api

# Watch logs for:
# [JupiterCache] Fetching fresh events for sports...
# [JupiterCache] Cached 25 events for sports (245ms)
# [JupiterCache] Serving stale data for sports (age: 180s)
```

### Verify Rate Limiting
```bash
# Make many requests rapidly
# Watch logs for:
# [JupiterRateLimiter] Attempt 1/4 failed for sports, retrying in 2000ms...
# [JupiterRateLimiter] Circuit breaker opened for sports (10s backoff)
```

---

## 📈 Expected Performance

### Without Optimizations
```
Agent tick (5 min):
  ├─ Fetch sports markets: 500ms (Jupiter API call)
  ├─ Fetch crypto markets: 450ms (Jupiter API call)
  ├─ Get signals: 200ms
  ├─ LLM research: 8000ms
  ├─ LLM analysis: 10000ms
  ├─ LLM decision: 5000ms
  └─ Check prices: 300ms (5 min old data)

Total: ~26 seconds, 2 Jupiter calls
```

### With Optimizations
```
Agent tick (5 min):
  ├─ Fetch markets: 50ms (CACHED ✨)
  ├─ Get signals: 30ms (CACHED ✨)
  ├─ LLM research: 2000ms (CACHED sometimes ✨)
  ├─ LLM analysis: 6000ms (PARALLEL ✨)
  ├─ LLM decision: 4000ms
  └─ Check prices: 15ms (15s old data ✨)

Total: ~12 seconds, 0-1 Jupiter calls
```

**Result: 2x faster, 50-100% fewer API calls** ✅

---

## 🆘 Troubleshooting

### Cache Not Working
```typescript
// Check cache stats
import { getCacheStats } from './services/jupiter-cache-manager';
console.log(await getCacheStats());

// Force invalidate
import { invalidateCategoryCache } from './services/jupiter-cache-manager';
await invalidateCategoryCache('sports');
```

### Rate Limiting Too Aggressive
```typescript
// Check rate limiter status
import { jupiterRateLimiter } from './services/jupiter-rate-limiter';
console.log(jupiterRateLimiter.getAllStatus());

// If circuit breaker is open, wait for it to close
// Or increase limits in jupiter-rate-limiter.ts
```

### Price Monitor Not Running
```typescript
import { realTimePriceMonitor } from './services/realtime-price-monitor';
console.log(realTimePriceMonitor.getStatus());
// Should show: { isRunning: true, monitoredPositions: N, ... }
```

### Mock API Not Activating
```bash
# Ensure TEST_MODE is set
echo $TEST_MODE  # Should output: true

# Check logs for:
# [MockJupiter] TEST_MODE enabled - applying mock Jupiter API
# [MockJupiter] Mock Jupiter API applied successfully
```

---

## 📚 Further Reading

- Full details: `OPTIMIZATION_SUMMARY.md`
- Architecture: Check `agents/sports-agent.ts` for integration example
- API Client: `plugins/polymarket-plugin.ts`
- Startup Flow: `index.ts`
