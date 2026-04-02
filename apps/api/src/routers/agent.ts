import { router, publicProcedure, protectedProcedure } from "../utils/trpc";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { getAgentStatus, listActiveAgents } from "../agents/supervisor";
import {
  buildRegisterAgentTx,
  registerAgentWithPrivy,
  getAgentProfile,
  agentProfileExists,
} from "../anchor/registry-client";
import { getWalletBalance } from "../utils/privy";

const agentInputSchema = z.object({
  name: z.string().min(1).max(100),
  category: z.enum(["geo", "politics", "sports", "crypto", "general"]),
  description: z.string().max(500),
  pricingModel: z.object({
    type: z.enum(["subscription", "per_trade", "profit_share"]),
    amount: z.number().min(0),
  }),
  capabilities: z.array(z.string()),
  maxCap: z.number().min(1),
  dailyCap: z.number().min(1),
  totalCap: z.number().min(1),
});

export const agentRouter = router({
  list: publicProcedure
    .input(z.object({
      category: z.enum(["geo", "politics", "sports", "crypto", "general"]).optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const query = input.category
        ? db
            .select()
            .from(schema.agents)
            .where(
              and(
                eq(schema.agents.isActive, true),
                eq(schema.agents.category, input.category)
              )
            )
            .orderBy(desc(schema.agents.createdAt))
            .limit(input.limit)
            .offset(input.offset)
        : db
            .select()
            .from(schema.agents)
            .where(eq(schema.agents.isActive, true))
            .orderBy(desc(schema.agents.createdAt))
            .limit(input.limit)
            .offset(input.offset);

      const agents = await query;
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.agents)
        .where(eq(schema.agents.isActive, true));

      return { agents, total: Number(count) };
    }),

  get: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [agent] = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, input.id))
        .limit(1);

      if (!agent) return null;

      const [perf] = await db
        .select()
        .from(schema.agentPerformance)
        .where(eq(schema.agentPerformance.agentId, input.id))
        .limit(1);

      const status = getAgentStatus(input.id);

      return { ...agent, performance: perf ?? null, runtimeStatus: status };
    }),

  buildRegisterTx: protectedProcedure
    .input(agentInputSchema)
    .mutation(async ({ input, ctx }) => {
      const alreadyRegistered = await agentProfileExists(ctx.walletAddress);
      if (alreadyRegistered) {
        throw new Error("You already have a registered agent on-chain");
      }

      const tx = await buildRegisterAgentTx({
        ownerAddress: ctx.walletAddress,
        ...input,
      });

      const serialized = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      return {
        transaction: serialized.toString("base64"),
      };
    }),

  create: protectedProcedure
    .input(agentInputSchema.extend({
      connectionMethod: z.enum(["mwa", "privy"]).optional(),
      onChainAddress: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { connectionMethod, onChainAddress, ...agentData } = input;

      await db
        .insert(schema.users)
        .values({ walletAddress: ctx.walletAddress })
        .onConflictDoNothing();

      // On-chain registration (if Privy user)
      let onChainAddr = onChainAddress;

      if (connectionMethod === "privy") {
        const alreadyRegistered = await agentProfileExists(ctx.walletAddress);
        if (!alreadyRegistered) {
          // Build tx for frontend to sign
          const tx = await buildRegisterAgentTx({
            ownerAddress: ctx.walletAddress,
            ...agentData,
          });
          const serialized = tx.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          });
          onChainAddr = undefined; // Will be set via confirmRegistration
          // Return tx for frontend signing
        }
      }

      // Save agent metadata to DB (no wallet provisioning)
      const [agent] = await db
        .insert(schema.agents)
        .values({
          ownerAddress: ctx.walletAddress,
          name: agentData.name,
          category: agentData.category,
          description: agentData.description,
          pricingModel: {
            type: agentData.pricingModel.type,
            amount: agentData.pricingModel.amount,
            maxCap: agentData.maxCap,
            dailyCap: agentData.dailyCap,
            totalCap: agentData.totalCap,
          },
          capabilities: agentData.capabilities,
          onChainAddress: onChainAddr,
        })
        .returning();

      await db
        .insert(schema.agentPerformance)
        .values({ agentId: agent.id })
        .onConflictDoNothing();

      return agent;
    }),

  confirmRegistration: protectedProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      onChainAddress: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [agent] = await db
        .update(schema.agents)
        .set({ onChainAddress: input.onChainAddress })
        .where(
          and(
            eq(schema.agents.id, input.agentId),
            eq(schema.agents.ownerAddress, ctx.walletAddress)
          )
        )
        .returning();

      if (!agent) {
        throw new Error("Agent not found or not owned by you");
      }

      return { success: true, onChainAddress: input.onChainAddress };
    }),

  getOnChainProfile: publicProcedure
    .input(z.object({ ownerAddress: z.string() }))
    .query(async ({ input }) => {
      return getAgentProfile(input.ownerAddress);
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...updates } = input;

      const [agent] = await db
        .update(schema.agents)
        .set(updates)
        .where(
          and(
            eq(schema.agents.id, id),
            eq(schema.agents.ownerAddress, ctx.walletAddress)
          )
        )
        .returning();

      return { success: !!agent, agent };
    }),

  getPerformance: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [perf] = await db
        .select()
        .from(schema.agentPerformance)
        .where(eq(schema.agentPerformance.agentId, input.id))
        .limit(1);

      return perf ?? {
        totalTrades: 0,
        winningTrades: 0,
        totalPnl: "0",
        winRate: "0",
        sharpeRatio: null,
        maxDrawdown: null,
        totalVolume: "0",
      };
    }),

  getStatus: publicProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getAgentStatus(input.jobId);
    }),

  listActive: publicProcedure.query(() => {
    return { agentIds: listActiveAgents() };
  }),

  getJobWalletBalance: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [job] = await db
        .select()
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.id, input.jobId),
            eq(schema.jobs.clientAddress, ctx.walletAddress)
          )
        )
        .limit(1);

      if (!job || !job.privyWalletAddress) {
        return { sol: 0, usdc: 0 };
      }

      return getWalletBalance(job.privyWalletAddress);
    }),
});
