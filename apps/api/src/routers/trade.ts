import { router, protectedProcedure } from "../utils/trpc";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db";
import {
  listTrades,
  getTrade,
  listPositions,
  getActivePositions,
} from "../services/trade-service";
import {
  getPaperBalance,
  topUpPaperBalance,
  getPaperPortfolio,
} from "../services/paper-trading";

async function verifyJobOwnership(jobId: string, walletAddress: string): Promise<boolean> {
  const [job] = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.clientAddress, walletAddress)))
    .limit(1);
  return !!job;
}

export const tradeRouter = router({
  list: protectedProcedure
    .input(z.object({
      jobId: z.string().uuid(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      if (!(await verifyJobOwnership(input.jobId, ctx.walletAddress))) {
        throw new Error("Job not found or not owned by you");
      }
      return listTrades({
        jobId: input.jobId,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const trade = await getTrade(input.id);
      if (trade && !(await verifyJobOwnership(trade.jobId, ctx.walletAddress))) {
        throw new Error("Trade not found or not owned by you");
      }
      return trade;
    }),
});

export const positionRouter = router({
  list: protectedProcedure
    .input(z.object({
      jobId: z.string().uuid(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      if (!(await verifyJobOwnership(input.jobId, ctx.walletAddress))) {
        throw new Error("Job not found or not owned by you");
      }
      return listPositions({
        jobId: input.jobId,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  getActive: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      if (!(await verifyJobOwnership(input.jobId, ctx.walletAddress))) {
        throw new Error("Job not found or not owned by you");
      }
      return getActivePositions(input.jobId);
    }),
});

// --- Paper Trading Router ---

export const paperTradingRouter = router({
  getBalance: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      if (!(await verifyJobOwnership(input.jobId, ctx.walletAddress))) {
        throw new Error("Job not found or not owned by you");
      }
      const balance = await getPaperBalance(input.jobId);
      return { balance };
    }),

  topUp: protectedProcedure
    .input(z.object({
      jobId: z.string().uuid(),
      amount: z.number().min(1).max(100000),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!(await verifyJobOwnership(input.jobId, ctx.walletAddress))) {
        throw new Error("Job not found or not owned by you");
      }
      const newBalance = await topUpPaperBalance(input.jobId, input.amount);
      return { success: true, newBalance };
    }),

  getPortfolio: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      if (!(await verifyJobOwnership(input.jobId, ctx.walletAddress))) {
        throw new Error("Job not found or not owned by you");
      }
      return getPaperPortfolio(input.jobId);
    }),
});
