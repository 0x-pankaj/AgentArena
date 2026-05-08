# Agent Arena — Setup Guide

This is the full setup guide. For a 60-second TL;DR see the [README](./README.md#demo-quick-win-60-seconds).

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3.8
- [Docker](https://docs.docker.com/get-docker/) (for local PostgreSQL + Redis)
- A free [OpenRouter](https://openrouter.ai) account (LLM)
- A [Privy](https://dashboard.privy.io) app (agentic wallets)
- A [Jupiter](https://portal.jup.ag) Predict API key (prediction-market trading)

Optional but recommended for richer signals: ACLED, FRED, NASA FIRMS, Reddit, Twitter (all free tiers).

---

## Quick Start (Docker — recommended)

```bash
# 1. Start PostgreSQL + Redis
docker compose up -d

# 2. Configure env
cp .env.example .env
# Edit .env — at minimum set OPENROUTER_API_KEY (others have safe defaults locally)

# 3. Push DB schema
cd apps/api && bunx drizzle-kit push && cd ../..

# 4. Start everything
bun run dev          # all apps via turbo
# or run individually:
bun run dev:api      # API server (http://localhost:3001)
bun run dev:web      # Web (http://localhost:3000)
bun run dev:mobile   # Expo (scan QR)

# 5. Verify
curl http://localhost:3001/health
curl http://localhost:3001/trpc/agent.list
```

---

## Quick Start (Cloud)

```bash
# 1. Create Supabase Postgres (free): https://supabase.com
# 2. Create Upstash Redis (free):     https://upstash.com
# 3. Edit .env:
DATABASE_URL=postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres
REDIS_URL=redis://default:[password]@[region].upstash.io:6379

# 4. Push schema and start
cd apps/api && bunx drizzle-kit push && cd ../..
bun run dev:api
```

---

## Environment Variables

### Required (backend won't start without these)

| Variable | What it's for | Where to get it |
|---|---|---|
| `DATABASE_URL` | Postgres connection | Supabase or local Docker |
| `REDIS_URL` | Cache + pub/sub | Upstash or local Docker |
| `OPENROUTER_API_KEY` | LLM (Qwen 3.6 Plus, primary) | https://openrouter.ai |

### Required for live trading + wallets

| Variable | What it's for | Where to get it |
|---|---|---|
| `JUPITER_API_KEY` | Prediction-market execution | https://portal.jup.ag |
| `PRIVY_APP_ID` | Agentic wallet creation | https://dashboard.privy.io |
| `PRIVY_APP_SECRET` | Privy server SDK auth | https://dashboard.privy.io |
| `BACKEND_PAYER_SECRET_KEY` | Devnet payer for 8004 mints + ATOM (base64) | `solana-keygen new` then encode |

### Deploy phase (controls risk gates + paper-vs-real trading)

| Variable | Values | Effect |
|---|---|---|
| `DEPLOY_PHASE` | `development` \| `traction` \| `production` | Loosens/tightens risk gates and swarm-trigger rate. See README §Deploy Phases. |
| `EXECUTE_TRADES` | `true` \| `false` | Force-enable/disable real on-chain trades (default: `true` only when `DEPLOY_PHASE=production`). |
| `EMERGENCY_STOP` | `true` \| `false` | Emergency kill switch — pauses all agent loops. |
| `ENABLE_CUSTOM_AGENT_CREATION` | `true` \| `false` | Gates user-created agents (default off — only canonical agents shown). |

### Optional data sources (signals — fail silently if missing)

| Variable | Source | Used by |
|---|---|---|
| `ACLED_EMAIL` + `ACLED_KEY` | Conflict + protest events | General, Politics |
| `FRED_API_KEY` | US macro / Fed data | Politics, Crypto |
| `NASA_FIRMS_MAP_KEY` | Wildfire detections | General |
| `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` | Social sentiment | Crypto, Sports |
| `TWITTER_BEARER_TOKEN` | Social sentiment | Crypto, Politics |
| `SEARCH_API_KEY` | Web search (Brave) | All — fallback to GDELT search |

### Per-agent overrides (optional — only set if you want to tune live)

```
POLITICS_AGENT_MIN_CONFIDENCE=0.3
POLITICS_AGENT_MAX_POSITIONS=6
POLITICS_AGENT_MAX_PORTFOLIO_PERCENT=0.12
POLITICS_AGENT_MAX_MARKET_DAYS=30
POLITICS_AGENT_MIN_VOLUME=1000
# Same shape for SPORTS_*, CRYPTO_*, GENERAL_*
```

In `traction` mode the defaults already mirror the loose `AGENT_LIMITS` for politics/sports/crypto. Set these only if you want a non-default override.

### Frontend env

`apps/web/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

`apps/mobile/.env`:
```
EXPO_PUBLIC_API_URL=http://localhost:3001
EXPO_PUBLIC_PRIVY_APP_ID=your_privy_app_id
```

---

## API Keys — Setup

### 1. OpenRouter (REQUIRED — LLM)

- Sign up at https://openrouter.ai
- Create an API key
- Add to `.env`: `OPENROUTER_API_KEY=sk-or-...`
- The default model is **Qwen 3.6 Plus** (`qwen/qwen3.6-plus`) — change via `LLM_MODEL` env if you want.

### 2. Jupiter Predict (live trading)

- Apply at https://portal.jup.ag
- Add to `.env`: `JUPITER_API_KEY=...`
- Without this key you can still run **paper trading** — the simulator uses real Jupiter prices but doesn't submit orders.

### 3. Privy (agentic wallets)

- Create app at https://dashboard.privy.io
- Enable **Solana** in allowed chains
- Enable **server wallets** (agentic)
- Add to `.env`: `PRIVY_APP_ID=...` `PRIVY_APP_SECRET=...`

### 4. Backend payer (devnet)

```bash
solana-keygen new -o ./backend-payer.json
# Fund it on devnet
solana airdrop 2 -k ./backend-payer.json --url devnet
# Encode as base64 for the env var
base64 -w0 ./backend-payer.json
# Paste into .env: BACKEND_PAYER_SECRET_KEY=<base64>
```

### 5. Free signal APIs (optional, recommended)

- **ACLED**: register at https://acleddata.com → email + key
- **FRED**: register at https://fred.stlouisfed.org/docs/api/ → key
- **NASA FIRMS**: https://firms.modaps.eosdis.nasa.gov/api/ → MAP_KEY
- **Reddit**: https://www.reddit.com/prefs/apps → script app
- **Twitter**: https://developer.twitter.com → bearer token

---

## Database

```bash
# Apply schema (idempotent — safe to re-run)
cd apps/api && bunx drizzle-kit push

# Open Drizzle Studio (GUI for the DB)
cd apps/api && bunx drizzle-kit studio
```

The seed runs automatically on API boot — it ensures the 3 canonical public agents (Crypto, Politics, Sports) and 1 hidden voter (General) exist.

---

## Verification

```bash
# Backend
curl http://localhost:3001/health
curl http://localhost:3001/trpc/agent.list
curl http://localhost:3001/trpc/feed.getRecent

# Live feed via WebSocket (install: cargo install websocat)
websocat ws://localhost:3002
> {"action":"subscribe","channel":"feed"}
```

You should see:
- A `payer` field in `/health` showing your devnet payer pubkey + SOL balance
- 3 agents in `agent.list` (politics, sports, crypto — general is hidden)
- Feed events streaming as agents tick (every 5 minutes)

---

## Minimum Viable Setup

If you just want the backend booting and trading on paper:

```bash
# .env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agent_arena
REDIS_URL=redis://localhost:6379
OPENROUTER_API_KEY=sk-or-...
DEPLOY_PHASE=traction
EXECUTE_TRADES=false

# Boot
docker compose up -d
cd apps/api && bunx drizzle-kit push && cd ../..
bun run dev:api
```

Trades will be paper-only and use simulated balances. Watch the feed (WebSocket or `feed.getRecent`) — agents start ticking within ~30 seconds.

---

## Common Issues

### "no such file or directory: backend-payer.json"
The 8004/ATOM features need a payer keypair. Either generate one (see step 4 above) or run with `DEPLOY_PHASE=development` — on-chain features become best-effort and fail silently.

### "Backend payer has 0 SOL"
Run `solana airdrop 2 -k ./backend-payer.json --url devnet` (devnet only). On mainnet, fund the wallet manually.

### "Agents are running but no trades"
Check `DEPLOY_PHASE`. In `production` mode the gates are strict (0.7 confidence, 5% edge) and few markets pass. Use `traction` for demos — see README §Deploy Phases.

### "Web can't reach API"
Set `NEXT_PUBLIC_API_URL` in `apps/web/.env.local`. CORS is open in dev.

### Mobile Expo can't reach API on a real device
Use your machine's LAN IP, not `localhost`: `EXPO_PUBLIC_API_URL=http://192.168.x.x:3001`.

---

## Next steps

- [README.md](./README.md) — feature overview + architecture
- [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) — env cheatsheet, common scripts, debugging tricks
- [AGENTS.md](./AGENTS.md) — graphify workflow for codebase navigation
