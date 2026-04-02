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

export const leaderboardRouter = router({
  getAllTime: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
    .query(async ({ input }) => {
      return getAllTimeLeaderboard(input.limit);
    }),

  getToday: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
    .query(async ({ input }) => {
      return getTodayLeaderboard(input.limit);
    }),

  getByCategory: publicProcedure
    .input(z.object({
      category: z.enum(["geo", "politics", "sports", "crypto", "general"]),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      return getLeaderboardByCategory(input.category, input.limit);
    }),

  getAgentRank: publicProcedure
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getAgentRank(input.agentId);
    }),

  getGlobalStats: publicProcedure
    .query(async () => {
      return getGlobalStats();
    }),

  getUsers: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
    .query(async ({ input }) => {
      return getUserLeaderboard(input.limit);
    }),

  getTrending: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      return getTrendingAgents(input.limit);
    }),
});
