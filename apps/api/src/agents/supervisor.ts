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
import { getEffectiveBalance } from "../utils/balance";
import { createAgenticWalletForJob, returnUsdcToClient, getWalletBalance } from "../utils/privy-agentic";
import { submitAtomFeedback, getAtomSummary, computeReputationScore, AtomTag } from "../utils/atom-reputation";
import { registerAgentOn8004WithBackendPayer } from "../utils/agent-registry-8004";
import { transferSolFromBackend, getExplorerUrl } from "../utils/devnet-helpers";
import { IS_DEVNET } from "@agent-arena/shared";
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

// --- Hire an agent (create job, provision Agentic Wallet with policy) ---

export async function hireAgent(params: {
  agentId: string;
  clientAddress: string;
  maxCap: number;
  dailyCap: number;
  durationDays?: number;
}): Promise<{
  jobId: string;
  privyWalletAddress?: string;
  policyId?: string;
  explorerLinks?: {
    agentAsset?: string;
    fundTx?: string;
    agentWallet?: string;
  };
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

  const explorerLinks: { agentAsset?: string; fundTx?: string; agentWallet?: string } = {};

  // 2. Ensure agent is registered on 8004 (CRITICAL — fail if we can't)
  if (!agent.assetAddress && IS_DEVNET) {
    try {
      const result = await registerAgentOn8004WithBackendPayer({
        ownerAddress: agent.ownerAddress,
        metadata: {
          name: agent.name,
          description: agent.description ?? "",
          category: agent.category,
          capabilities: agent.capabilities ?? [],
          pricingModel: agent.pricingModel as any,
        },
        atomEnabled: true,
      });

      await db
        .update(schema.agents)
        .set({
          assetAddress: result.agentAsset,
          atomStatsAddress: result.atomStats,
          atomEnabled: true,
        })
        .where(eq(schema.agents.id, params.agentId));

      agent.assetAddress = result.agentAsset;
      explorerLinks.agentAsset = getExplorerUrl("address", result.agentAsset);
      console.log(`[Supervisor] ✅ Auto-registered agent ${agent.id} on 8004: ${result.agentAsset}`);
      console.log(`[Supervisor]    Explorer: ${explorerLinks.agentAsset}`);
    } catch (err: any) {
      console.error(`[Supervisor] ❌ 8004 auto-registration FAILED: ${err.message}`);
      console.error(`[Supervisor]    Backend payer may need devnet SOL.`);
      throw new Error(`Agent registration failed: ${err.message}. Please try again.`);
    }
  } else if (agent.assetAddress) {
    explorerLinks.agentAsset = getExplorerUrl("address", agent.assetAddress);
  }

  // 3. Create Agentic Wallet with dynamic job policy
  let walletId: string | null = null;
  let walletAddress: string | null = null;
  let policyId: string | null = null;

  try {
    const agentic = await createAgenticWalletForJob({
      jobId: "pending", // will update after job insert
      agentName: agent.name,
      maxBudgetUsdc: params.maxCap,
      dailyCapUsdc: params.dailyCap,
      durationDays: params.durationDays ?? 7,
      denySolTransfers: true,
    });

    walletId = agentic.walletId;
    walletAddress = agentic.walletAddress;
    policyId = agentic.policyId;

    console.log(`[Supervisor] Created Agentic Wallet for job (${agent.name}): ${walletAddress} with policy ${policyId}`);

    // Seed agentic wallet with devnet SOL from backend payer
    // This SOL is for the wallet's own transaction fees, NOT backend infrastructure
    if (IS_DEVNET && walletAddress) {
      try {
        const fundSig = await transferSolFromBackend(walletAddress, 0.1);
        if (fundSig) {
          explorerLinks.fundTx = getExplorerUrl("tx", fundSig);
          explorerLinks.agentWallet = getExplorerUrl("address", walletAddress);
          console.log(`[Supervisor] ✅ Seeded agent wallet ${walletAddress} with 0.1 SOL: ${fundSig}`);
        } else {
          console.warn(`[Supervisor] Failed to seed agent wallet — backend payer may need devnet SOL`);
        }
      } catch (err: any) {
        console.warn(`[Supervisor] Agent wallet funding failed: ${err.message}`);
      }
    }
  } catch (err: any) {
    console.warn(`[Supervisor] Agentic wallet creation failed (continuing without wallet for paper trading): ${err.message}`);
  }

  // 3. Create job in DB (paused by default, paper trading mode)
  const [job] = await db
    .insert(schema.jobs)
    .values({
      clientAddress: params.clientAddress,
      agentId: params.agentId,
      privyWalletId: walletId ?? null,
      privyWalletAddress: walletAddress ?? null,
      privyPolicyId: policyId ?? null,
      maxCap: String(params.maxCap),
      dailyCap: String(params.dailyCap),
      status: "paused",
      tradingMode: "paper",
      paperBalance: String(DEFAULT_PAPER_BALANCE_USDC),
      policyExpiryAt: new Date(Date.now() + (params.durationDays ?? 7) * 86400000),
    })
    .returning();

  // If wallet was created, update policy name with real jobId
  if (policyId && walletId) {
    try {
      // Policies are immutable; we already named it with pending. For hackathon, this is fine.
      // In production, we'd re-create with the real jobId.
      console.log(`[Supervisor] Job ${job.id} linked to policy ${policyId}`);
    } catch {
      // ignore
    }
  }

  return {
    jobId: job.id,
    privyWalletAddress: walletAddress ?? undefined,
    policyId: policyId ?? undefined,
    explorerLinks: Object.keys(explorerLinks).length > 0 ? explorerLinks : undefined,
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

// --- Cancel a job (stop agent, return funds, update DB) ---

export async function cancelJob(jobId: string): Promise<boolean> {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1);

  if (!job) return false;

  stopAgentLoop(jobId);

  // Return remaining live funds to client
  if (job.tradingMode === "live" && job.privyWalletId && job.privyWalletAddress) {
    try {
      const bal = await getWalletBalance(job.privyWalletAddress);
      if (bal.usdc > 0.01) {
        const sig = await returnUsdcToClient(
          job.privyWalletId,
          job.privyWalletAddress,
          job.clientAddress,
          bal.usdc
        );
        console.log(`[Supervisor] Returned ${bal.usdc} USDC to client on cancel: ${sig}`);
      }
    } catch (err: any) {
      console.error(`[Supervisor] Failed to return funds on cancel: ${err.message}`);
    }
  }

  await db
    .update(schema.jobs)
    .set({
      status: "cancelled",
      endedAt: new Date(),
    })
    .where(eq(schema.jobs.id, jobId));

  return true;
}

// --- Complete a job (stop agent, submit ATOM feedback, return funds) ---

export async function completeJob(jobId: string): Promise<boolean> {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1);

  if (!job) return false;

  stopAgentLoop(jobId);

  // Calculate job performance
  const trades = await db
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.jobId, jobId));

  const winningTrades = trades.filter((t) => t.outcome === "win").length;
  const totalPnl = trades.reduce((sum, t) => sum + Number(t.profitLoss ?? 0), 0);
  const winRate = trades.length > 0 ? winningTrades / trades.length : 0;

  // Submit ATOM feedback if agent has 8004 asset
  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, job.agentId))
    .limit(1);

  if (agent?.assetAddress) {
    try {
      const pnlPercent = job.totalInvested && Number(job.totalInvested) > 0
        ? (totalPnl / Number(job.totalInvested)) * 100
        : 0;

      const feedback = await submitAtomFeedback({
        agentAsset: agent.assetAddress,
        value: Math.abs(pnlPercent).toFixed(2),
        tag1: pnlPercent >= 0 ? AtomTag.profit : AtomTag.loss,
        tag2: AtomTag.day,
        reviewerAddress: job.clientAddress,
      });

      if (feedback) {
        console.log(`[Supervisor] Submitted ATOM feedback on-chain for agent ${agent.id}: ${pnlPercent.toFixed(2)}% (tx: ${feedback.txSignature})`);

        // Update agent reputation in DB from on-chain state
        const summary = await getAtomSummary(agent.assetAddress);
        if (summary) {
          await db
            .update(schema.agents)
            .set({
              trustTier: summary.trustTier,
              reputationScore: String(computeReputationScore(summary)),
            })
            .where(eq(schema.agents.id, job.agentId));
        }
      }
    } catch (err: any) {
      console.error(`[Supervisor] ATOM feedback failed: ${err.message}`);
    }
  }

  // Return remaining live funds to client
  if (job.tradingMode === "live" && job.privyWalletId && job.privyWalletAddress) {
    try {
      const bal = await getWalletBalance(job.privyWalletAddress);
      if (bal.usdc > 0.01) {
        const sig = await returnUsdcToClient(
          job.privyWalletId,
          job.privyWalletAddress,
          job.clientAddress,
          bal.usdc
        );
        console.log(`[Supervisor] Returned ${bal.usdc} USDC to client on completion: ${sig}`);
      }
    } catch (err: any) {
      console.error(`[Supervisor] Failed to return funds on completion: ${err.message}`);
    }
  }

  await db
    .update(schema.jobs)
    .set({
      status: "completed",
      endedAt: new Date(),
    })
    .where(eq(schema.jobs.id, jobId));

  return true;
}

// --- Approve job (alias for completeJob) ---

export async function approveJob(jobId: string): Promise<boolean> {
  return completeJob(jobId);
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
