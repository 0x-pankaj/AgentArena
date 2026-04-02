import { router, publicProcedure } from "../utils/trpc";
import { z } from "zod";
import {
  listMarkets,
  getMarket,
  getTrendingMarkets,
  searchMarkets,
} from "../services/market-service";

export const marketRouter = router({
  list: publicProcedure
    .input(z.object({
      category: z.string().optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      return listMarkets({
        category: input.category,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return getMarket(input.id);
    }),

  getTrending: publicProcedure
    .input(z.object({
      category: z.string().optional(),
      limit: z.number().min(1).max(50).default(10),
    }))
    .query(async ({ input }) => {
      return getTrendingMarkets({
        category: input.category,
        limit: input.limit,
      });
    }),

  search: publicProcedure
    .input(z.object({
      query: z.string().min(1),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      return searchMarkets(input.query, input.limit);
    }),
});
