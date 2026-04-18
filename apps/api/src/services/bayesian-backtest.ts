import { db, schema } from "../db";
import { eq, and, isNotNull, desc } from "drizzle-orm";
import { extractProbabilityFromText } from "../agents/shared-pipeline-utils";
import type { SharedSignals } from "./signal-cache";

export interface BacktestResult {
  marketId: string;
  question: string;
  actualOutcome: boolean;
  predictedProbability: number;
  bayesianProbability: number;
  aggregatedProbability: number;
  confidence: number;
  edge: number;
  correct: boolean;
  pnl: number;
}

export interface BacktestSummary {
  totalTrades: number;
  correctCount: number;
  accuracy: number;
  avgEdge: number;
  avgConfidence: number;
  calibrationError: number;
  profitableIfBet: number;
}

export async function runBayesianBacktest(params: {
  agentType: string;
  limit?: number;
}): Promise<{ results: BacktestResult[]; summary: BacktestSummary }> {
  const limit = params.limit ?? 100;

  const trades = await db
    .select()
    .from(schema.trades)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.trades.agentId))
    .where(
      and(
        eq(schema.agents.category, params.agentType),
        isNotNull(schema.trades.outcome)
      )
    )
    .orderBy(desc(schema.trades.executedAt))
    .limit(limit);

  const results: BacktestResult[] = [];
  let totalEdge = 0;
  let totalConfidence = 0;
  let calibrationSum = 0;
  let profitableCount = 0;

  for (const row of trades) {
    const trade = row.trades;
    const outcome = trade.outcome === "win";
    const pnl = Number(trade.profitLoss ?? 0);

    const predictedProbability = extractProbabilityFromText(trade.reasoning ?? "");
    const bayesianProbability = predictedProbability;
    const aggregatedProbability = predictedProbability;
    const confidence = 0.7;

    const edge = outcome
      ? aggregatedProbability - (1 - aggregatedProbability)
      : (1 - aggregatedProbability) - aggregatedProbability;

    const correct = outcome
      ? aggregatedProbability > 0.5
      : aggregatedProbability < 0.5;

    results.push({
      marketId: trade.marketId,
      question: trade.marketQuestion ?? "",
      actualOutcome: outcome,
      predictedProbability,
      bayesianProbability,
      aggregatedProbability,
      confidence,
      edge,
      correct,
      pnl,
    });

    totalEdge += Math.abs(edge);
    totalConfidence += confidence;
    calibrationSum += Math.abs(aggregatedProbability - (outcome ? 1 : 0));
    if (pnl > 0) profitableCount++;
  }

  const totalTrades = results.length;
  const correctCount = results.filter((r) => r.correct).length;

  const summary: BacktestSummary = {
    totalTrades,
    correctCount,
    accuracy: totalTrades > 0 ? correctCount / totalTrades : 0,
    avgEdge: totalTrades > 0 ? totalEdge / totalTrades : 0,
    avgConfidence: totalTrades > 0 ? totalConfidence / totalTrades : 0,
    calibrationError: totalTrades > 0 ? calibrationSum / totalTrades : 0,
    profitableIfBet: totalTrades > 0 ? profitableCount / totalTrades : 0,
  };

  console.log(
    `[BayesianBacktest] ${params.agentType}: ${correctCount}/${totalTrades} correct (${(summary.accuracy * 100).toFixed(1)}%), avg edge: ${summary.avgEdge.toFixed(3)}, calibration error: ${summary.calibrationError.toFixed(3)}`
  );

  return { results, summary };
}

export async function runAllAgentBacktests(): Promise<
  Record<string, { summary: BacktestSummary }>
> {
  const categories = ["crypto", "sports", "politics", "general"] as const;
  const out: Record<string, { summary: BacktestSummary }> = {};

  for (const cat of categories) {
    const { summary } = await runBayesianBacktest({ agentType: cat, limit: 100 });
    out[cat] = { summary };
  }

  return out;
}
