import { AGENT_LIMITS, IS_SIMULATED } from "@agent-arena/shared";

export interface PositionRecord {
  marketId: string;
  category: string;
  amount: number;
  entryPrice: number;
  currentPrice: number;
  status: "open" | "closed" | "settled";
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface PortfolioSnapshot {
  totalBalance: number;
  totalPnl: number;
  dailyPnl: number;
  positions: PositionRecord[];
  lastTradeTimestamp: number | null;
}

// --- Guard checks (hardcoded, override LLM) ---

export function checkPortfolioLimit(
  proposedAmount: number,
  totalBalance: number
): RiskCheckResult {
  // Simulated mode: skip balance-dependent checks since balance is fake
  if (IS_SIMULATED) return { allowed: true };

  const maxAllowed = totalBalance * AGENT_LIMITS.MAX_PORTFOLIO_PERCENT_PER_MARKET;
  if (proposedAmount > maxAllowed) {
    return {
      allowed: false,
      reason: `Position size $${proposedAmount.toFixed(2)} exceeds 10% portfolio limit ($${maxAllowed.toFixed(2)})`,
    };
  }
  return { allowed: true };
}

export function checkCategoryExposure(
  proposedAmount: number,
  category: string,
  existingPositions: PositionRecord[]
): RiskCheckResult {
  const categoryExposure = existingPositions
    .filter((p) => p.category === category && p.status === "open")
    .reduce((sum, p) => sum + p.amount, 0);

  const totalOpen = existingPositions
    .filter((p) => p.status === "open")
    .reduce((sum, p) => sum + p.amount, 0);

  // No existing positions — category check is handled by portfolio limit
  if (totalOpen === 0) return { allowed: true };

  const newTotal = totalOpen + proposedAmount;
  const newCategoryExposure = categoryExposure + proposedAmount;

  if (newCategoryExposure / newTotal > AGENT_LIMITS.MAX_CATEGORY_EXPOSURE) {
    return {
      allowed: false,
      reason: `Category "${category}" exposure would exceed 25% limit`,
    };
  }
  return { allowed: true };
}

export function checkMaxPositions(
  existingPositions: PositionRecord[]
): RiskCheckResult {
  const openCount = existingPositions.filter((p) => p.status === "open").length;
  if (openCount >= AGENT_LIMITS.MAX_CONCURRENT_POSITIONS) {
    return {
      allowed: false,
      reason: `Max ${AGENT_LIMITS.MAX_CONCURRENT_POSITIONS} concurrent positions reached`,
    };
  }
  return { allowed: true };
}

export function checkDuplicateMarket(
  marketId: string,
  existingPositions: PositionRecord[],
  proposedSide?: string
): RiskCheckResult {
  const existing = existingPositions.find(
    (p) => p.marketId === marketId && p.status === "open"
  );
  if (existing) {
    // Allow opposite side (closing/reversing existing position)
    if (proposedSide && existing.category !== proposedSide) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Already have an open ${existing.category} position in market ${marketId}`,
    };
  }
  return { allowed: true };
}

export function checkCooldown(lastTradeTimestamp: number | null): RiskCheckResult {
  if (!lastTradeTimestamp) return { allowed: true };

  const elapsed = Date.now() - lastTradeTimestamp;
  const cooldownMs = AGENT_LIMITS.COOLDOWN_MINUTES * 60 * 1000;

  if (elapsed < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
    return {
      allowed: false,
      reason: `Cooldown active: ${remaining}s remaining`,
    };
  }
  return { allowed: true };
}

export function checkDailyLossLimit(
  dailyPnl: number,
  totalBalance: number
): RiskCheckResult {
  const maxDailyLoss = totalBalance * AGENT_LIMITS.DAILY_LOSS_LIMIT_PERCENT;
  if (dailyPnl < -maxDailyLoss) {
    return {
      allowed: false,
      reason: `Daily loss limit reached: $${dailyPnl.toFixed(2)} (limit: -$${maxDailyLoss.toFixed(2)})`,
    };
  }
  return { allowed: true };
}

export function checkMinConfidence(confidence: number): RiskCheckResult {
  if (confidence < AGENT_LIMITS.MIN_CONFIDENCE) {
    return {
      allowed: false,
      reason: `Confidence ${(confidence * 100).toFixed(0)}% below minimum ${(AGENT_LIMITS.MIN_CONFIDENCE * 100).toFixed(0)}%`,
    };
  }
  return { allowed: true };
}

export function checkMinMarketVolume(volume: number): RiskCheckResult {
  if (volume < AGENT_LIMITS.MIN_MARKET_VOLUME) {
    return {
      allowed: false,
      reason: `Market volume $${volume} below minimum $${AGENT_LIMITS.MIN_MARKET_VOLUME}`,
    };
  }
  return { allowed: true };
}

export function checkMarketResolution(closesAt: Date): RiskCheckResult {
  const daysUntilClose =
    (closesAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysUntilClose > AGENT_LIMITS.MAX_MARKET_DAYS_TO_RESOLUTION) {
    return {
      allowed: false,
      reason: `Market resolves in ${daysUntilClose.toFixed(1)} days (max ${AGENT_LIMITS.MAX_MARKET_DAYS_TO_RESOLUTION})`,
    };
  }
  return { allowed: true };
}

export function checkHumanApprovalThreshold(
  proposedAmount: number
): RiskCheckResult {
  if (proposedAmount > AGENT_LIMITS.HUMAN_APPROVAL_THRESHOLD) {
    return {
      allowed: false,
      reason: `Position $${proposedAmount.toFixed(2)} exceeds $${AGENT_LIMITS.HUMAN_APPROVAL_THRESHOLD} threshold — requires human approval`,
    };
  }
  return { allowed: true };
}

// --- Stop-loss check ---

export function checkStopLoss(
  entryPrice: number,
  currentPrice: number,
  side: string = "yes",
  stopLossPercent?: number
): RiskCheckResult {
  if (entryPrice <= 0) return { allowed: true }; // no entry price yet

  const slPct = stopLossPercent ?? AGENT_LIMITS.STOP_LOSS_PERCENT;

  let loss: number;
  if (side === "yes") {
    // YES position: profit when price goes UP, loss when price goes DOWN
    loss = (entryPrice - currentPrice) / entryPrice;
  } else {
    // NO position: profit when price goes DOWN, loss when price goes UP
    loss = (currentPrice - entryPrice) / entryPrice;
  }

  if (loss >= slPct) {
    return {
      allowed: false,
      reason: `Stop-loss triggered: ${(loss * 100).toFixed(1)}% loss on ${side.toUpperCase()} position (limit: ${(slPct * 100).toFixed(0)}%)`,
    };
  }
  return { allowed: true };
}

// --- Take-profit check ---

export function checkTakeProfit(
  entryPrice: number,
  currentPrice: number,
  side: string = "yes",
  takeProfitPercent?: number
): RiskCheckResult {
  if (entryPrice <= 0) return { allowed: true };

  const tpPct = takeProfitPercent ?? 0.20; // default 20%

  let profit: number;
  if (side === "yes") {
    profit = (currentPrice - entryPrice) / entryPrice;
  } else {
    profit = (entryPrice - currentPrice) / entryPrice;
  }

  if (profit >= tpPct) {
    return {
      allowed: false,
      reason: `Take-profit triggered: ${(profit * 100).toFixed(1)}% gain on ${side.toUpperCase()} position (target: ${(tpPct * 100).toFixed(0)}%)`,
    };
  }
  return { allowed: true };
}

// --- Market expiry check ---

export function checkMarketExpiry(
  positionOpenedAt: Date,
  marketCloseTime: Date | null,
  positionExpiresAt: Date | null
): RiskCheckResult {
  const now = Date.now();

  if (positionExpiresAt && now > positionExpiresAt.getTime()) {
    return {
      allowed: false,
      reason: `Position expiry reached`,
    };
  }

  if (marketCloseTime && now > marketCloseTime.getTime()) {
    return {
      allowed: false,
      reason: `Market has closed`,
    };
  }

  return { allowed: true };
}

// --- Market resolution check ---

export function checkMarketResolutionResult(
  marketResult: string | null | undefined,
  positionSide: string
): RiskCheckResult {
  if (!marketResult) return { allowed: true };

  if (marketResult === "yes" || marketResult === "no" || marketResult === "cancelled") {
    return {
      allowed: false,
      reason: `Market resolved: ${marketResult.toUpperCase()}`,
    };
  }

  return { allowed: true };
}

// --- Full pre-trade risk check ---

export function runPreTradeChecks(
  proposedAmount: number,
  category: string,
  confidence: number,
  marketVolume: number,
  marketClosesAt: Date,
  portfolio: PortfolioSnapshot,
  marketId?: string,
  jobLimits?: { maxCap?: number; dailyCap?: number }
): RiskCheckResult {
  // Job-specific limits (from user input)
  if (jobLimits?.maxCap && proposedAmount > jobLimits.maxCap) {
    return {
      allowed: false,
      reason: `Position $${proposedAmount.toFixed(2)} exceeds per-trade cap $${jobLimits.maxCap.toFixed(2)}`,
    };
  }

  const checks = [
    checkPortfolioLimit(proposedAmount, portfolio.totalBalance),
    checkCategoryExposure(proposedAmount, category, portfolio.positions),
    checkMaxPositions(portfolio.positions),
    ...(marketId ? [checkDuplicateMarket(marketId, portfolio.positions)] : []),
    checkCooldown(portfolio.lastTradeTimestamp),
    checkDailyLossLimit(portfolio.dailyPnl, portfolio.totalBalance),
    checkMinConfidence(confidence),
    checkMinMarketVolume(marketVolume),
    checkMarketResolution(marketClosesAt),
    checkHumanApprovalThreshold(proposedAmount),
  ];

  for (const result of checks) {
    if (!result.allowed) return result;
  }

  return { allowed: true };
}

// --- Position sizing (True Kelly Criterion) ---
// Kelly fraction = edge / odds
// Where edge = estimatedProbability - marketPrice
//       odds = payout ratio (for binary markets: 1/price for YES, 1/(1-price) for NO)
// We use quarter-Kelly for safety (reduces variance while keeping positive EV)

export function calculatePositionSize(
  estimatedProbability: number,
  marketPrice: number,
  totalBalance: number,
  isYes: boolean,
  confidence: number // used as a scaling factor: higher confidence = closer to full Kelly
): number {
  const edge = Math.abs(estimatedProbability - marketPrice);

  // If no edge or negative edge, don't bet
  if (edge <= 0) return 0;

  // Odds for binary prediction market
  // YES bet pays (1 - price) / price per dollar bet
  // NO bet pays price / (1 - price) per dollar bet
  const odds = isYes
    ? (1 - marketPrice) / marketPrice
    : marketPrice / (1 - marketPrice);

  // Full Kelly fraction
  const p = estimatedProbability;
  const q = 1 - p;
  const b = odds;

  // Kelly = (bp - q) / b = (p * (1-price)/price - (1-p)) / ((1-price)/price)
  // Simplified for binary markets:
  const kellyFraction = isYes
    ? (p - marketPrice) / (1 - marketPrice)
    : (marketPrice - p) / marketPrice;

  // Quarter-Kelly for safety (reduces variance by 75% while keeping most of the growth)
  const safetyFraction = 0.25;

  // Scale by confidence: high confidence bets closer to quarter-Kelly, low confidence scales down
  // At confidence=0.5, scale=0. At confidence=1.0, scale=1.0
  const confidenceScale = Math.max(0, (confidence - 0.5) * 2);

  const betFraction = Math.max(0, kellyFraction * safetyFraction * confidenceScale);

  const maxBet = totalBalance * AGENT_LIMITS.MAX_PORTFOLIO_PERCENT_PER_MARKET;
  const positionSize = totalBalance * betFraction;

  return Math.min(positionSize, maxBet);
}

// --- Backward-compatible wrapper (deprecated, use calculatePositionSize with full params) ---

export function calculatePositionSizeLegacy(
  confidence: number,
  totalBalance: number,
  currentPrice: number
): number {
  const kellyFraction = Math.max(0, (confidence - 0.5) * 2);
  const maxBet = totalBalance * AGENT_LIMITS.MAX_PORTFOLIO_PERCENT_PER_MARKET;
  const kellySize = totalBalance * kellyFraction * 0.25;
  return Math.min(kellySize, maxBet);
}
