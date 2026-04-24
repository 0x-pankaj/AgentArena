import { eq, desc, sql, and } from "drizzle-orm";
import { db, schema } from "../db";
import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import { broadcastLeaderboardUpdate } from "../ws";

export interface LeaderboardEntry {
  agentId: string;
  agentName: string;
  category: string;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  totalVolume: number;
  sharpeRatio: number | null;
  maxDrawdown: number | null;
  recentTrend: "up" | "down" | "flat";
  activePositions: number;
  lastActivityAt: string | null;
  rank: number;
}

export interface GlobalStats {
  totalVolume: number;
  totalPnl: number;
  activeAgents: number;
  totalTrades: number;
  totalUsers: number;
  topCategory: string;
}

export interface UserLeaderboardEntry {
  rank: number;
  walletAddress: string;
  username: string | null;
  totalPnl: number;
  totalAgents: number;
  avgWinRate: number;
  totalTrades: number;
  bestAgent: { id: string; name: string; pnl: number };
}

// --- Update agent stats in Redis ---

export async function updateAgentStats(
  agentId: string,
  stats: {
    totalPnl: number;
    winRate: number;
    totalTrades: number;
    maxDrawdown: number;
    sharpeRatio: number;
    totalVolume: number;
  },
  isPaperTrading: boolean = true
): Promise<void> {
  const modeSuffix = isPaperTrading ? ":paper" : ":live";
  const key = `${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}${modeSuffix}`;

  await redis.hset(key, {
    totalPnl: String(stats.totalPnl),
    winRate: String(stats.winRate),
    totalTrades: String(stats.totalTrades),
    maxDrawdown: String(stats.maxDrawdown),
    sharpeRatio: String(stats.sharpeRatio),
    totalVolume: String(stats.totalVolume),
  });

  // Update mode-specific leaderboard ZSETs
  const alltimeKey = `${REDIS_KEYS.LEADERBOARD_ALLTIME}${modeSuffix}`;
  await redis.zadd(alltimeKey, stats.totalPnl, agentId);

  // Update daily leaderboard
  const today = new Date().toISOString().slice(0, 10);
  await redis.zadd(
    `${REDIS_KEYS.LEADERBOARD_PREFIX}daily:${today}${modeSuffix}`,
    stats.totalPnl,
    agentId
  );

  // Update category leaderboard
  const [agent] = await db
    .select({ category: schema.agents.category, ownerAddress: schema.agents.ownerAddress })
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId))
    .limit(1);

  if (agent?.category) {
    await redis.zadd(
      `${REDIS_KEYS.LEADERBOARD_CATEGORY_PREFIX}${agent.category}${modeSuffix}`,
      stats.totalPnl,
      agentId
    );
  }

  // Update user leaderboard (paper vs live aggregated separately)
  if (agent?.ownerAddress) {
    await updateUserLeaderboardEntry(agent.ownerAddress, isPaperTrading);
  }

  // Broadcast leaderboard update via WebSocket (paper by default)
  if (isPaperTrading) {
    const topAgents = await getAllTimeLeaderboard(10, true);
    broadcastLeaderboardUpdate({ type: "agents", entries: topAgents.entries, mode: "paper" });
  }

  // Invalidate global stats cache
  await redis.del(`${REDIS_KEYS.GLOBAL_STATS}${modeSuffix}`);
}

// --- Update user leaderboard entry ---

async function updateUserLeaderboardEntry(walletAddress: string, isPaperTrading: boolean = true): Promise<void> {
  const modeSuffix = isPaperTrading ? ":paper" : ":live";
  const result = await db
    .select({
      totalPnl: sql<number>`COALESCE(SUM(CAST(${schema.agentPerformance.totalPnl} AS NUMERIC)), 0)`,
      totalAgents: sql<number>`COUNT(${schema.agents.id})`,
      avgWinRate: sql<number>`COALESCE(AVG(CAST(${schema.agentPerformance.winRate} AS NUMERIC)), 0)`,
      totalTrades: sql<number>`COALESCE(SUM(${schema.agentPerformance.totalTrades}), 0)`,
    })
    .from(schema.agents)
    .leftJoin(
      schema.agentPerformance,
      and(
        eq(schema.agents.id, schema.agentPerformance.agentId),
        eq(schema.agentPerformance.isPaperTrading, isPaperTrading)
      )
    )
    .where(eq(schema.agents.ownerAddress, walletAddress));

  const stats = result[0];
  if (stats) {
    await redis.hset(`${REDIS_KEYS.LEADERBOARD_USERS}:${walletAddress}${modeSuffix}`, {
      totalPnl: String(stats.totalPnl),
      totalAgents: String(stats.totalAgents),
      avgWinRate: String(stats.avgWinRate),
      totalTrades: String(stats.totalTrades),
    });
    await redis.zadd(`${REDIS_KEYS.LEADERBOARD_USERS}${modeSuffix}`, Number(stats.totalPnl), walletAddress);
  }
}

