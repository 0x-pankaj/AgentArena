import { router, publicProcedure, protectedProcedure } from "../utils/trpc";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { getAgentStatus, listActiveAgents } from "../agents/supervisor";
import { getEffectiveBalance } from "../utils/balance";
import {
  buildRegisterAgentTx8004,
  isAgentRegisteredOn8004,
  fetchAgentAsset,
  getAgentExplorerUrl,
  registerAgentOn8004WithBackendPayer,
} from "../utils/agent-registry-8004";
import {
  getAtomSummary,
  computeReputationScore,
  formatTrustTier,
  getAtomStatsPDA,
} from "../utils/atom-reputation";
import { PublicKey } from "@solana/web3.js";

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

      // Fetch on-chain ATOM reputation
      let atomReputation = null;
      if (agent.assetAddress) {
        const summary = await getAtomSummary(agent.assetAddress);
        if (summary) {
          atomReputation = {
            ...summary,
            formattedTier: formatTrustTier(summary.trustTier),
            compositeScore: computeReputationScore(summary),
          };
        }
      }

      return { ...agent, performance: perf ?? null, runtimeStatus: status, atomReputation };
    }),

  // Register agent on 8004 Solana Agent Registry (on-chain NFT)
  registerOn8004: protectedProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      atomEnabled: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const [agent] = await db
        .select()
        .from(schema.agents)
        .where(
          and(
            eq(schema.agents.id, input.agentId),
            eq(schema.agents.ownerAddress, ctx.walletAddress)
          )
        )
        .limit(1);

      if (!agent) {
        throw new Error("Agent not found or not owned by you");
      }

      if (agent.assetAddress) {
        return { success: true, assetAddress: agent.assetAddress, message: "Already registered on 8004" };
      }

      const alreadyRegistered = await isAgentRegisteredOn8004(ctx.walletAddress);
      if (alreadyRegistered) {
        const asset = await fetchAgentAsset(ctx.walletAddress);
        if (asset) {
          const [statsPda] = getAtomStatsPDA(new PublicKey(asset.assetAddress));
          await db
            .update(schema.agents)
            .set({ assetAddress: asset.assetAddress, atomStatsAddress: statsPda.toBase58(), atomEnabled: asset.atomEnabled })
            .where(eq(schema.agents.id, input.agentId));
          return { success: true, assetAddress: asset.assetAddress, message: "Synced existing 8004 registration" };
        }
      }

      // Build unsigned transaction for frontend to sign
      const tx = await buildRegisterAgentTx8004({
        ownerAddress: ctx.walletAddress,
        metadata: {
          name: agent.name,
          description: agent.description ?? "",
          category: agent.category,
          capabilities: agent.capabilities ?? [],
          pricingModel: agent.pricingModel as any,
        },
        atomEnabled: input.atomEnabled,
      });

      const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

      return {
        success: true,
        transaction: serialized.toString("base64"),
        message: "Sign this transaction to mint your 8004 Agent NFT",
      };
    }),

  // Confirm 8004 registration after user signs
  confirm8004Registration: protectedProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      txSignature: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [agent] = await db
        .select()
        .from(schema.agents)
        .where(
          and(
            eq(schema.agents.id, input.agentId),
            eq(schema.agents.ownerAddress, ctx.walletAddress)
          )
        )
        .limit(1);

      if (!agent) {
        throw new Error("Agent not found or not owned by you");
      }

      // Verify on-chain
      const asset = await fetchAgentAsset(ctx.walletAddress);
      if (!asset) {
        throw new Error("On-chain registration not found. Please try again.");
      }

      const [statsPda] = getAtomStatsPDA(new PublicKey(asset.assetAddress));
      await db
        .update(schema.agents)
        .set({
          assetAddress: asset.assetAddress,
          atomStatsAddress: statsPda.toBase58(),
          atomEnabled: asset.atomEnabled,
        })
        .where(eq(schema.agents.id, input.agentId));

      return {
        success: true,
        assetAddress: asset.assetAddress,
        explorerUrl: getAgentExplorerUrl(asset.assetAddress),
      };
    }),

  // Retroactively register an existing agent on 8004 (admin/dev only)
  registerRetroactive: protectedProcedure
    .input(z.object({
      agentId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [agent] = await db
        .select()
        .from(schema.agents)
        .where(
          and(
            eq(schema.agents.id, input.agentId),
            eq(schema.agents.ownerAddress, ctx.walletAddress)
          )
        )
        .limit(1);

      if (!agent) {
        throw new Error("Agent not found or not owned by you");
      }

      if (agent.assetAddress) {
        return {
          success: true,
          assetAddress: agent.assetAddress,
          message: "Already registered on 8004",
          explorerUrl: getAgentExplorerUrl(agent.assetAddress),
        };
      }

      // Register on 8004 with backend payer
      const result = await registerAgentOn8004WithBackendPayer({
        ownerAddress: ctx.walletAddress,
        metadata: {
          name: agent.name,
          description: agent.description ?? "",
          category: agent.category,
          capabilities: agent.capabilities ?? [],
          pricingModel: agent.pricingModel as any,
        },
        atomEnabled: true,
      });

      const [statsPda] = getAtomStatsPDA(new PublicKey(result.agentAsset));
      await db
        .update(schema.agents)
        .set({
          assetAddress: result.agentAsset,
          atomStatsAddress: statsPda.toBase58(),
          atomEnabled: true,
        })
        .where(eq(schema.agents.id, input.agentId));

      return {
        success: true,
        assetAddress: result.agentAsset,
        message: "Registered on 8004",
        explorerUrl: getAgentExplorerUrl(result.agentAsset),
      };
    }),

  // Get ATOM reputation for an agent
  getReputation: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [agent] = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, input.id))
        .limit(1);

      if (!agent?.assetAddress) {
        return null;
      }

      const summary = await getAtomSummary(agent.assetAddress);
      if (!summary) return null;

      return {
        ...summary,
        formattedTier: formatTrustTier(summary.trustTier),
        compositeScore: computeReputationScore(summary),
        assetAddress: agent.assetAddress,
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
          onChainAddress: onChainAddress,
        })
        .returning();

      await db
        .insert(schema.agentPerformance)
        .values({ agentId: agent.id })
        .onConflictDoNothing();

      return agent;
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

      return getEffectiveBalance(job.privyWalletAddress);
    }),
});
