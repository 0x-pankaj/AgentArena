import { router, protectedProcedure } from "../utils/trpc";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../db";
import { hireAgent, fundJob, cancelJob, approveJob, pauseAgentLoop, resumeJob } from "../agents/supervisor";
import { getEffectiveBalance } from "../utils/balance";
import { getPolicy, getWalletBalance } from "../utils/privy-agentic";

async function enrichJobWithAgent(job: any) {
  const [agent] = await db
    .select({ name: schema.agents.name, category: schema.agents.category, assetAddress: schema.agents.assetAddress })
    .from(schema.agents)
    .where(eq(schema.agents.id, job.agentId))
    .limit(1);
  return {
    ...job,
    agentName: agent?.name ?? "Unknown",
    agentCategory: agent?.category ?? "geo",
    agentAssetAddress: agent?.assetAddress,
  };
}

export const jobRouter = router({
  // Step 1: Hire agent — creates Agentic Wallet with policy, saves job as "paused"
  create: protectedProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      maxCap: z.number().min(1),
      dailyCap: z.number().min(1),
      durationDays: z.number().min(1).max(30).default(7),
    }))
    .mutation(async ({ input, ctx }) => {
      // Ensure user exists
      await db
        .insert(schema.users)
        .values({ walletAddress: ctx.walletAddress })
        .onConflictDoNothing();

      const result = await hireAgent({
        agentId: input.agentId,
        clientAddress: ctx.walletAddress,
        maxCap: input.maxCap,
        dailyCap: input.dailyCap,
        durationDays: input.durationDays,
      });

      const [job] = await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, result.jobId))
        .limit(1);

      return {
        ...(await enrichJobWithAgent(job)),
        privyWalletAddress: result.privyWalletAddress,
        policyId: result.policyId,
        explorerLinks: result.explorerLinks,
      };
    }),

  // Step 2a: Fund job — verify wallet has balance
  fund: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [job] = await db
        .select()
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.id, input.id),
            eq(schema.jobs.clientAddress, ctx.walletAddress)
          )
        )
        .limit(1);

      if (!job) {
        throw new Error("Job not found or not owned by you");
      }

      const result = await fundJob(input.id);
      return result;
    }),

  // Step 2b: Resume job — start agent loop after funding
  resume: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [job] = await db
        .select()
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.id, input.id),
            eq(schema.jobs.clientAddress, ctx.walletAddress)
          )
        )
        .limit(1);

      if (!job) {
        throw new Error("Job not found or not owned by you");
      }

      if (job.status === "active") {
        return { success: true, message: "Already active" };
      }

      try {
        const success = await resumeJob(input.id);
        return { success, message: success ? "Agent started" : "Failed to start" };
      } catch (err: any) {
        return { success: false, message: err.message };
      }
    }),

  // Get job wallet balance
  getWalletBalance: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [job] = await db
        .select()
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.id, input.id),
            eq(schema.jobs.clientAddress, ctx.walletAddress)
          )
        )
        .limit(1);

      if (!job || !job.privyWalletAddress) {
        return { sol: 0, usdc: 0 };
      }

      return getEffectiveBalance(job.privyWalletAddress);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [job] = await db
        .select()
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.id, input.id),
            eq(schema.jobs.clientAddress, ctx.walletAddress)
          )
        )
        .limit(1);

      if (!job) return null;

      // Get positions for this job
      const positions = await db
        .select()
        .from(schema.positions)
        .where(eq(schema.positions.jobId, input.id));

      // Get trades for this job
      const trades = await db
        .select()
        .from(schema.trades)
        .where(eq(schema.trades.jobId, input.id))
        .orderBy(desc(schema.trades.executedAt));

      // Get paper balance if applicable
      let paperBalance = null;
      if (job.tradingMode === "paper") {
        const { getPaperBalance } = await import("../services/paper-trading");
        paperBalance = await getPaperBalance(job.id);
      }

      // Get policy details if available
      let policyDetails = null;
      if (job.privyPolicyId) {
        try {
          policyDetails = await getPolicy(job.privyPolicyId);
        } catch {
          // ignore
        }
      }

      return { ...(await enrichJobWithAgent(job)), positions, trades, paperBalance, policyDetails };
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [eq(schema.jobs.clientAddress, ctx.walletAddress)];
      if (input.status) {
        conditions.push(eq(schema.jobs.status, input.status));
      }

      const jobs = await db
        .select()
        .from(schema.jobs)
        .where(and(...conditions))
        .orderBy(desc(schema.jobs.createdAt))
        .limit(input.limit);

      const enriched = await Promise.all(jobs.map(enrichJobWithAgent));
      return { jobs: enriched };
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [job] = await db
        .select()
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.id, input.id),
            eq(schema.jobs.clientAddress, ctx.walletAddress)
          )
        )
        .limit(1);

      if (!job) {
        throw new Error("Job not found or not owned by you");
      }

      const success = await cancelJob(input.id);
      return { success };
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [job] = await db
        .select()
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.id, input.id),
            eq(schema.jobs.clientAddress, ctx.walletAddress)
          )
        )
        .limit(1);

      if (!job) {
        throw new Error("Job not found or not owned by you");
      }

      const success = await approveJob(input.id);
      return { success };
    }),

  pause: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [job] = await db
        .select()
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.id, input.id),
            eq(schema.jobs.clientAddress, ctx.walletAddress)
          )
        )
        .limit(1);

      if (!job) {
        throw new Error("Job not found or not owned by you");
      }

      if (job.status !== "active") {
        throw new Error("Job is not active");
      }

      const success = pauseAgentLoop(job.id, "User paused via mobile app");

      if (success) {
        await db
          .update(schema.jobs)
          .set({ status: "paused" })
          .where(eq(schema.jobs.id, input.id));
      }

      return { success };
    }),

  // Deprecated: kept for mobile backward compatibility (no-op)
  registerOnChain: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      return { success: true, message: "On-chain registration deprecated — using 8004 + Privy Agentic Wallets" };
    }),

  // Deprecated: kept for mobile backward compatibility (no-op)
  confirmOnChain: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      onChainAddress: z.string(),
      txSignature: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return { success: true, onChainAddress: input.onChainAddress, message: "On-chain registration deprecated" };
    }),

  // Switch trading mode (paper <-> live)
  switchMode: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      mode: z.enum(["paper", "live"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const [job] = await db
        .select()
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.id, input.id),
            eq(schema.jobs.clientAddress, ctx.walletAddress)
          )
        )
        .limit(1);

      if (!job) {
        throw new Error("Job not found or not owned by you");
      }

      if (job.status === "active") {
        throw new Error("Cannot switch mode while job is active. Please pause first.");
      }

      const [updated] = await db
        .update(schema.jobs)
        .set({ tradingMode: input.mode })
        .where(eq(schema.jobs.id, input.id))
        .returning();

      return { success: true, tradingMode: updated.tradingMode };
    }),

  // Get policy dashboard for a job
  getPolicyDashboard: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [job] = await db
        .select()
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.id, input.id),
            eq(schema.jobs.clientAddress, ctx.walletAddress)
          )
        )
        .limit(1);

      if (!job) {
        throw new Error("Job not found or not owned by you");
      }

      const policy = job.privyPolicyId ? await getPolicy(job.privyPolicyId).catch(() => null) : null;
      const balance = job.privyWalletAddress ? await getWalletBalance(job.privyWalletAddress).catch(() => ({ usdc: 0, sol: 0 })) : { usdc: 0, sol: 0 };

      const maxCap = Number(job.maxCap ?? 0);
      const spent = Number(job.totalInvested ?? 0);
      const remaining = Math.max(0, maxCap - spent);

      return {
        jobId: job.id,
        status: job.status,
        tradingMode: job.tradingMode,
        maxCap,
        dailyCap: Number(job.dailyCap ?? 0),
        spent,
        remaining,
        usdcBalance: balance.usdc,
        solBalance: balance.sol,
        policyExpiryAt: job.policyExpiryAt,
        policyName: policy?.name ?? null,
        policyRules: policy?.rules ?? [],
        walletAddress: job.privyWalletAddress,
      };
    }),
});
