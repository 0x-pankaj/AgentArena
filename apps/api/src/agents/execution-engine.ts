import { jupiterPredict, type JupiterMarket } from "../plugins/polymarket-plugin";
import { signSolanaTransaction, getWalletBalance } from "../utils/privy";
import {
  executeBuyOrder,
  closePosition,
  checkStopLosses,
} from "../services/trade-service";
import { getMarket, getTrendingMarkets } from "../services/market-service";
import { publishFeedEvent, buildFeedEvent } from "../feed";
import type { LLMDecision, MarketContext, AgentPosition } from "./strategy-engine";
import type { PortfolioSnapshot } from "../plugins/risk-plugin";
import { EXECUTE_TRADES, TEST_MODE, TEST_WALLET_BALANCE_USDC, TEST_WALLET_BALANCE_SOL } from "@agent-arena/shared";
import { db, schema } from "../db";
import { eq, and, gte, sql } from "drizzle-orm";
import type { TradeDecision } from "../ai/types";

const AGENT_LIMITS = {
  MIN_MARKET_VOLUME: 10000,
  MAX_MARKET_DAYS_TO_RESOLUTION: 7,
};

// --- Cached SOL price ---
let cachedSOLPrice = 150; // default fallback
let solPriceLastFetched = 0;
const SOL_PRICE_TTL_MS = 60_000;

function getSOLPrice(): number {
  return cachedSOLPrice;
}

export async function refreshSOLPrice(): Promise<void> {
  if (Date.now() - solPriceLastFetched < SOL_PRICE_TTL_MS) return;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    if (res.ok) {
      const data = await res.json() as { solana?: { usd?: number } };
      if (data.solana?.usd) {
        cachedSOLPrice = data.solana.usd;
        solPriceLastFetched = Date.now();
      }
    }
  } catch {
    // keep cached/default price
  }
}

// --- Validate LLM decision against known markets ---

export function validateDecision(
  decision: TradeDecision,
  markets: MarketContext[]
): { valid: boolean; error?: string } {
  if (decision.action === "hold") return { valid: true };

  if (!decision.marketId) {
    return { valid: false, error: "Decision has no marketId" };
  }

  const market = markets.find((m) => m.marketId === decision.marketId);
  if (!market) {
    return {
      valid: false,
      error: `LLM hallucinated marketId "${decision.marketId}" — not in scanned markets`,
    };
  }

  if (decision.amount && decision.amount <= 0) {
    return { valid: false, error: "Invalid trade amount" };
  }

  return { valid: true };
}

// --- Scan markets from Jupiter Predict ---

