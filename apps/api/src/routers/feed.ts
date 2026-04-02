import { router, publicProcedure } from "../utils/trpc";
import { z } from "zod";
import { getRecentEvents, getEventsByAgent, getEventsByCategory, getEventsByJob } from "../feed";

export const feedRouter = router({
  getRecent: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }))
    .query(async ({ input }) => {
      const events = await getRecentEvents(input.limit);
      return { events };
    }),

  getByAgent: publicProcedure
    .input(z.object({
      agentId: z.string().uuid(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const events = await getEventsByAgent(input.agentId, input.limit);
      return { events };
    }),

  getByJob: publicProcedure
    .input(z.object({
      jobId: z.string().uuid(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const events = await getEventsByJob(input.jobId, input.limit);
      return { events };
    }),

  getByCategory: publicProcedure
    .input(z.object({
      category: z.enum(["politics", "sports", "general", "crypto", "geo"]),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const events = await getEventsByCategory(input.category, input.limit);
      return { events };
    }),
});
