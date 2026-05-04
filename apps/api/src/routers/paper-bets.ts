import { router, protectedProcedure, publicProcedure } from "../utils/trpc";
import { z } from "zod";
import { eq, and, sql, desc, gte, inArray, ne } from "drizzle-orm";
import { db, schema } from "../db";

const BET_DIRECTIONS = ["buy", "sell", "pass"] as const;
const MIN_BET = 10;
const MAX_BET = 500;
const WIN_MULTIPLIER = 2;

// --- In-memory cache: agentId + marketId -> most recent reasoning event_id ---
const pendingReasoningEvents = new Map<string, string>();
const PENDING_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const pendingCacheTimestamps = new Map<string, number>();

export function setPendingReasoningEvent(agentId: string, marketId: string, eventId: string): void {
  const key = `${agentId}:${marketId}`;
  pendingReasoningEvents.set(key, eventId);
  pendingCacheTimestamps.set(key, Date.now());
}

export function getPendingReasoningEvent(agentId: string, marketId: string): string | undefined {
  const key = `${agentId}:${marketId}`;
  const ts = pendingCacheTimestamps.get(key);
  if (ts && Date.now() - ts > PENDING_CACHE_TTL_MS) {
    pendingReasoningEvents.delete(key);
    pendingCacheTimestamps.delete(key);
    return undefined;
  }
  return pendingReasoningEvents.get(key);
}

export function clearPendingReasoningEvent(agentId: string, marketId: string): void {
  const key = `${agentId}:${marketId}`;
  pendingReasoningEvents.delete(key);
  pendingCacheTimestamps.delete(key);
}

// --- Helper: get or init paper balance ---
export async function getOrInitPaperBalance(userWallet: string): Promise<number> {
  const [balance] = await db
    .select()
    .from(schema.paperBalances)
    .where(eq(schema.paperBalances.userWallet, userWallet))
    .limit(1);

  if (balance) {
    return Number(balance.balance);
  }

  // Initialize with 1000 paper points
  await db.insert(schema.paperBalances).values({
    userWallet,
    balance: "1000",
    totalEarned: "0",
    totalLost: "0",
  });

  return 1000;
}

export async function adjustPaperBalance(
  userWallet: string,
  delta: number,
  type: "earned" | "lost"
): Promise<void> {
  const [current] = await db
    .select()
    .from(schema.paperBalances)
    .where(eq(schema.paperBalances.userWallet, userWallet))
    .limit(1);

  if (!current) {
    await getOrInitPaperBalance(userWallet);
    return adjustPaperBalance(userWallet, delta, type);
  }

  const newBalance = Math.max(0, Number(current.balance) + delta);
  const updateData: Record<string, string> = {
    balance: newBalance.toFixed(6),
  };

  if (type === "earned" && delta > 0) {
    updateData.totalEarned = (Number(current.totalEarned) + delta).toFixed(6);
  } else if (type === "lost" && delta < 0) {
    updateData.totalLost = (Number(current.totalLost) + Math.abs(delta)).toFixed(6);
  }

  await db
    .update(schema.paperBalances)
    .set(updateData)
    .where(eq(schema.paperBalances.userWallet, userWallet));
}