export async function scanMarkets(
  category: string = "general",
  minVolume: number = AGENT_LIMITS.MIN_MARKET_VOLUME
): Promise<MarketContext[]> {
  try {
    // Map agent categories to Jupiter categories
    const categoryMap: Record<string, string[]> = {
      politics: ["politics", "economics"],
      sports: ["sports"],
      crypto: ["crypto"],
      general: ["politics", "crypto", "sports", "economics"],
    };
    const categories = categoryMap[category] ?? ["crypto", "politics", "sports", "economics"];
    const allMarkets: MarketContext[] = [];

    for (const cat of categories) {
      try {
        const { markets } = await getTrendingMarkets({
          category: cat,
          limit: 20,
        });

        for (const m of markets) {
          const volume = Number(m.volume ?? 0);
          if (volume < minVolume) continue;

          const daysUntilClose = m.closesAt
            ? (new Date(m.closesAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            : Infinity;
          if (daysUntilClose > AGENT_LIMITS.MAX_MARKET_DAYS_TO_RESOLUTION) continue;

          const outcomes = Array.isArray(m.outcomes)
            ? (m.outcomes as Array<{ name: string; price?: number }>)
                .map((o) => ({ name: o.name, price: o.price ?? 0 }))
            : [];

          allMarkets.push({
            marketId: m.marketId,
            question: m.question,
            outcomes,
            volume,
            liquidity: Number(m.liquidity ?? 0),
            closesAt: m.closesAt ? new Date(m.closesAt).toISOString() : null,
          });
        }
      } catch {
        // Skip failed category
      }
    }

    return allMarkets;
  } catch (err) {
    console.error("Market scan failed:", err);
    return [];
  }
}

// --- Execute a buy order based on LLM decision ---

export async function executeBuy(
  decision: LLMDecision,
  agentId: string,
  jobId: string,
  agentWalletId: string,
  ownerPubkey: string,
  portfolio: PortfolioSnapshot,
  agentName: string = "Agent",
  category: string = "general"
): Promise<{ success: boolean; positionId?: string; error?: string }> {
  if (decision.action !== "buy" || !decision.marketId) {
    return { success: false, error: "Invalid decision for buy execution" };
  }

  // Get market details
  const market = await getMarket(decision.marketId);
  if (!market) {
    return { success: false, error: `Market ${decision.marketId} not found` };
  }

  const amount = decision.amount ?? 0;
  if (amount <= 0) {
    return { success: false, error: "Invalid amount" };
  }

  // Devnet safety guard — log decision but don't execute
  if (!EXECUTE_TRADES) {
    const feedEvent = buildFeedEvent({
      agentId,
      agentName,
      jobId,
      category: "decision",
      severity: "info",
      content: {
        market_analyzed: decision.marketQuestion ?? market.question,
        action: "buy",
        amount: String(amount),
        price: decision.isYes ? "yes" : "no",
        decision: decision.reasoning,
        reasoning_snippet: decision.reasoning.slice(0, 200),
        confidence: decision.confidence,
      },
      displayMessage: `${agentName} decided: BUY ${decision.isYes ? "YES" : "NO"}, $${amount} USDC on "${decision.marketQuestion ?? market.question}" (devnet — not executed)`,
    });
    await publishFeedEvent(feedEvent);
    return { success: false, error: "Trade execution disabled (devnet mode)" };
  }

  // Execute via trade service (includes risk checks)
  const outcomes = (market.outcomes ?? []) as Array<{ name: string; price: number }>;
  const entryPrice = decision.isYes
    ? (outcomes.find((o: { name: string; price: number }) => o.name?.toLowerCase() === "yes")?.price ?? 0.5)
    : (outcomes.find((o: { name: string; price: number }) => o.name?.toLowerCase() === "no")?.price ?? 0.5);

  const result = await executeBuyOrder({
    jobId,
    agentId,
    agentWalletId,
    ownerPubkey,
    marketId: decision.marketId,
    marketQuestion: decision.marketQuestion ?? market.question,
    isYes: decision.isYes ?? true,
    amount,
    entryPrice,
    confidence: decision.confidence,
    reasoning: decision.reasoning,
    category,
    marketVolume: Number(market.volume ?? 0),
    marketClosesAt: market.closesAt ? new Date(market.closesAt) : new Date(),
    portfolio,
  });

  if (result.success && result.position) {
    // Publish to public feed
    const feedEvent = buildFeedEvent({
      agentId,
      agentName,
      jobId,
      category: "trade",
      severity: "significant",
      content: {
        market_analyzed: decision.marketQuestion ?? market.question,
        action: "buy",
        amount: String(amount),
        price: decision.isYes ? "yes" : "no",
        decision: decision.reasoning,
        reasoning_snippet: decision.reasoning.slice(0, 200),
      },
      displayMessage: `${agentName} placed order: BUY ${decision.isYes ? "YES" : "NO"}, $${amount} USDC on "${decision.marketQuestion ?? market.question}"`,
    });
    await publishFeedEvent(feedEvent);

    return { success: true, positionId: result.position.id };
  }

  return { success: false, error: result.error };
}

// --- Execute a sell (close position) ---

export async function executeSell(
  positionId: string,
  agentId: string,
  jobId: string,
  agentWalletId: string,
  reason: string,
  agentName: string = "Agent"
): Promise<{ success: boolean; error?: string }> {
  const result = await closePosition({
    positionId,
    agentId,
    agentWalletId,
    reason,
  });

  if (result.success && result.trade) {
    const feedEvent = buildFeedEvent({
      agentId,
      agentName,
      jobId,
      category: "position_update",
      severity: result.trade.profitLoss && Number(result.trade.profitLoss) < 0 ? "critical" : "significant",
      content: {
        action: "sell",
        market_analyzed: result.trade.marketQuestion,
        pnl: result.trade.profitLoss
          ? {
              value: Number(result.trade.profitLoss),
              percent:
                Number(result.trade.profitLoss) / Number(result.trade.amount) * 100,
            }
          : undefined,
        reasoning_snippet: reason.slice(0, 200),
      },
      displayMessage: `${agentName} closed position: ${result.trade.marketQuestion} | PnL: $${Number(result.trade.profitLoss ?? 0).toFixed(2)}`,
    });
    await publishFeedEvent(feedEvent);

    return { success: true };
  }

  return { success: false, error: result.error };
}

// --- Monitor positions (check stop-loss, resolution) ---

export async function monitorPositions(
  agentId: string,
  jobId: string,
  agentWalletId: string,
  agentName: string = "Agent"
): Promise<{ closedCount: number }> {
  const { closed } = await checkStopLosses(agentId, agentWalletId);

  if (closed > 0) {
    const feedEvent = buildFeedEvent({
      agentId,
      agentName,
      jobId,
      category: "position_update",
      severity: "critical",
      content: {
        summary: `Stop-loss triggered on ${closed} position(s)`,
      },
      displayMessage: `${agentName} auto-closed ${closed} position(s) due to stop-loss`,
    });
    await publishFeedEvent(feedEvent);
  }

  return { closedCount: closed };
}

// --- Build portfolio snapshot for risk checks ---

export async function buildPortfolioSnapshot(
  agentWalletAddress: string,
  positions: AgentPosition[],
  jobId?: string
): Promise<PortfolioSnapshot> {
  await refreshSOLPrice();

  let balance: { sol: number; usdc: number };
  if (TEST_MODE) {
    balance = { sol: TEST_WALLET_BALANCE_SOL, usdc: TEST_WALLET_BALANCE_USDC };
    console.log(`[TEST MODE] Using simulated $${TEST_WALLET_BALANCE_USDC} USDC balance`);
  } else {
    balance = await getWalletBalance(agentWalletAddress);
  }

  const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);

  // Calculate actual daily PnL from today's settled trades
  let dailyPnl = totalPnl; // fallback to unrealized PnL
  if (jobId) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayTrades = await db
      .select({ profitLoss: schema.trades.profitLoss })
      .from(schema.trades)
      .where(
        and(
          eq(schema.trades.jobId, jobId),
          gte(schema.trades.executedAt, todayStart)
        )
      );

    const realizedDaily = todayTrades.reduce(
      (sum, t) => sum + Number(t.profitLoss ?? 0),
      0
    );
    dailyPnl = realizedDaily + totalPnl; // realized today + unrealized on open positions
  }

  return {
    totalBalance: balance.usdc + balance.sol * getSOLPrice(),
    totalPnl,
    dailyPnl,
    positions: positions.map((p) => ({
      marketId: p.marketId,
      category: "general",
      amount: p.amount,
      entryPrice: p.entryPrice,
      currentPrice: p.currentPrice,
      status: "open" as const,
    })),
    lastTradeTimestamp: null,
  };
}

