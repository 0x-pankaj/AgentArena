// --- Deploy phase configuration ---
// "development" | "traction" | "production"
// Controls balance simulation, trade execution, and policy strictness
export type DeployPhase = "development" | "traction" | "production";
export const DEPLOY_PHASE = (process.env.DEPLOY_PHASE ?? "development") as DeployPhase;
export const IS_DEVELOPMENT = DEPLOY_PHASE === "development";
export const IS_TRACTION = DEPLOY_PHASE === "traction";
export const IS_PRODUCTION = DEPLOY_PHASE === "production";
export const IS_SIMULATED = DEPLOY_PHASE === "development" || DEPLOY_PHASE === "traction";

// Backward compatibility aliases
export const TEST_MODE = IS_SIMULATED;

// --- Cluster Configuration ---
// Set SOLANA_CLUSTER=mainnet in .env to switch to mainnet
export const SOLANA_CLUSTER = (process.env.SOLANA_CLUSTER ?? "devnet") as "devnet" | "mainnet";
export const IS_DEVNET = SOLANA_CLUSTER === "devnet";
export const IS_MAINNET = SOLANA_CLUSTER === "mainnet";

export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? (
  IS_MAINNET
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com"
);
export const SOLANA_COMMITMENT = "confirmed" as const;

// CAIP2 chain ID for Privy wallet API
export const SOLANA_CAIP2 = IS_MAINNET
  ? "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
  : "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

// USDC mint address (mainnet only — devnet has no real USDC)
export const USDC_MINT = process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const JUPITER_PREDICT_BASE_URL = "https://prediction-market-api.jup.ag/api/v1";
export const JUPITER_PREDICT_DOCS = "https://prediction-market-api.jup.ag/docs";
export const JUPUSD_MINT = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";

// Paper Trading Configuration
export const PAPER_TRADING_ENABLED = process.env.PAPER_TRADING_ENABLED !== "false";
export const DEFAULT_PAPER_BALANCE_USDC = Number(process.env.DEFAULT_PAPER_BALANCE_USDC ?? "1000");
export const DEFAULT_TAKE_PROFIT_PERCENT = Number(process.env.DEFAULT_TAKE_PROFIT_PERCENT ?? "0.20");
export const DEFAULT_STOP_LOSS_PERCENT = Number(process.env.DEFAULT_STOP_LOSS_PERCENT ?? "0.15");

// Whether to execute trades (false = paper trading only, log but don't trade on-chain)
// In production, real trades are executed. In dev/traction, paper trading is default.
export const EXECUTE_TRADES = IS_PRODUCTION;

// Simulated mode: uses TEST_WALLET_BALANCE instead of real on-chain balance
// Also skips server-side risk checks since balance is simulated
// In dev/traction: agents see simulated balance and log decisions (no real trades)
// In production: real balance and real trade execution
export const TEST_WALLET_BALANCE_USDC = Number(process.env.TEST_WALLET_BALANCE_USDC ?? "1000");
export const TEST_WALLET_BALANCE_SOL = Number(process.env.TEST_WALLET_BALANCE_SOL ?? "0");

// Emergency kill switch: if "true", all agent loops pause immediately
export const EMERGENCY_STOP = process.env.EMERGENCY_STOP === "true";

// Paper-traction phase loosens gates so agents trade visibly. Production keeps strict bars.
export const AGENT_LIMITS = {
  MAX_PORTFOLIO_PERCENT_PER_MARKET: IS_SIMULATED ? 0.12 : 0.1,
  MAX_CATEGORY_EXPOSURE: IS_SIMULATED ? 0.4 : 0.25,
  STOP_LOSS_PERCENT: 0.15,
  MAX_CONCURRENT_POSITIONS: IS_SIMULATED ? 6 : 3,
  COOLDOWN_MINUTES: IS_SIMULATED ? 2 : 5,
  DAILY_LOSS_LIMIT_PERCENT: IS_SIMULATED ? 0.1 : 0.05,
  MIN_MARKET_VOLUME: IS_SIMULATED ? 1_000 : 10_000,
  MAX_MARKET_DAYS_TO_RESOLUTION: IS_SIMULATED ? 30 : 7,
  MIN_CONFIDENCE: IS_SIMULATED ? 0.3 : 0.7,
  MIN_EDGE: IS_SIMULATED ? 0.002 : 0.05,
  HUMAN_APPROVAL_THRESHOLD: 500,
} as const;

// Per-category profiles. In simulated/traction mode these mirror AGENT_LIMITS so
// every category trades aggressively for the demo; production uses stricter defaults.
// `general` keeps the strict bar even in traction (it's hidden from marketplace and
// only used for swarm voting, not for primary trade volume).
const PROFILE_DEFAULT_CONF = IS_SIMULATED ? 0.3 : 0.7;
const PROFILE_DEFAULT_EDGE_VOL = IS_SIMULATED ? 1_000 : 10_000;
const PROFILE_DEFAULT_DAYS = IS_SIMULATED ? 30 : 7;
const PROFILE_DEFAULT_MAX_POS = IS_SIMULATED ? 6 : 3;
const PROFILE_DEFAULT_MAX_PCT = IS_SIMULATED ? 0.12 : 0.1;