// --- Enrich leaderboard entry with live data ---

async function enrichLeaderboardEntry(
  agentId: string,
  baseEntry: Omit<LeaderboardEntry, "totalVolume" | "sharpeRatio" | "maxDrawdown" | "recentTrend" | "activePositions" | "lastActivityAt">,
  isPaperTrading: boolean = true
): Promise<LeaderboardEntry> {
  const modeSuffix = isPaperTrading ? ":paper" : ":live";
  const stats = await redis.hgetall(`${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}${modeSuffix}`);
  const fsmState = await redis.get(`${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}:fsm`);

  // Get active positions count (filtered by paper/live mode)
  const activePositions = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(schema.positions)
    .innerJoin(schema.jobs, eq(schema.positions.jobId, schema.jobs.id))
    .where(and(
      eq(schema.jobs.agentId, agentId),
      eq(schema.positions.status, "open"),
      eq(schema.positions.isPaperTrade, isPaperTrading)
    ));

  // Get recent trades for trend (filtered by paper/live via positions)
  const recentTrades = await db
    .select({ profitLoss: schema.trades.profitLoss })
    .from(schema.trades)
    .innerJoin(schema.positions, eq(schema.trades.txSignature, schema.positions.txSignature))
    .where(and(
      eq(schema.trades.agentId, agentId),
      eq(schema.positions.isPaperTrade, isPaperTrading)
    ))
    .orderBy(desc(schema.trades.executedAt))
    .limit(5);

  let recentTrend: "up" | "down" | "flat" = "flat";
  if (recentTrades.length >= 2) {
    const recent = recentTrades.reduce((sum, t) => sum + Number(t.profitLoss ?? 0), 0);
    recentTrend = recent > 0 ? "up" : recent < 0 ? "down" : "flat";
  }

  // Get last activity
  const lastFeedEvent = await redis.zrange(REDIS_KEYS.FEED_RECENT, 0, 0, "REV");
  let lastActivityAt: string | null = null;
  if (lastFeedEvent.length > 0) {
    try {
      const event = JSON.parse(lastFeedEvent[0]);
      if (event.agent_id === agentId) {
        lastActivityAt = event.timestamp;
      }
    } catch {}
  }

  return {
    ...baseEntry,
    totalVolume: Number(stats.totalVolume ?? 0),
    sharpeRatio: stats.sharpeRatio ? Number(stats.sharpeRatio) : null,
    maxDrawdown: stats.maxDrawdown ? Number(stats.maxDrawdown) : null,
    recentTrend,
    activePositions: Number(activePositions[0]?.count ?? 0),
    lastActivityAt,
  };
}

// --- Get all-time leaderboard ---

export async function getAllTimeLeaderboard(
  limit: number = 50,
  isPaperTrading: boolean = true
): Promise<{ entries: LeaderboardEntry[] }> {
  const modeSuffix = isPaperTrading ? ":paper" : ":live";
  const raw = await redis.zrange(
    `${REDIS_KEYS.LEADERBOARD_ALLTIME}${modeSuffix}`,
    0,
    limit - 1,
    "REV"
  );

  const entries: LeaderboardEntry[] = [];

  for (let i = 0; i < raw.length; i++) {
    const agentId = raw[i];
    const stats = await redis.hgetall(
      `${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}${modeSuffix}`
    );

    // Get agent name from DB
    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1);

    const baseEntry = {
      agentId,
      agentName: agent?.name ?? "Unknown",
      category: agent?.category ?? "geo",
      totalPnl: Number(stats.totalPnl ?? 0),
      winRate: Number(stats.winRate ?? 0),
      totalTrades: Number(stats.totalTrades ?? 0),
      rank: i + 1,
    };

    entries.push(await enrichLeaderboardEntry(agentId, baseEntry, isPaperTrading));
  }

  return { entries };
}

