// ============================================================
// Parallel Market Analysis
// Splits markets into chunks for concurrent LLM analysis
// Reduces total analysis time from O(n) to O(n/chunks)
// ============================================================

import { quickAnalysis } from "../ai/pipeline";
import type { ModelConfig } from "../ai/types";
import type { MarketContext, AgentPosition } from "../ai/types";
import type { SharedSignals } from "./signal-cache";
import type { PortfolioSnapshot } from "../plugins/risk-plugin";

// --- Configuration ---

export interface ParallelAnalysisConfig {
  maxChunkSize: number;        // Max markets per chunk
  maxConcurrent: number;       // Max concurrent LLM calls
  timeoutMs: number;          // Timeout for entire parallel analysis
}

const DEFAULT_CONFIG: ParallelAnalysisConfig = {
  maxChunkSize: 3,            // 3 markets per LLM call
  maxConcurrent: 3,           // 3 concurrent LLM calls
  timeoutMs: 120_000,         // 2 minute timeout
};

// --- Analysis result ---

export interface MarketAnalysisResult {
  marketId: string;
  question: string;
  analysis: string;
  tokensUsed: number;
  toolCalls: number;
  success: boolean;
  error?: string;
}

// ============================================================
// Chunk markets into groups
// ============================================================

function chunkMarkets<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

// ============================================================
// Build analysis prompt for a chunk of markets
// ============================================================

function buildChunkAnalysisPrompt(
  baseSystemPrompt: string,
  markets: MarketContext[],
  signals: SharedSignals,
  positions: AgentPosition[],
  balance: number
): string {
  const marketList = markets.map((m, i) => {
    const yesPrice = m.outcomes.find(o => o.name.toLowerCase() === 'yes')?.price ?? 0.5;
    return `${i + 1}. ${m.question} (Yes: ${(yesPrice * 100).toFixed(1)}%, Volume: $${m.volume.toLocaleString()})`;
  }).join('\n');

  return `${baseSystemPrompt}

ANALYZE THE FOLLOWING ${markets.length} MARKETS:
${marketList}

For each market, provide your independent probability estimate.
Explain your reasoning step by step for each market.
Be specific about which signals changed your estimate from the market price.`;
}

function buildChunkUserMessage(
  signals: SharedSignals,
  markets: MarketContext[],
  positions: AgentPosition[],
  balance: number,
  triggerReasons?: string[]
): string {
  const marketContext = markets.map(m => ({
    marketId: m.marketId,
    question: m.question,
    yesPrice: m.outcomes.find(o => o.name.toLowerCase() === 'yes')?.price ?? 0.5,
    volume: m.volume,
    closesAt: m.closesAt,
  }));

  return `Analyze these ${markets.length} markets:
${JSON.stringify(marketContext, null, 2)}

Portfolio: $${balance.toFixed(2)} USDC | ${positions.length} open positions
${triggerReasons && triggerReasons.length > 0 ? `Signal triggers: ${triggerReasons.join(', ')}` : ''}`;
}

// ============================================================
// Parallel Analysis Function
// ============================================================

