# AgentArena Backend Setup Guide

## Quick Start (Docker — Recommended)

```bash
# 1. Start PostgreSQL + Redis
docker compose up -d

# 2. Copy env file
cp .env.example .env
# Edit .env — at minimum set KIMI_API_KEY

# 3. Push DB schema
cd apps/api && bunx drizzle-kit push && cd ../..

# 4. Start backend
bun run dev:api

# 5. Test
curl http://localhost:3001/health
```

## Quick Start (Cloud Services)

```bash
# 1. Create Supabase project (free): https://supabase.com
# 2. Create Upstash Redis (free): https://upstash.com
# 3. Edit .env with your URLs:
DATABASE_URL=postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres
REDIS_URL=redis://default:[password]@[region].upstash.io:6379

# 4. Push DB schema
cd apps/api && bunx drizzle-kit push && cd ../..

# 5. Start backend
bun run dev:api
```

## Environment Variables

### Required (backend won't start without these)

| Variable | Where to get it | Free? |
|----------|----------------|-------|
| `DATABASE_URL` | Supabase or local Docker | Yes |
| `REDIS_URL` | Upstash or local Docker | Yes |
| `KIMI_API_KEY` | https://platform.moonshot.ai | Yes (free tier) |

### Required for trading

| Variable | Where to get it | Free? |
|----------|----------------|-------|
| `JUPITER_API_KEY` | https://portal.jup.ag | Yes (beta) |
| `PRIVY_APP_ID` | https://dashboard.privy.io | Yes (<500 MAU) |
| `PRIVY_APP_SECRET` | https://dashboard.privy.io | Yes (<500 MAU) |

### Optional (has fallbacks)

| Variable | Purpose | Fallback |
|----------|---------|----------|
| `OPENAI_API_KEY` | GPT-4o for decisions | Uses Kimi |
| `ANTHROPIC_API_KEY` | Claude for analysis | Uses Kimi |
| `ACLED_EMAIL` + `ACLED_KEY` | Conflict data | Skipped |
| `FRED_API_KEY` | Economic data | Skipped |
| `NASA_FIRMS_MAP_KEY` | Wildfire data | Skipped |
| `TWITTER_BEARER_TOKEN` | Social signals | Skipped |
| `SEARCH_API_KEY` | Web search (Brave) | GDELT search |

## API Keys Setup

### 1. Kimi (REQUIRED — cheapest LLM)
- Go to https://platform.moonshot.ai
- Create account, get API key
- Add to `.env`: `KIMI_API_KEY=sk-...`

### 2. Jupiter Predict (for trading)
- Go to https://portal.jup.ag
- Request API key for Prediction Markets
- Add to `.env`: `JUPITER_API_KEY=...`

### 3. Privy (for wallets)
- Go to https://dashboard.privy.io
- Create app, get App ID + Secret
- Add Solana to allowed chains
- Add to `.env`: `PRIVY_APP_ID=...` and `PRIVY_APP_SECRET=...`

### 4. Free Geo Data APIs
- **ACLED**: https://acleddata.com/ → Register → Get email + key
- **FRED**: https://fred.stlouisfed.org/docs/api/ → Register → Get key
- **NASA FIRMS**: https://firms.modaps.eosdis.nasa.gov/api/ → Get MAP_KEY

## Testing

```bash
# Run typecheck
bun run typecheck

# Start backend
bun run dev:api

# Test health endpoint
curl http://localhost:3001/health

# Test tRPC endpoints
curl http://localhost:3001/trpc/agent.list
curl http://localhost:3001/trpc/market.list
curl http://localhost:3001/trpc/feed.getRecent

# Test WebSocket (install websocat: cargo install websocat)
websocat ws://localhost:3002
# Then send: {"action":"subscribe","channel":"feed"}
```

## Minimum Viable Setup

If you just want to see the backend start:

```bash
# Only need these 3 env vars:
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agent_arena
REDIS_URL=redis://localhost:6379
KIMI_API_KEY=sk-your-key

# Start services
docker compose up -d
cd apps/api && bunx drizzle-kit push && cd ../..
bun run dev:api
```

The backend will start and serve API endpoints. Trading features require Jupiter + Privy keys.


```


bun run --env-file=../../.env test-agent-tick.ts crypto
bun run --env-file=../../.env test-data-sources.ts