export const paperBetsRouter = router({
  // Get current user's paper balance
  getBalance: protectedProcedure.query(async ({ ctx }) => {
    const balance = await getOrInitPaperBalance(ctx.walletAddress);
    const [record] = await db
      .select()
      .from(schema.paperBalances)
      .where(eq(schema.paperBalances.userWallet, ctx.walletAddress))
      .limit(1);

    return {
      balance,
      totalEarned: Number(record?.totalEarned ?? 0),
      totalLost: Number(record?.totalLost ?? 0),
    };
  }),

  // Place a bet on an agent's upcoming decision
  place: protectedProcedure
    .input(
      z.object({
        eventId: z.string().min(1),
        agentId: z.string().min(1),
        direction: z.enum(BET_DIRECTIONS),
        amount: z.number().min(MIN_BET).max(MAX_BET),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const balance = await getOrInitPaperBalance(ctx.walletAddress);

      if (balance < input.amount) {
        throw new Error(`Insufficient paper balance. You have ${balance} points.`);
      }

      // Check if user already bet on this event
      const existing = await db
        .select()
        .from(schema.paperBets)
        .where(
          and(
            eq(schema.paperBets.eventId, input.eventId),
            eq(schema.paperBets.userWallet, ctx.walletAddress)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        throw new Error("You already placed a bet on this event");
      }

      // Deduct balance
      await adjustPaperBalance(ctx.walletAddress, -input.amount, "lost");

      // Create bet
      const [bet] = await db
        .insert(schema.paperBets)
        .values({
          eventId: input.eventId,
          userWallet: ctx.walletAddress,
          agentId: input.agentId,
          direction: input.direction,
          amount: input.amount.toFixed(6),
          status: "pending",
        })
        .returning();

      return { success: true, bet };
    }),

  // Get bets for an event (public, shows community sentiment)
  getByEvent: publicProcedure
    .input(z.object({ eventId: z.string().min(1) }))
    .query(async ({ input }) => {
      const bets = await db
        .select()
        .from(schema.paperBets)
        .where(eq(schema.paperBets.eventId, input.eventId))
        .orderBy(desc(schema.paperBets.createdAt));

      const totals = { buy: 0, sell: 0, pass: 0, totalAmount: 0 };
      for (const bet of bets) {
        totals[bet.direction as keyof typeof totals] += Number(bet.amount);
        totals.totalAmount += Number(bet.amount);
      }

      return { bets, totals };
    }),

  // Get current user's bets
  getMyBets: protectedProcedure
    .input(
      z.object({
        status: z.enum(["pending", "won", "lost", "all"]).default("all"),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      let whereClause = eq(schema.paperBets.userWallet, ctx.walletAddress);
      if (input.status !== "all") {
        whereClause = and(whereClause, eq(schema.paperBets.status, input.status)) as any;
      }

      const bets = await db
        .select()
        .from(schema.paperBets)
        .where(whereClause)
        .orderBy(desc(schema.paperBets.createdAt))
        .limit(input.limit);

      return { bets };
    }),

  // Get active (open) bets for an agent
  getActiveByAgent: publicProcedure
    .input(z.object({ agentId: z.string().min(1), limit: z.number().min(1).max(100).default(50) }))
    .query(async ({ input }) => {
      const bets = await db
        .select()
        .from(schema.paperBets)
        .where(
          and(
            eq(schema.paperBets.agentId, input.agentId),
            eq(schema.paperBets.status, "pending")
          )
        )
        .orderBy(desc(schema.paperBets.createdAt))
        .limit(input.limit);

      return { bets };
    }),
});

// --- Auto-resolve bets when a trade executes ---
// Called from execution-engine when trade completes
export async function resolveBetsForEvent(
  eventId: string,
  actualDirection: "buy" | "sell" | "pass"
): Promise<{ winners: number; losers: number; totalPayout: number }> {
  const pendingBets = await db
    .select()
    .from(schema.paperBets)
    .where(
      and(
        eq(schema.paperBets.eventId, eventId),
        eq(schema.paperBets.status, "pending")
      )
    );

  let winners = 0;
  let losers = 0;
  let totalPayout = 0;

  for (const bet of pendingBets) {
    const won = bet.direction === actualDirection;
    const amount = Number(bet.amount);

    if (won) {
      const payout = amount * WIN_MULTIPLIER;
      await adjustPaperBalance(bet.userWallet, payout, "earned");
      totalPayout += payout;
      winners++;
    } else {
      losers++;
    }

    await db
      .update(schema.paperBets)
      .set({
        status: won ? "won" : "lost",
        resolvedAt: new Date(),
      })
      .where(eq(schema.paperBets.id, bet.id));
  }

  return { winners, losers, totalPayout };
}

// --- Predictor Leaderboard ---
export async function getPredictorLeaderboard(limit: number = 50) {
  const rows = await db
    .select({
      userWallet: schema.paperBets.userWallet,
      totalBets: sql<number>`count(*)`,
      wonBets: sql<number>`sum(case when ${schema.paperBets.status} = 'won' then 1 else 0 end)`,
      totalWagered: sql<number>`sum(${schema.paperBets.amount})`,
      netProfit: sql<number>`sum(case when ${schema.paperBets.status} = 'won' then ${schema.paperBets.amount} * ${WIN_MULTIPLIER - 1} else -${schema.paperBets.amount} end)`,
    })
    .from(schema.paperBets)
    .where(ne(schema.paperBets.status, "pending"))
    .groupBy(schema.paperBets.userWallet)
    .orderBy(desc(sql`sum(case when ${schema.paperBets.status} = 'won' then ${schema.paperBets.amount} * ${WIN_MULTIPLIER - 1} else -${schema.paperBets.amount} end)`))
    .limit(limit);

  // Get usernames
  const wallets = rows.map((r) => r.userWallet);
  let users: Record<string, string> = {};
  if (wallets.length > 0) {
    const userRows = await db
      .select({
        walletAddress: schema.users.walletAddress,
        username: schema.users.username,
      })
      .from(schema.users)
      .where(inArray(schema.users.walletAddress, wallets));

    users = Object.fromEntries(userRows.map((u) => [u.walletAddress, u.username ?? u.walletAddress.slice(0, 8)]));
  }

  return rows.map((r, i) => ({
    rank: i + 1,
    walletAddress: r.userWallet,
    username: users[r.userWallet] ?? r.userWallet.slice(0, 8),
    totalBets: r.totalBets,
    wonBets: r.wonBets ?? 0,
    winRate: r.totalBets > 0 ? ((r.wonBets ?? 0) / r.totalBets) * 100 : 0,
    totalWagered: Number(r.totalWagered ?? 0),
    netProfit: Number(r.netProfit ?? 0),
  }));
}
