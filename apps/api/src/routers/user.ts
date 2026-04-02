import { router, protectedProcedure } from "../utils/trpc";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "../db";
import { getWalletBalance } from "../utils/privy";

export const userRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    // Get or create user
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.walletAddress, ctx.walletAddress))
      .limit(1);

    if (!user) {
      const [created] = await db
        .insert(schema.users)
        .values({ walletAddress: ctx.walletAddress })
        .returning();
      return created;
    }

    return user;
  }),

  getPortfolio: protectedProcedure.query(async ({ ctx }) => {
    // Get all jobs for user
    const jobs = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.clientAddress, ctx.walletAddress))
      .orderBy(desc(schema.jobs.createdAt));

    // Get positions across all jobs
    let totalInvested = 0;
    let totalProfit = 0;
    const allPositions = [];

    for (const job of jobs) {
      totalInvested += Number(job.totalInvested ?? 0);
      totalProfit += Number(job.totalProfit ?? 0);

      const positions = await db
        .select()
        .from(schema.positions)
        .where(eq(schema.positions.jobId, job.id));

      allPositions.push(...positions);
    }

    // Get wallet balance
    const balance = await getWalletBalance(ctx.walletAddress);

    return {
      jobs,
      positions: allPositions,
      totalInvested,
      totalProfit,
      walletBalance: balance,
    };
  }),
});
