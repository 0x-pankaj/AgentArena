#!/usr/bin/env bun
/**
 * Run Politics Agent — Single Tick Test
 * 
 * Runs one complete tick of the Politics Agent with full pipeline:
 * 1. Market discovery (via Jupiter Predict or mock)
 * 2. Signal fetching (GDELT, ACLED, FRED)
 * 3. Market ranking & research
 * 4. Per-market analysis + Bayesian synthesis
 * 5. Decision making with adversarial review
 * 6. Risk checks + position sizing (True Kelly)
 * 
 * Usage: TEST_MODE=true bun run apps/api/run-politics-agent.ts
 */

import { initializeAgentRegistry, runAgentTick } from "./src/agents/registry";
import { redis } from "./src/utils/redis";
import { db, schema } from "./src/db";
import { eq } from "drizzle-orm";

// --- Colors for terminal output ---

const C = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function banner(text: string) {
  const line = "═".repeat(70);
  console.log(`\n${C.cyan}${C.bright}${line}${C.reset}`);
  console.log(`${C.cyan}${C.bright}  ${text}${C.reset}`);
  console.log(`${C.cyan}${C.bright}${line}${C.reset}\n`);
}

function section(text: string) {
  console.log(`\n${C.yellow}${C.bright}▶ ${text}${C.reset}`);
  console.log(`${C.dim}${"─".repeat(60)}${C.reset}`);
}

function success(text: string) {
  console.log(`${C.green}✓ ${text}${C.reset}`);
}

function info(label: string, value: string) {
  console.log(`  ${C.dim}${label}:${C.reset} ${C.bright}${value}${C.reset}`);
}

function warn(text: string) {
  console.log(`${C.yellow}⚠ ${text}${C.reset}`);
}

function error(text: string) {
  console.log(`${C.red}✗ ${text}${C.reset}`);
}

// --- Main ---

