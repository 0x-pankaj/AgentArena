#!/usr/bin/env bun
/**
 * Real Agent Tick Test — Simulates production flow with detailed step logging
 * 
 * Usage: bun run --env-file=../../.env test-agent-tick.ts [category]
 * Categories: politics, sports, crypto, general (default: general)
 */

import { eq, sql } from "drizzle-orm";
import { db, schema } from "./src/db";
import { redis } from "./src/utils/redis";
import { initializeAgentRegistry, runAgentTick, listRegisteredAgents } from "./src/agents/registry";
import type { AgentRuntimeContext } from "./src/ai/types";
import { nanoid } from "nanoid";

const TEST_WALLET = "TestUser000000000000000000000000000000000000";

function log(step: string, detail: string = "") {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`  [${ts}] ${step}${detail ? ` — ${detail}` : ""}`);
}

async function section(name: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${"═".repeat(60)}`);
}

async function cleanup() {
  try { await db.delete(schema.feedEvents).where(sql`true`); } catch {}
  try { await db.delete(schema.jobs).where(eq(schema.jobs.clientAddress, TEST_WALLET)); } catch {}
  try { await db.delete(schema.agents).where(eq(schema.agents.ownerAddress, TEST_WALLET)); } catch {}
  try { await db.delete(schema.users).where(eq(schema.users.walletAddress, TEST_WALLET)); } catch {}
  log("Cleaned up previous test data");
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     AgentArena — Real Agent Tick Test (Production Mode)  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  const categoryArg = process.argv.slice(2)[0] ?? "general";
  const validCategories = ["politics", "sports", "crypto", "general"];

  if (!validCategories.includes(categoryArg)) {
    console.error(`\n  Invalid category: ${categoryArg}`);
    console.error(`  Valid: ${validCategories.join(", ")}`);
    process.exit(1);
  }

  console.log(`\n  Category: ${categoryArg.toUpperCase()}`);
  console.log(`  Model: qwen/qwen3.6-plus:free (OpenRouter)`);
  console.log(`  Web Search: Exa AI`);
  console.log(`  Trading: ${process.env.EXECUTE_TRADES === "true" ? "ENABLED ⚠️" : "DECISION-ONLY (safe)"}`);

  // Cleanup
  await section("Cleanup");
  await cleanup();

  // Create test user
  await section("1. Creating Test User");
  await db.insert(schema.users).values({
    walletAddress: TEST_WALLET,
    username: `test_${nanoid(6)}`,
  }).onConflictDoNothing();
  log("Test user created", TEST_WALLET);

  // Create test agent
  await section("2. Creating Test Agent");
  const [agent] = await db
    .insert(schema.agents)
    .values({
      ownerAddress: TEST_WALLET,
      name: `Test ${categoryArg.charAt(0).toUpperCase() + categoryArg.slice(1)} Agent`,
      category: categoryArg,
      description: `Test agent for ${categoryArg} prediction markets`,
      pricingModel: { hourlyRate: 10, currency: "USDC" },
      capabilities: ["research", "analysis", "trading"],
      strategyConfig: { maxPositions: 3, maxPerPosition: 100, riskTolerance: "medium" },
      isActive: true,
      isVerified: true,
    })
    .returning();
  log("Test agent created", `${agent.name} (id: ${agent.id})`);

  // Create test job
  await section("3. Creating Test Job");
  const mockWalletId = `test_wallet_${nanoid(10)}`;
  const [job] = await db
    .insert(schema.jobs)
    .values({
      clientAddress: TEST_WALLET,
      agentId: agent.id,
      privyWalletId: mockWalletId,
      privyWalletAddress: "TestWallet0000000000000000000000000000000000",
      maxCap: "100",
      dailyCap: "500",
      status: "active",
      totalInvested: "1000",
      startedAt: new Date(),
    })
    .returning();
  log("Test job created", `${job.id}`);

  // Initialize registry
  await section("4. Initializing Agent Registry");
  initializeAgentRegistry();
  log("Registered agents", listRegisteredAgents().map(a => a.name).join(", "));

  // Run tick with timeout — use registry ID (category-based), not DB UUID
  await section("5. Running Agent Tick");
  const CATEGORY_TO_REGISTRY_ID: Record<string, string> = {
    politics: "politics-agent",
    sports: "sports-agent",
    crypto: "crypto-agent",
    general: "general-agent",
  };
  const registryId = CATEGORY_TO_REGISTRY_ID[categoryArg] ?? "general-agent";

  const ctx: AgentRuntimeContext = {
    agentId: agent.id, // DB UUID for context tracking
    jobId: job.id,
    agentWalletId: job.privyWalletId ?? "",
    agentWalletAddress: job.privyWalletAddress ?? "",
    ownerPubkey: job.clientAddress,
  };

  log("Starting tick...", `registryId=${registryId}, agentId=${agent.id}`);
  const startTime = Date.now();

  const tickPromise = runAgentTick(registryId, ctx);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Tick timed out after 300 seconds`)), 300_000);
  });

  try {
    const result = await Promise.race([tickPromise, timeoutPromise]);
    const elapsed = Date.now() - startTime;

    console.log(`\n${"─".repeat(60)}`);
    log(`Tick completed in ${elapsed}ms`);
console.log(`${"─".repeat(60)}`);
  log(`State`, result.state);
    log(`Action`, result.action);
    log(`Detail`, result.detail);
    log(`Tokens`, String(result.tokensUsed ?? 0));

    if (result.decision) {
      const d = result.decision;
      console.log(`\n  ┌─ Decision ──────────────────────────────────────────┐`);
      log(`Action`, d.action.toUpperCase());
      log(`Confidence`, `${(d.confidence * 100).toFixed(0)}%`);
      if (d.marketQuestion) log(`Market`, d.marketQuestion.slice(0, 80));
      if (d.amount) log(`Amount`, `$${d.amount.toFixed(2)}`);
      if (d.isYes !== undefined) log(`Side`, d.isYes ? "YES" : "NO");
      log(`Reasoning`, d.reasoning.slice(0, 200));
      console.log(`  └─────────────────────────────────────────────────────┘`);
    }

    // Check feed events
    try {
      const feedEvents = await redis.zrange("feed:recent", 0, -1);
      log(`Feed events published`, `${feedEvents.length}`);
      if (feedEvents.length > 0) {
        const last = JSON.parse(feedEvents[feedEvents.length - 1]);
        log(`Last feed event`, last.displayMessage?.slice(0, 100) ?? "no message");
      }
    } catch {}

    const success = result.action !== "skipped";
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  RESULT: ${success ? "✅ PASSED" : "❌ FAILED"}`);
    console.log(`${"═".repeat(60)}\n`);
    process.exit(success ? 0 : 1);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.log(`\n${"─".repeat(60)}`);
    log(`Tick failed after ${elapsed}ms`);
    log(`Error`, err instanceof Error ? err.message : String(err));
    console.log(`${"─".repeat(60)}`);

    // Check what feed events were published before failure
    try {
      const feedEvents = await redis.zrange("feed:recent", 0, -1);
      log(`Feed events before failure`, `${feedEvents.length}`);
      for (const evt of feedEvents.slice(-5)) {
        const parsed = JSON.parse(evt);
        log(`  → ${parsed.displayMessage?.slice(0, 80) ?? "no message"}`);
      }
    } catch {}

    console.log(`\n${"═".repeat(60)}`);
    console.log(`  RESULT: ❌ FAILED (timeout or error)`);
    console.log(`${"═".repeat(60)}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
