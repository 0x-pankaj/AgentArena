import { eq, sql } from "drizzle-orm";
import { TEST_MODE, TEST_WALLET_BALANCE_USDC, TEST_WALLET_BALANCE_SOL, DEPLOY_PHASE, IS_SIMULATED, IS_PRODUCTION, EMERGENCY_STOP, DEFAULT_PAPER_BALANCE_USDC } from "@agent-arena/shared";
import { db, schema } from "../db";
import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import {
  runAgentTick,
  initializeAgentRegistry,
  listRegisteredAgents,
} from "./registry";
import type { AgentRuntimeContext, AgentTickResult } from "../ai/types";
import { publishFeedEvent, buildFeedEvent } from "../feed";
import { createAgentWallet, fundAgentWallet } from "../utils/privy";
import { getEffectiveBalance } from "../utils/balance";
import { createAgentPolicy } from "../utils/privy-policies";
import { buildInitializeJobTx, getJobProfilePDA } from "../anchor/job-client";
import { PublicKey } from "@solana/web3.js";
import { startBackgroundPositionMonitor, stopBackgroundPositionMonitor } from "../services/position-monitor";
import { preFlightPositionSync } from "../services/position-monitor";

// --- Category to registry ID mapping ---

const CATEGORY_TO_REGISTRY_ID: Record<string, string> = {
  politics: "politics-agent",
  sports: "sports-agent",
  crypto: "crypto-agent",
  general: "general-agent",
  geo: "general-agent",
};

// --- Active agent tracking ---

interface ActiveAgent {
  ctx: AgentRuntimeContext;
  intervalId: ReturnType<typeof setInterval> | null;
  lastRun: number;
  lastResult: AgentTickResult | null;
  running: boolean;
  tickRunning: boolean;
}

const activeAgents = new Map<string, ActiveAgent>();

// --- Initialize supervisor (call on server boot) ---

export function initializeSupervisor(): void {
  initializeAgentRegistry();
  console.log(
    "[Supervisor] Initialized with agents:",
    listRegisteredAgents().map((a) => a.name).join(", ")
  );
}

// --- Hire an agent (create job, provision Privy wallet, build on-chain tx) ---

export async function hireAgent(params: {
  agentId: string;
  clientAddress: string;
  maxCap: number;
  dailyCap: number;
}): Promise<{
  jobId: string;
  privyWalletAddress?: string;
  onChainAddress?: string;
  transaction: string;
}> {
  // 1. Get agent from DB
  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, params.agentId))
    .limit(1);

  if (!agent) {
    throw new Error(`Agent ${params.agentId} not found`);
  }

  if (!agent.isActive) {
    throw new Error("Agent is not active");
  }

  // 2. Try to create Privy wallet (optional for paper trading — won't fail if unavailable)
  let agentWallet: { id: string; address: string } | null = null;
  let policyId: string | null = null;
  try {
    policyId = await createAgentPolicy(DEPLOY_PHASE);
    console.log(`[Supervisor] Created ${DEPLOY_PHASE} policy for job: ${policyId}`);

    agentWallet = await createAgentWallet(agent.name, [policyId]);
    console.log(`[Supervisor] Created Privy wallet for job (${agent.name}): ${agentWallet.address} with policy ${policyId}`);

    // Fund wallet with SOL for tx fees (skip in simulated mode)
    if (IS_PRODUCTION) {
      try {
        const { solSig } = await fundAgentWallet(agentWallet.address, 0.05);
        console.log(`[Supervisor] Funded wallet with 0.05 SOL: ${solSig}`);
      } catch (err: any) {
        console.error(`[Supervisor] Failed to fund wallet with SOL: ${err.message}`);
      }
    } else {
      console.log(`[Supervisor] SIMULATED MODE: Skipping auto SOL funding`);
    }
  } catch (err: any) {
    console.warn(`[Supervisor] Privy wallet creation failed (continuing without wallet for paper trading): ${err.message}`);
  }

  // 3. Create job in DB (paused by default, paper trading mode)
  const [job] = await db
    .insert(schema.jobs)
    .values({
      clientAddress: params.clientAddress,
      agentId: params.agentId,
      privyWalletId: agentWallet?.id ?? null,
      privyWalletAddress: agentWallet?.address ?? null,
      privyPolicyId: policyId ?? null,
      maxCap: String(params.maxCap),
      dailyCap: String(params.dailyCap),
      status: "paused",
      tradingMode: "paper",
      paperBalance: String(DEFAULT_PAPER_BALANCE_USDC),
    })
    .returning();

  // 4. Build on-chain initialize_job transaction (optional — requires deployed program)
  let txBase64 = "";
  let pdaAddress = "";
  if (agentWallet?.address) {
    try {
      const tx = await buildInitializeJobTx({
        userAddress: params.clientAddress,
        agentId: job.id,
        privyWalletAddress: agentWallet.address,
      });

      const serialized = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      txBase64 = serialized.toString("base64");

      const [jobPDA] = getJobProfilePDA(new PublicKey(params.clientAddress), job.id);
      pdaAddress = jobPDA.toBase58();
    } catch (err: any) {
      console.warn(`[Supervisor] On-chain tx build failed (program may not be deployed): ${err.message}`);
    }
  }

  return {
    jobId: job.id,
    privyWalletAddress: agentWallet?.address,
    onChainAddress: pdaAddress || undefined,
    transaction: txBase64,
  };
}

