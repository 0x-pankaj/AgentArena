# AgentArena — Final Architecture & Hackathon Plan

> **Solana Colosseum Spring 2026** | 19-Day Solo Sprint (March 22 → April 10) | Target: AI Track ($25K) + Mobile Award ($25K)

---

## 1. Executive Summary

**AgentArena** — decentralized marketplace on Solana where users hire specialized AI agents to trade on prediction markets. Full transparency public live feed shows every agent decision.

| Constraint | Decision |
|-----------|----------|
| Developer | Solo |
| Frontend | React Native (Expo) for Solana Seeker dApp Store |
| Backend | Bun + Hono + tRPC |
| Smart Contracts | 2 Anchor programs (Registry + Escrow) |
| Agents | Geo Agent fully functional, Politics/Sports as placeholders |
| Trading | Live with real USDC on Jupiter Predict API |
| LLM | Kimi K2.5 ($0.60/$3.00 per 1M, built-in `$web_search` at $0.005/call) |
| Public Feed | Full transparency (reasoning, trades, data analysis visible to all) |
| Timeline | 19 days build (March 22 → April 10), then marketing until May 11 Colosseum submission |

**Core Differentiators:**
- Only prediction market AI agent platform on Solana
- Full transparency — every agent reasoning step is public
- Domain-specific AI (Geo Agent) — not a generic trading bot
- Seeker-native mobile app with MWA
- On-chain verifiable agent performance
- Revenue model from day 1 (2% platform fee)

---

## 2. Prediction Market Integration

### 2.1 Three Paths

| Approach | Chain | Role |
|----------|-------|------|
| **Jupiter Predict API** | Solana (keeper handles cross-chain) | PRIMARY |
| **Drift Protocol BET** | Solana-native | SECONDARY |
| **Polymarket CLOB API** | Polygon (direct) | FALLBACK |

### 2.2 Jupiter Predict API (PRIMARY)

```
Base URL:    https://api.jup.ag/prediction/v1/
Docs:        https://prediction-market-api.jup.ag/docs
Auth:        x-api-key header (from portal.jup.ag)
Status:      BETA
Geo Block:   US and South Korea IPs
Settlement:  JupUSD or USDC on Solana
```

**Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/events` | GET | List events (filter: category, sortBy, includeMarkets) |
| `/events/search` | GET | Search events by keyword |
| `/events/{eventId}` | GET | Event details with all markets |
| `/markets/{marketId}` | GET | Market details + pricing |
| `/orderbook/{marketId}` | GET | Orderbook depth |
| `/orders` | POST | **Create buy order** |
| `/orders/{orderPubkey}` | GET | Check order status |
| `/positions` | GET | List positions |
| `/positions/{pubkey}` | DELETE | Close/sell position |
| `/positions/{pubkey}/claim` | POST | Claim payout |
| `/history` | GET | Transaction history |
| `/trading-status` | GET | Check if exchange is trading |

**Categories**: crypto, sports, politics, esports, culture, economics, tech, finance, climate & science
**Providers**: polymarket (default), kalshi

**Create Order:**
```json
{
  "ownerPubkey": "string",
  "marketId": "string",
  "isYes": true,
  "isBuy": true,
  "depositAmount": "2000000",
  "depositMint": "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD"
}
```
Response: base64 Solana tx, orderPubkey, positionPubkey. Sign and submit to Solana RPC.

**Limitations**: Buy-only (close via DELETE). Keeper fills orders (variable latency). Winnings auto-claimed after 24h. Variable fees based on price/uncertainty.

### 2.3 Drift Protocol BET (SECONDARY)

```
SDK:         @drift-labs/sdk
Type:        Perp markets with ContractType.PREDICTION
Margin:      100% (no leverage)
Prices:      Bounded [0, 1]
Resolution:  Drift security council multisig
Fees:        0.021%-0.035% taker
Data API:    https://data.api.drift.trade/stats/markets
WebSocket:   wss://dlob.drift.trade/ws
```

### 2.4 Data Fetching Strategy

| Data | Method | Source | Frequency |
|------|--------|--------|-----------|
| Market prices | WebSocket | Polymarket CLOB WS (`wss://ws-subscriptions-clob.polymarket.com/ws/market`) | Real-time push |
| Order book | WebSocket | Same CLOB WS | Real-time push |
| Drift prices | WebSocket | DLOB WS (`wss://dlob.drift.trade/ws`) | Real-time push |
| Market discovery | REST | Jupiter Predict `/events` | Every 15 min |
| Agent positions | REST | Jupiter Predict `/positions` | Every 5 min |
| Geo data | REST | GDELT, ACLED, FRED | Every 15-30 min |
| Order execution | REST POST | Jupiter Predict `/orders` | On-demand |

**WebSocket**: PING every 10s (Polymarket req), exponential backoff reconnect (1s to 30s), re-subscribe on reconnect.

---

## 3. LLM & Web Search Strategy

### 3.1 LLM: Kimi K2.5

```
Model:       kimi-k2.5
Input:       $0.60 / 1M tokens
Output:      $3.00 / 1M tokens
Web Search:  $0.005 / call (built-in $web_search tool)
API:         OpenAI-compatible (baseURL: https://api.moonshot.ai/v1)
Context:     256K tokens
```

### 3.2 Decision Loop (Every 5 Minutes)

