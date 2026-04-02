import { router, publicProcedure, protectedProcedure } from "../utils/trpc";
import { z } from "zod";
import {
  listPromptVersions,
  getEvolutionHistory,
  getPromptPerformance,
  getActivePrompts,
  runEvolutionCycle,
  promotePromptVersion,
  rollbackPromptVersion,
  shouldEvolve,
} from "../services/evolution-service";

const ADMIN_WALLETS = (process.env.ADMIN_WALLETS ?? "").split(",").map((w) => w.trim()).filter(Boolean);

function requireAdmin(walletAddress: string): void {
  if (ADMIN_WALLETS.length > 0 && !ADMIN_WALLETS.includes(walletAddress)) {
    throw new Error("Unauthorized: Admin access required");
  }
}

export const evolutionRouter = router({
  // List all prompt versions, optionally filtered by agent type and pipeline step
  listPromptVersions: publicProcedure
    .input(
      z.object({
        agentType: z.enum(["politics", "sports", "crypto", "general"]).optional(),
        pipelineStep: z.enum(["research", "analysis", "decision"]).optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      return listPromptVersions(input);
    }),

  // Get currently active prompts for all agent types or a specific one
  getActivePrompts: publicProcedure
    .input(
      z.object({
        agentType: z.enum(["politics", "sports", "crypto", "general"]),
      })
    )
    .query(async ({ input }) => {
      const prompts = await getActivePrompts(input.agentType);
      return {
        agentType: input.agentType,
        ...prompts,
      };
    }),

  // Get evolution history (past evolution events)
  getEvolutionHistory: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      return getEvolutionHistory(input.limit);
    }),

  // Get performance data for a specific prompt version
  getPromptPerformance: publicProcedure
    .input(
      z.object({
        promptVersionId: z.string().uuid(),
      })
    )
    .query(async ({ input }) => {
      return getPromptPerformance(input.promptVersionId);
    }),

  // Check if an agent type is ready to evolve
  checkEvolutionReadiness: publicProcedure
    .input(
      z.object({
        agentType: z.enum(["politics", "sports", "crypto", "general"]),
      })
    )
    .query(async ({ input }) => {
      const ready = await shouldEvolve(input.agentType);
      return { agentType: input.agentType, ready };
    }),

  // Manually trigger evolution cycle (protected - admin only)
  triggerEvolution: protectedProcedure
    .mutation(async ({ ctx }) => {
      requireAdmin(ctx.walletAddress);
      const result = await runEvolutionCycle();
      return result;
    }),

  // Manually promote a specific prompt version (protected - admin only)
  promoteVersion: protectedProcedure
    .input(
      z.object({
        versionId: z.string().uuid(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireAdmin(ctx.walletAddress);
      const success = await promotePromptVersion(input.versionId);
      return { success };
    }),

  // Rollback to a previous prompt version (protected - admin only)
  rollbackVersion: protectedProcedure
    .input(
      z.object({
        versionId: z.string().uuid(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireAdmin(ctx.walletAddress);
      const success = await rollbackPromptVersion(input.versionId);
      return { success };
    }),
});