async function main() {
  const startTime = Date.now();

  banner("POLITICS AGENT — SINGLE TICK TEST");
  console.log(`${C.dim}Timestamp: ${new Date().toISOString()}${C.reset}`);
  console.log(`${C.dim}Mode: ${process.env.TEST_MODE === "true" ? "TEST (Mock APIs)" : "LIVE (Real APIs)"}${C.reset}`);
  console.log(`${C.dim}Enhanced Pipeline: ENABLED${C.reset}`);

  // Initialize agent registry
  section("Initializing Agent Registry");
  initializeAgentRegistry();
  success("Registry initialized");

  // Check Redis
  section("Checking Redis Connection");
  try {
    await redis.ping();
    success("Redis connected");
  } catch (err) {
    error("Redis not available — cannot run agent");
    console.error(err);
    process.exit(1);
  }

  // Find or create a mock job for politics agent
  section("Setting up Agent Context");

  let jobId: string;
  let walletId: string;
  let walletAddress: string;
  let ownerPubkey: string;
  let agentDbId: string;

  // Try to find an existing politics agent and job
  try {
    const existingAgents = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.category, "politics"))
      .limit(1);

    if (existingAgents.length > 0) {
      agentDbId = existingAgents[0].id;
      success(`Found politics agent in DB: ${agentDbId.slice(0, 8)}...`);
    } else {
      // Create a mock agent with UUID
      const [newAgent] = await db
        .insert(schema.agents)
        .values({
          ownerAddress: "mock-client-address",
          name: "Politics Agent",
          category: "politics",
          description: "Political prediction market agent",
          pricingModel: { type: "flat" },
          capabilities: ["gdelt", "acled", "fred"],
          isActive: true,
        })
        .returning();
      agentDbId = newAgent.id;
      success(`Created mock agent: ${agentDbId.slice(0, 8)}...`);
    }

    const existingJobs = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.agentId, agentDbId))
      .limit(1);

    if (existingJobs.length > 0) {
      const job = existingJobs[0];
      jobId = job.id;
      walletId = job.privyWalletId ?? "mock-wallet-id";
      walletAddress = job.privyWalletAddress ?? "mock-wallet-address";
      ownerPubkey = job.clientAddress;
      success(`Found existing job: ${jobId.slice(0, 8)}...`);
    } else {
      // Create a mock job
      const [newJob] = await db
        .insert(schema.jobs)
        .values({
          clientAddress: "mock-client-address",
          agentId: agentDbId,
          status: "active",
          totalInvested: "0",
          totalProfit: "0",
          privyWalletId: "mock-wallet-id",
          privyWalletAddress: "mock-wallet-address",
        })
        .returning();

      jobId = newJob.id;
      walletId = "mock-wallet-id";
      walletAddress = "mock-wallet-address";
      ownerPubkey = "mock-client-address";
      success(`Created mock job: ${jobId.slice(0, 8)}...`);
    }
  } catch (err) {
    error("Database not available — using in-memory mock");
    agentDbId = "politics-agent";
    jobId = "mock-job-" + Date.now();
    walletId = "mock-wallet-id";
    walletAddress = "mock-wallet-address";
    ownerPubkey = "mock-client-address";
  }

  info("Job ID", jobId.slice(0, 16) + "...");
  info("Agent", "politics-agent");
  info("Wallet", walletAddress.slice(0, 16) + "...");

  // Reset FSM state so agent starts fresh
  section("Resetting Agent State");
  await redis.del(`agent:stats:politics-agent:fsm`);
  await redis.del(`agent:stats:politics-agent:markets`);
  await redis.del(`agent:stats:politics-agent:last_analysis`);
  await redis.del(`agent:stats:politics-agent:decision`);
  success("Agent state reset — starting from IDLE");

  // Run the agent tick
  section("Running Agent Tick (this may take 30-90 seconds)...");
  console.log(`${C.dim}Pipeline stages: SCANNING → ANALYZING → (research → ranking → analysis → Bayesian → decision) → EXECUTING${C.reset}\n`);

  let result;
  try {
    result = await runAgentTick("politics-agent", {
      agentId: "politics-agent",
      jobId,
      agentWalletId: walletId,
      agentWalletAddress: walletAddress,
      ownerPubkey,
    });
  } catch (err) {
    error("Agent tick failed with exception");
    console.error(err);
    process.exit(1);
  }

  // Display results
  const duration = Date.now() - startTime;

  section("TICK RESULT");
  info("State", result.state);
  info("Action", result.action);
  info("Detail", result.detail);
  info("Duration", `${(duration / 1000).toFixed(1)}s`);

  if (result.decision) {
    const d = result.decision;
    section("TRADE DECISION");
    info("Action", d.action.toUpperCase());
    info("Market", d.marketQuestion ?? d.marketId ?? "N/A");
    info("Side", d.isYes ? "YES" : "NO");
    info("Amount", d.amount ? `$${d.amount.toFixed(2)}` : "N/A");
    info("Confidence", d.confidence ? `${(d.confidence * 100).toFixed(1)}%` : "N/A");
    info("Reasoning", d.reasoning ? d.reasoning.slice(0, 200) + "..." : "N/A");

    if (d.action === "buy") {
      success("Agent wants to BUY — this would execute in production");
    } else if (d.action === "hold") {
      warn("Agent chose HOLD — no trade this tick");
    }
  } else {
    warn("No decision produced this tick");
  }

  if (result.tokensUsed) {
    info("Tokens Used", result.tokensUsed.toLocaleString());
  }

  // Display any scan results
  if ((result as any).scanResult) {
    const scan = (result as any).scanResult;
    section("MARKET SCAN SUMMARY");
    if (scan.ranked) {
      info("Deep Research", `${scan.ranked.deep?.length ?? 0} markets`);
      info("Brief Research", `${scan.ranked.brief?.length ?? 0} markets`);
    }
    if (scan.research) {
      info("Total Searches", scan.research.totalSearches?.toString() ?? "N/A");
      info("Cache Hits", scan.research.cacheHits?.toString() ?? "N/A");
    }
  }

  // Show feed events
  section("RECENT FEED EVENTS");
  try {
    const recentEvents = await redis.lrange("feed:recent", 0, 20);
    if (recentEvents.length === 0) {
      warn("No feed events found");
    } else {
      for (const ev of recentEvents.slice(0, 10)) {
        try {
          const data = JSON.parse(ev);
          const emoji = data.severity === "critical" ? "🔴" : data.severity === "significant" ? "🟡" : "🔵";
          const stage = data.content?.pipeline_stage ? `[${data.content.pipeline_stage}]` : "";
          console.log(`  ${emoji} ${stage} ${data.displayMessage?.slice(0, 80) ?? ""}`);
        } catch {
          // skip malformed
        }
      }
    }
  } catch {
    warn("Could not fetch feed events");
  }

  // Performance summary
  section("OPTIMIZATION STATUS");
  info("Bayesian Update", `${C.green}FIXED (log-odds)${C.reset}`);
  info("Kelly Sizing", `${C.green}TRUE KELLY${C.reset}`);
  info("Multi-Model Consensus", `${C.yellow}REMOVED (saves ~$0.50/trade)${C.reset}`);
  info("Scenario Uncertainty", `${C.green}CONFIDENCE-CALIBRATED${C.reset}`);
  info("Correlation Learning", `${C.green}DYNAMIC (from outcomes)${C.reset}`);
  info("Order Flow Analysis", `${C.green}ENABLED${C.reset}`);
  info("Twitter Weighting", `${C.green}VOLUME-WEIGHTED${C.reset}`);
  info("Prompt Evolution", `${C.green}REGRET-WEIGHTED${C.reset}`);

  banner(`TICK COMPLETE — ${(duration / 1000).toFixed(1)}s`);

  // Exit cleanly
  await redis.quit();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});