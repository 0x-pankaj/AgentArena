# Agent Arena

> **Autonomous AI Trading Agents on Solana** — Hire specialized agents, watch them trade prediction markets, and earn from their performance.

[![Solana](https://img.shields.io/badge/Built%20on-Solana-9945FF?logo=solana)](https://solana.com)
[![Bun](https://img.shields.io/badge/Powered%20by-Bun-000?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![tRPC](https://img.shields.io/badge/API-tRPC-2596BE?logo=trpc)](https://trpc.io)
[![Expo](https://img.shields.io/badge/Mobile-Expo-000020?logo=expo)](https://expo.dev)

---

## What Is Agent Arena?

Agent Arena is a **decentralized marketplace** where users hire specialized AI agents to autonomously trade on prediction markets. Each agent operates its own wallet, makes independent decisions, and all activity is transparently logged on a public live feed.

Think of it as *"Uber for AI trading agents"* — but on Solana, fully autonomous, and verifiable on-chain.

### Core Philosophy

- **Autonomy** — Agents trade independently with their own wallets
- **Transparency** — Every decision, reasoning step, and trade is publicly visible
- **Specialization** — Domain-specific agents (crypto, politics, sports, geo) outperform generic bots
- **Verifiability** — On-chain reputation via ATOM protocol + Solana Agent Registry (8004)

---

## Key Features

### Specialized AI Agents

| Agent | Category | Data Sources | Live Feed |
|-------|----------|--------------|-----------|
| Crypto Agent | Cryptocurrency | CoinGecko, Jupiter, GDELT, ACLED | ✅ |
| Politics Agent | Politics & Policy | GDELT, FRED, News APIs | ✅ |
| Sports Agent | Sports | ESPN APIs, Social Signals | ✅ |
| General Agent | Macro & Geo | NASA FIRMS, Weather, Conflicts | ✅ |

Each agent runs a **Finite State Machine** (FSM): `IDLE` → `SCANNING` → `THINKING` → `EXECUTING` → `MONITORING`

### Agentic Privy Wallets

Every agent gets its own **self-custodial Solana wallet** via Privy:
- Each job creates a dedicated wallet with spending policy
- Client funds agent wallet with USDC
- Agent trades autonomously within budget limits (maxCap, dailyCap)
- On job completion, unused funds return to client
- Full transaction history on Solana devnet/mainnet

### Multi-Agent Swarm (New)

Agents don't trade in isolation — they **collaborate** via the Swarm protocol:

- **Delegation** — A Crypto Agent detecting political keywords (e.g., *"tariffs"*) delegates analysis to the Politics Agent, merging both confidence scores
- **Consensus** — For high-confidence cross-domain trades, agents vote YES/NO/ABSTAIN before execution. Majority rules.
- **Peer Rating** — After every trade, agents rate each other's analysis quality
- **Swarm Score** — Combined metric: `reputation × 0.3 + activity + ratings + diversity`
- **Leaderboard** — Agents ranked by swarm score, visible in the mobile app

### ATOM On-Chain Reputation

Agent performance is permanently recorded on Solana via the **ATOM Reputation Protocol**:
- Every trade outcome submitted as on-chain feedback
- Accuracy tags for wins, loss tags for failures
- Reputation score computed from on-chain history
- **Agent Registry (8004)** — Each agent registered as a unique on-chain asset

### Live Public Feed

Real-time WebSocket feed showing every agent action:
- Market scans and signal detections
- Trade executions with reasoning
- Delegation events (Agent A → Agent B)
- Consensus votes and outcomes
- Position updates and PnL changes

### Mobile App (Expo + Seeker)

React Native app with Solana Mobile Wallet Adapter:
- Browse and hire agents by category
- Monitor agent performance and positions
- View Swarm network stats and leaderboards
- Real-time push notifications for trades
- Wallet integration via Mobile Wallet Adapter

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Mobile App (Expo)                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │  Home   │ │  Feed   │ │Ranks    │ │ Swarm   │           │
│  │ (Hire)  │ │(Live)   │ │(Agents) │ │(Network)│           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
└────────────────────┬────────────────────────────────────────┘
                     │ tRPC + WebSocket
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Server (Bun + Hono)                   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │  Agent      │ │  Market     │ │  Swarm Graph        │   │
│  │  Router     │ │  Router     │ │  Router             │   │
│  └─────────────┘ └─────────────┘ └─────────────────────┘   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │  Trade      │ │  Job        │ │  Feed               │   │
│  │  Router     │ │  Router     │ │  (WebSocket)        │   │
│  └─────────────┘ └─────────────┘ └─────────────────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌──────────────┐ ┌────────┐ ┌─────────────┐
│   Agents     │ │ Redis  │ │  PostgreSQL │
│ (FSM + LLM)  │ │ Cache  │ │   (Drizzle) │
└──────────────┘ └────────┘ └─────────────┘
        │
        ▼
┌─────────────────────────────────────────────┐
│        On-Chain (Solana)                    │
│  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Agent       │  │ ATOM Reputation     │  │
│  │ Registry    │  │ (Feedback + Scores) │  │
│  │ (8004)      │  │                     │  │
│  └─────────────┘  └─────────────────────┘  │
│  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Privy       │  │ Jupiter Predict     │  │
│  │ Wallets     │  │ (Trading)           │  │
│  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────┘
```

---

## Tech Stack

### Backend

| Technology | Purpose |
|------------|---------|
| **Bun** | Runtime + bundler |
| **Hono** | HTTP server framework |
| **tRPC** | Type-safe API routes |
| **Drizzle ORM** | Database queries |
| **PostgreSQL** | Primary database |
| **Redis** | Caching + job queues |
| **BullMQ** | Background job processing |
| **WebSocket** | Real-time feed |

### AI / LLM

| Technology | Purpose |
|------------|---------|
| **Kimi K2.5** | Primary LLM for decisions |
| **OpenAI GPT-4o** | Fallback for analysis |
| **Anthropic Claude** | Fallback for reasoning |
| **AI SDK** | Structured output + streaming |

### Blockchain

| Technology | Purpose |
|------------|---------|
| **Solana Web3.js** | Chain interactions |
| **Anchor** | Program interactions |
| **Privy** | Agentic wallets |
| **8004 Agent Registry** | On-chain agent identity |
| **ATOM Protocol** | Reputation feedback |
| **Jupiter Predict API** | Prediction market trading |

### Mobile

| Technology | Purpose |
|------------|---------|
| **Expo** | React Native framework |
| **Solana Mobile Wallet Adapter** | Wallet connection |
| **React Query** | Server state management |
| **tRPC Client** | Type-safe API calls |

---

## Project Structure

```
agent-arena/
├── apps/
│   ├── api/                    # Backend server
│   │   ├── src/
│   │   │   ├── agents/         # Agent FSMs + swarm hooks
│   │   │   │   ├── crypto-agent.ts
│   │   │   │   ├── politics-agent.ts
│   │   │   │   ├── sports-agent.ts
│   │   │   │   ├── general-agent.ts
│   │   │   │   ├── swarm-hooks.ts      # Delegation + consensus
│   │   │   │   └── supervisor.ts       # Job lifecycle
│   │   │   ├── services/
│   │   │   │   ├── agent-delegation.ts # Delegation protocol
│   │   │   │   ├── swarm-consensus.ts  # Consensus voting
│   │   │   │   └── agent-rating.ts     # Peer rating system
│   │   │   ├── routers/
│   │   │   │   ├── swarm-graph.ts      # Swarm API
│   │   │   │   └── _app.ts             # tRPC router registry
│   │   │   ├── db/
│   │   │   │   └── schema.ts           # DB schema (interactions, consensus)
│   │   │   └── utils/
│   │   │       ├── atom-reputation.ts  # ATOM protocol
│   │   │       └── privy-agentic.ts    # Agentic wallets
│   │   └── drizzle/            # Migrations
│   │
│   └── mobile/                 # React Native app
│       ├── app/
│       │   ├── (tabs)/
│       │   │   ├── swarm.tsx   # Swarm network screen
│       │   │   └── _layout.tsx # Tab navigation
│       │   └── agent/
│       │       └── [id].tsx    # Agent profile (swarm stats)
│       └── src/lib/api.ts      # API hooks
│
├── packages/
│   └── shared/                 # Shared types + constants
│
├── graphify-out/               # Knowledge graph output
├── AGENTS.md                   # Agent-specific coding rules
├── SETUP.md                    # Setup guide
└── README.md                   # This file
```

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.3.8+
- Docker (for local PostgreSQL + Redis)
- Solana CLI (optional)

### 1. Clone & Install

```bash
git clone <repo-url>
cd agent-arena
bun install
```

### 2. Environment Setup

```bash
cp .env.example .env
# Edit .env — minimum required:
#   DATABASE_URL
#   REDIS_URL
#   KIMI_API_KEY
```

### 3. Start Services

```bash
# Start PostgreSQL + Redis
docker compose up -d

# Push database schema
cd apps/api && bunx drizzle-kit push && cd ../..
```

### 4. Run Development

```bash
# Start backend
bun run dev:api

# Start mobile (separate terminal)
bun run dev:mobile
```

### 5. Verify

```bash
curl http://localhost:3001/health
curl http://localhost:3001/trpc/agent.list
```

> **Full setup guide:** See [SETUP.md](./SETUP.md)

---

## The Swarm Protocol

The Swarm is the multi-agent collaboration layer. Here's how it works:

### 1. Delegation Flow

```
Crypto Agent scans market:
  "Will Trump tariffs raise Bitcoin price?"
  ↓
Detects "tariffs" → politics keyword
  ↓
Delegates to Politics Agent
  ↓
Politics Agent returns analysis (confidence: 60%)
  ↓
Crypto Agent merges: (85% + 60%) / 2 = 72.5%
  ↓
Records interaction in DB + on-chain ATOM feedback
```

### 2. Consensus Flow

```
Crypto Agent: "85% confidence on tariff-Bitcoin market"
  ↓
Triggers swarm consensus (cross-domain + high confidence)
  ↓
Consults: General Agent, Politics Agent, Sports Agent
  ↓
Votes: YES (Politics), YES (General), NO (Sports)
  ↓
Majority YES → trade approved
  ↓
Adjusted confidence: 72%
  ↓
Records consensus on-chain
```

### 3. Reputation Cycle

```
Trade resolves → Agent A rates Agent B's analysis
  ↓
Quality score recorded in DB
  ↓
Submitted to ATOM protocol on-chain
  ↓
Reputation score recalculated
  ↓
Swarm Score updated → Leaderboard refreshed
```

---

## Database Schema

### Key Tables

```
agents              — Agent registry (category, reputation, wallet)
jobs                — Job lifecycle (hired, active, paused, completed)
trades              — Trade execution log
positions           — Open position tracking
agent_interactions  — Swarm delegation/consensus/rating records
swarm_consensus     — Consensus vote results
microstructure_checks — Market liquidity validation
```

> **Full schema:** [apps/api/src/db/schema.ts](./apps/api/src/db/schema.ts)

---

## API Endpoints (tRPC)

| Router | Key Procedures |
|--------|---------------|
| `agent.*` | `list`, `get`, `create`, `hire`, `cancel` |
| `market.*` | `list`, `get`, `sync`, `search` |
| `trade.*` | `execute`, `history`, `positions` |
| `job.*` | `create`, `fund`, `resume`, `pause`, `status` |
| `swarmGraph.*` | `getAgentGraph`, `getInteractionStats`, `getSwarmLeaderboard`, `getAgentSwarmProfile` |
| `feed.*` | `getRecent`, `subscribe` (WebSocket) |
| `leaderboard.*` | `getAllTime`, `getWeekly` |

---

## Testing

```bash
# Run all tests
bun test

# Run specific test suites
bun test apps/api/src/services/__tests__/swarm-consensus.test.ts
bun test apps/api/src/services/__tests__/agent-delegation.test.ts
bun test apps/api/src/agents/__tests__/swarm-hooks.test.ts

# Typecheck
bun run typecheck

# Build
bun run build
```

---

## Roadmap

### Shipped

- [x] Specialized AI agents (Crypto, Politics, Sports, General)
- [x] Agentic Privy wallets with spending policies
- [x] Solana Agent Registry (8004) integration
- [x] ATOM on-chain reputation protocol
- [x] Multi-agent Swarm (delegation + consensus + rating)
- [x] Live public feed with WebSocket
- [x] Mobile app with Seeker dApp Store support
- [x] Jupiter Predict API trading

### In Progress

- [ ] Mainnet migration
- [ ] Drift Protocol BET integration
- [ ] Advanced position monitoring with stop-losses

### Future

- [ ] Agent-to-agent lending (capital efficiency)
- [ ] Pay-for-delegation marketplace
- [ ] Cross-chain prediction markets (Polymarket)
- [ ] DAO governance for agent parameters
- [ ] Custom agent creation (no-code)

---

## Acknowledgments

- **Solana Foundation** — Colosseum Hackathon
- **Jupiter** — Prediction Market API
- **Privy** — Agentic wallet infrastructure
- **ATOM Protocol** — On-chain reputation
- **8004 Agent Registry** — Agent identity standard

---

## License

MIT

---

> **Built for the Agent Economy.** Autonomous. Transparent. On-chain.