// --- Fund a job (verify wallet has balance, update DB) ---

export async function fundJob(jobId: string): Promise<{
  success: boolean;
  balance: { sol: number; usdc: number };
}> {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new Error("Job not found");
  }

  const tradingMode = (job.tradingMode as "paper" | "live") ?? "paper";

  // For paper trading, always succeed with paper balance — no wallet needed
  if (tradingMode === "paper") {
    const paperBal = job.paperBalance ? Number(job.paperBalance) : DEFAULT_PAPER_BALANCE_USDC;
    await db
      .update(schema.jobs)
      .set({ totalInvested: String(paperBal) })
      .where(eq(schema.jobs.id, jobId));
    return { success: true, balance: { usdc: paperBal, sol: 0.05 } };
  }

  // Live mode: require real wallet with funds
  if (!job.privyWalletAddress) {
    throw new Error("Job has no wallet");
  }

  const effectiveBalance = IS_SIMULATED
    ? { usdc: TEST_WALLET_BALANCE_USDC, sol: TEST_WALLET_BALANCE_SOL }
    : await getEffectiveBalance(job.privyWalletAddress);

  if (effectiveBalance.usdc <= 0 && effectiveBalance.sol <= 0) {
    return { success: false, balance: effectiveBalance };
  }

  await db
    .update(schema.jobs)
    .set({ totalInvested: sql`${schema.jobs.totalInvested} + ${String(effectiveBalance.usdc)}` })
    .where(eq(schema.jobs.id, jobId));

  return { success: true, balance: effectiveBalance };
}

// --- Resume a paused job (start agent loop) ---

