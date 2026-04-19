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
  side: string = "yes"
): RiskCheckResult {
  if (entryPrice <= 0) return { allowed: true }; // no entry price yet

  let loss: number;
  if (side === "yes") {
    // YES position: profit when price goes UP, loss when price goes DOWN
    loss = (entryPrice - currentPrice) / entryPrice;
  } else {
    // NO position: profit when price goes DOWN, loss when price goes UP
    loss = (currentPrice - entryPrice) / entryPrice;
  }

  if (loss >= AGENT_LIMITS.STOP_LOSS_PERCENT) {
    return {
      allowed: false,
      reason: `Stop-loss triggered: ${(loss * 100).toFixed(1)}% loss on ${side.toUpperCase()} position (limit: ${AGENT_LIMITS.STOP_LOSS_PERCENT * 100}%)`,
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

// --- Position sizing ---

export function calculatePositionSize(
  confidence: number,
  totalBalance: number,
  currentPrice: number
): number {
  // Kelly-inspired sizing: bet more with higher confidence, capped by limits
  const kellyFraction = Math.max(0, (confidence - 0.5) * 2); // 0 at 50%, 1 at 100%
  const maxBet = totalBalance * AGENT_LIMITS.MAX_PORTFOLIO_PERCENT_PER_MARKET;
  const kellySize = totalBalance * kellyFraction * 0.25; // quarter-Kelly for safety

  return Math.min(kellySize, maxBet);
}