export const AGENT_PROFILES: Record<string, {
  minConfidence: number;
  maxPositions: number;
  maxPortfolioPercent: number;
  maxMarketDays: number;
  minVolume: number;
}> = {
  general: {
    minConfidence: Number(process.env.GENERAL_AGENT_MIN_CONFIDENCE ?? "0.7"),
    maxPositions: Number(process.env.GENERAL_AGENT_MAX_POSITIONS ?? "3"),
    maxPortfolioPercent: Number(process.env.GENERAL_AGENT_MAX_PORTFOLIO_PERCENT ?? "0.1"),
    maxMarketDays: Number(process.env.GENERAL_AGENT_MAX_MARKET_DAYS ?? "7"),
    minVolume: Number(process.env.GENERAL_AGENT_MIN_VOLUME ?? "10000"),
  },
  politics: {
    minConfidence: Number(process.env.POLITICS_AGENT_MIN_CONFIDENCE ?? String(PROFILE_DEFAULT_CONF)),
    maxPositions: Number(process.env.POLITICS_AGENT_MAX_POSITIONS ?? String(PROFILE_DEFAULT_MAX_POS)),
    maxPortfolioPercent: Number(process.env.POLITICS_AGENT_MAX_PORTFOLIO_PERCENT ?? String(PROFILE_DEFAULT_MAX_PCT)),
    maxMarketDays: Number(process.env.POLITICS_AGENT_MAX_MARKET_DAYS ?? String(PROFILE_DEFAULT_DAYS)),
    minVolume: Number(process.env.POLITICS_AGENT_MIN_VOLUME ?? String(PROFILE_DEFAULT_EDGE_VOL)),
  },
  sports: {
    minConfidence: Number(process.env.SPORTS_AGENT_MIN_CONFIDENCE ?? String(PROFILE_DEFAULT_CONF)),
    maxPositions: Number(process.env.SPORTS_AGENT_MAX_POSITIONS ?? String(PROFILE_DEFAULT_MAX_POS)),
    maxPortfolioPercent: Number(process.env.SPORTS_AGENT_MAX_PORTFOLIO_PERCENT ?? String(PROFILE_DEFAULT_MAX_PCT)),
    maxMarketDays: Number(process.env.SPORTS_AGENT_MAX_MARKET_DAYS ?? String(IS_SIMULATED ? 14 : 3)),
    minVolume: Number(process.env.SPORTS_AGENT_MIN_VOLUME ?? String(IS_SIMULATED ? 500 : 5000)),
  },
  crypto: {
    minConfidence: Number(process.env.CRYPTO_AGENT_MIN_CONFIDENCE ?? String(PROFILE_DEFAULT_CONF)),
    maxPositions: Number(process.env.CRYPTO_AGENT_MAX_POSITIONS ?? String(PROFILE_DEFAULT_MAX_POS)),
    maxPortfolioPercent: Number(process.env.CRYPTO_AGENT_MAX_PORTFOLIO_PERCENT ?? String(PROFILE_DEFAULT_MAX_PCT)),
    maxMarketDays: Number(process.env.CRYPTO_AGENT_MAX_MARKET_DAYS ?? String(PROFILE_DEFAULT_DAYS)),
    minVolume: Number(process.env.CRYPTO_AGENT_MIN_VOLUME ?? String(PROFILE_DEFAULT_EDGE_VOL)),
  },
};

export const FSM_SCAN_INTERVAL_MS = 5 * 60 * 1000;
export const FSM_ANALYSIS_INTERVAL_MS = 15 * 60 * 1000;

export const REDIS_KEYS = {
  MARKET_CACHE: "cache:markets",
  GDELT_CACHE: "cache:gdelt",
  ACLED_CACHE: "cache:acled",
  FRED_CACHE: "cache:fred",
  FIRMS_CACHE: "cache:firms",
  TWITTER_CACHE: "cache:twitter",
  LEADERBOARD_ALLTIME: "lb:alltime",
  LEADERBOARD_PREFIX: "lb:",
  LEADERBOARD_USERS: "lb:users",
  LEADERBOARD_CATEGORY_PREFIX: "lb:category:",
  AGENT_STATS_PREFIX: "agent:stats:",
  FEED_RECENT: "feed:recent",
  FEED_CATEGORY_PREFIX: "feed:category:",
  AGENT_EVENTS_STREAM: "agent:events",
  GLOBAL_STATS: "cache:global_stats",
  CALIBRATION_PREFIX: "calibration:",
  CONSENSUS_PREFIX: "consensus:",
  PRICE_MONITOR_PREFIX: "monitor:",
} as const;

export const REVENUE_SPLIT = {
  PLATFORM_FEE_BPS: 200,
  CREATOR_FEE_BPS: 500,
  OPERATOR_SHARE: 93,
} as const;

export const LLM_MODEL = "qwen/qwen3.6-plus";
export const LLM_BASE_URL = "https://openrouter.ai/api/v1";
export const WEB_SEARCH_COST_PER_CALL = 0;

// --- Evolution Engine ---
export const EVOLUTION_CONFIG = {
  MIN_TRADES_TO_EVOLVE: 30,
  AUTO_PROMOTE_THRESHOLD: 0.03, // 3% projected improvement
  EVOLUTION_INTERVAL_MS: 6 * 60 * 60 * 1000, // 6 hours
  PROMPT_CACHE_TTL: 300, // 5 minutes in Redis
} as const;

export const AGENT_TYPES = ["politics", "sports", "crypto", "general"] as const;
export const PIPELINE_STEPS = ["research", "analysis", "decision"] as const;