// --- Get today's leaderboard ---

export async function getTodayLeaderboard(
  limit: number = 50,
  isPaperTrading: boolean = true
): Promise<{ entries: LeaderboardEntry[] }> {
  const today = new Date().toISOString().slice(0, 10);
  const modeSuffix = isPaperTrading ? ":paper" : ":live";
  const key = `${REDIS_KEYS.LEADERBOARD_PREFIX}daily:${today}${modeSuffix}`;

  const raw = await redis.zrange(key, 0, limit - 1, "REV");

  const entries: LeaderboardEntry[] = [];

  for (let i = 0; i < raw.length; i++) {
    const agentId = raw[i];
    const stats = await redis.hgetall(
      `${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}${modeSuffix}`
    );

    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1);

    const baseEntry = {
      agentId,
      agentName: agent?.name ?? "Unknown",
      category: agent?.category ?? "geo",
      totalPnl: Number(stats.totalPnl ?? 0),
      winRate: Number(stats.winRate ?? 0),
      totalTrades: Number(stats.totalTrades ?? 0),
      rank: i + 1,
    };

    entries.push(await enrichLeaderboardEntry(agentId, baseEntry, isPaperTrading));
  }

  return { entries };
}

// --- Get leaderboard by category ---

export async function getLeaderboardByCategory(
  category: string,
  limit: number = 50,
  isPaperTrading: boolean = true
): Promise<{ entries: LeaderboardEntry[] }> {
  const modeSuffix = isPaperTrading ? ":paper" : ":live";
  const key = `${REDIS_KEYS.LEADERBOARD_CATEGORY_PREFIX}${category}${modeSuffix}`;
  const raw = await redis.zrange(key, 0, limit - 1, "REV");

  // If category-specific ZSET is empty, filter from all-time
  if (raw.length === 0) {
    const all = await getAllTimeLeaderboard(200, isPaperTrading);
    return {
      entries: all.entries
        .filter((e) => e.category === category)
        .slice(0, limit),
    };
  }

  const entries: LeaderboardEntry[] = [];

  for (let i = 0; i < raw.length; i++) {
    const agentId = raw[i];
    const stats = await redis.hgetall(
      `${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}${modeSuffix}`
    );

    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1);

    const baseEntry = {
      agentId,
      agentName: agent?.name ?? "Unknown",
      category: agent?.category ?? category,
      totalPnl: Number(stats.totalPnl ?? 0),
      winRate: Number(stats.winRate ?? 0),
      totalTrades: Number(stats.totalTrades ?? 0),
      rank: i + 1,
    };

    entries.push(await enrichLeaderboardEntry(agentId, baseEntry, isPaperTrading));
  }

  return { entries };
}

// --- Get agent rank ---

export async function getAgentRank(
  agentId: string,
  isPaperTrading: boolean = true
): Promise<{ rank: number; totalAgents: number }> {
  const modeSuffix = isPaperTrading ? ":paper" : ":live";
  const rank = await redis.zrevrank(
    `${REDIS_KEYS.LEADERBOARD_ALLTIME}${modeSuffix}`,
    agentId
  );
  const totalAgents = await redis.zcard(`${REDIS_KEYS.LEADERBOARD_ALLTIME}${modeSuffix}`);

  return {
    rank: rank !== null ? rank + 1 : 0,
    totalAgents,
  };
}

// --- Get global stats ---