export async function analyzeMarketsInParallel(
  markets: MarketContext[],
  signals: SharedSignals,
  positions: AgentPosition[],
  portfolio: PortfolioSnapshot,
  modelConfig: ModelConfig,
  systemPrompt: string,
  config?: Partial<ParallelAnalysisConfig>,
  triggerReasons?: string[]
): Promise<MarketAnalysisResult[]> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  console.log(`[ParallelAnalysis] Analyzing ${markets.length} markets in parallel (chunk size: ${mergedConfig.maxChunkSize}, concurrent: ${mergedConfig.maxConcurrent})`);

  // Chunk markets
  const chunks = chunkMarkets(markets, mergedConfig.maxChunkSize);
  console.log(`[ParallelAnalysis] Split into ${chunks.length} chunks`);

  // Set timeout
  const timeoutPromise = new Promise<MarketAnalysisResult[]>((_, reject) => {
    setTimeout(() => reject(new Error('Parallel analysis timeout')), mergedConfig.timeoutMs);
  });

  // Run analysis chunks
  const analysisPromise = (async (): Promise<MarketAnalysisResult[]> => {
    const results: MarketAnalysisResult[] = [];

    // Process chunks in batches (respecting maxConcurrent)
    for (let i = 0; i < chunks.length; i += mergedConfig.maxConcurrent) {
      const batch = chunks.slice(i, i + mergedConfig.maxConcurrent);
      
      const batchPromises = batch.map(async (chunk, chunkIdx) => {
        try {
          const chunkStart = Date.now();
          
          const prompt = buildChunkAnalysisPrompt(systemPrompt, chunk, signals, positions, portfolio.totalBalance);
          const userMessage = buildChunkUserMessage(signals, chunk, positions, portfolio.totalBalance, triggerReasons);

          const analysis = await quickAnalysis({
            modelConfig,
            systemPrompt: prompt,
            userMessage,
          });

          const duration = Date.now() - chunkStart;
          console.log(`[ParallelAnalysis] Chunk ${i + chunkIdx + 1}/${chunks.length} complete (${duration}ms, ${analysis.tokensUsed} tokens)`);

          // Create result for each market in chunk
          return chunk.map((market, marketIdx) => ({
            marketId: market.marketId,
            question: market.question,
            analysis: analysis.text, // Full analysis text applies to all markets in chunk
            tokensUsed: Math.floor(analysis.tokensUsed / chunk.length), // Distribute tokens
            toolCalls: analysis.toolCalls,
            success: true,
          }));
        } catch (err) {
          console.error(`[ParallelAnalysis] Chunk ${i + chunkIdx + 1} failed:`, err);
          return chunk.map(market => ({
            marketId: market.marketId,
            question: market.question,
            analysis: '',
            tokensUsed: 0,
            toolCalls: 0,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.flat());
    }

    return results;
  })();

  // Race between timeout and analysis
  try {
    const results = await Promise.race([analysisPromise, timeoutPromise]);
    const successCount = results.filter(r => r.success).length;
    console.log(`[ParallelAnalysis] Complete: ${successCount}/${results.length} markets analyzed successfully`);
    return results;
  } catch (err) {
    console.error('[ParallelAnalysis] Failed:', err);
    // Return failure for all markets
    return markets.map(m => ({
      marketId: m.marketId,
      question: m.question,
      analysis: '',
      tokensUsed: 0,
      toolCalls: 0,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

// ============================================================
// Sequential Analysis (fallback for small market counts)
// ============================================================

export async function analyzeMarketsSequentially(
  markets: MarketContext[],
  signals: SharedSignals,
  positions: AgentPosition[],
  portfolio: PortfolioSnapshot,
  modelConfig: ModelConfig,
  systemPrompt: string,
  triggerReasons?: string[]
): Promise<MarketAnalysisResult[]> {
  console.log(`[SequentialAnalysis] Analyzing ${markets.length} markets sequentially`);

  const results: MarketAnalysisResult[] = [];

  for (const market of markets) {
    try {
      const yesPrice = market.outcomes.find(o => o.name.toLowerCase() === 'yes')?.price ?? 0.5;
      
      const prompt = `${systemPrompt}

MARKET TO ANALYZE:
- ${market.question}
- Current Yes price: ${(yesPrice * 100).toFixed(1)}%
- Volume: $${market.volume.toLocaleString()}
- Closes: ${market.closesAt ?? 'Unknown'}

Provide your independent probability estimate.
Explain your reasoning step by step.`;

      const userMessage = `Portfolio: $${portfolio.totalBalance.toFixed(2)} USDC | ${positions.length} open positions
${triggerReasons && triggerReasons.length > 0 ? `Signal triggers: ${triggerReasons.join(', ')}` : ''}`;

      const analysis = await quickAnalysis({
        modelConfig,
        systemPrompt: prompt,
        userMessage,
      });

      results.push({
        marketId: market.marketId,
        question: market.question,
        analysis: analysis.text,
        tokensUsed: analysis.tokensUsed,
        toolCalls: analysis.toolCalls,
        success: true,
      });
    } catch (err) {
      results.push({
        marketId: market.marketId,
        question: market.question,
        analysis: '',
        tokensUsed: 0,
        toolCalls: 0,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

// ============================================================
// Smart Analysis: Choose parallel or sequential based on market count
// ============================================================

export async function smartAnalyzeMarkets(
  markets: MarketContext[],
  signals: SharedSignals,
  positions: AgentPosition[],
  portfolio: PortfolioSnapshot,
  modelConfig: ModelConfig,
  systemPrompt: string,
  config?: Partial<ParallelAnalysisConfig>,
  triggerReasons?: string[]
): Promise<MarketAnalysisResult[]> {
  // Use parallel for >5 markets, sequential for <=5
  if (markets.length > 5) {
    return analyzeMarketsInParallel(
      markets, signals, positions, portfolio,
      modelConfig, systemPrompt, config, triggerReasons
    );
  } else {
    return analyzeMarketsSequentially(
      markets, signals, positions, portfolio,
      modelConfig, systemPrompt, triggerReasons
    );
  }
}