```
STEP 1: FETCH cheap signals (always, free)
  - Market prices from Redis cache (WebSocket-updated)
  - Order book from Redis cache
  - GDELT tone from Redis cache (updated every 15 min)
  - ACLED conflict score from Redis cache (updated every 30 min)
  - Agent's current positions from PostgreSQL

STEP 2: CHECK thresholds (deterministic, no LLM)
  - Price moved >5% since last analysis?       -> TRIGGER
  - GDELT tone spike >0.3?                     -> TRIGGER
  - ACLED conflict delta >50%?                 -> TRIGGER
  - New market appeared in category?            -> TRIGGER
  - Market resolution within 24 hours?          -> TRIGGER
  - Agent has open position + edge narrowed?    -> TRIGGER
  - NONE of above?                              -> SKIP (save cost)

STEP 3: LLM CALL (only if threshold triggered)
  - Model: Kimi K2.5
  - Tools: [{ type: "function", function: { name: "$web_search" } }]
  - Input: cached signals + market data + positions
  - Output: Zod-validated { action, marketId, isYes, amount, confidence, reasoning }
  - Guard: confidence must be > 0.7

STEP 4: EXECUTE (if action = buy or sell)
  - Jupiter Predict API (POST /orders or DELETE /positions)
  - Sign VersionedTransaction, submit to Solana
  - Push event to Redis Stream (public feed)
  - Update PostgreSQL positions table
```

### 3.3 Cost

| Item | Daily | 19-Day Total |
|------|-------|-------------|
| Kimi LLM calls (~30-50/day) | $0.40-1.20 | $8-23 |
| Kimi web search (~10-20/day) | $0.05-0.10 | $1-2 |
| Infrastructure | $0 | $0 |
| Solana tx | ~$0.05 | $1 |
| **Total** | **~$0.50-1.50** | **$10-30** |

---

## 4. Geo Agent Data Sources (All FREE)

| API | Purpose | URL | Auth | Rate Limit |
|-----|---------|-----|------|------------|
| **GDELT v2 DOC** | Global news + tone analysis | `api.gdeltproject.org/api/v2/doc/doc` | None | Unpublished |
| **ACLED** | Structured conflict events | `acleddata.com/api/acled/read` | Email + key | 5K rows/call |
| **FRED** | US macro indicators (840K+) | `api.stlouisfed.org/fred/series/observations` | Free key | Throttled |
| **NASA FIRMS** | Wildfire hotspots (satellite) | `firms.modaps.eosdis.nasa.gov/api/area/csv` | Free MAP_KEY | 5K/10min |
| **USGS Earthquake** | Seismic events | `earthquake.usgs.gov/fdsnws/event/1/query` | None | 20K/query |
| **Climate TRACE** | GHG emissions | `api.climatetrace.org/v7/sources` | None | Low |
| **IMF DataMapper** | Country forecasts | `imf.org/external/datamapper/api/v1` | None | ~500ms |
| **World Bank** | 16K+ indicators | `api.worldbank.org/v2` | None | 15K/call |

**Pipeline**: GDELT (news tone) -> ACLED (conflict escalation) -> FRED (macro surprise) -> NASA FIRMS (disasters) -> LLM analysis -> Trade decision

---

## 5. Agent FSM (Finite State Machine)

```
+-------------------------------------------------------------+
|                    AGENTARENA FSM                            |
|                                                             |
|  +--------------+                                           |
|  |   IDLE       | <-------------------+                     |
|  +------+-------+                     |                     |
|         | user_hires                  | cycle_complete      |
|         v                             |                     |
|  +--------------+                     |                     |
|  |   SCANNING   | --no_markets--> IDLE|                     |
|  +------+-------+                     |                     |
|         | markets_found               |                     |
|         v                             |                     |
|  +--------------+                     |                     |
|  |   ANALYZING  | --no_edge-->SCANNING|                     |
|  +------+-------+                     |                     |
|         | edge_found                  |                     |
|         v                             |                     |
|  +--------------+                     |                     |
|  |   EXECUTING  | --fail-->SCANNING   |                     |
|  +------+-------+                     |                     |
|         | order_placed                |                     |
|         v                             |                     |
|  +--------------+                     |                     |
|  |   MONITORING | --sell_trigger--+   |                     |
|  +------+-------+                 |   |                     |
|         |                         v   |                     |
|         |                  +----------+|                     |
|         | position_closed  |  CLOSING  |                    |
|         v                  +----------+|                     |
|  +--------------+                      |                    |
|  |   SETTLING   |-----> IDLE           |                    |
|  +--------------+                      |                    |
|                                                             |
|  ANY STATE --stop_loss----> CLOSING                         |
|  ANY STATE --daily_limit---> IDLE (paused)                  |
+-------------------------------------------------------------+
```

### State Details

| State | Action | Transitions |
|-------|--------|-------------|
| **IDLE** | Wait for user to hire agent | -> SCANNING |
| **SCANNING** | Fetch markets from Jupiter Predict API. Filter: volume >$10K, category match, not resolved | -> ANALYZING or -> IDLE |
| **ANALYZING** | Check thresholds, LLM call if triggered, calculate edge | -> EXECUTING or -> SCANNING |
| **EXECUTING** | POST /orders, sign tx, submit to Solana, push to public feed | -> MONITORING or -> SCANNING |
| **MONITORING** | Every 5 min: check stop-loss, edge convergence, market resolution | -> CLOSING or stay |
| **CLOSING** | DELETE /positions, update PostgreSQL, push to feed | -> SETTLING or -> SCANNING |
| **SETTLING** | Claim payout, update PnL | -> IDLE |

### How FSM Prevents Bad Behavior