export async function getGlobalStats(isPaperTrading: boolean = true): Promise<GlobalStats> {
  const modeSuffix = isPaperTrading ? ":paper" : ":live";
  const cacheKey = `${REDIS_KEYS.GLOBAL_STATS}${modeSuffix}`;

  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as GlobalStats;
  }

  // Aggregate from DB (filtered by paper/live)
  const perfResult = await db
    .select({
      totalVolume: sql<number>`COALESCE(SUM(CAST(${schema.agentPerformance.totalVolume} AS NUMERIC)), 0)`,
      totalPnl: sql<number>`COALESCE(SUM(CAST(${schema.agentPerformance.totalPnl} AS NUMERIC)), 0)`,
      totalTrades: sql<number>`COALESCE(SUM(${schema.agentPerformance.totalTrades}), 0)`,
    })
    .from(schema.agentPerformance)
    .where(eq(schema.agentPerformance.isPaperTrading, isPaperTrading));

  const agentCount = await db
    .select({ count: sql<number>`COUNT(DISTINCT ${schema.agents.id})` })
    .from(schema.agents)
    .where(eq(schema.agents.isActive, true));

  const userCount = await db
    .select({ count: sql<number>`COUNT(DISTINCT ${schema.agents.ownerAddress})` })
    .from(schema.agents);

  // Find top category
  const categoryStats = await db
    .select({
      category: schema.agents.category,
      totalPnl: sql<number>`COALESCE(SUM(CAST(${schema.agentPerformance.totalPnl} AS NUMERIC)), 0)`,
    })
    .from(schema.agents)
    .leftJoin(
      schema.agentPerformance,
      and(
        eq(schema.agents.id, schema.agentPerformance.agentId),
        eq(schema.agentPerformance.isPaperTrading, isPaperTrading)
      )
    )
    .groupBy(schema.agents.category)
    .orderBy(sql`COALESCE(SUM(CAST(${schema.agentPerformance.totalPnl} AS NUMERIC)), 0) DESC`)
    .limit(1);

  const stats: GlobalStats = {
    totalVolume: Number(perfResult[0]?.totalVolume ?? 0),
    totalPnl: Number(perfResult[0]?.totalPnl ?? 0),
    activeAgents: Number(agentCount[0]?.count ?? 0),
    totalTrades: Number(perfResult[0]?.totalTrades ?? 0),
    totalUsers: Number(userCount[0]?.count ?? 0),
    topCategory: categoryStats[0]?.category ?? "geo",
  };

  // Cache for 30 seconds
  await redis.set(cacheKey, JSON.stringify(stats), "EX", 30);

  return stats;
}

// --- Get user leaderboard ---

