import { router, protectedProcedure } from "../utils/trpc";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db, schema } from "../db";
import { hireAgent, fundJob, cancelJob, approveJob, pauseAgentLoop, resumeJob } from "../agents/supervisor";
import { getEffectiveBalance } from "../utils/balance";

async function enrichJobWithAgent(job: any) {
  const [agent] = await db
    .select({ name: schema.agents.name, category: schema.agents.category })
    .from(schema.agents)
    .where(eq(schema.agents.id, job.agentId))
    .limit(1);
  return {
    ...job,
    agentName: agent?.name ?? "Unknown",
    agentCategory: agent?.category ?? "geo",
  };
}

export const jobRouter = router({
  // Step 1: Hire agent — creates Privy wallet, builds on-chain tx, saves job as "paused"
  create: protectedProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      maxCap: z.number().min(1),
      dailyCap: z.number().min(1),
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
      });

      const [job] = await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, result.jobId))
        .limit(1);

      return {
        ...(await enrichJobWithAgent(job)),
        privyWalletAddress: result.privyWalletAddress,
        onChainAddress: result.onChainAddress,
        transaction: result.transaction,
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

  // Get job wallet balance (respects DEPLOY_PHASE: simulated in dev/traction, real in production)
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

      return { ...(await enrichJobWithAgent(job)), positions, trades };
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

  // Register existing job on-chain (for jobs created with "skip")
  registerOnChain: protectedProcedure
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

      if (job.onChainAddress) {
        return { success: true, onChainAddress: job.onChainAddress, message: "Already registered" };
      }

      if (!job.privyWalletAddress) {
        throw new Error("Job has no wallet");
      }

      const { getJobProfilePDA } = await import("../anchor/job-client");
      const { PublicKey } = await import("@solana/web3.js");
      const { createHash } = await import("crypto");
      const idl = await import("../anchor/agent_registry.json");

      const [pda] = getJobProfilePDA(new PublicKey(ctx.walletAddress), job.id);

      // Return the hash so mobile doesn't need crypto module
      const jobIdHash = createHash("sha256").update(job.id).digest("hex");

      return {
        success: true,
        onChainAddress: pda.toBase58(),
        programId: idl.address,
        jobId: job.id,
        jobIdHash,
        privyWalletAddress: job.privyWalletAddress,
        message: "Ready to register on-chain",
      };
    }),

  // Confirm on-chain registration after user signs
  confirmOnChain: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      onChainAddress: z.string(),
      txSignature: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [job] = await db
        .update(schema.jobs)
        .set({ onChainAddress: input.onChainAddress })
        .where(
          and(
            eq(schema.jobs.id, input.id),
            eq(schema.jobs.clientAddress, ctx.walletAddress)
          )
        )
        .returning();

      if (!job) {
        throw new Error("Job not found or not owned by you");
      }

      // Publish feed event for on-chain registration
      const [agent] = await db
        .select({ name: schema.agents.name })
        .from(schema.agents)
        .where(eq(schema.agents.id, job.agentId))
        .limit(1);

      if (agent) {
        const { buildFeedEvent, publishFeedEvent } = await import("../feed");
        const feedEvent = buildFeedEvent({
          agentId: job.agentId,
          agentName: agent.name,
          category: "trade",
          severity: "info",
          content: {
            summary: `${agent.name} registered on Solana`,
          },
          displayMessage: `${agent.name} has been registered on-chain by ${ctx.walletAddress.slice(0, 6)}...${ctx.walletAddress.slice(-4)}`,
        });
        await publishFeedEvent(feedEvent);
      }

      return { success: true, onChainAddress: input.onChainAddress };
    }),
});