1. **Explicit transitions** — Agent cannot jump from IDLE to EXECUTING. Must go through SCANNING -> ANALYZING first.
2. **Hardcoded guards in every state:**
   - SCANNING: skip markets with volume < $10K
   - ANALYZING: skip if confidence < 70%
   - EXECUTING: skip if amount exceeds per-tx limit
   - MONITORING: auto-close if stop-loss hit
3. **No tools outside scope** — Agent can only: call Jupiter Predict API, call data APIs, read/write PostgreSQL. No browser, no file system, no arbitrary code.
4. **Deterministic transitions** — LLM is used for analysis within ANALYZING state, not for state transitions.

### Safety Guards (Hardcoded, Override LLM)

- Max 10% of portfolio per single market
- Max 25% exposure to single category
- Stop-loss at -15% per position
- Max 3 concurrent positions per agent
- 5-min cooldown between trades
- Daily loss limit: -5% of portfolio
- Only trade markets with >$10K volume
- Only trade markets settling within 7 days
- Confidence threshold: >70% to trade
- Positions >$500 require human approval

---

## 6. Position Management

**Storage**: PostgreSQL `positions` table (NO vector DB)

```sql
CREATE TABLE positions (
  id UUID PRIMARY KEY,
  job_id UUID REFERENCES jobs(id),
  market_id VARCHAR(100),
  market_question TEXT,
  side VARCHAR(10),          -- 'yes' or 'no'
  amount DECIMAL(18,6),
  entry_price DECIMAL(10,6),
  current_price DECIMAL(10,6),
  pnl DECIMAL(18,6),
  status VARCHAR(20),        -- 'open', 'closed', 'settled'
  reasoning_snippet TEXT,
  tx_signature VARCHAR(88),
  opened_at TIMESTAMP,
  closed_at TIMESTAMP
);
```

**Lifecycle**: BUY -> INSERT into positions -> HOLD (re-evaluate from scratch each iteration) -> SELL (edge gone, stop-loss, or resolution) -> UPDATE

**Key insight**: LLM does NOT need past reasoning. Re-evaluates from current market state every iteration. Same as PolyStrat.

**Sell triggers:**
1. Edge disappeared (LLM decides during ANALYZING state)
2. Stop-loss at -15% (hardcoded, auto-close)
3. Market resolves (auto-settle via Jupiter)
4. Daily loss limit hit (hardcoded, pause agent)

---

## 7. Public Live Feed (Full Transparency)

**Architecture**: Agent Action -> Redis Stream -> Fan-out Service -> Redis Pub/Sub -> WebSocket -> Mobile App

```
+----------------+     +-------------+     +----------------+     +-----------+     +------------+
| Agent Actions  |---->| Redis Stream|---->| Fan-out Service|---->| Redis     |---->| WebSocket  |
| (Producers)    |     | agent:events|     | (enrich,       |     | Pub/Sub   |     | -> Mobile  |
+----------------+     +-------------+     |  anonymize,    |     | channels  |     |   App      |
                              |            |  truncate)     |     +-----------+     +------------+
                       +------+------+     +----------------+
                       | Redis Stream|            |
                       | (persistence|     +------+-------+
                       |  + replay)  |     | Redis ZSET   |
                       +-------------+     | feed:recent  |
                                           | (cached)     |
                                           +--------------+
```

### What's Visible (Full Transparency)

```
"Geo Agent analyzed Middle East markets"
  - GDELT tone: -0.42 (negative spike detected)
  - ACLED: 3 conflict events in region (up 150% vs 7d avg)

"Geo Agent decided: BUY YES on 'Will ceasefire hold?'"
  - Reasoning: "Conflict escalation detected. Market underpricing
    ceasefire failure risk. Current YES: $0.62, estimate: $0.71 (9% edge)"
  - Confidence: 78%

"Geo Agent placed order: BUY YES, $25 USDC"
  - TX: 5xK9m... (Solana explorer link)
  - Order status: Pending keeper fill...

"Order filled at $0.63"
  - Position opened: 39.68 contracts YES @ $0.63
```

**Privacy**: User wallet addresses hidden. Agent display names used. Strategy parameters private. Everything else public.

### Event Schema

```typescript
interface AgentEvent {
  event_id: string;
  timestamp: string;
  agent_id: string;
  agent_display_name: string;
  category: 'analysis' | 'trade' | 'decision' | 'position_update' | 'reasoning';
  severity: 'info' | 'significant' | 'critical';
  content: {
    market_analyzed?: string;
    summary?: string;
    asset?: string;
    action?: 'buy' | 'sell';
    amount?: string;
    price?: string;
    decision?: string;
    reasoning_snippet?: string;
    pnl?: { value: number; percent: number };
  };
  display_message: string;
  is_public: boolean;
}
```

---

## 8. Leaderboard

**Architecture**: Redis ZSET (rankings) + Redis Hash (per-agent stats) + PostgreSQL (audit)

```
Every trade execution:
  -> ZADD leaderboard:pnl <total_pnl> <agent_id>
  -> HSET agent:stats:<agent_id> win_rate 0.72 sharpe 1.4 ...
  -> PUBLISH leaderboard:updates { agent_id, new_pnl, rank_change }
  -> WebSocket -> Mobile app (real-time rank update)
```

### Metrics

| Metric | Storage | Update Frequency |
|--------|---------|-----------------|
| Total PnL (primary rank) | Redis ZSET score | Every trade |
| Win rate | Redis Hash + PostgreSQL | Every trade |
| Sharpe ratio (30-day rolling) | Redis Hash | Every 15 min |
| Max drawdown | Redis Hash | Every trade |
| Current streak | Redis Hash | Every trade |
| Total trades | Redis Hash | Every trade |
| Category PnL | Redis ZSET (per-category) | Every trade |

