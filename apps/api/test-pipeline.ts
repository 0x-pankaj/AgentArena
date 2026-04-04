#!/usr/bin/env bun
/**
 * AI Pipeline Integration Test
 * 
 * Tests the complete pipeline:
 * 1. Fetch markets from Jupiter Predict
 * 2. Fetch signals from data sources (GDELT, Exa web search, etc.)
 * 3. Run LLM analysis via OpenRouter (Qwen)
 * 4. Run LLM decision via OpenRouter (Qwen) with Zod validation
 * 5. Run pre-trade risk checks
 * 
 * Does NOT execute real trades (EXECUTE_TRADES=false).
 */

import { resolveModel, MODELS } from "./src/ai/models";
import { quickAnalysis, quickDecision } from "./src/ai/pipeline";
import { TradeDecisionSchema } from "./src/ai/types";
import { runPreTradeChecks, calculatePositionSize } from "./src/plugins/risk-plugin";
import { webSearch } from "./src/services/web-search";
import { jupiterPredict } from "./src/plugins/polymarket-plugin";
import { getTrendingMarkets } from "./src/services/market-service";
import { bayesianUpdate, aggregateSignals, calculateEdge, kellyPositionSize } from "./src/agents/shared-helpers";
import { searchGdelt } from "./src/data-sources/gdelt";
import { getGlobalMarket } from "./src/data-sources/coingecko";
import { sendAlert } from "./src/services/alert-service";
import { getAllBayesianWeights, getAllSignalSourceWeights } from "./src/agents/signal-weights";
import { getCachedEvents } from "./src/services/market-service";

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(test: string) {
  passed++;
  console.log(`  ✅ ${test}`);
}

function fail(test: string, err: unknown) {
  failed++;
  console.error(`  ❌ ${test}`);
  console.error(`     ${err instanceof Error ? err.message : String(err)}`);
}

function skip(test: string, reason: string) {
  skipped++;
  console.log(`  ⏭️  ${test} (skipped: ${reason})`);
}

