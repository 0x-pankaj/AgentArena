#!/usr/bin/env tsx
/**
 * Unit tests for the enhanced pipeline services.
 * Tests market-ranking, research-cache, improved-bayesian, and per-market-analysis
 * without requiring Redis, DB, or external API calls.
 * 
 * Usage: npx tsx apps/api/test-enhanced-pipeline.ts
 */

// ============================================================
// Test 1: Market Ranking
// ============================================================
import { scoreMarket, rankMarkets, extractSearchQuery, generateExtraSearchQueries } from "./src/services/market-ranking";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

function testMarketRanking() {
  console.log("\n═══ Test 1: Market Ranking ═══");

  // Test extractSearchQuery
  const q1 = extractSearchQuery("Will Bitcoin reach $100k by March 2025?");
  console.log(`  extractSearchQuery("Will Bitcoin reach $100k by March 2025?") = "${q1}"`);
  assert(q1.includes("bitcoin") && q1.includes("100k"), `Expected "bitcoin" and "100k" in query, got "${q1}"`);
  assert(!q1.includes("will"), `Stop word "will" should be removed, got "${q1}"`);

  const q2 = extractSearchQuery("Will the Fed cut interest rates in January?");
  console.log(`  extractSearchQuery("Will the Fed cut interest rates in January?") = "${q2}"`);
  assert(q2.includes("fed"), `Expected "fed" in query, got "${q2}"`);
  assert(!q2.includes("will"), `Stop word "will" should be removed, got "${q2}"`);

  // Test scoreMarket — established market
  const establishedMarket = {
    marketId: "m1",
    question: "Will Bitcoin reach $100k by March 2025?",
    outcomes: [{ name: "Yes", price: 0.35 }, { name: "No", price: 0.65 }],
    volume: 450000,
    liquidity: 50000,
    closesAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const scored1 = scoreMarket(establishedMarket);
  console.log(`  Established market (vol=$450K, price=0.35): score=${scored1.score.toFixed(3)}, isNew=${scored1.isNewMarket}, priority=${scored1.researchPriority}`);
  assert(!scored1.isNewMarket, "Established market should NOT be flagged as new");
  assert(scored1.scoreBreakdown.newMarketBonus === 1.0, `newMarketBonus should be 1.0 for established, got ${scored1.scoreBreakdown.newMarketBonus}`);

  // Test scoreMarket — new/low-volume market
  const newMarket = {
    marketId: "m2",
    question: "Will the Fed cut rates in January 2025?",
    outcomes: [{ name: "Yes", price: 0.45 }, { name: "No", price: 0.55 }],
    volume: 8000,
    liquidity: 2000,
    closesAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const scored2 = scoreMarket(newMarket);
  console.log(`  New market (vol=$8K, price=0.45): score=${scored2.score.toFixed(3)}, isNew=${scored2.isNewMarket}, priority=${scored2.researchPriority}`);
  assert(scored2.isNewMarket, "Low-volume market with uncertain price should be flagged as new");
  assert(scored2.scoreBreakdown.newMarketBonus >= 1.4, `newMarketBonus should be >= 1.4 for new market, got ${scored2.scoreBreakdown.newMarketBonus}`);
  assert(scored2.researchPriority === "deep", `New market should have deep research priority, got ${scored2.researchPriority}`);

  // Test that new market scores higher than established
  console.log(`  New market score (${scored2.score.toFixed(3)}) > Established score (${scored1.score.toFixed(3)}): ${scored2.score > scored1.score}`);
  assert(scored2.score > scored1.score, "New/emerging market should score higher than established market");

  // Test generateExtraSearchQueries
  const extraQueries = generateExtraSearchQueries(scored2);
  console.log(`  Extra queries for new market: ${JSON.stringify(extraQueries)}`);
  assert(extraQueries.length >= 2, `New market should have >= 2 extra queries, got ${extraQueries.length}`);

  // Test rankMarkets
  const markets = [
    establishedMarket,
    newMarket,
    {
      marketId: "m3",
      question: "Will ETH flip BTC by 2026?",
      outcomes: [{ name: "Yes", price: 0.12 }, { name: "No", price: 0.88 }],
      volume: 120000,
      liquidity: 15000,
      closesAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      marketId: "m4",
      question: "Will SOL hit $500 by end of 2025?",
      outcomes: [{ name: "Yes", price: 0.42 }, { name: "No", price: 0.58 }],
      volume: 80000,
      liquidity: 10000,
      closesAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  const ranked = rankMarkets(markets, 7, 10);
  console.log(`  Ranked ${markets.length} markets:`);
  console.log(`    Deep: ${ranked.deep.map(m => `"${m.question.slice(0, 30)}..." (score=${m.score.toFixed(3)}${m.isNewMarket ? " NEW" : ""})`).join(", ")}`);
  console.log(`    Brief: ${ranked.brief.map(m => `"${m.question.slice(0, 30)}..." (score=${m.score.toFixed(3)})`).join(", ")}`);
  assert(ranked.deep.length <= 10, `Deep markets should be <= 10, got ${ranked.deep.length}`);
  assert(ranked.deep.length >= 1, `Should have at least 1 deep market`);
  assert(ranked.deep[0].score >= ranked.deep[ranked.deep.length - 1]?.score ?? 0, "Deep markets should be sorted by score descending");

  console.log("  ✅ Market ranking tests PASSED");
}

// ============================================================
// Test 2: Improved Bayesian Synthesis
// ============================================================
import { runImprovedBayesianSynthesis, selectBestMarket } from "./src/services/improved-bayesian";
import type { RankedMarket } from "./src/services/market-ranking";
import type { PerMarketAnalysis } from "./src/services/per-market-analysis";
import type { SharedSignals } from "./src/services/signal-cache";

function testImprovedBayesian() {
  console.log("\n═══ Test 2: Improved Bayesian Synthesis ═══");

  const markets: RankedMarket[] = [
    {
      marketId: "btc-100k",
      question: "Will BTC reach $100k by March 2025?",
      outcomes: [{ name: "Yes", price: 0.35 }, { name: "No", price: 0.65 }],
      volume: 450000,
      liquidity: 50000,
      closesAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      rank: 1,
      score: 0.8,
      scoreBreakdown: { edgePotential: 0.7, volumeConfidence: 0.95, timeSweetSpot: 1.0, freshnessBonus: 1.0, newMarketBonus: 1.0 },
      isNewMarket: false,
      researchPriority: "deep" as const,
    },
    {
      marketId: "fed-cut",
      question: "Will the Fed cut rates in January 2025?",
      outcomes: [{ name: "Yes", price: 0.45 }, { name: "No", price: 0.55 }],
      volume: 8000,
      liquidity: 2000,
      closesAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      rank: 2,
      score: 1.5,
      scoreBreakdown: { edgePotential: 0.9, volumeConfidence: 0.89, timeSweetSpot: 0.95, freshnessBonus: 1.3, newMarketBonus: 1.6 },
      isNewMarket: true,
      researchPriority: "deep" as const,
    },
  ];

  // LLM analysis says BTC 100k is 42% likely (market says 35%)
  // LLM analysis says Fed cut is 18% likely (market says 45%)
  const analyses = new Map<string, PerMarketAnalysis>();
  analyses.set("btc-100k", {
    marketId: "btc-100k",
    probability: 0.42,
    confidence: 0.78,
    reasoning: "BTC momentum strong, ETF inflows driving price action",
    keyFactors: ["ETF inflows", "momentum", "institutional adoption"],
    risks: ["regulatory risk", "market correction"],
    evidenceQuality: "moderate",
    sourcesUsed: 5,
    recommendation: "buy",
  });
  analyses.set("fed-cut", {
    marketId: "fed-cut",
    probability: 0.18,
    confidence: 0.65,
    reasoning: "Fed signals suggest holding rates steady, not cutting",
    keyFactors: ["Fed statements", "inflation data", "employment"],
    risks: ["low liquidity", "thin orderbook"],
    evidenceQuality: "weak",
    recommendation: "speculative",
  });

  const signals: SharedSignals = {
    gdelt: {},
    acled: {},
    fred: {},
    fires: {},
    fetchedAt: new Date().toISOString(),
    agentType: "crypto",
  };

  const researchData = new Map();

  const calibratedWeights: Record<string, number> = {};

  const results = runImprovedBayesianSynthesis(markets, analyses, signals, researchData, calibratedWeights, 5, "crypto");

  console.log("  Bayesian synthesis results:");
  for (const r of results) {
    console.log(`    ${r.marketQuestion.slice(0, 40)}: prior=${r.prior.toFixed(2)} → posterior=${r.posterior.toFixed(2)} | edge=${r.edgeDirection} ${(r.edgeMagnitude * 100).toFixed(1)}% | confidence=${r.confidence.toFixed(2)} | evidence=${r.evidence.length}`);
  }

  // BTC: LLM says 42%, market says 35% YES
  // With no signal data, posterior should shift based on LLM analysis
  // Direction depends on evidence weight vs prior strength
  const btcResult = results.find(r => r.marketId === "btc-100k")!;
  console.log(`  BTC: prior=${btcResult.prior.toFixed(3)}, posterior=${btcResult.posterior.toFixed(3)}, edge=${btcResult.edgeDirection} ${(btcResult.edgeMagnitude * 100).toFixed(1)}%`);
  assert(btcResult.evidence.length >= 1, "BTC should have at least 1 evidence item (LLM analysis)");

  // Fed: LLM says 18%, market says 45% YES → strong NO edge
  const fedResult = results.find(r => r.marketId === "fed-cut")!;
  console.log(`  Fed: prior=${fedResult.prior.toFixed(3)}, posterior=${fedResult.posterior.toFixed(3)}, edge=${fedResult.edgeDirection} ${(fedResult.edgeMagnitude * 100).toFixed(1)}%`);
  assert(fedResult.posterior < fedResult.prior, `Fed posterior (${fedResult.posterior.toFixed(3)}) should be < prior (${fedResult.prior.toFixed(3)}) when LLM says 18% vs market 45%`);
  assert(fedResult.edgeDirection === "no", `Fed should have NO edge direction when LLM strongly disagrees, got ${fedResult.edgeDirection}`);

  // Test selectBestMarket
  const bestMarkets = selectBestMarket(results, analyses, [], 10000);
  console.log(`  Best markets (${bestMarkets.length}):`);
  for (const b of bestMarkets) {
    console.log(`    #${b.rank} "${b.marketQuestion.slice(0, 40)}..." edge=${(b.edgeMagnitude * 100).toFixed(1)}% ${b.edgeDirection} conf=${(b.confidence * 100).toFixed(0)}% ${b.isNewMarket ? "[NEW]" : ""} rec=${b.recommendation}`);
  }
  assert(bestMarkets.length >= 1, "Should find at least 1 market with edge > 5%");

  console.log("  ✅ Bayesian synthesis tests PASSED");
}

// ============================================================
// Test 3: Select Best Market with Positions
// ============================================================
function testSelectBestMarketWithPositions() {
  console.log("\n═══ Test 3: Market Selection with Positions ═══");

  const markets: RankedMarket[] = [
    {
      marketId: "m1",
      question: "Test market 1",
      outcomes: [{ name: "Yes", price: 0.5 }, { name: "No", price: 0.5 }],
      volume: 50000,
      liquidity: 10000,
      closesAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      rank: 1,
      score: 0.8,
      scoreBreakdown: { edgePotential: 0.5, volumeConfidence: 0.9, timeSweetSpot: 1.0, freshnessBonus: 1.0, newMarketBonus: 1.0 },
      isNewMarket: false,
      researchPriority: "standard" as const,
    },
  ];

  const analyses = new Map<string, PerMarketAnalysis>();
  analyses.set("m1", {
    marketId: "m1",
    probability: 0.65,
    confidence: 0.80,
    reasoning: "Strong edge detected",
    keyFactors: ["factor 1"],
    risks: ["risk 1"],
    evidenceQuality: "moderate",
    sourcesUsed: 3,
    recommendation: "buy",
  });

  // Test: No positions, should select market
  const noPositionResult = selectBestMarket(
    [{ marketId: "m1", marketQuestion: "Test market 1", posterior: 0.65, prior: 0.5, confidence: 0.80, edgeDirection: "yes" as const, edgeMagnitude: 0.15, evidence: [], isNewMarket: false }],
    analyses,
    [],
    10000,
    0.05,
    0.6
  );
  console.log(`  No positions: ${noPositionResult.length} markets selected`);
  assert(noPositionResult.length === 1, "Should select 1 market with no positions");

  // Test: Already have position in m1, should NOT select it
  const positions = [{ marketId: "m1", side: "yes", amount: 100, entryPrice: 0.5, currentPrice: 0.52, pnl: 2 }];
  const withPositionResult = selectBestMarket(
    [{ marketId: "m1", marketQuestion: "Test market 1", posterior: 0.65, prior: 0.5, confidence: 0.80, edgeDirection: "yes" as const, edgeMagnitude: 0.15, evidence: [], isNewMarket: false }],
    analyses,
    positions as any,
    10000,
    0.05,
    0.6
  );
  console.log(`  With existing position: ${withPositionResult.length} markets selected (should be 0)`);
  assert(withPositionResult.length === 0, "Should NOT select market with existing position");

  console.log("  ✅ Market selection tests PASSED");
}

// ============================================================
// Test 4: Edge cases
// ============================================================
function testEdgeCases() {
  console.log("\n═══ Test 4: Edge Cases ═══");

  // Test: Market with extreme prices (0.95 YES)
  const extremeMarket = {
    marketId: "ext1",
    question: "Will the sun rise tomorrow?",
    outcomes: [{ name: "Yes", price: 0.95 }, { name: "No", price: 0.05 }],
    volume: 500000,
    liquidity: 100000,
    closesAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const extreme = scoreMarket(extremeMarket);
  console.log(`  Extreme price (0.95 YES): score=${extreme.score.toFixed(3)}, edgePotential=${extreme.scoreBreakdown.edgePotential.toFixed(3)}`);
  assert(extreme.scoreBreakdown.edgePotential < 0.3, "Extreme price should have low edge potential");

  // Test: Market with no close date
  const noCloseMarket = {
    marketId: "nc1",
    question: "Will X happen eventually?",
    outcomes: [{ name: "Yes", price: 0.5 }, { name: "No", price: 0.5 }],
    volume: 10000,
    liquidity: 5000,
    closesAt: null,
  };
  const noclose = scoreMarket(noCloseMarket);
  console.log(`  No close date: score=${noclose.score.toFixed(3)}, timeSweetSpot=${noclose.scoreBreakdown.timeSweetSpot.toFixed(2)}`);
  assert(noclose.scoreBreakdown.timeSweetSpot === 0.8, "Market without close date should have timeSweetSpot=0.8");

  // Test: Empty markets array
  const emptyRanked = rankMarkets([], 7, 10);
  assert(emptyRanked.deep.length === 0, "Empty markets should produce empty deep array");
  assert(emptyRanked.brief.length === 0, "Empty markets should produce empty brief array");

  // Test: Search query extraction
  const queries = [
    "Will Bitcoin reach $100k by March 2025?",
    "Is the US going to enter a recession in 2025?",
    "Will team A beat team B in the NBA finals?",
    "Will ETH be above $5,000 on June 1st?",
  ];
  console.log("  Search queries:");
  for (const q of queries) {
    const extracted = extractSearchQuery(q);
    console.log(`    "${q}" → "${extracted}"`);
    assert(extracted.length > 0, `Query extraction should produce non-empty result for "${q}"`);
    assert(!extracted.includes("will"), `Should remove "will" from "${q}"`);
  }

  console.log("  ✅ Edge case tests PASSED");
}

// ============================================================
// Test 5: Analysis Cursor (Sliding Window)
// ============================================================
import { planNextTickAnalysis, mergeAnalyzedMarkets, selectMarketFromHistory, type AnalysisCursor, type AnalyzedMarket } from "./src/services/analysis-cursor";

function testAnalysisCursor() {
  console.log("\n═══ Test 5: Analysis Cursor (Sliding Window) ═══");

  // Create 15 ranked markets
  const markets: RankedMarket[] = [];
  for (let i = 0; i < 15; i++) {
    markets.push({
      marketId: `m${i + 1}`,
      question: `Market ${i + 1}: Will something happen?`,
      outcomes: [{ name: "Yes", price: 0.3 + Math.random() * 0.4 }, { name: "No", price: 0.3 + Math.random() * 0.4 }],
      volume: 10000 + i * 5000,
      liquidity: 2000 + i * 1000,
      closesAt: new Date(Date.now() + (5 - i * 0.3) * 24 * 60 * 60 * 1000).toISOString(),
      rank: i + 1,
      score: 1.5 - i * 0.1,
      scoreBreakdown: { edgePotential: 0.5, volumeConfidence: 0.8, timeSweetSpot: 0.9, freshnessBonus: 1.0, newMarketBonus: 1.0 },
      isNewMarket: i < 3,
      researchPriority: "deep" as const,
    });
  }

  // Tick 1: No previous cursor — should analyze top 6
  const plan1 = planNextTickAnalysis(markets, null, 5, 6, 2, 8);
  console.log(`  Tick 1 (fresh): window ${plan1.windowStart + 1}-${plan1.windowEnd}, fresh=${plan1.freshMarkets.length}, cached=${plan1.cachedMarkets.length}`);
  assert(plan1.freshMarkets.length === 6, `Tick 1 should have 6 fresh markets, got ${plan1.freshMarkets.length}`);
  assert(plan1.cachedMarkets.length === 0, `Tick 1 should have 0 cached markets, got ${plan1.cachedMarkets.length}`);

  // Simulate Tick 1 results
  const tick1Analyses: AnalyzedMarket[] = plan1.freshMarkets.map((m, i) => ({
    marketId: m.marketId,
    question: m.question,
    probability: 0.3 + i * 0.05,
    confidence: 0.7 + i * 0.02,
    recommendation: i < 2 ? "buy" : "hold",
    evidenceQuality: "moderate" as const,
    isNewMarket: i < 3,
    analyzedAt: Date.now(),
    tickCount: 1,
    bayesianPosterior: 0.35 + i * 0.04,
    bayesianEdge: 0.05 + i * 0.02,
    bayesianDirection: i % 2 === 0 ? "yes" : "no",
  }));

  const cursor1: AnalysisCursor = {
    agentId: "test-agent",
    lastTickRank: 6,
    tickCount: 1,
    updatedAt: Date.now(),
    analyzedMarkets: tick1Analyses,
  };

  // Tick 2: Should overlap last 2 and add new ones
  const plan2 = planNextTickAnalysis(markets, cursor1, 5, 6, 2, 8);
  console.log(`  Tick 2 (sliding): window ${plan2.windowStart + 1}-${plan2.windowEnd}, fresh=${plan2.freshMarkets.length}, cached=${plan2.cachedMarkets.length}`);
  assert(plan2.cachedMarkets.length > 0, `Tick 2 should have some cached markets from tick 1`);
  assert(plan2.freshMarkets.length >= 2, `Tick 2 should have at least 2 fresh markets`);

  // Tick 3: Should go even deeper
  const tick2Analyses: AnalyzedMarket[] = plan2.freshMarkets.map((m, i) => ({
    marketId: m.marketId,
    question: m.question,
    probability: 0.3 + i * 0.05,
    confidence: 0.7 + i * 0.02,
    recommendation: "speculative" as const,
    evidenceQuality: "moderate" as const,
    isNewMarket: false,
    analyzedAt: Date.now(),
    tickCount: 2,
    bayesianPosterior: 0.35 + i * 0.04,
    bayesianEdge: 0.05 + i * 0.02,
    bayesianDirection: "yes" as const,
  }));

  const merged = mergeAnalyzedMarkets(cursor1.analyzedMarkets, tick2Analyses);
  console.log(`  Merged analysis history: ${merged.length} total analyzed markets`);
  assert(merged.length > 6, `Merged should have more than 6 markets, got ${merged.length}`);

  // Select best from combined results
  const candidates = selectMarketFromHistory(
    new Map(plan2.freshMarkets.map((m, i) => [m.marketId, { marketId: m.marketId, probability: tick2Analyses[i]?.probability ?? 0.5, confidence: tick2Analyses[i]?.confidence ?? 0.6, reasoning: "", keyFactors: [], risks: [], evidenceQuality: "moderate" as const, sourcesUsed: 3, recommendation: "speculative" as const }])),
    merged,
    [],
    [],
    0.05,
    0.6
  );

  console.log(`  Best candidates from combined history: ${candidates.length}`);
  console.log(`  ✅ Analysis cursor tests PASSED`);
}

// ============================================================
// Run all tests
// ============================================================
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     Enhanced Pipeline — Unit Tests                        ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  try {
    testMarketRanking();
    testImprovedBayesian();
    testSelectBestMarketWithPositions();
    testEdgeCases();
    testAnalysisCursor();

    console.log("\n╔══════════════════════════════════════════════════════════╗");
    console.log("║     ✅ ALL TESTS PASSED                                   ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");
    process.exit(0);
  } catch (err) {
    console.error("\n╔══════════════════════════════════════════════════════════╗");
    console.error("║     ❌ TEST FAILED                                        ║");
    console.error("╚══════════════════════════════════════════════════════════╝\n");
    console.error(err);
    process.exit(1);
  }
}

main();