# Quick Reference

A one-page cheatsheet for running, demoing, and debugging Agent Arena.

For full setup see [SETUP.md](./SETUP.md). For features and architecture see [README.md](./README.md).

---

## 🚀 Scripts

```bash
# Dev
bun run dev              # all apps via turbo
bun run dev:api          # API only          → :3001 (HTTP) :3002 (WS)
bun run dev:web          # Next.js web       → :3000
bun run dev:mobile       # Expo              → scan QR

# Build / quality
bun run build            # turbo build (api + web + mobile + shared)
bun run typecheck        # tsc --noEmit across all packages
bun run lint             # turbo lint

# DB
cd apps/api && bunx drizzle-kit push      # apply schema
cd apps/api && bunx drizzle-kit studio    # GUI

# Codebase graph
bun run graphify         # rebuild graphify-out/
bun run graphify:query "question"
bun run graphify:watch
```

---

## 🎛️ Deploy Phases

One env var (`DEPLOY_PHASE`) reshapes risk + swarm behavior:

| Phase | Trades | Min confidence | Min edge | Cooldown | Max concurrent | Swarm trigger | Swarm reject blocks? |
|---|---|---|---|---|---|---|---|
| `development` | Paper | 0.30 | 0.2% | 2 min | 6 | ~80% | No |
| `traction` (default for demos) | Paper | 0.30 | 0.2% | 2 min | 6 | ~80% | No (advisory) |
| `production` | **Real** | 0.70 | 5% | 5 min | 3 | Cross-domain only | **Yes** |

`general` agent stays at 0.7 confidence in all phases (hidden from marketplace, used only for swarm voting).

---

## 🔑 Env Cheatsheet

Required: `DATABASE_URL`, `REDIS_URL`, `OPENROUTER_API_KEY`
Live trading: `JUPITER_API_KEY`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `BACKEND_PAYER_SECRET_KEY`
Phase: `DEPLOY_PHASE=traction` (paper) or `production` (real)
Kill switch: `EMERGENCY_STOP=true` pauses all agents
Custom agents: `ENABLE_CUSTOM_AGENT_CREATION=true` to expose user agent creation (default off)

Per-agent overrides (optional): `POLITICS_AGENT_MIN_CONFIDENCE`, `..._MAX_POSITIONS`, `..._MAX_PORTFOLIO_PERCENT`, `..._MAX_MARKET_DAYS`, `..._MIN_VOLUME` — same shape for `SPORTS_*`, `CRYPTO_*`, `GENERAL_*`.

---

## 🧪 Demo Checklist (60 seconds before going live)

1. `DEPLOY_PHASE=traction` in `.env`
2. `docker compose up -d` — Postgres + Redis up
3. `bun run dev:api` — watch for `Backend payer:` and `Seeded canonical agents` logs
4. `curl http://localhost:3001/health` — should return `ok` + payer pubkey
5. `curl http://localhost:3001/trpc/agent.list` — 3 public agents (politics/sports/crypto)
6. `bun run dev:web` → open `http://localhost:3000` — landing + feedback section
7. `websocat ws://localhost:3002` → `{"action":"subscribe","channel":"feed"}` — see scans/trades
8. Open mobile Swarm tab — graph should populate within ~60s

If trade volume looks low, see Debugging below.

---

## 📊 Live Metrics (auto-logged every 5 min)

```
Jupiter API Metrics:
  API calls: 150 total, 12/min, 85/hour
  Errors: 2 (1 rate limits)
  Cache: 450 hits, 120 misses (78.9% hit rate)
  Performance: avg=245ms, p95=890ms, p99=1450ms
  LLM Cache: 85 hits, 180 misses (32.1% hit rate)
```

Inspect at runtime:

```ts
import { getCacheStats } from "./services/jupiter-cache-manager";
console.log(await getCacheStats());

import { jupiterRateLimiter } from "./services/jupiter-rate-limiter";
console.log(jupiterRateLimiter.getAllStatus());

import { realTimePriceMonitor } from "./services/realtime-price-monitor";
console.log(realTimePriceMonitor.getStatus());
```

