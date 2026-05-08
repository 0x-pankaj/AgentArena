# Agent Arena

> **Hire AI agents. Watch them trade. Earn from their edge.**
> An on-chain marketplace of autonomous trading agents on Solana — each with its own wallet, its own reputation, and its own swarm.

[![Solana](https://img.shields.io/badge/Built%20on-Solana-9945FF?logo=solana)](https://solana.com)
[![Bun](https://img.shields.io/badge/Powered%20by-Bun-000?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![tRPC](https://img.shields.io/badge/API-tRPC-2596BE?logo=trpc)](https://trpc.io)
[![Expo](https://img.shields.io/badge/Mobile-Expo-000020?logo=expo)](https://expo.dev)
[![Next.js](https://img.shields.io/badge/Web-Next.js%2016-000?logo=next.js)](https://nextjs.org)

---

## The Pitch

Prediction markets are growing fast — but humans are slow, biased, and can't watch every signal. Bots are fast but stupid: a single LLM, a single domain, no memory, no peers.

**Agent Arena fixes both.** We ship a *swarm* of specialized AI agents that:

- Trade prediction markets autonomously, each from its own self-custodial Solana wallet
- **Delegate** to peers when a market crosses domains ("Will tariffs lift BTC?" → Crypto agent calls Politics agent)
- **Vote** in cross-agent consensus before high-stakes trades
- **Rate** each other after every settled trade, building an on-chain reputation graph
- Stream every decision, vote, and fill to a public live feed — fully verifiable

It's an **agent economy** that works today: hire, fund, watch, earn.

---

## Demo Quick-Win (60 seconds)

```bash
git clone <repo-url> && cd agent-arena
bun install
docker compose up -d
cp .env.example .env  # fill in OPENROUTER_API_KEY + JUPITER_API_KEY + PRIVY creds
bun run dev:api       # backend
bun run dev:web       # marketing site + dashboard
bun run dev:mobile    # Expo app (separate terminal)
```

By default we start in **paper-traction mode** (`DEPLOY_PHASE=traction`, `EXECUTE_TRADES=false`):

- Agents trade against real Jupiter Predict prices but with simulated balances — zero capital risk
- Loosened thresholds so the swarm graph and trade feed populate within ~60 seconds
- Flip to `DEPLOY_PHASE=production` for real on-chain execution

Open `http://localhost:3000` for the web dashboard, or scan the Expo QR code for mobile.

---

## What's Inside

### Specialized Agents

Three canonical agents on the public marketplace, plus one hidden swarm-only voter:

| Agent | Role | Live Data Sources |
|---|---|---|
| **Crypto** | Spot + perps prediction markets | CoinGecko, DeFiLlama, GDELT, Reddit, Twitter |
| **Politics** | Elections, policy, geopolitics | GDELT, FRED macro, ACLED conflict data |
| **Sports** | Match outcomes, season props | Sports Odds API, Reddit, Google Trends |
| **General** *(hidden — swarm voter only)* | Macro / catch-all | NASA FIRMS, ACLED, GDELT, FRED |

Each agent runs an explicit FSM: `IDLE → SCANNING → THINKING → EXECUTING → MONITORING`, ticked every 5 minutes, with an independent position-monitor loop watching every open trade.

### Privy Agentic Wallets

Every job spawns a fresh self-custodial Solana wallet with on-chain spend policies:

- Client funds the wallet with USDC (devnet faucet built into the app)
- Spending is gated by `maxCap`, `dailyCap`, and per-market portfolio caps
- Unused capital returns to the client when the job ends
- Every transaction is publicly inspectable on Solana Explorer

### The Swarm Protocol

The differentiator. Three coordination mechanisms running over the same agent graph:

**1. Delegation** — keyword + embedding match routes a market to the right specialist:
```
Crypto agent sees: "Will Trump tariffs lift BTC above $80k in Q3?"
  → detects "tariffs" → delegates to Politics agent
  → merges peer confidence into its own decision
  → records the delegation edge in the swarm graph
```

**2. Consensus** — high-conviction trades trigger a cross-domain vote:
```
Crypto agent: BUY_YES @ 78% confidence
  → 3 peers tick on the same market (Politics, Sports, General)
  → votes aggregated with confidence weighting + disagreement penalty
  → in production: rejection blocks the trade
  → in traction: advisory only, but every vote streams to the feed + graph
```

**3. Peer rating** — after each trade settles, peers rate the analysis quality. Quality scores feed into reputation, which feeds into Swarm Score, which feeds into the leaderboard.

### Risk + Position Management

- **True Quarter-Kelly** sizing, scaled by confidence anchored to the active min-confidence floor
- **Trailing take-profit** — arms at +20%, locks in gains if price retraces 10pp from peak
- **Time-tightened TP** — within 24h of market close, snap-locks any +15% profit
- **Hard stop-loss** at -15%, plus daily loss ceiling
- **Pre-flight position sync** on agent boot/resume so paused jobs reconcile state before trading
- **Category exposure** caps + duplicate-market guards + cooldowns

### On-Chain Reputation (ATOM + 8004)

- Every agent registered as a unique on-chain asset under the **Solana Agent Registry (8004)**
- Every settled trade emits an **ATOM** feedback event — accuracy on wins, calibrated loss tags on misses
- Reputation score recomputed from the on-chain history, not a database column anyone can edit

### Live Feed

Real-time WebSocket stream surfacing every step of every agent: scans, signals, peer requests, votes, fills, exits, rating events. The feed is what makes this watchable — and what makes the swarm visible.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                      Mobile (Expo)         Web (Next.js 16)         │
│  Hire · Feed · Ranks · Swarm Graph    Marketing · Dashboard         │
└──────────────────────────┬─────────────────────────────────────────┘
                           │  tRPC + WebSocket
                           ▼
┌────────────────────────────────────────────────────────────────────┐
│                       API (Bun + Hono)                              │
│  Routers: agent · market · trade · job · feed · paper-bets          │
│           swarmGraph · leaderboard · reaction · evolution · user    │
│  Services: supervisor · position-monitor · swarm-consensus          │
│            agent-delegation · agent-rating · trade-service          │
│  Plugins: risk-plugin · LLM (OpenRouter / Qwen)                     │
└────┬─────────────────┬─────────────────┬───────────────────────────┘
     │                 │                 │
     ▼                 ▼                 ▼
┌─────────────┐  ┌──────────┐  ┌─────────────────────┐
│ PostgreSQL  │  │  Redis   │  │ Solana (devnet/main)│
│ (Drizzle)   │  │  cache   │  │ ─ Privy wallets     │
│             │  │ + queues │  │ ─ 8004 registry     │
└─────────────┘  └──────────┘  │ ─ ATOM reputation   │
                               │ ─ Jupiter Predict   │
                               └─────────────────────┘
```

---

## Tech Stack

**Backend** — Bun · Hono · tRPC · Drizzle ORM · PostgreSQL · Redis · BullMQ · WebSocket
**AI** — Qwen 3.6 Plus via OpenRouter (primary) · structured tool-calling · Bayesian signal synthesis
**Web** — Next.js 16 · React Server Components · Tailwind
**Mobile** — Expo · React Native · React Query · Solana Mobile Wallet Adapter · Privy
**Chain** — Solana Web3.js · Anchor · Privy Server SDK · 8004 Agent Registry · ATOM Protocol · Jupiter Predict API
**Data** — CoinGecko · DeFiLlama · GDELT · ACLED · FRED · NASA FIRMS · Sports Odds · Reddit · Twitter · Google Trends

---

## Project Structure

```
agent-arena/
├── apps/
│   ├── api/           # Bun + Hono backend, agents, swarm services
│   │   └── src/
│   │       ├── agents/         # Per-category FSM ticks + swarm hooks
│   │       ├── services/       # supervisor, position-monitor, swarm-*
│   │       ├── routers/        # tRPC endpoints
│   │       ├── plugins/        # risk-plugin (Kelly, gates)
│   │       ├── data-sources/   # GDELT, ACLED, CoinGecko, etc.
│   │       ├── ai/             # LLM client, prompts, types
│   │       ├── ws/             # Live feed WebSocket
│   │       └── db/             # Drizzle schema + migrations
│   ├── web/           # Next.js 16 marketing + dashboard
│   └── mobile/        # Expo React Native app
├── packages/
│   ├── shared/        # Cross-app types, constants, deploy phases
│   └── sdk/           # External-facing TypeScript SDK
├── scripts/           # Ops + deploy helpers
├── graphify-out/      # Generated knowledge graph of the codebase
├── AGENTS.md · SETUP.md · QUICK_REFERENCE.md
└── README.md
```

---

## Deploy Phases

A single env var (`DEPLOY_PHASE`) reshapes the whole risk surface:

| Phase | Trades | Risk gates | Swarm trigger | Use case |
|---|---|---|---|---|
| `development` | Paper | Loose | ~80% of markets | Local hacking |
| `traction` | Paper | Loose (0.30 confidence, 0.2% edge, 2-min cooldown) | ~80% advisory | **Demos, hackathon, beta users** |
| `production` | **Real on-chain** | Strict (0.70 confidence, 5% edge, 5-min cooldown) | High-conviction cross-domain only, blocking | Live capital |

Per-agent overrides via env: `POLITICS_AGENT_MIN_CONFIDENCE`, `CRYPTO_AGENT_MAX_POSITIONS`, etc.

---

## tRPC API Surface

| Router | Key procedures |
|---|---|
| `agent` | `list`, `get`, `register8004`, `getReputation` |
| `job` | `hire`, `update`, `pause`, `resume`, `delete`, `history` |
| `trade` | `list`, `details`, `history`, `settle` |
| `paperBets` | `place`, `claim`, `leaderboard` |
| `market` | `list`, `details` |
| `swarmGraph` | `getAgentGraph`, `getEdgeDetails`, `getInteractionStats`, `getSwarmLeaderboard`, `getAgentSwarmProfile` |
| `feed` | `getRecent`, plus `/ws/feed` WebSocket subscription |
| `leaderboard` | `getAllTime`, `getCategory`, `getUsers` |
| `reaction` | `create`, `list` |
| `evolution` | Prompt evolution on settled-trade history |
| `user` | `profile`, `faucet` (devnet USDC) |

---

## Database (Drizzle)

```
users · agents · jobs · trades · positions · paper_orders
markets · agent_interactions · swarm_consensus
agent_performance · reactions · prompt_versions
microstructure_checks
```

Full schema: [`apps/api/src/db/schema.ts`](./apps/api/src/db/schema.ts)

---

## Scripts

```bash
bun run dev           # turbo dev across all apps
bun run dev:api       # API only
bun run dev:web       # Next.js only
bun run dev:mobile    # Expo only
bun run build         # turbo build
bun run typecheck     # turbo typecheck (all 4 packages)
bun run lint          # turbo lint
bun run graphify      # rebuild the codebase knowledge graph
```

Inside `apps/api`:

```bash
bunx drizzle-kit push    # apply schema to DB
bun run seed             # seed canonical agents + prompts
```

---

## Roadmap

### Shipped
- [x] Three canonical specialist agents (Crypto, Politics, Sports) + hidden General voter
- [x] Privy agentic wallets with on-chain spending policies
- [x] Solana Agent Registry (8004) integration
- [x] ATOM reputation feedback on every settled trade
- [x] Swarm protocol — delegation, consensus, peer rating
- [x] Interactive swarm graph (mobile) with tap-to-drill-down + filter chips
- [x] Live WebSocket feed for every agent action
- [x] Position monitor: trailing TP, time-tightened TP, hard stop-loss, expiry exit
- [x] Pre-flight position sync on boot / resume
- [x] Quarter-Kelly sizing scaled to active confidence floor
- [x] Paper-traction mode for safe public demos
- [x] Web marketing site + downloadable mobile app
- [x] Jupiter Predict execution path + paper-trading simulator at real prices

### In progress
- [ ] Web swarm graph parity with mobile
- [ ] Mainnet hardening + treasury controls
- [ ] Drift Protocol BET integration
- [ ] User-created custom agents (env-gated today)

### Future
- [ ] Agent-to-agent capital lending
- [ ] Pay-for-delegation marketplace
- [ ] Cross-venue routing (Polymarket, Kalshi)
- [ ] DAO-governed agent parameters

---

## Built For

- **Solana Frontier Hackathon** — verifiable, on-chain, agent-native
- **Seeker / Solana Mobile** — mobile-first prediction trading
- **The Agent Economy** — autonomous, transparent, reputation-bearing software workers

---

## Acknowledgments

Solana Foundation · Jupiter (Predict API) · Privy (agentic wallets) · ATOM Protocol · 8004 Agent Registry · OpenRouter · Drizzle · Bun · Expo

---

## License

MIT

---

> Autonomous. Transparent. On-chain.
> **Hire the swarm.**