async function section(name: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${"═".repeat(60)}`);
}

// ============================================================
// TEST 1: Model Resolution (OpenRouter + Qwen)
// ============================================================
async function testModelResolution() {
  await section("1. Model Resolution — OpenRouter Qwen");

  try {
    const model = resolveModel(MODELS.qwen);
    if (model) pass("Qwen model resolved successfully");
    else fail("Qwen model resolved to null", new Error("null model"));
  } catch (err) {
    fail("Qwen model resolution", err);
  }
}

// ============================================================
// TEST 2: Jupiter Market Fetching
// ============================================================
async function testJupiterMarkets() {
  await section("2. Jupiter Predict — Market Fetching");

  try {
    const events = await jupiterPredict.listEvents({ limit: 5, includeMarkets: true });
    if (events.length > 0) {
      pass(`Fetched ${events.length} events from Jupiter`);
      const firstMarket = events[0].markets?.[0];
      if (firstMarket?.metadata?.question) {
        console.log(`     Sample: ${firstMarket.metadata.question.slice(0, 80)}`);
      }
    } else {
      fail("No events returned from Jupiter", new Error("empty result"));
    }
  } catch (err) {
    fail("Jupiter event listing", err);
  }

  try {
    const trending = await getTrendingMarkets({ limit: 3 });
    if (trending.markets.length > 0) {
      pass(`Got ${trending.markets.length} trending markets`);
    } else {
      skip("Trending markets", "No trending markets found");
    }
  } catch (err) {
    fail("Trending markets", err);
  }
}

// ============================================================
// TEST 3: Exa Web Search
// ============================================================
async function testExaWebSearch() {
  await section("3. Exa Web Search");

  try {
    const results = await webSearch("US election prediction markets 2026", 5);
    if (results.length > 0) {
      pass(`Exa returned ${results.length} results`);
      console.log(`     Top: ${results[0].title?.slice(0, 80) ?? "no title"}`);
    } else {
      skip("Exa search", "No results (falling back to GDELT)");
    }
  } catch (err) {
    fail("Exa web search", err);
  }

  try {
    const results = await webSearch("crypto market news today", 3);
    if (results.length > 0) {
      pass(`Crypto news search: ${results.length} results`);
    } else {
      skip("Crypto news search", "No results");
    }
  } catch (err) {
    fail("Crypto news search", err);
  }
}

// ============================================================
// TEST 4: GDELT Signals
// ============================================================
async function testGdeltSignals() {
  await section("4. GDELT Signal Fetching");

  try {
    const results = await searchGdelt({ query: "prediction markets", mode: "artlist", timespan: "24h", maxRecords: 5 });
    if (results.articles && results.articles.length > 0) {
      pass(`GDELT returned ${results.articles.length} articles`);
    } else {
      skip("GDELT search", "No articles found");
    }
  } catch (err) {
    fail("GDELT search", err);
  }
}

// ============================================================
// TEST 5: CoinGecko Global Market
// ============================================================
async function testCoinGecko() {
  await section("5. CoinGecko Global Market Data");

  try {
    const data = await getGlobalMarket();
    if (data && (data as any).totalMarketCap) {
      const mc = (data as any).totalMarketCap;
      pass(`CoinGecko: Total market cap $${(mc / 1e9).toFixed(1)}B`);
    } else if (data) {
      pass("CoinGecko returned data");
    } else {
      fail("CoinGecko returned no data", new Error("empty result"));
    }
  } catch (err) {
    fail("CoinGecko global market", err);
  }
}

// ============================================================
// TEST 6: Bayesian Update & Signal Aggregation
// ============================================================
async function testSignalProcessing() {
  await section("6. Signal Processing — Bayesian + Aggregation");

  try {
    const prior = 0.5;
    const evidence = [
      { likelihoodYes: 0.7, likelihoodNo: 0.3 },
      { likelihoodYes: 0.65, likelihoodNo: 0.35 },
      { likelihoodYes: 0.6, likelihoodNo: 0.4 },
    ];
    const posterior = bayesianUpdate(prior, evidence);
    if (posterior > prior && posterior > 0 && posterior < 1) {
      pass(`Bayesian update: ${prior} → ${posterior.toFixed(4)} (3 positive signals)`);
    } else {
      fail("Bayesian update produced unexpected result", new Error(`posterior=${posterior}`));
    }
  } catch (err) {
    fail("Bayesian update", err);
  }

  try {
    const signals = [
      { name: "gdelt", value: 0.7, confidence: 0.8, weight: 1.0 },
      { name: "acled", value: 0.6, confidence: 0.7, weight: 1.2 },
      { name: "fred", value: 0.55, confidence: 0.6, weight: 0.8 },
    ];
    const result = aggregateSignals(signals);
    if (result.probability >= 0 && result.probability <= 1 && result.confidence >= 0 && result.confidence <= 1) {
      pass(`Signal aggregation: prob=${result.probability.toFixed(3)}, conf=${result.confidence.toFixed(3)}, n=${result.nSignals}`);
    } else {
      fail("Signal aggregation out of range", new Error(`prob=${result.probability}, conf=${result.confidence}`));
    }
  } catch (err) {
    fail("Signal aggregation", err);
  }
}

// ============================================================
// TEST 7: Edge Detection & Kelly Sizing
// ============================================================
async function testEdgeAndSizing() {
  await section("7. Edge Detection & Kelly Position Sizing");

  try {
    const edge = calculateEdge(0.7, 0.5, 0.8);
    if (edge.shouldTrade && edge.direction === "yes" && edge.netEdge > 0) {
      pass(`Edge detected: ${edge.direction} edge=${(edge.netEdge * 100).toFixed(2)}%`);
    } else {
      fail("Edge detection missed expected trade", new Error(`shouldTrade=${edge.shouldTrade}, dir=${edge.direction}`));
    }
  } catch (err) {
    fail("Edge detection", err);
  }

  try {
    const size = kellyPositionSize(0.7, 0.5, 1000);
    if (size > 0 && size <= 100) {
      pass(`Kelly size: $${size.toFixed(2)} on $1000 portfolio (70% prob @ $0.50)`);
    } else {
      fail("Kelly sizing out of range", new Error(`size=${size}`));
    }
  } catch (err) {
    fail("Kelly position sizing", err);
  }
}

// ============================================================
// TEST 8: Configurable Signal Weights
// ============================================================
async function testSignalWeights() {
  await section("8. Configurable Signal Weights");

  try {
    const bayesian = getAllBayesianWeights();
    const sources = getAllSignalSourceWeights();
    if (Object.keys(bayesian).length > 0 && Object.keys(sources).length > 0) {
      pass(`${Object.keys(bayesian).length} Bayesian weights, ${Object.keys(sources).length} source weights configured`);
    } else {
      fail("Signal weights empty", new Error("no weights"));
    }
  } catch (err) {
    fail("Signal weights", err);
  }
}

// ============================================================
// TEST 9: LLM Analysis (quickAnalysis via OpenRouter)
// ============================================================
async function testLLMAnalysis() {
  await section("9. LLM Analysis — OpenRouter Qwen (quickAnalysis)");

  try {
    const result = await quickAnalysis({
      modelConfig: MODELS.qwen,
      systemPrompt: `You are a prediction market research assistant. 
Given a market question, identify the key factors that will influence the outcome.
Keep your response concise (3-5 bullet points).`,
      userMessage: `Research this market: "Will Bitcoin reach $150,000 by end of 2026?"

Current context:
- Bitcoin is currently trading around $85,000
- Institutional adoption is increasing
- ETF inflows have been strong

Identify the top 3-5 factors that will determine whether Bitcoin reaches $150K.`,
      tools: ["web_search"],
    });

    if (result.text && result.text.length > 20) {
      pass(`Analysis complete: ${result.text.length} chars, ${result.tokensUsed} tokens, ${result.toolCalls} tool calls`);
      console.log(`     Preview: ${result.text.slice(0, 150)}...`);
    } else {
      fail("LLM analysis returned empty/short response", new Error(`text length: ${result.text?.length ?? 0}`));
    }
  } catch (err) {
    fail("LLM analysis via OpenRouter", err);
  }
}

// ============================================================
// TEST 10: LLM Decision (quickDecision via OpenRouter + Zod)
// ============================================================
async function testLLMDecision() {
  await section("10. LLM Decision — OpenRouter Qwen (quickDecision + Zod)");

  try {
    const result = await quickDecision({
      modelConfig: MODELS.qwen,
      systemPrompt: `You are an AI trading agent for prediction markets.
Based on the research and analysis provided, make a trade decision.

RULES:
- Only buy if you have strong conviction (>70% confidence)
- If uncertain, choose "hold"
- Return valid JSON matching the schema exactly`,
      userMessage: `## Market Research Summary

Market: "Will Bitcoin reach $150,000 by end of 2026?"
Market ID: btc-150k-2026
Current Price (YES): $0.55
Market Volume: $2,500,000

## Key Factors
1. Bitcoin halving cycle suggests bull market through 2025-2026
2. Institutional ETF inflows accelerating
3. Macro environment: Fed rate cuts expected
4. Historical cycle peaks typically 12-18 months post-halving

## Signal Aggregation
- Bayesian posterior: 0.68
- Signal confidence: 0.72
- Edge detected: YES side with 13% net edge

Make your trade decision.`,
      schema: TradeDecisionSchema,
      tools: [],
    });

    const decision = result.decision;
    if (decision.action && decision.confidence >= 0 && decision.confidence <= 1 && decision.reasoning.length > 10) {
      pass(`Decision: ${decision.action.toUpperCase()} | confidence: ${(decision.confidence * 100).toFixed(0)}% | tokens: ${result.tokensUsed}`);
      console.log(`     Reasoning: ${decision.reasoning.slice(0, 150)}...`);
      if (decision.marketId) console.log(`     Market: ${decision.marketId}`);
      if (decision.amount) console.log(`     Amount: $${decision.amount.toFixed(2)}`);
    } else {
      fail("LLM decision missing required fields", new Error(JSON.stringify(decision).slice(0, 200)));
    }
  } catch (err) {
    fail("LLM decision via OpenRouter", err);
  }
}

// ============================================================
// TEST 11: Pre-Trade Risk Checks
// ============================================================
async function testRiskChecks() {
  await section("11. Pre-Trade Risk Checks");

  try {
    const portfolio = {
      totalBalance: 1000,
      totalPnl: 50,
      dailyPnl: -10,
      positions: [],
      lastTradeTimestamp: null,
    };

    const check = runPreTradeChecks(
      50,
      "crypto",
      0.75,
      2500000,
      new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
      portfolio,
      "btc-150k-2026",
    );

    if (check.allowed) {
      pass("Risk checks passed for $50 position");
    } else {
      fail("Risk check blocked valid trade", new Error(check.reason));
    }
  } catch (err) {
    fail("Risk checks", err);
  }

  try {
    const portfolio = {
      totalBalance: 1000,
      totalPnl: 50,
      dailyPnl: -10,
      positions: [],
      lastTradeTimestamp: null,
    };

    const check = runPreTradeChecks(
      200,
      "crypto",
      0.75,
      2500000,
      new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      portfolio,
      "btc-150k-2026",
    );

    if (!check.allowed && check.reason?.includes("10%")) {
      pass("Risk check correctly blocked oversized position");
    } else {
      fail("Risk check should have blocked oversized position", new Error(`allowed=${check.allowed}, reason=${check.reason}`));
    }
  } catch (err) {
    fail("Risk check - oversized position", err);
  }

  try {
    const size = calculatePositionSize(0.75, 1000, 0.55);
    if (size > 0 && size <= 100) {
      pass(`Position sizing: $${size.toFixed(2)} (75% confidence, $1000 portfolio)`);
    } else {
      fail("Position sizing out of range", new Error(`size=${size}`));
    }
  } catch (err) {
    fail("Position sizing", err);
  }
}

// ============================================================
// TEST 12: Alert Service
// ============================================================
async function testAlertService() {
  await section("12. Alert Service");

  try {
    await sendAlert({
      type: "info",
      service: "TestPipeline",
      message: "Test alert from pipeline test",
    });
    pass("Alert service executed (no webhook configured, logged to console)");
  } catch (err) {
    fail("Alert service", err);
  }
}

// ============================================================
// TEST 13: Full Pipeline Integration (End-to-End)
// ============================================================
async function testFullPipeline() {
  await section("13. Full Pipeline — End-to-End Integration");

  try {
    // Step 1: Fetch a real market from Jupiter
    console.log("  [Pipeline] Step 1: Fetching events from Jupiter...");
    const events = await jupiterPredict.listEvents({ limit: 10, includeMarkets: true });
    
    // Flatten events into markets
    const allMarkets: Array<{ marketId: string; question: string; category: string; volume?: number; closesAt?: string; outcomes?: Array<{ name: string; price: number }> }> = [];
    for (const event of events) {
      if (event.markets) {
        for (const m of event.markets) {
          if ((m.status === "active" || m.status === "open" || m.status === "live") && m.metadata?.title) {
            const prices = m.pricing as any;
            const yesPrice = prices ? (prices.buyYesPriceUsd ?? prices.sellYesPriceUsd) / 1000000 : 0.5;
            const noPrice = prices ? (prices.buyNoPriceUsd ?? prices.sellNoPriceUsd) / 1000000 : 0.5;
            const marketQuestion = `${event.metadata?.title ?? ""} — ${m.metadata.title}`.trim();
            allMarkets.push({
              marketId: m.marketId,
              question: marketQuestion,
              category: event.category ?? "general",
              volume: prices?.volume ? prices.volume / 100 : undefined,
              closesAt: m.closeTime ? (typeof m.closeTime === "number" ? new Date(m.closeTime * 1000).toISOString() : String(m.closeTime)) : undefined,
              outcomes: [
                { name: "Yes", price: yesPrice },
                { name: "No", price: noPrice },
              ],
            });
          }
        }
      }
    }

    if (allMarkets.length === 0) {
      skip("Full pipeline", "No active markets found from Jupiter");
      return;
    }

    // Pick a market with decent volume
    const market = allMarkets.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0];
    console.log(`  [Pipeline] Selected: ${market.question.slice(0, 80)}...`);

    // Step 2: Web search for context
    console.log("  [Pipeline] Step 2: Searching web for context...");
    const searchResults = await webSearch(market.question, 5);
    const searchContext = searchResults.slice(0, 3).map((r: any) => `- ${r.title}: ${r.snippet.slice(0, 100)}`).join("\n");

    // Step 3: LLM Analysis
    console.log("  [Pipeline] Step 3: Running LLM analysis...");
    const analysis = await quickAnalysis({
      modelConfig: MODELS.qwen,
      systemPrompt: `You are a prediction market research analyst. Analyze the market question and available information to identify key factors and estimate probability.`,
      userMessage: `## Market Question
${market.question}

## Web Search Results
${searchContext || "No web search results available."}

## Market Context
- Current YES price: ${market.outcomes?.[0]?.price ?? 0.5}
- Market volume: ${market.volume ?? "unknown"}
- Closes: ${market.closesAt ?? "unknown"}

Analyze this market and provide:
1. Key factors for YES outcome
2. Key factors for NO outcome  
3. Your estimated probability (0-100%)`,
      tools: ["web_search"],
    });

    console.log(`  [Pipeline] Analysis: ${analysis.text.slice(0, 200)}...`);

    // Step 4: LLM Decision
    console.log("  [Pipeline] Step 4: Running LLM decision...");
    const decision = await quickDecision({
      modelConfig: MODELS.qwen,
      systemPrompt: `You are an AI trading agent for prediction markets. Make a trade decision based on the analysis.
Only trade if you have strong conviction (>70% confidence). Otherwise hold.
Return your decision as valid JSON with these exact fields: action ("buy", "sell", or "hold"), confidence (0-1), reasoning (string).`,
      userMessage: `## Market Analysis
${analysis.text}

## Market Details
- Market ID: ${market.marketId}
- Question: ${market.question}
- YES Price: ${market.outcomes?.[0]?.price ?? 0.5}
- Volume: ${market.volume ?? 0}

Make your trade decision.`,
      schema: TradeDecisionSchema,
      tools: [],
    });

    const d = decision.decision;
    console.log(`  [Pipeline] Decision: ${d.action.toUpperCase()}`);
    console.log(`  [Pipeline] Confidence: ${(d.confidence * 100).toFixed(0)}%`);
    console.log(`  [Pipeline] Reasoning: ${d.reasoning.slice(0, 200)}...`);

    // Step 5: Risk Checks
    console.log("  [Pipeline] Step 5: Running risk checks...");
    const portfolio = {
      totalBalance: 1000,
      totalPnl: 0,
      dailyPnl: 0,
      positions: [],
      lastTradeTimestamp: null,
    };

    const proposedAmount = d.amount ?? calculatePositionSize(d.confidence, 1000, market.outcomes?.[0]?.price ?? 0.5);
    const riskCheck = runPreTradeChecks(
      proposedAmount,
      market.category,
      d.confidence,
      market.volume ?? 0,
      new Date(market.closesAt ?? "2027-01-01"),
      portfolio,
      market.marketId,
    );

    if (d.action === "hold") {
      pass(`Full pipeline: HOLD decision (confidence ${(d.confidence * 100).toFixed(0)}%)`);
    } else if (riskCheck.allowed) {
      pass(`Full pipeline: ${d.action.toUpperCase()} approved, $${proposedAmount.toFixed(2)} at ${(d.confidence * 100).toFixed(0)}% confidence`);
    } else {
      pass(`Full pipeline: ${d.action.toUpperCase()} blocked by risk check — ${riskCheck.reason}`);
    }

    console.log(`  [Pipeline] Total tokens used: ${analysis.tokensUsed + decision.tokensUsed}`);
    console.log(`  [Pipeline] Tool calls: ${analysis.toolCalls}`);

  } catch (err) {
    fail("Full pipeline integration", err);
  }
}

// ============================================================
// RUN ALL TESTS
// ============================================================
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     AgentArena AI Pipeline — Integration Test Suite      ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n  Date: ${new Date().toISOString()}`);
  console.log(`  Model: ${MODELS.qwen.model} (OpenRouter)`);
  console.log(`  Web Search: Exa AI`);
  console.log(`  Trading: ${process.env.EXECUTE_TRADES === "true" ? "ENABLED" : "DECISION-ONLY"}`);

  await testModelResolution();
  await testJupiterMarkets();
  await testExaWebSearch();
  await testGdeltSignals();
  await testCoinGecko();
  await testSignalProcessing();
  await testEdgeAndSizing();
  await testSignalWeights();
  await testLLMAnalysis();
  await testLLMDecision();
  await testRiskChecks();
  await testAlertService();
  await testFullPipeline();

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  RESULTS`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  ✅ Passed:  ${passed}`);
  console.log(`  ❌ Failed:  ${failed}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log(`  📊 Total:   ${passed + failed + skipped}`);
  console.log(`${"═".repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