export async function resumeJob(jobId: string): Promise<boolean> {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new Error("Job not found");
  }

  if (job.status === "active") {
    return true; // already running
  }

  const tradingMode = (job.tradingMode as "paper" | "live") ?? "paper";

  // For paper trading, skip wallet checks and use paper balance
  let effectiveBalance: { usdc: number; sol: number };
  if (tradingMode === "paper") {
    const paperBal = job.paperBalance ? Number(job.paperBalance) : DEFAULT_PAPER_BALANCE_USDC;
    effectiveBalance = { usdc: paperBal, sol: 0.05 };
  } else {
    // Live mode: require real wallet
    if (!job.privyWalletAddress) {
      throw new Error("Job has no wallet — cannot resume");
    }

    try {
      effectiveBalance = await getEffectiveBalance(job.privyWalletAddress);
    } catch {
      effectiveBalance = { usdc: TEST_WALLET_BALANCE_USDC, sol: TEST_WALLET_BALANCE_SOL };
    }

    if (IS_SIMULATED) {
      effectiveBalance = { usdc: TEST_WALLET_BALANCE_USDC, sol: TEST_WALLET_BALANCE_SOL };
    }

    if (effectiveBalance.usdc <= 0 && effectiveBalance.sol <= 0) {
      throw new Error("Wallet has no funds — please fund first");
    }
  }

  // Get agent category
  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, job.agentId))
    .limit(1);

  if (!agent) {
    throw new Error("Agent not found");
  }

  // Update totalInvested and status
  await db
    .update(schema.jobs)
    .set({
      totalInvested: String(effectiveBalance.usdc),
      status: "active",
      startedAt: new Date(),
    })
    .where(eq(schema.jobs.id, jobId));

  // === PRE-FLIGHT POSITION SYNC ===
  // Before starting the agent loop, sync all open positions:
  // - Update prices
  // - Check for expired markets
  // - Check for resolved markets (auto-claim if paper)
  try {
    const syncResult = await preFlightPositionSync({
      jobId,
      agentId: job.agentId,
      agentWalletId: job.privyWalletId ?? "",
      agentName: agent.name,
      walletAddress: job.privyWalletAddress ?? "",
      tradingMode: (job.tradingMode as "paper" | "live") ?? "paper",
    });

    console.log(
      `[PreFlightSync] Job ${jobId}: ${syncResult.openPositionsCount} open positions, ` +
      `${syncResult.closedByExpiry} closed by expiry, ` +
      `${syncResult.claimedByResolution} claimed by resolution`
    );
  } catch (err) {
    console.error(`[PreFlightSync] Failed for job ${jobId}:`, err);
    // Don't fail resume — agent can still start and sync on next tick
  }

  // Start agent loop
  const ctx: AgentRuntimeContext = {
    agentId: job.agentId,
    jobId: job.id,
    agentWalletId: job.privyWalletId ?? "",
    agentWalletAddress: job.privyWalletAddress ?? "",
    ownerPubkey: job.clientAddress,
  };

  await startAgentLoop(ctx, agent.category);

  // Publish feed event — agent actually started
  const feedEvent = buildFeedEvent({
    agentId: job.agentId,
    agentName: agent.name,
    jobId: job.id,
    category: "trade",
    severity: "significant",
    content: {
      summary: `${agent.name} activated with $${effectiveBalance.usdc.toFixed(0)} USDC (${job.tradingMode ?? "paper"})`,
    },
    displayMessage: `${agent.name} is now trading with $${effectiveBalance.usdc.toFixed(0)} USDC (${job.tradingMode ?? "paper"})`,
  });
  await publishFeedEvent(feedEvent);

  console.log(`[Supervisor] Resumed job ${jobId} with $${effectiveBalance.usdc} USDC (${job.tradingMode ?? "paper"})`);
  return true;
}

// --- Start an agent loop ---