### Leaderboard Views

| View | Redis Key | Description |
|------|-----------|-------------|
| All-time best | `lb:alltime` | Top agents by total PnL |
| Today's best | `lb:daily:2026-03-22` | Top agents by today's PnL |
| Geo category | `lb:category:geo` | Top geo agents |
| Politics category | `lb:category:politics` | Top politics agents |
| Sports category | `lb:category:sports` | Top sports agents |

### Mobile Display

```
Leaderboard
===========
#1  GeoAlpha-7      +$1,247  | 78% win | 34 trades
#2  ClimateHawk-3   +$892    | 71% win | 28 trades
#3  GeoStorm-12     +$634    | 65% win | 41 trades
#4  ConflictBot-5   +$421    | 69% win | 22 trades
#5  TerraWatch-9    +$318    | 62% win | 37 trades
---
Your Agent: #7  GeoAgent-X  +$187  | 67% win | 15 trades
```

---

## 9. Smart Contracts (2 Programs)

```
programs/
+-- agent-registry/     -- Agent identity, metadata, categories
+-- agent-escrow/       -- Payment escrow for hiring agents
```

### Agent Registry Program

```
PDA:          ["agent", owner_pubkey]
Instructions: register_agent, update_agent, deactivate_agent, verify_agent

AgentProfile {
  authority: Pubkey,
  name: String,
  category: AgentCategory,    // Geo=0, Politics=1, Sports=2
  description: String,
  pricing_model: PricingModel,
  capabilities: Vec<String>,
  is_active: bool,
  is_verified: bool,
  registration_time: i64,
  bump: u8,
}
```

### Agent Escrow Program

```
PDA:          ["job", client_pubkey, job_id]
State Machine: Created -> Funded -> Active -> Completed -> Released
                            -> Disputed -> Resolved

Instructions:
  create_job        - Transfer USDC to PDA vault
  activate_job      - Agent accepts
  complete_job      - Agent marks deliverable complete
  approve_release   - Client approves, PDA-signed transfer to agent
  dispute           - Either party initiates dispute
  resolve_dispute   - Arbitrator resolves

JobState {
  client: Pubkey,
  agent: Pubkey,
  job_id: u64,
  amount: u64,
  status: JobStatus,
  created_at: i64,
  bump: u8,
}
```

**Deferred**: Revenue sharing, reputation, staking -> tracked in PostgreSQL for demo, on-chain later.

---

## 9B. Wallet Architecture (Privy Embedded Wallets)

### Problem
User hires 5 agents. Each agent needs to trade. User should NEVER share their private key.

### Solution: Privy Embedded Wallets

| Question | Answer |
|----------|--------|
| Does user need email per agent? | NO — user logs in ONCE. Agent wallets created server-side. |
| User notice agent wallet creation? | NO — happens silently in backend. |
| Top-level wallet needed? | YES — either Phantom (MWA) OR Privy-created (email login) |
| User without wallet app? | Privy email login creates wallet automatically. |
| How are agent wallets funded? | User approves ONE transfer from top-level wallet to agent wallet |

### Two Login Paths

**Path A: User has Phantom/Solflare**
```
Connect Wallet (MWA) → Fund from Phantom → Hire agents → Agent wallets created silently
```

**Path B: User has NO wallet app**
```
Sign in with Email (Privy) → Privy creates main wallet → Fund via on-ramp → Hire agents → Agent wallets created silently
```

### Wallet Architecture

```
User's Top-Level Wallet (Phantom or Privy-created)
    │
    ├── USDC transfer ──→ Privy Agent Wallet #1 (Geo Agent)
    │                     - Created by backend via Privy API
    │                     - Policy: $500/day, Jupiter only, USDC+SOL only
    │                     - Agent trades via Privy signing API
    │
    ├── USDC transfer ──→ Privy Agent Wallet #2 (Politics Agent)
    │                     - Same policies
    │
    └── USDC transfer ──→ Privy Agent Wallet #3 (Sports Agent)
                          - Same policies
```

### Privy Integration Points

| Component | How |
|-----------|-----|
| User auth | Privy React Native SDK (email/social login) or MWA (existing wallet) |
| Main wallet | Created automatically by Privy on first login |
| Agent wallet creation | Backend Privy API (`POST /api/v1/wallets`) with policies |
| Agent wallet funding | User approves SPL token transfer to agent's wallet address |
| Agent trading | Backend calls Privy signing API to sign Jupiter Predict transactions |
| Profit withdrawal | Agent wallet transfers USDC back to user's main wallet |

### Privy Policies (Per Agent Wallet)

```json
{
  "policy": {
    "solana": {
      "allowedPrograms": [
        "Jupiter Predict program ID",
        "SPL Token program",
        "System program"
      ],
      "maxAmountPerTransaction": 500000000,
      "allowedTokens": ["USDC mint", "SOL"],
      "maxTransactionsPerDay": 50
    }
  }
}
```

### Cost
- Privy: FREE for <500 MAUs (hackathon)
- Acquired by Stripe (2025) — production-grade infrastructure

---

## 10. Tech Stack

### Frontend (Mobile Only)

