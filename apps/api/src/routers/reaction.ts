import { router, protectedProcedure, publicProcedure } from "../utils/trpc";
import { z } from "zod";
import { eq, and, sql, desc, gte, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { redisPub } from "../utils/redis";

const REACTION_TYPES = ["fire", "up", "think", "gem"] as const;

// --- Helper: broadcast reaction update via WS ---
async function broadcastReactionUpdate(eventId: string) {
  const counts = await db
    .select({
      reactionType: schema.feedReactions.reactionType,
      count: sql<number>`count(*)`,
    })
    .from(schema.feedReactions)
    .where(eq(schema.feedReactions.eventId, eventId))
    .groupBy(schema.feedReactions.reactionType);

  const userReactions = await db
    .select({
      userWallet: schema.feedReactions.userWallet,
      reactionType: schema.feedReactions.reactionType,
    })
    .from(schema.feedReactions)
    .where(eq(schema.feedReactions.eventId, eventId));

  const payload = {
    type: "reaction_update" as const,
    data: {
      eventId,
      counts: Object.fromEntries(counts.map((c) => [c.reactionType, c.count])),
      userReactions: userReactions.map((r) => ({
        userWallet: r.userWallet,
        reactionType: r.reactionType,
      })),
    },
  };

  // Broadcast via Redis so WS server picks it up
  await redisPub.publish("feed:live", JSON.stringify(payload));
}

export const reactionRouter = router({
  // Toggle a reaction on/off for the current user
  toggle: protectedProcedure
    .input(
      z.object({
        eventId: z.string().min(1),
        reactionType: z.enum(REACTION_TYPES),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await db
        .select()
        .from(schema.feedReactions)
        .where(
          and(
            eq(schema.feedReactions.eventId, input.eventId),
            eq(schema.feedReactions.userWallet, ctx.walletAddress),
            eq(schema.feedReactions.reactionType, input.reactionType)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // Remove reaction (toggle off)
        await db
          .delete(schema.feedReactions)
          .where(eq(schema.feedReactions.id, existing[0].id));
      } else {
        // Add reaction
        await db.insert(schema.feedReactions).values({
          eventId: input.eventId,
          userWallet: ctx.walletAddress,
          reactionType: input.reactionType,
        });
      }

      await broadcastReactionUpdate(input.eventId);

      return { success: true };
    }),

  // Get reactions for a list of event IDs (batch fetch for feed)
  getForEvents: publicProcedure
    .input(
      z.object({
        eventIds: z.array(z.string().min(1)).max(200),
        userWallet: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      if (input.eventIds.length === 0) {
        return { reactions: {} };
      }

      const rows = await db
        .select({
          eventId: schema.feedReactions.eventId,
          reactionType: schema.feedReactions.reactionType,
          count: sql<number>`count(*)`,
        })
        .from(schema.feedReactions)
        .where(inArray(schema.feedReactions.eventId, input.eventIds))
        .groupBy(schema.feedReactions.eventId, schema.feedReactions.reactionType);

      // Build nested map: eventId -> { reactionType -> count }
      const reactions: Record<string, Record<string, number>> = {};
      for (const row of rows) {
        if (!reactions[row.eventId]) reactions[row.eventId] = {};
        reactions[row.eventId][row.reactionType] = row.count;
      }

      // Get current user's reactions if wallet provided
      let myReactions: Record<string, string[]> = {};
      if (input.userWallet) {
        const userRows = await db
          .select({
            eventId: schema.feedReactions.eventId,
            reactionType: schema.feedReactions.reactionType,
          })
          .from(schema.feedReactions)
          .where(
            and(
              inArray(schema.feedReactions.eventId, input.eventIds),
              eq(schema.feedReactions.userWallet, input.userWallet)
            )
          );

        for (const row of userRows) {
          if (!myReactions[row.eventId]) myReactions[row.eventId] = [];
          myReactions[row.eventId].push(row.reactionType);
        }
      }

      return { reactions, myReactions };
    }),

  // Get top reacted events (reaction leaderboard)
  getTopEvents: publicProcedure
    .input(
      z.object({
        hours: z.number().min(1).max(168).default(24),
        limit: z.number().min(1).max(50).default(10),
      })
    )
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