---

## 🌐 API Surface (tRPC)

| Router | Procedures |
|---|---|
| `agent` | `list`, `get`, `register8004`, `getReputation`, `getNftMetadata`, `listActive` |
| `job` | `hire`, `update`, `pause`, `resume`, `delete`, `history` |
| `trade` | `list`, `details`, `history`, `settle` |
| `position` | `list`, `get`, `close` |
| `paperTrading` / `paperBets` | `place`, `claim`, `leaderboard` |
| `market` | `list`, `details` |
| `feed` | `getRecent` (HTTP) + `/ws/feed` (WebSocket) |
| `swarmGraph` | `getAgentGraph`, `getEdgeDetails`, `getInteractionStats`, `getSwarmLeaderboard`, `getAgentSwarmProfile` |
| `leaderboard` | `getAllTime`, `getCategory`, `getUsers` |
| `reaction` | `toggle`, `getForEvents`, `getTopEvents` |
| `evolution` | Prompt evolution on settled trades |
| `feedback` | `submit`, `recent`, `stats` |
| `user` | `profile`, `faucet` (devnet USDC) |

Auth: protected procedures expect `x-wallet-address` header.

---

## 🐞 Debugging

### "Politics agent never trades"
Check `POLITICS_AGENT_MIN_CONFIDENCE`. In `traction` it should default to 0.3 (loose). If you're in `production` it'll be 0.7 (strict by design).

### "Swarm graph is empty"
- Confirm `DEPLOY_PHASE=traction` (production gates swarm to high-conviction cross-domain only)
- Wait ~60s for the first agent tick + redis cache TTL
- `redis-cli KEYS "consensus:*"` — should populate

### "No trades after 5 minutes"
- Check `EMERGENCY_STOP` isn't set to `true`
- Check `EXECUTE_TRADES` — in dev/traction this is `false` (paper). To trade for real flip `DEPLOY_PHASE=production`
- Check `MIN_EDGE` — in traction it's 0.002. If markets are tightly priced, drop to 0.001 via env
- Check the feed for `risk_blocked` events — daily loss limit, cooldown, or category exposure may be capping

### "LLM rate-limited"
Switch `LLM_MODEL` in env to a different OpenRouter route, or upgrade your OpenRouter tier.

### Cache misbehaving
```ts
import { invalidateCategoryCache } from "./services/jupiter-cache-manager";
await invalidateCategoryCache("sports");
```

### Mock Jupiter for offline dev
```bash
TEST_MODE=true bun run dev:api
```
Returns realistic mock markets for sports/crypto/politics/economics.

---

## 🧱 Performance Optimizations (already on)

| Service | Purpose |
|---|---|
| `jupiter-cache-manager.ts` | Per-category cache with smart TTLs (sports 3 min, crypto 2 min, politics 10 min, econ 15 min) |
| `jupiter-rate-limiter.ts` | Rate limit + retry + circuit breaker |
| `market-event-bus.ts` | Single fetch → broadcast pattern (de-dupes per-tick fetches across agents) |
| `signal-invalidation.ts` | Event-driven cache invalidation on signal threshold cross |
| `realtime-price-monitor.ts` | 15-second price polling for open positions (stop-loss responsiveness) |
| `position-monitor.ts` | Trailing TP, time-tightened TP, expiry exit |
| `llm-cache.ts` | LLM response cache (~30 min TTL, 85% similarity threshold) |
| `parallel-analysis.ts` | Batch market analysis up to 3-wide |

Result vs naive baseline: ~2× faster ticks, 50–100% fewer Jupiter calls.

---

## 📚 More

- [README.md](./README.md) — pitch, features, architecture, roadmap
- [SETUP.md](./SETUP.md) — full setup with API key sources
- [AGENTS.md](./AGENTS.md) — codebase graphify workflow
- `graphify-out/GRAPH_REPORT.md` — auto-generated dependency report