| Layer | Tech | Why |
|-------|------|-----|
| Framework | React Native + Expo (custom dev build) | Solana Seeker dApp Store requires Android APK |
| Wallet | Mobile Wallet Adapter (MWA) + Privy React Native SDK | MWA for Phantom/Solflare, Privy for email/social login |
| Auth | Privy (email/social) + MWA (existing wallet) | Two paths: wallet users + non-wallet users |
| State | Zustand + TanStack Query | Client state + server state caching |
| UI | NativeWind (Tailwind for RN) | Faster than Tamagui for solo dev, familiar CSS-like syntax |
| Charts | react-native-chart-kit | Lightweight, works well |
| Real-time | WebSocket (wsLink via tRPC) | Live trade feeds, agent decisions, prices |
| Navigation | Expo Router (file-based) | Simple, familiar to Next.js devs |

### Backend

| Layer | Tech | Why |
|-------|------|-----|
| Runtime | Bun | Faster than Node, native WebSocket, built-in bundler |
| API | Hono + tRPC | Lightweight, type-safe, edge-compatible |
| Wallet | Privy Server SDK | Create agent wallets, sign transactions server-side |
| Agents | LangGraph.js + SendAI SAK V2 | Multi-agent orchestration + 60+ Solana actions |
| Queue | BullMQ + Redis | Trade execution queue, rate limit handling |
| DB | PostgreSQL + Drizzle ORM | Type-safe queries, serverless-friendly |
| Cache | Redis | Market data, session store, leaderboard |
| RPC | Helius | Indexing, webhooks, reliable Solana RPC |
| LLM | Kimi K2.5 (OpenAI-compatible) | Cheap, capable, built-in web search |

### Smart Contracts

| Layer | Tech |
|-------|------|
| Framework | Anchor v0.31+ |
| Language | Rust |
| Testing | LiteSVM + Bankrun |

### Infrastructure

| Layer | Tech |
|-------|------|
| Hosting | Railway (backend) |
| DB | Supabase (serverless Postgres) |
| Redis | Upstash (serverless Redis) |
| CI/CD | GitHub Actions |
| Monitoring | Sentry |
| Android Build | Expo EAS Build |

### tRPC Compatibility (React Native + Future Web)

| Feature | React Native | Next.js (future) |
|---------|-------------|-----------------|
| httpBatchLink (queries/mutations) | Works | Works |
| wsLink (WebSocket subscriptions) | Native WS, no polyfill | Works |
| httpBatchStreamLink | Needs ReadableStream polyfill | Works |
| httpSubscriptionLink (SSE) | Needs EventSource polyfill | Works |
| useQuery/useMutation hooks | Works | Works |

**Shared router**: `packages/api/routers/` - platform-agnostic, works on both platforms.

---

## 11. Monorepo Structure

```
agent-arena/
+-- apps/
|   +-- mobile/                 # React Native (Expo) - Seeker dApp Store
|   |   +-- app/                # Expo Router screens
|   |   |   +-- (tabs)/
|   |   |   |   +-- index.tsx   # Agent Marketplace
|   |   |   |   +-- explore.tsx # Market Explorer
|   |   |   |   +-- feed.tsx    # Public Live Feed
|   |   |   |   +-- portfolio.tsx # Portfolio / Active Jobs
|   |   |   |   +-- profile.tsx # User Profile
|   |   |   +-- agent/[id].tsx  # Agent Detail + Hire
|   |   |   +-- job/[id].tsx    # Job Detail + Live Trades
|   |   |   +-- leaderboard.tsx # Leaderboard
|   |   |   +-- _layout.tsx     # Root layout with wallet provider
|   |   +-- components/
|   |   +-- hooks/
|   |   +-- stores/
|   |   +-- package.json
|   |
|   +-- api/                    # Bun + Hono + tRPC backend
|       +-- src/
|       |   +-- routers/        # tRPC routers
|       |   |   +-- agent.ts
|       |   |   +-- market.ts
|       |   |   +-- trade.ts
|       |   |   +-- job.ts
|       |   |   +-- user.ts
|       |   |   +-- leaderboard.ts
|       |   +-- services/       # Business logic
|       |   +-- agents/
|       |   |   +-- supervisor.ts
|       |   |   +-- geo-agent.ts       # FULLY BUILT
|       |   |   +-- politics-agent.ts  # Stub
|       |   |   +-- sports-agent.ts    # Stub
|       |   |   +-- fsm.ts             # FSM state machine
|       |   |   +-- strategy-engine.ts # Signal analysis + LLM
|       |   |   +-- execution-engine.ts # Jupiter Predict + Drift
|       |   +-- plugins/
|       |   |   +-- polymarket-plugin.ts  # Jupiter Predict API wrapper
|       |   |   +-- prediction-plugin.ts  # Market analysis
|       |   |   +-- risk-plugin.ts        # Position sizing + limits
|       |   |   +-- drift-bet-plugin.ts   # Drift BET integration
|       |   +-- data-sources/
|       |   |   +-- gdelt.ts
|       |   |   +-- acled.ts
|       |   |   +-- fred.ts
|       |   |   +-- nasa-firms.ts
|       |   +-- db/             # Drizzle schema + migrations
|       |   +-- ws/             # WebSocket handlers
|       |   +-- feed/           # Public feed (Redis Stream -> Pub/Sub)
|       |   +-- leaderboard/    # Redis ZSET rankings
|       |   +-- utils/
|       +-- package.json
|
+-- packages/
|   +-- shared/                 # Shared types, constants
|   +-- sdk/                    # Anchor-generated TypeScript client
|
+-- programs/
|   +-- agent-registry/
|   +-- agent-escrow/
|
+-- turbo.json
+-- package.json
+-- bun.lockb
```

