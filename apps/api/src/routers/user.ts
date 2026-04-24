import { router, protectedProcedure, publicProcedure } from "../utils/trpc";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "../db";
import { getWalletBalance } from "../utils/privy";
import { requestDevnetAirdrop } from "../utils/devnet-helpers";
import { IS_DEVNET } from "@agent-arena/shared";
import { z } from "zod";

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

  // Devnet faucet — airdrop SOL to user's wallet for 8004 mints/fees
  faucet: publicProcedure
    .input(z.object({ walletAddress: z.string().min(32).max(44) }))
    .mutation(async ({ input }) => {
      if (!IS_DEVNET) {
        throw new Error("Faucet only available on devnet");
      }

      const success = await requestDevnetAirdrop(input.walletAddress, 0.5);
      if (!success) {
        throw new Error("Airdrop failed — devnet rate limit may apply. Try again later.");
      }

      return {
        success: true,
        message: "Airdropped 0.5 SOL to your wallet",
        walletAddress: input.walletAddress,
      };
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
