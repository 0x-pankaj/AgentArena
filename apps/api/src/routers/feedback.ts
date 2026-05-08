import { router, publicProcedure } from "../utils/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, schema } from "../db";
import { redis } from "../utils/redis";

const FEEDBACK_TYPES = ["bug", "feature", "general", "praise"] as const;
const FEEDBACK_STATUSES = ["new", "triaged", "resolved", "spam"] as const;
const SOURCES = ["web", "mobile", "api"] as const;

const RATE_LIMIT_WINDOW_SEC = 60 * 60; // 1 hour
// Bumped 5 → 15 for traction launch — shared NATs (event WiFi, offices) share one IP-hash bucket.
const RATE_LIMIT_MAX = 15;

function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex");
}

export const feedbackRouter = router({
  submit: publicProcedure
    .input(
      z.object({
        type: z.enum(FEEDBACK_TYPES),
        rating: z.number().int().min(1).max(5).optional(),
        message: z.string().min(3).max(2000),
        contact: z.string().max(200).optional(),
        source: z.enum(SOURCES).default("web"),
        pageUrl: z.string().max(500).optional(),
        // Honeypot — must be empty. Bots tend to fill every field.
        website: z.string().max(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.website && input.website.length > 0) {
        // Silently accept and drop — don't tip off bots that they were caught.
        return { success: true, id: null };
      }

      const ipHash = hashIp(ctx.ip);

      // Per-IP rate-limit using a redis counter.
      if (ipHash) {
        const key = `feedback:rl:${ipHash}`;
        const count = await redis.incr(key);
        if (count === 1) {
          await redis.expire(key, RATE_LIMIT_WINDOW_SEC);
        }
        if (count > RATE_LIMIT_MAX) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `Too many submissions. Try again in ${RATE_LIMIT_WINDOW_SEC / 60} minutes.`,
          });
        }
      }

      const [row] = await db
        .insert(schema.feedback)
        .values({
          type: input.type,
          rating: input.rating ?? null,
          message: input.message.trim(),
          contact: input.contact?.trim() || null,
          source: input.source,
          pageUrl: input.pageUrl ?? null,
          userAgent: ctx.userAgent ?? null,
          ipHash,
          walletAddress: ctx.walletAddress ?? null,
          status: "new",
        })
        .returning({ id: schema.feedback.id });

      return { success: true, id: row.id };
    }),

  // Public list of recent feedback. Sensitive fields (contact, ipHash, userAgent)
  // are stripped — anyone can see what's been submitted (this is intentional —
  // social proof for new visitors), but personal data stays private.
  recent: publicProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).default(10),
          type: z.enum(FEEDBACK_TYPES).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 10;
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days

      const filters = [
        ne(schema.feedback.status, "spam"),
        gte(schema.feedback.createdAt, since),
      ];
      if (input?.type) filters.push(eq(schema.feedback.type, input.type));

      const rows = await db
        .select({
          id: schema.feedback.id,
          type: schema.feedback.type,
          rating: schema.feedback.rating,
          message: schema.feedback.message,
          source: schema.feedback.source,
          createdAt: schema.feedback.createdAt,
        })
        .from(schema.feedback)
        .where(and(...filters))
        .orderBy(desc(schema.feedback.createdAt))
        .limit(limit);

      return { items: rows };
    }),

  // Aggregate stats — useful for the landing page ("324 pieces of feedback, avg ★4.6").
  stats: publicProcedure.query(async () => {
    const [agg] = await db
      .select({
        total: sql<number>`count(*)`,
        avgRating: sql<number | null>`avg(${schema.feedback.rating})`,
        bugs: sql<number>`sum(case when ${schema.feedback.type} = 'bug' then 1 else 0 end)`,
        features: sql<number>`sum(case when ${schema.feedback.type} = 'feature' then 1 else 0 end)`,
        praise: sql<number>`sum(case when ${schema.feedback.type} = 'praise' then 1 else 0 end)`,
      })
      .from(schema.feedback)
      .where(ne(schema.feedback.status, "spam"));

      return {
        total: Number(agg?.total ?? 0),
        avgRating: agg?.avgRating != null ? Number(agg.avgRating) : null,
        bugs: Number(agg?.bugs ?? 0),
        features: Number(agg?.features ?? 0),
        praise: Number(agg?.praise ?? 0),
      };
  }),
});