export async function getUserLeaderboard(
  limit: number = 50,
  isPaperTrading: boolean = true
): Promise<{ entries: UserLeaderboardEntry[] }> {
  const modeSuffix = isPaperTrading ? ":paper" : ":live";
  const redisKey = `${REDIS_KEYS.LEADERBOARD_USERS}${modeSuffix}`;

  // Try Redis sorted set first
  const raw = await redis.zrange(redisKey, 0, limit - 1, "REV");

  if (raw.length > 0) {
    const entries: UserLeaderboardEntry[] = [];

    for (let i = 0; i < raw.length; i++) {
      const walletAddress = raw[i];
      const stats = await redis.hgetall(`${REDIS_KEYS.LEADERBOARD_USERS}:${walletAddress}${modeSuffix}`);

      if (!stats.totalPnl) continue;

      // Get username
      const [user] = await db
        .select({ username: schema.users.username })
        .from(schema.users)
        .where(eq(schema.users.walletAddress, walletAddress))
        .limit(1);

      // Get best agent (filtered by mode)
      const bestAgent = await db
        .select({
          id: schema.agents.id,
          name: schema.agents.name,
          pnl: schema.agentPerformance.totalPnl,
        })
        .from(schema.agents)
        .leftJoin(
          schema.agentPerformance,
          and(
            eq(schema.agents.id, schema.agentPerformance.agentId),
            eq(schema.agentPerformance.isPaperTrading, isPaperTrading)
          )
        )
        .where(eq(schema.agents.ownerAddress, walletAddress))
        .orderBy(desc(schema.agentPerformance.totalPnl))
        .limit(1);

      entries.push({
        rank: i + 1,
        walletAddress,
        username: user?.username ?? null,
        totalPnl: Number(stats.totalPnl ?? 0),
        totalAgents: Number(stats.totalAgents ?? 0),
        avgWinRate: Number(stats.avgWinRate ?? 0),
        totalTrades: Number(stats.totalTrades ?? 0),
        bestAgent: bestAgent[0]
          ? { id: bestAgent[0].id, name: bestAgent[0].name, pnl: Number(bestAgent[0].pnl ?? 0) }
          : { id: "", name: "N/A", pnl: 0 },
      });
    }

    return { entries };
  }

  // Fallback: aggregate from DB (filtered by paper/live)
  const result = await db
    .select({
      ownerAddress: schema.agents.ownerAddress,
      username: schema.users.username,
      totalPnl: sql<number>`COALESCE(SUM(CAST(${schema.agentPerformance.totalPnl} AS NUMERIC)), 0)`,
      totalAgents: sql<number>`COUNT(${schema.agents.id})`,
      avgWinRate: sql<number>`COALESCE(AVG(CAST(${schema.agentPerformance.winRate} AS NUMERIC)), 0)`,
      totalTrades: sql<number>`COALESCE(SUM(${schema.agentPerformance.totalTrades}), 0)`,
    })
    .from(schema.agents)
    .leftJoin(
      schema.agentPerformance,
      and(
        eq(schema.agents.id, schema.agentPerformance.agentId),
        eq(schema.agentPerformance.isPaperTrading, isPaperTrading)
      )
    )
    .leftJoin(schema.users, eq(schema.agents.ownerAddress, schema.users.walletAddress))
    .groupBy(schema.agents.ownerAddress, schema.users.username)
    .orderBy(sql`COALESCE(SUM(CAST(${schema.agentPerformance.totalPnl} AS NUMERIC)), 0) DESC`)
    .limit(limit);

  const entries: UserLeaderboardEntry[] = [];

  for (let i = 0; i < result.length; i++) {
    const row = result[i];

    // Get best agent for this user
    const bestAgent = await db
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        pnl: schema.agentPerformance.totalPnl,
      })
      .from(schema.agents)
      .leftJoin(
        schema.agentPerformance,
        and(
          eq(schema.agents.id, schema.agentPerformance.agentId),
          eq(schema.agentPerformance.isPaperTrading, isPaperTrading)
        )
      )
      .where(eq(schema.agents.ownerAddress, row.ownerAddress))
      .orderBy(desc(schema.agentPerformance.totalPnl))
      .limit(1);

    entries.push({
      rank: i + 1,
      walletAddress: row.ownerAddress,
      username: row.username ?? null,
      totalPnl: Number(row.totalPnl ?? 0),
      totalAgents: Number(row.totalAgents ?? 0),
      avgWinRate: Number(row.avgWinRate ?? 0),
      totalTrades: Number(row.totalTrades ?? 0),
      bestAgent: bestAgent[0]
        ? { id: bestAgent[0].id, name: bestAgent[0].name, pnl: Number(bestAgent[0].pnl ?? 0) }
        : { id: "", name: "N/A", pnl: 0 },
    });
  }

  // Cache in Redis
  for (const entry of entries) {
    await redis.hset(`${REDIS_KEYS.LEADERBOARD_USERS}:${entry.walletAddress}${modeSuffix}`, {
      totalPnl: String(entry.totalPnl),
      totalAgents: String(entry.totalAgents),
      avgWinRate: String(entry.avgWinRate),
      totalTrades: String(entry.totalTrades),
    });
    await redis.zadd(redisKey, entry.totalPnl, entry.walletAddress);
  }

  return { entries };
}

// --- Get trending agents (by recent activity) ---

export async function getTrendingAgents(
  limit: number = 10
): Promise<{ agents: Array<{ id: string; name: string; category: string; lastEvent: string; pnl: number }> }> {
  // Get recent feed events to find most active agents
  const raw = await redis.zrange(REDIS_KEYS.FEED_RECENT, 0, 49, "REV");

  const agentActivity = new Map<string, { count: number; lastEvent: string }>();

  for (const r of raw) {
    try {
      const event = JSON.parse(r);
      const existing = agentActivity.get(event.agent_id);
      if (!existing) {
        agentActivity.set(event.agent_id, { count: 1, lastEvent: event.timestamp });
      } else {
        existing.count++;
      }
    } catch {}
  }

  // Sort by activity count
  const sorted = Array.from(agentActivity.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit);

  const agents = [];
  for (const [agentId, activity] of sorted) {
    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1);

    if (agent) {
      const stats = await redis.hgetall(`${REDIS_KEYS.AGENT_STATS_PREFIX}${agentId}`);
      agents.push({
        id: agentId,
        name: agent.name,
        category: agent.category,
        lastEvent: activity.lastEvent,
        pnl: Number(stats.totalPnl ?? 0),
      });
    }
  }

  return { agents };
}
