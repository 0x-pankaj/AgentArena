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
      agentId: z.string().min(1),
      limit: z.number().min(1).max(100).default(50),
      // Marketplace agent page shows the agent's own activity. Swarm-peer
      // events (this agent consulted by another agent for a vote) are
      // tagged via swarm_driven=true; default to hiding them so a non-
      // hired agent's feed shows nothing instead of misleading "active"
      // chatter. Pass includeSwarm=true for the swarm/admin views.
      includeSwarm: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      // Over-fetch slightly so we can drop swarm events without coming up
      // short on the displayed list.
      const fetchLimit = input.includeSwarm ? input.limit : Math.min(100, input.limit * 3);
      const raw = await getEventsByAgent(input.agentId, fetchLimit);
      const events = input.includeSwarm
        ? raw
        : raw.filter((e) => {
            const c = (e.content ?? {}) as Record<string, unknown>;
            return c.swarm_driven !== true;
          });
      return { events: events.slice(0, input.limit) };
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