// --- Publish analysis event to feed ---

export async function publishAnalysisEvent(
  agentId: string,
  jobId: string,
  summary: string,
  severity: "info" | "significant" | "critical" = "info",
  agentName: string = "Agent"
): Promise<void> {
  const feedEvent = buildFeedEvent({
    agentId,
    agentName,
    jobId,
    category: "analysis",
    severity,
    content: { summary },
    displayMessage: summary,
  });
  await publishFeedEvent(feedEvent);
}

// --- Publish reasoning event to feed ---

export async function publishReasoningEvent(
  agentId: string,
  jobId: string,
  decision: LLMDecision,
  agentName: string = "Agent"
): Promise<void> {
  const feedEvent = buildFeedEvent({
    agentId,
    agentName,
    jobId,
    category: "reasoning",
    severity: decision.confidence > 0.8 ? "significant" : "info",
    content: {
      decision: decision.action,
      reasoning_snippet: decision.reasoning.slice(0, 500),
      market_analyzed: decision.marketQuestion,
      confidence: decision.confidence,
    },
    displayMessage: `${agentName} decided: ${decision.action.toUpperCase()} ${decision.isYes ? "YES" : "NO"} on "${decision.marketQuestion ?? "N/A"}" | Confidence: ${(decision.confidence * 100).toFixed(0)}%`,
  });
  await publishFeedEvent(feedEvent);
}