---

## 12. Database Schema (PostgreSQL)

```sql
-- Users
CREATE TABLE users (
  wallet_address VARCHAR(44) PRIMARY KEY,
  username VARCHAR(50) UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Agents
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_address VARCHAR(44) NOT NULL REFERENCES users(wallet_address),
  on_chain_address VARCHAR(44),
  name VARCHAR(100) NOT NULL,
  category VARCHAR(20) NOT NULL CHECK (category IN ('geo', 'politics', 'sports')),
  description TEXT,
  pricing_model JSONB NOT NULL,
  capabilities TEXT[],
  strategy_config JSONB,
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Jobs (Hiring sessions)
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_address VARCHAR(44) NOT NULL REFERENCES users(wallet_address),
  agent_id UUID NOT NULL REFERENCES agents(id),
  on_chain_job_id BIGINT,
  status VARCHAR(20) DEFAULT 'created',
  total_invested DECIMAL(18,6) DEFAULT 0,
  total_profit DECIMAL(18,6) DEFAULT 0,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Positions (Open trades)
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  market_id VARCHAR(100) NOT NULL,
  market_question TEXT NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('yes', 'no')),
  amount DECIMAL(18,6) NOT NULL,
  entry_price DECIMAL(10,6) NOT NULL,
  current_price DECIMAL(10,6),
  pnl DECIMAL(18,6),
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closed', 'settled')),
  reasoning_snippet TEXT,
  tx_signature VARCHAR(88),
  opened_at TIMESTAMP DEFAULT NOW(),
  closed_at TIMESTAMP
);

-- Trades (Completed trades, audit trail)
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  market_id VARCHAR(100) NOT NULL,
  market_question TEXT NOT NULL,
  side VARCHAR(10) NOT NULL,
  amount DECIMAL(18,6) NOT NULL,
  entry_price DECIMAL(10,6) NOT NULL,
  exit_price DECIMAL(10,6),
  outcome VARCHAR(10) CHECK (outcome IN ('win', 'loss', 'pending')),
  profit_loss DECIMAL(18,6),
  reasoning TEXT,
  executed_at TIMESTAMP DEFAULT NOW(),
  settled_at TIMESTAMP,
  tx_signature VARCHAR(88)
);

-- Agent Performance (Aggregated)
CREATE TABLE agent_performance (
  agent_id UUID PRIMARY KEY REFERENCES agents(id),
  total_trades INT DEFAULT 0,
  winning_trades INT DEFAULT 0,
  total_pnl DECIMAL(18,6) DEFAULT 0,
  win_rate DECIMAL(5,4) DEFAULT 0,
  sharpe_ratio DECIMAL(10,4),
  max_drawdown DECIMAL(10,4),
  total_volume DECIMAL(18,6) DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Market Data Cache
CREATE TABLE market_data (
  market_id VARCHAR(100) PRIMARY KEY,
  source VARCHAR(20) NOT NULL,
  category VARCHAR(20),
  question TEXT NOT NULL,
  outcomes JSONB NOT NULL,
  volume DECIMAL(18,6),
  liquidity DECIMAL(18,6),
  closes_at TIMESTAMP,
  resolved_at TIMESTAMP,
  result VARCHAR(20),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Feed Events (Public live feed, also in Redis Stream)
CREATE TABLE feed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id),
  agent_name VARCHAR(100),
  category VARCHAR(20),
  content JSONB NOT NULL,
  display_message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 13. API Design (tRPC Routes)

```typescript
// Agent routes
agent.list           -- List agents with filters (category, performance)
agent.get            -- Get agent details + performance
agent.create         -- Register new agent (owner only)
agent.update         -- Update agent config (owner only)
agent.getPerformance -- Get detailed performance metrics

// Job routes
job.create           -- Hire an agent (creates escrow)
job.get              -- Get job details + positions + trades
job.list             -- List user's jobs
job.cancel           -- Cancel active job
job.approve          -- Approve and release payment

// Trade/Position routes
position.list        -- List positions for a job
position.getActive   -- Get currently open positions
trade.list           -- List completed trades for a job
trade.get            -- Get trade details

// Market routes
market.list          -- List available markets
market.get           -- Get market details + odds
market.getTrending   -- Get trending markets by category
market.search        -- Search markets by keyword

// User routes
user.get             -- Get user profile
user.getPortfolio    -- Get user's portfolio across all jobs

// Leaderboard routes
leaderboard.getAllTime    -- Top agents all-time
leaderboard.getToday      -- Top agents today
leaderboard.getByCategory -- Top agents per category
leaderboard.getAgentRank  -- Specific agent's rank

// Feed routes
feed.getRecent       -- Get recent public feed events
feed.getByAgent      -- Get feed events for specific agent

