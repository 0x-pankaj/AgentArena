#!/usr/bin/env bun
/**
 * Data Sources Test — Tests all web search and signal data sources
 * 
 * Tests:
 * 1. Exa Web Search (primary)
 * 2. GDELT (news tone)
 * 3. CoinGecko (crypto prices)
 * 4. DeFiLlama (TVL data)
 * 5. FRED (macro indicators)
 * 6. ACLED (conflict data)
 * 7. NASA FIRMS (satellite fire data)
 * 8. Sports Odds (if API key configured)
 * 9. Twitter/X (if bearer token configured)
 */

import { webSearch } from "./src/services/web-search";
import { searchGdelt, getGeoSignals } from "./src/data-sources/gdelt";
import { getCryptoSignals, getGlobalMarket } from "./src/data-sources/coingecko";
import { getDeFiSignals, getSolanaTVL } from "./src/data-sources/defillama";
import { getKeyMacroSignals } from "./src/data-sources/fred";
import { getRegionalConflictSignals } from "./src/data-sources/acled";
import { getAllRegionalFireSignals } from "./src/data-sources/nasa-firms";
import { getSportsSignals } from "./src/data-sources/sports-odds";
import { getSharedSignals } from "./src/services/signal-cache";

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(test: string, detail: string = "") {
  passed++;
  console.log(`  ✅ ${test}${detail ? ` — ${detail}` : ""}`);
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
// 1. Exa Web Search
// ============================================================
async function testExaWebSearch() {
  await section("1. Exa Web Search");

  const queries = [
    "Bitcoin prediction market 2026",
    "US election odds Polymarket",
    "crypto ETF approval news",
    "Solana DeFi TVL growth",
    "Fed interest rate decision April 2026",
  ];

  for (const query of queries) {
    try {
      const results = await webSearch(query, 3);
      if (results.length > 0) {
        pass(`Exa: "${query.slice(0, 40)}..."`, `${results.length} results`);
      } else {
        skip(`Exa: "${query.slice(0, 40)}..."`, "No results");
      }
    } catch (err) {
      fail(`Exa: "${query.slice(0, 40)}..."`, err);
    }
  }
}

// ============================================================
// 2. GDELT News Tone
// ============================================================
async function testGdelt() {
  await section("2. GDELT — Global News Tone");

  try {
    const results = await searchGdelt({
      query: "prediction markets",
      mode: "artlist",
      timespan: "7d",
      maxRecords: 5,
    });
    if (results.articles && results.articles.length > 0) {
      pass("GDELT search", `${results.articles.length} articles`);
      console.log(`     Top: ${results.articles[0].title?.slice(0, 60)}`);
    } else {
      skip("GDELT search", "No articles found");
    }
  } catch (err) {
    fail("GDELT search", err);
  }

  try {
    const signals = await getGeoSignals();
    const keys = Object.keys(signals);
    if (keys.length > 0) {
      pass("GDELT signals", `${keys.length} topics tracked`);
      for (const [key, signal] of Object.entries(signals).slice(0, 3)) {
        console.log(`     ${key}: tone=${signal.avgTone?.toFixed(2)}, articles=${signal.articleCount}`);
      }
    } else {
      skip("GDELT signals", "No topics tracked");
    }
  } catch (err) {
    fail("GDELT signals", err);
  }
}

// ============================================================
// 3. CoinGecko Crypto Prices
// ============================================================
async function testCoinGecko() {
  await section("3. CoinGecko — Crypto Prices & Market Data");

  try {
    const signals = await getCryptoSignals();
    const coins = Object.keys(signals);
    if (coins.length > 0) {
      pass("CoinGecko prices", `${coins.length} coins tracked`);
      for (const [symbol, data] of Object.entries(signals).slice(0, 5)) {
        console.log(`     ${symbol}: $${data.price?.toFixed(2)} | 24h: ${data.change24h?.toFixed(1)}% | 7d: ${data.change7d?.toFixed(1)}%`);
      }
    } else {
      fail("CoinGecko prices", new Error("No coins tracked"));
    }
  } catch (err) {
    fail("CoinGecko prices", err);
  }

  try {
    const global = await getGlobalMarket();
    if (global && (global as any).totalMarketCap) {
      const mc = (global as any).totalMarketCap;
      pass("CoinGecko global", `Market cap: $${(mc / 1e9).toFixed(1)}B | BTC dom: ${(global as any).btcDominance?.toFixed(1)}%`);
    } else if (global) {
      pass("CoinGecko global", "Data returned");
    } else {
      fail("CoinGecko global", new Error("No data"));
    }
  } catch (err) {
    fail("CoinGecko global", err);
  }
}

// ============================================================
// 4. DeFiLlama TVL
// ============================================================
async function testDefiLlama() {
  await section("4. DeFiLlama — Protocol TVL");

  try {
    const defi = await getDeFiSignals();
    const protocols = Object.keys(defi.protocols);
    if (protocols.length > 0) {
      pass("DeFiLlama protocols", `${protocols.length} tracked`);
      for (const [name, proto] of Object.entries(defi.protocols).slice(0, 5)) {
        console.log(`     ${name}: $${(proto.tvl / 1e9).toFixed(2)}B | 7d: ${proto.tvlChange7d?.toFixed(1)}%`);
      }
    } else {
      fail("DeFiLlama protocols", new Error("No protocols tracked"));
    }
  } catch (err) {
    fail("DeFiLlama protocols", err);
  }

  try {
    const solana = await getSolanaTVL();
    if (solana && solana.totalTvl) {
      pass("Solana TVL", `$${(solana.totalTvl / 1e9).toFixed(2)}B | 7d: ${solana.tvlChange7d?.toFixed(1)}%`);
    } else {
      skip("Solana TVL", "No data");
    }
  } catch (err) {
    fail("Solana TVL", err);
  }
}

// ============================================================
// 5. FRED Macro Indicators
// ============================================================
async function testFred() {
  await section("5. FRED — Macro Economic Indicators");

  try {
    const signals = await getKeyMacroSignals();
    const keys = Object.keys(signals);
    if (keys.length > 0) {
      pass("FRED indicators", `${keys.length} tracked`);
      for (const [key, signal] of Object.entries(signals)) {
        console.log(`     ${key}: ${signal.latestValue} | ${signal.trend} ${signal.changePercent?.toFixed(2)}%`);
      }
    } else {
      skip("FRED indicators", "No indicators tracked");
    }
  } catch (err) {
    fail("FRED indicators", err);
  }
}

// ============================================================
// 6. ACLED Conflict Data
// ============================================================
async function testAcled() {
  await section("6. ACLED — Conflict Data");

  try {
    const signals = await getRegionalConflictSignals();
    const regions = Object.keys(signals);
    if (regions.length > 0) {
      pass("ACLED regions", `${regions.length} tracked`);
      for (const [region, signal] of Object.entries(signals).slice(0, 3)) {
        console.log(`     ${region}: ${signal.totalEvents} events | delta7d: ${signal.delta7d?.toFixed(1)}%`);
      }
    } else {
      skip("ACLED regions", "No regions tracked (may need API key)");
    }
  } catch (err) {
    fail("ACLED regions", err);
  }
}

// ============================================================
// 7. NASA FIRMS Satellite Data
// ============================================================
async function testNasaFirms() {
  await section("7. NASA FIRMS — Satellite Fire Data");

  try {
    const signals = await getAllRegionalFireSignals();
    const regions = Object.keys(signals);
    if (regions.length > 0) {
      pass("NASA FIRMS regions", `${regions.length} tracked`);
      for (const [region, signal] of Object.entries(signals).slice(0, 3)) {
        console.log(`     ${region}: ${signal.hotspotCount} hotspots | FRP: ${signal.totalFrp?.toFixed(1)} MW`);
      }
    } else {
      skip("NASA FIRMS regions", "No regions tracked");
    }
  } catch (err) {
    fail("NASA FIRMS regions", err);
  }
}

// ============================================================
// 8. Sports Odds
// ============================================================
async function testSportsOdds() {
  await section("8. Sports Odds");

  if (!process.env.ODDS_API_KEY) {
    skip("Sports odds", "No ODDS_API_KEY configured");
    return;
  }

  try {
    const signals = await getSportsSignals();
    const sports = Object.keys(signals);
    if (sports.length > 0) {
      pass("Sports signals", `${sports.length} sports tracked`);
      for (const [sport, signal] of Object.entries(signals).slice(0, 3)) {
        console.log(`     ${sport}: ${signal.totalEvents} events | sharp: ${signal.sharpMoneyIndicator?.toFixed(2)}`);
      }
    } else {
      skip("Sports signals", "No events found");
    }
  } catch (err) {
    fail("Sports signals", err);
  }
}

// ============================================================
// 9. Shared Signals (Agent-Aware Cache)
// ============================================================
async function testSharedSignals() {
  await section("9. Shared Signals — Agent-Aware Cache");

  for (const agentType of ["general", "crypto", "politics"]) {
    try {
      const signals = await getSharedSignals(agentType);
      const sources: string[] = [];
      if (Object.keys(signals.gdelt).length > 0) sources.push("gdelt");
      if (Object.keys(signals.acled).length > 0) sources.push("acled");
      if (Object.keys(signals.fred).length > 0) sources.push("fred");
      if (Object.keys(signals.fires).length > 0) sources.push("fires");
      if (signals.crypto) sources.push("crypto");
      if (signals.sports) sources.push("sports");

      if (sources.length > 0) {
        pass(`${agentType} signals`, `${sources.join(", ")}`);
      } else {
        skip(`${agentType} signals`, "No sources available");
      }
    } catch (err) {
      fail(`${agentType} signals`, err);
    }
  }
}

// ============================================================
// RUN ALL
// ============================================================
async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     AgentArena — Data Sources Test Suite                 ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\n  Date: ${new Date().toISOString()}`);

  await testExaWebSearch();
  await testGdelt();
  await testCoinGecko();
  await testDefiLlama();
  await testFred();
  await testAcled();
  await testNasaFirms();
  await testSportsOdds();
  await testSharedSignals();

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