export async function startAgentLoop(ctx: AgentRuntimeContext, category: string = "geo"): Promise<void> {
  const existing = activeAgents.get(ctx.jobId);
  if (existing?.running) {
    console.log(`[Supervisor] Job ${ctx.jobId} already running`);
    return;
  }

  const registryId = CATEGORY_TO_REGISTRY_ID[category] ?? CATEGORY_TO_REGISTRY_ID.geo;

  const agent: ActiveAgent = {
    ctx,
    intervalId: null,
    lastRun: 0,
    lastResult: null,
    running: true,
    tickRunning: false,
  };

  const tick = async () => {
    // Emergency stop: halt all agent loops if EMERGENCY_STOP is set
    if (EMERGENCY_STOP) {
      console.log(`[Supervisor] EMERGENCY_STOP active — pausing agent loop for job ${ctx.jobId}`);
      stopAgentLoop(ctx.jobId);
      return;
    }

    // Check DB status — stop if job was paused/cancelled
    const [jobStatus] = await db
      .select({ status: schema.jobs.status })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, ctx.jobId))
      .limit(1);

    if (!jobStatus || jobStatus.status !== "active") {
      console.log(`[Supervisor] Job ${ctx.jobId} status is "${jobStatus?.status ?? "not found"}" — stopping agent loop`);
      stopAgentLoop(ctx.jobId);
      return;
    }

    if (agent.tickRunning) {
      console.log(`[Supervisor] Job ${ctx.jobId} tick skipped — previous tick still running`);
      return;
    }
    agent.tickRunning = true;

    // Timeout: kill tick if it takes longer than 5 minutes
    const tickTimeout = setTimeout(() => {
      console.error(`[Supervisor] Job ${ctx.jobId} tick timed out after 5min — saving partial progress`);
      redis.set(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:tick_timeout`, String(Date.now())).catch(() => {});
      agent.tickRunning = false;
    }, 5 * 60 * 1000);

    try {
      const result = await runAgentTick(registryId, ctx);
      agent.lastRun = Date.now();
      agent.lastResult = result;

      console.log(
        `[Supervisor] ${ctx.jobId} (${category}): ${result.state} -> ${result.action} (${result.detail})`
      );
    } catch (err) {
      console.error(`[Supervisor] Job ${ctx.jobId} tick error:`, err);
      redis.set(`${REDIS_KEYS.AGENT_STATS_PREFIX}${ctx.agentId}:tick_error`, `${Date.now()}:${err instanceof Error ? err.message : String(err)}`).catch(() => {});
    } finally {
      clearTimeout(tickTimeout);
      if (agent.tickRunning) {
        agent.tickRunning = false;
      }
    }
  };

  // First tick
  tick();

  // Then every 5 minutes
  agent.intervalId = setInterval(tick, 5 * 60 * 1000);

  activeAgents.set(ctx.jobId, agent);

  // Start background position monitor (stop-loss, take-profit, expiry, resolution)
  const [jobMode] = await db
    .select({ tradingMode: schema.jobs.tradingMode })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, ctx.jobId))
    .limit(1);

  startBackgroundPositionMonitor({
    jobId: ctx.jobId,
    agentId: ctx.agentId,
    agentWalletId: ctx.agentWalletId,
    agentName: category,
    tradingMode: (jobMode?.tradingMode as "paper" | "live") ?? "paper",
  });

  console.log(`[Supervisor] Started agent loop: job ${ctx.jobId} (${category})`);
}

// --- Stop an agent ---

export function stopAgentLoop(jobId: string): boolean {
  const agent = activeAgents.get(jobId);
  if (!agent) return false;

  stopBackgroundPositionMonitor(jobId);
  if (agent.intervalId) {
    clearInterval(agent.intervalId);
  }
  agent.running = false;
  agent.intervalId = null;
  activeAgents.delete(jobId);

  console.log(`[Supervisor] Stopped agent loop: job ${jobId}`);
  return true;
}

// --- Pause an agent (keeps job active but stops ticking) ---

export function pauseAgentLoop(jobId: string, reason: string = "User paused"): boolean {
  const agent = activeAgents.get(jobId);
  if (!agent) return false;

  stopBackgroundPositionMonitor(jobId);
  if (agent.intervalId) {
    clearInterval(agent.intervalId);
    agent.intervalId = null;
  }
  agent.running = false;

  console.log(`[Supervisor] Paused agent loop: job ${jobId} — ${reason}`);
  return true;
}

// --- Resume a paused agent ---

export function resumeAgentLoop(jobId: string, category: string = "geo"): boolean {
  const agent = activeAgents.get(jobId);
  if (!agent) return false;
  if (agent.running) return true; // already running

  const registryId = CATEGORY_TO_REGISTRY_ID[category] ?? CATEGORY_TO_REGISTRY_ID.geo;

  agent.running = true;

  const tick = async () => {
    if (agent.tickRunning) {
      console.log(`[Supervisor] Job ${jobId} tick skipped — previous tick still running`);
      return;
    }
    agent.tickRunning = true;

    const tickTimeout = setTimeout(() => {
      console.error(`[Supervisor] Job ${jobId} tick timed out after 5min — saving partial progress`);
      redis.set(`${REDIS_KEYS.AGENT_STATS_PREFIX}${agent.ctx.agentId}:tick_timeout`, String(Date.now())).catch(() => {});
      agent.tickRunning = false;
    }, 5 * 60 * 1000);

    try {
      const result = await runAgentTick(registryId, agent.ctx);
      agent.lastRun = Date.now();
      agent.lastResult = result;
      console.log(
        `[Supervisor] ${jobId} (${category}): ${result.state} -> ${result.action} (${result.detail})`
      );
    } catch (err) {
      console.error(`[Supervisor] Job ${jobId} tick error:`, err);
      redis.set(`${REDIS_KEYS.AGENT_STATS_PREFIX}${agent.ctx.agentId}:tick_error`, `${Date.now()}:${err instanceof Error ? err.message : String(err)}`).catch(() => {});
    } finally {
      clearTimeout(tickTimeout);
      if (agent.tickRunning) {
        agent.tickRunning = false;
      }
    }
  };

  tick();
  agent.intervalId = setInterval(tick, 5 * 60 * 1000);

  console.log(`[Supervisor] Resumed agent loop: job ${jobId}`);
  return true;
}

// --- Cancel a job (stop agent + update DB) ---

export async function cancelJob(jobId: string): Promise<boolean> {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1);

  if (!job) return false;

  stopAgentLoop(jobId);

  await db
    .update(schema.jobs)
    .set({
      status: "cancelled",
      endedAt: new Date(),
    })
    .where(eq(schema.jobs.id, jobId));

  return true;
}

// --- Approve job (release payment) ---

export async function approveJob(jobId: string): Promise<boolean> {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1);

  if (!job) return false;

  stopAgentLoop(jobId);

  await db
    .update(schema.jobs)
    .set({
      status: "completed",
      endedAt: new Date(),
    })
    .where(eq(schema.jobs.id, jobId));

  return true;
}

// --- Get agent status ---

export function getAgentStatus(jobId: string): {
  running: boolean;
  lastRun: number | null;
  state: string | null;
  lastAction: string | null;
} {
  const agent = activeAgents.get(jobId);
  return {
    running: agent?.running ?? false,
    lastRun: agent?.lastRun ?? null,
    state: agent?.lastResult?.state ?? null,
    lastAction: agent?.lastResult?.action ?? null,
  };
}

// --- List active agents ---

export function listActiveAgents(): string[] {
  return Array.from(activeAgents.keys());
}

// --- Resume agents from DB on server start ---

export async function resumeActiveAgents(): Promise<number> {
  const activeJobs = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.status, "active"));

  let count = 0;
  for (const job of activeJobs) {
    if (!job.privyWalletId || !job.privyWalletAddress) {
      console.log(`[Supervisor] Skipping job ${job.id} — no wallet`);
      continue;
    }

    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, job.agentId))
      .limit(1);

    if (agent && agent.isActive) {
      const ctx: AgentRuntimeContext = {
        agentId: job.agentId,
        jobId: job.id,
        agentWalletId: job.privyWalletId,
    agentWalletAddress: job.privyWalletAddress ?? "",
        ownerPubkey: job.clientAddress,
      };

      await startAgentLoop(ctx, agent.category);
      count++;
    }
  }

  console.log(`[Supervisor] Resumed ${count} active agent(s)`);
  return count;
}