// WebSocket events
ws:trade_executed    -- Real-time trade notification
ws:price_update      -- Market price updates
ws:position_update   -- Position PnL updates
ws:feed_event        -- New public feed event
ws:leaderboard_update -- Rank changes
ws:agent_decision    -- Agent reasoning broadcast
```

---

## 14. 19-Day Timeline (March 22 -> April 10)

### Week 1: Foundation (March 22-28)

| Day | Focus | Hours | Deliverables |
|-----|-------|-------|-------------|
| **Day 1** | Project Setup | 10h | Bun monorepo, Turborepo, Anchor project, Supabase + Upstash, GitHub |
| **Day 2** | Smart Contracts | 10h | Registry + Escrow programs, deploy to devnet |
| **Day 3** | Backend Core | 10h | Hono + tRPC, Drizzle schema, SIWS auth, Redis |
| **Day 4** | Jupiter Predict | 10h | API client, market discovery, order placement, position tracking |
| **Day 5** | Geo Data Sources | 10h | GDELT, ACLED, FRED API clients, Redis caching layer |
| **Day 6** | Geo Agent | 10h | FSM, Kimi K2.5 integration, decision loop, Zod validation, risk management |
| **Day 7** | Trade Pipeline | 10h | BullMQ, execution engine, position monitoring, stop-loss, WebSocket |

### Week 2: Mobile + Feed (March 29 - April 4)

| Day | Focus | Hours | Deliverables |
|-----|-------|-------|-------------|
| **Day 8** | React Native Setup | 10h | Expo custom build, MWA, Expo Router, NativeWind |
| **Day 9** | Agent Marketplace | 10h | Agent listing, agent detail, category filter, hire flow |
| **Day 10** | Job + Portfolio | 10h | Escrow payment flow, portfolio screen, active jobs, job detail |
| **Day 11** | Public Live Feed | 10h | Redis Streams + Pub/Sub, WebSocket, feed screen with full transparency |
| **Day 12** | Leaderboard + Charts | 10h | Redis ZSET rankings, leaderboard screen, PnL charts |
| **Day 13** | Smart Contract Integration | 10h | Mobile <-> on-chain programs, MWA transaction signing |

### Week 3: Polish + Ship (April 5-10)

| Day | Focus | Hours | Deliverables |
|-----|-------|-------|-------------|
| **Day 14** | Integration Testing | 10h | End-to-end: hire -> agent trades -> public feed -> profits |
| **Day 15** | Bug Fixes + Polish | 10h | Error handling, loading states, edge cases |
| **Day 16** | Deploy Backend | 10h | Railway deployment, env vars, monitoring |
| **Day 17** | Build APK | 10h | Expo EAS Build, test on real device |
| **Day 18** | Live Testing | 10h | Real USDC trades, verify public feed, fix issues |
| **Day 19** | Demo Prep | 10h | 3-minute pitch video, Colosseum submission materials |

### April 10 -> May 11: Marketing
- Twitter/X content showing live agent trades
- Demo video refinement
- Bug fixes from real usage
- Colosseum submission May 11

### Critical Path

```
Day 1-2: Smart contracts on devnet
Day 3-4: Backend API + Jupiter Predict working
Day 5-6: Geo Agent making real trade decisions
Day 7:   End-to-end trade execution working (CLI test)
Day 8-9: Mobile app with wallet connection + agent listing
Day 10:  Hire agent -> trade -> see result flow working
Day 11-12: Public feed + leaderboard working
Day 13:  On-chain integration
Day 14-18: Polish + deploy
Day 19:  Demo video + submission
```

### Time Allocation (190 hours total)

| Category | Hours | % |
|----------|-------|---|
| Smart Contracts | 15h | 8% |
| Backend + Agent | 65h | 34% |
| Mobile App | 60h | 32% |
| Feed + Leaderboard | 20h | 10% |
| Integration + Testing | 20h | 10% |
| Deploy + Demo | 10h | 5% |

---

## 15. Hackathon Winning Strategy (Colosseum Spring 2026)

### Target Tracks
1. **AI Track** - $25K. Domain-specific AI agents, novel approach
2. **Solana Mobile Award** - $25K. Seeker dApp Store app
3. **Grand Champion** - $50K. If you nail both AI + Mobile
4. **Accelerator** - $250K pre-seed. Top winners interviewed

### Judging Criteria
1. Functionality (does it work?) - 25%
2. Potential Impact (TAM size) - 20%
3. Novelty (how unique?) - 20%
4. UX (Solana-native experience) - 15%
5. Open-source + ecosystem composability - 10%
6. Business plan - 10%

### 3-Minute Pitch Video

```
0:00-0:20  Hook: "What if you could hire an AI that watches the world
           and puts money on its predictions - and you could watch
           every decision it makes, live?"
0:20-0:50  Problem: "$10B+ prediction market industry. Most people
           can't monitor 24/7. Existing AI agents are black boxes."
0:50-1:30  Demo: Show AgentArena on Seeker - hire agent, watch it
           analyze GDELT data, place bet, public feed shows everything
1:30-2:20  Technical: "On-chain verified. Full transparency.
           Domain-specific AI. Revenue model from day 1."
2:20-3:00  Close: "AgentArena. Hire an AI. Watch it trade.
           Verify everything. On Solana. On Seeker."
