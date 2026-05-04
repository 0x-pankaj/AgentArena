import { router, publicProcedure } from "../utils/trpc";
import { z } from "zod";
import {
  getAllTimeLeaderboard,
  getTodayLeaderboard,
  getLeaderboardByCategory,
  getAgentRank,
  getGlobalStats,
  getUserLeaderboard,
  getTrendingAgents,
} from "../leaderboard";
import { getPredictorLeaderboard } from "./paper-bets";
import { db, schema } from "../db";
import { eq, sql, desc, gte } from "drizzle-orm";

export const leaderboardRouter = router({
  getAllTime: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      mode: z.enum(["paper", "live"]).default("paper"),
    }))
    .query(async ({ input }) => {
      return getAllTimeLeaderboard(input.limit, input.mode === "paper");
    }),

  getToday: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      mode: z.enum(["paper", "live"]).default("paper"),
    }))
    .query(async ({ input }) => {
      return getTodayLeaderboard(input.limit, input.mode === "paper");
    }),

  getByCategory: publicProcedure
    .input(z.object({
      category: z.enum(["geo", "politics", "sports", "crypto", "general"]),
      limit: z.number().min(1).max(100).default(50),
      mode: z.enum(["paper", "live"]).default("paper"),
    }))
    .query(async ({ input }) => {
      return getLeaderboardByCategory(input.category, input.limit, input.mode === "paper");
    }),

  getAgentRank: publicProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      mode: z.enum(["paper", "live"]).default("paper"),
    }))
    .query(async ({ input }) => {
      return getAgentRank(input.agentId, input.mode === "paper");
    }),

  getGlobalStats: publicProcedure
    .input(z.object({
      mode: z.enum(["paper", "live"]).default("paper"),
    }).optional())
    .query(async ({ input }) => {
      return getGlobalStats(input?.mode === "live" ? false : true);
    }),

  getUsers: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      mode: z.enum(["paper", "live"]).default("paper"),
    }))
    .query(async ({ input }) => {
      return getUserLeaderboard(input.limit, input.mode === "paper");
    }),

  getTrending: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      return getTrendingAgents(input.limit);
    }),

  // Get leaderboard filtered by ATOM trust tier
  getByTier: publicProcedure
    .input(z.object({
      tier: z.enum(["Unknown", "Bronze", "Silver", "Gold", "Platinum", "Legendary"]),
      limit: z.number().min(1).max(100).default(50),
      mode: z.enum(["paper", "live"]).default("paper"),
    }))
    .query(async ({ input }) => {
      const all = await getAllTimeLeaderboard(200, input.mode === "paper");
      return {
        entries: all.entries
          .filter((e) => e.trustTier === input.tier)
          .slice(0, input.limit),
      };
    }),

  // Get agents with ATOM reputation only
  getAtomVerified: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      mode: z.enum(["paper", "live"]).default("paper"),
    }))
    .query(async ({ input }) => {
      const all = await getAllTimeLeaderboard(200, input.mode === "paper");
      return {
        entries: all.entries
          .filter((e) => e.atomEnabled && e.trustTier !== "Unknown")
          .sort((a, b) => (b.reputationScore ?? 0) - (a.reputationScore ?? 0))
          .slice(0, input.limit),
      };
    }),

  // --- Paper Predictor Leaderboard ---
  getPredictors: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      return getPredictorLeaderboard(input.limit);
    }),

  // --- Reaction Leaderboard (most hyped events) ---
  getTopReactedEvents: publicProcedure
    .input(z.object({
      hours: z.number().min(1).max(168).default(24),
      limit: z.number().min(1).max(50).default(10),
    }))
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);

      const rows = await db
        .select({
          eventId: schema.feedReactions.eventId,
          totalReactions: sql<number>`count(*)`,
        })
        .from(schema.feedReactions)
        .where(gte(schema.feedReactions.createdAt, since))
        .groupBy(schema.feedReactions.eventId)
        .orderBy(desc(sql`count(*)`))
        .limit(input.limit);

      return { events: rows };
    }),
});