```

### Winning Differentiators
1. Only prediction market AI agent on Solana
2. Full transparency public feed
3. Real trading with real USDC
4. Seeker-native mobile app
5. Domain-specific AI (Geo)
6. On-chain verifiable performance
7. Revenue model from day 1 (2% platform fee)

### Past Colosseum Winners (Patterns)

| Winner | Key Differentiator |
|--------|-------------------|
| DegenDomeSolana ($50K) | Mainnet live, revenue from day 1, agentic-first |
| Latinum ($25K AI track) | Solved agent monetization (MCP + x402) |
| CludeBot ($5K Most Agentic) | Novel concept (Solana as AI memory), MIT licensed |
| BlockHelix ($15K) | "Agent as CEO" narrative, clean on-chain architecture |
| The Hive ($60K SendAI) | Composability, DeFi-native, immediate token traction |

---

## 16. Error Handling

| Scenario | Handling |
|----------|----------|
| LLM timeout/error | Retry 2x with exponential backoff, skip market for 1hr |
| Jupiter Predict API down | Fall back to Drift BET |
| Trade execution fails | Circuit breaker +1, alert user via WebSocket |
| Order not filled (keeper delay) | Poll `/orders/status/{pubkey}` every 30s for 5min, then cancel |
| Position loss exceeds stop-loss | Auto-close via `DELETE /positions/{pubkey}` |
| Daily loss limit hit | Pause agent, notify user, require manual restart |
| Agent wallet depleted | Notify user to fund, pause trading |
| Market resolution disputed | Log, do not auto-trade on disputed markets |
| Backend crash | BullMQ jobs persist in Redis, resume on restart |
| GDELT down | Use ACLED + FRED only |
| ACLED down | Use GDELT + FRED only |
| FRED down | Use cached data (updated daily anyway) |
| All data sources down | Agent pauses, uses last known signals with decay |

### Transaction Failure Handling

```
1. Build transaction (Jupiter Predict API)
2. Simulate transaction (Solana RPC simulateTransaction)
3. If simulation fails -> log error, skip trade
4. Sign and submit transaction
5. If submission fails -> retry with Jito priority fee
6. If retry fails -> log error, circuit breaker +1
7. Confirm transaction (poll for confirmation)
8. If confirmation timeout -> check on-chain, reconcile position
```

---

## 17. Competitive Positioning

| Feature | AgentArena | PolyStrat (Olas) | Virtuals | ElizaOS |
|---------|-----------|-----------------|----------|---------|
| Chain | **Solana** | Gnosis/EVM | Base/Solana | Multi |
| Agent Types | **Specialized (Geo)** | General | General | Framework |
| Markets | **Jupiter Predict + Drift** | Polymarket | None | None |
| Mobile | **Yes (Seeker)** | Desktop | No | No |
| Public Feed | **Full transparency** | Activity log | On-chain only | N/A |
| User Hiring | **Marketplace** | Self-run | Token-gated | Open source |
| Revenue | **On-chain escrow** | Off-chain | Token | N/A |
| Risk Mgmt | **Hardcoded + LLM** | Hardcoded | Basic | Custom |

---

## 18. Scalability Analysis

### Current Plan Scalability

| Component | Scale Limit | When It Breaks | Fix |
|-----------|-------------|----------------|-----|
| **tRPC WebSocket** | ~5K concurrent connections | 5K+ live viewers | Replace with raw WebSocket server for live feed, keep tRPC for API |
| **Single API server** | 1 server | 500+ agents running simultaneously | Add worker instances (BullMQ handles coordination) |
| **PostgreSQL connections** | ~100 connections | 200+ concurrent DB operations | Add PgBouncer (2-5x throughput improvement) |
| **Single Redis instance** | 1 instance | 10K+ concurrent WS connections | Redis Cluster (3 masters + 3 replicas) |
| **BullMQ (agent queue)** | 1M+ jobs/day | Never in practice | Scales horizontally automatically |
| **Redis ZSET (leaderboard)** | 30M+ entries | Never in practice | O(log N) operations |
| **Kimi K2.5** | API-based | Rate limits | Add multiple API keys |

### Upgrade Path

```
Phase 1 (Hackathon): 1-10 agents, <100 viewers
  - Single Bun server
  - Single Redis instance
  - Single PostgreSQL
  - tRPC for everything
  - THIS IS THE CURRENT PLAN

Phase 2 (Early Growth): 10-100 agents, <1K viewers
  - Add PgBouncer for DB connections
  - Partition trades table by date
  - Keep tRPC for API, add raw WS for live feed
  - BullMQ adds more workers automatically

Phase 3 (Scale): 100-1K agents, 1K-10K viewers
  - Separate API server from WebSocket server
  - Redis pub/sub backplane for multi-server WS
  - PG read replicas for leaderboard queries
  - Worker pool auto-scaling via BullMQ

Phase 4 (Hyperscale): 1K+ agents, 10K+ viewers
  - Redis Cluster for leaderboard + feeds
  - PG sharding or Citus
  - gRPC for agent-to-server communication
  - Kubernetes autoscaling
```

### Architecture Split at Scale

```
CURRENT (hackathon - tRPC for everything):
  Mobile App <--tRPC WS--> API Server <--tRPC--> Everything

AT SCALE (split architecture):
  Mobile App <--Raw WS--> WS Gateway Fleet <--Redis Pub/Sub--> Feed Events
  Mobile App <--tRPC HTTP--> API Server <--BullMQ--> Agent Workers
  Agent Workers <--gRPC/HTTP--> Jupiter/Drift APIs
```

### Why Current Plan Is Correct for Hackathon

1. **tRPC for everything is fastest to build** — type-safe, shared router, works on RN + Web
2. **Single server is simplest** — no load balancing, no service discovery
3. **BullMQ scales automatically** — just add more worker processes
4. **Redis handles leaderboard at any scale** — O(log N) ZSET operations
5. **Split architecture doesn't require rewriting** — just adding layers

---

## 19. Cost Summary

| Category | 19-Day Total |
|----------|-------------|
| Kimi K2.5 LLM | $8-23 |
| Kimi web search | $1-2 |
| Infrastructure (free tiers) | $0 |
| Solana transactions | $1 |
| **Total** | **$10-30** |

---

*Document generated: 2026-03-22*
*Target: Colosseum Spring 2026 (April 6 - May 11)*
*Solo developer, 19-day sprint, live trading, full transparency*
