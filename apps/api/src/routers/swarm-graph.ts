// ============================================================
// Swarm Graph API — tRPC Router
// Exposes agent interaction data as a graph for mobile + judges.
// ============================================================

import { z } from "zod";
import { router, publicProcedure } from "../utils/trpc";
import { db, schema } from "../db";
import { eq, and, sql, desc, gte } from "drizzle-orm";
import { redis } from "../utils/redis";
import { getPeerRatings, getSwarmScore } from "../services/agent-rating";
import { getDelegationHistory } from "../services/agent-delegation";
import { getConsensusHistory } from "../services/swarm-consensus";

// --- Cache helpers ---

const CACHE_TTL = 60; // seconds

async function getCached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached) as T;
  const result = await fn();
  await redis.setex(key, CACHE_TTL, JSON.stringify(result));
  return result;
}

// ============================================================
// Router
// ============================================================

export const swarmGraphRouter = router({
  // --- Get full agent graph (nodes + edges) ---
  getAgentGraph: publicProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        limit: z.number().min(1).max(500).default(200),
        days: z.number().min(1).max(90).default(30),
      })
    )
    .query(async ({ input }) => {
      const cacheKey = `swarm:graph:${input.agentId ?? "all"}:${input.days}`;

      return getCached(cacheKey, async () => {
        const since = new Date(Date.now() - input.days * 86400000);

        // Get all agents (nodes)
        const allAgents = await db.select().from(schema.agents);

        // Get interactions (edges)
        let interactions;
        if (input.agentId) {
          interactions = await db
            .select()
            .from(schema.agentInteractions)
            .where(
              and(
                gte(schema.agentInteractions.createdAt, since),
                sql`${schema.agentInteractions.fromAgentId} = ${input.agentId} OR ${schema.agentInteractions.toAgentId} = ${input.agentId}`
              )
            )
            .limit(input.limit);
        } else {
          interactions = await db
            .select()
            .from(schema.agentInteractions)
            .where(gte(schema.agentInteractions.createdAt, since))
            .limit(input.limit);
        }

        // Build nodes
        const agentIds = new Set<string>();
        interactions.forEach((i) => {
          agentIds.add(i.fromAgentId);
          agentIds.add(i.toAgentId);
        });

        const nodes = allAgents
          .filter((a) => agentIds.has(a.id))
          .map((a) => ({
            id: a.id,
            name: a.name,
            category: a.category,
            reputationScore: a.reputationScore ? Number(a.reputationScore) : 0,
            trustTier: a.trustTier,
            assetAddress: a.assetAddress,
          }));

        // Build edges with weights, per-type breakdown, last seen, and a
        // few recent markets — gives the tap-edge UI enough to render
        // "Sports → Crypto: 5 delegations on these markets …" inline
        // without a follow-up query for the common case.
        type EdgeAcc = {
          source: string;
          target: string;
          weight: number;
          types: string[];
          byType: Record<string, number>;
          lastInteractionAt: string | null;
          recentMarkets: Array<{
            marketId: string | null;
            marketQuestion: string | null;
            type: string;
            at: string | null;
          }>;
        };
        const edgeMap = new Map<string, EdgeAcc>();

        for (const i of interactions) {
          const key = `${i.fromAgentId}-${i.toAgentId}`;
          const existing = edgeMap.get(key);
          const at = i.createdAt ? new Date(i.createdAt).toISOString() : null;
          const recent = {
            marketId: i.marketId ?? null,
            marketQuestion: i.marketQuestion ?? null,
            type: i.interactionType,
            at,
          };
          if (existing) {
            existing.weight += 1;
            existing.byType[i.interactionType] = (existing.byType[i.interactionType] ?? 0) + 1;
            if (!existing.types.includes(i.interactionType)) {
              existing.types.push(i.interactionType);
            }
            if (!existing.lastInteractionAt || (at && at > existing.lastInteractionAt)) {
              existing.lastInteractionAt = at;
            }
            if (existing.recentMarkets.length < 3 && recent.marketId) {
              existing.recentMarkets.push(recent);
            }
          } else {
            edgeMap.set(key, {
              source: i.fromAgentId,
              target: i.toAgentId,
              weight: 1,
              types: [i.interactionType],
              byType: { [i.interactionType]: 1 },
              lastInteractionAt: at,
              recentMarkets: recent.marketId ? [recent] : [],
            });
          }
        }

        // Per-node degree: in/out counts split by interaction type. Lets
        // the tap-node UI show "Sports sent 5 delegations, received 2".
        type DegreeAcc = {
          out: Record<string, number>;
          in: Record<string, number>;
          totalOut: number;
          totalIn: number;
        };
        const degreeByAgent = new Map<string, DegreeAcc>();
        const ensureDegree = (id: string): DegreeAcc => {
          let d = degreeByAgent.get(id);
          if (!d) {
            d = { out: {}, in: {}, totalOut: 0, totalIn: 0 };
            degreeByAgent.set(id, d);
          }
          return d;
        };
        for (const i of interactions) {
          const fromD = ensureDegree(i.fromAgentId);
          const toD = ensureDegree(i.toAgentId);
          fromD.out[i.interactionType] = (fromD.out[i.interactionType] ?? 0) + 1;
          fromD.totalOut++;
          toD.in[i.interactionType] = (toD.in[i.interactionType] ?? 0) + 1;
          toD.totalIn++;
        }

        const nodesWithDegree = nodes.map((n) => ({
          ...n,
          degree: degreeByAgent.get(n.id) ?? { out: {}, in: {}, totalOut: 0, totalIn: 0 },
        }));

        return {
          nodes: nodesWithDegree,
          edges: Array.from(edgeMap.values()),
          totalInteractions: interactions.length,
          uniqueAgents: nodes.length,
        };
      });
    }),

  // --- Drill-down: full interaction list for a single from→to edge ---
  // Powers the tap-edge modal so users can see exactly which markets a
  // given pair has interacted on, with timestamps + types.
  getEdgeDetails: publicProcedure
    .input(
      z.object({
        fromAgentId: z.string(),
        toAgentId: z.string(),
        days: z.number().min(1).max(90).default(30),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.days * 86400000);

      const interactions = await db
        .select({
          id: schema.agentInteractions.id,
          interactionType: schema.agentInteractions.interactionType,
          marketId: schema.agentInteractions.marketId,
          marketQuestion: schema.agentInteractions.marketQuestion,
          confidence: schema.agentInteractions.confidence,
          qualityScore: schema.agentInteractions.qualityScore,
          txSignature: schema.agentInteractions.txSignature,
          createdAt: schema.agentInteractions.createdAt,
        })
        .from(schema.agentInteractions)
        .where(
          and(
            gte(schema.agentInteractions.createdAt, since),
            eq(schema.agentInteractions.fromAgentId, input.fromAgentId),
            eq(schema.agentInteractions.toAgentId, input.toAgentId),
          )
        )
        .orderBy(desc(schema.agentInteractions.createdAt))
        .limit(input.limit);

      const byType: Record<string, number> = {};
      for (const i of interactions) {
        byType[i.interactionType] = (byType[i.interactionType] ?? 0) + 1;
      }

      const [from] = await db
        .select({ id: schema.agents.id, name: schema.agents.name, category: schema.agents.category })
        .from(schema.agents)
        .where(eq(schema.agents.id, input.fromAgentId))
        .limit(1);
      const [to] = await db
        .select({ id: schema.agents.id, name: schema.agents.name, category: schema.agents.category })
        .from(schema.agents)
        .where(eq(schema.agents.id, input.toAgentId))
        .limit(1);

      return {
        from: from ?? { id: input.fromAgentId, name: input.fromAgentId, category: null },
        to: to ?? { id: input.toAgentId, name: input.toAgentId, category: null },
        total: interactions.length,
        byType,
        interactions: interactions.map((i) => ({
          id: i.id,
          type: i.interactionType,
          marketId: i.marketId,
          marketQuestion: i.marketQuestion,
          confidence: i.confidence ? Number(i.confidence) : null,
          qualityScore: i.qualityScore ? Number(i.qualityScore) : null,
          onChain: !!i.txSignature,
          at: i.createdAt ? new Date(i.createdAt).toISOString() : null,
        })),
      };
    }),

  // --- Get interaction stats summary ---
  getInteractionStats: publicProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(30),
      })
    )
    .query(async ({ input }) => {
      const cacheKey = `swarm:stats:${input.days}`;

      return getCached(cacheKey, async () => {
        const since = new Date(Date.now() - input.days * 86400000);

        const total = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.agentInteractions)
          .where(gte(schema.agentInteractions.createdAt, since));

        const byType = await db
          .select({
            type: schema.agentInteractions.interactionType,
            count: sql<number>`count(*)`,
          })
          .from(schema.agentInteractions)
          .where(gte(schema.agentInteractions.createdAt, since))
          .groupBy(schema.agentInteractions.interactionType);

        const onChainVerified = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.agentInteractions)
          .where(
            and(
              gte(schema.agentInteractions.createdAt, since),
              sql`${schema.agentInteractions.txSignature} IS NOT NULL`
            )
          );

        const consensusRounds = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.swarmConsensus)
          .where(gte(schema.swarmConsensus.createdAt, since));

        return {
          totalInteractions: total[0]?.count ?? 0,
          byType: Object.fromEntries(byType.map((b) => [b.type, b.count])),
          onChainVerified: onChainVerified[0]?.count ?? 0,
          consensusRounds: consensusRounds[0]?.count ?? 0,
          reviewAuthenticityRate:
            total[0]?.count > 0
              ? Math.round(((onChainVerified[0]?.count ?? 0) / total[0].count) * 1000) / 10
              : 0,
        };
      });
    }),

  // --- Network density (actual / possible edges) ---
  getNetworkDensity: publicProcedure.query(async () => {
    const cacheKey = "swarm:density";

    return getCached(cacheKey, async () => {
      const agentCountResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.agents);

      const n = agentCountResult[0]?.count ?? 0;
      const possibleEdges = n * (n - 1); // directed graph

      const actualEdgesResult = await db
        .select({
          fromAgent: schema.agentInteractions.fromAgentId,
          toAgent: schema.agentInteractions.toAgentId,
        })
        .from(schema.agentInteractions)
        .groupBy(
          schema.agentInteractions.fromAgentId,
          schema.agentInteractions.toAgentId
        );

      const actualEdges = actualEdgesResult.length;

      const density = possibleEdges > 0 ? actualEdges / possibleEdges : 0;

      return {
        agentCount: n,
        possibleEdges,
        actualEdges,
        density: Math.round(density * 1000) / 1000,
        clusteringCoefficient: await calculateClusteringCoefficient(),
      };
    });
  }),

  // --- Reputation score distribution ---
  getReputationDistribution: publicProcedure.query(async () => {
    const agents = await db
      .select({
        reputationScore: schema.agents.reputationScore,
        trustTier: schema.agents.trustTier,
      })
      .from(schema.agents);

    const bins: Record<string, number> = {
      "0-20": 0,
      "21-40": 0,
      "41-60": 0,
      "61-80": 0,
      "81-100": 0,
    };

    const tierCounts: Record<string, number> = {};

    for (const a of agents) {
      const score = a.reputationScore ? Number(a.reputationScore) : 0;
      if (score <= 20) bins["0-20"]++;
      else if (score <= 40) bins["21-40"]++;
      else if (score <= 60) bins["41-60"]++;
      else if (score <= 80) bins["61-80"]++;
      else bins["81-100"]++;

      const tier = a.trustTier ?? "Unknown";
      tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
    }

    return {
      histogram: bins,
      byTier: tierCounts,
      totalAgents: agents.length,
      averageScore:
        agents.length > 0
          ? Math.round(
              (agents.reduce((sum, a) => sum + Number(a.reputationScore ?? 0), 0) / agents.length) *
                100
            ) / 100
          : 0,
    };
  }),

  // --- Get detailed swarm profile for an agent ---
  getAgentSwarmProfile: publicProcedure
    .input(z.object({ agentId: z.string() }))
    .query(async ({ input }) => {
      const [agent] = await db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, input.agentId))
        .limit(1);

      // Hardcoded agents (e.g., "politics-agent") don't exist in DB — return empty profile
      if (!agent) {
        return {
          agent: {
            id: input.agentId,
            name: input.agentId,
            category: "general",
            reputationScore: 0,
            trustTier: "Unknown",
            swarmScore: 0,
          },
          delegations: { total: 0, history: [] },
          ratings: { count: 0, averageReceived: 0, history: [] },
          consensus: [],
        };
      }

      const delegations = await getDelegationHistory(input.agentId);
      const ratings = await getPeerRatings(input.agentId);
      const consensus = await getConsensusHistory(input.agentId);
      const swarmScore = await getSwarmScore(input.agentId);

      return {
        agent: {
          id: agent.id,
          name: agent.name,
          category: agent.category,
          reputationScore: agent.reputationScore ? Number(agent.reputationScore) : 0,
          trustTier: agent.trustTier,
          swarmScore,
        },
        delegations,
        ratings,
        consensus,
      };
    }),

  // --- Recent swarm activity for the live ticker ---
  // Hydrates the front-end SwarmTicker with real (agent, action, market)
  // tuples instead of the static demo strip. Joins interactions with
  // initiator/peer agent names so the client doesn't need a follow-up call.
  getRecentActivity: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(12),
      })
    )
    .query(async ({ input }) => {
      const cacheKey = `swarm:activity:${input.limit}`;

      return getCached(cacheKey, async () => {
        const rows = await db
          .select({
            id: schema.agentInteractions.id,
            type: schema.agentInteractions.interactionType,
            marketQuestion: schema.agentInteractions.marketQuestion,
            confidence: schema.agentInteractions.confidence,
            metadata: schema.agentInteractions.metadata,
            createdAt: schema.agentInteractions.createdAt,
            fromName: sql<string>`from_agent.name`.as("fromName"),
            fromCategory: sql<string>`from_agent.category`.as("fromCategory"),
            toName: sql<string>`to_agent.name`.as("toName"),
            toCategory: sql<string>`to_agent.category`.as("toCategory"),
          })
          .from(schema.agentInteractions)
          .leftJoin(
            sql`${schema.agents} AS from_agent`,
            sql`from_agent.id = ${schema.agentInteractions.fromAgentId}`,
          )
          .leftJoin(
            sql`${schema.agents} AS to_agent`,
            sql`to_agent.id = ${schema.agentInteractions.toAgentId}`,
          )
          .orderBy(desc(schema.agentInteractions.createdAt))
          .limit(input.limit);

        return {
          items: rows.map((r) => ({
            id: r.id,
            type: r.type,
            from: { name: r.fromName ?? "Agent", category: r.fromCategory ?? "general" },
            to: { name: r.toName ?? "Peer", category: r.toCategory ?? "general" },
            marketQuestion: r.marketQuestion,
            confidence: r.confidence ? Number(r.confidence) : null,
            metadata: r.metadata,
            at: r.createdAt ? new Date(r.createdAt).toISOString() : null,
          })),
        };
      });
    }),

  // --- Get swarm leaderboard (by swarm score) ---
  getSwarmLeaderboard: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        category: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let agents;
      if (input.category) {
        agents = await db
          .select()
          .from(schema.agents)
          .where(eq(schema.agents.category, input.category));
      } else {
        agents = await db.select().from(schema.agents);
      }

      const withScores = await Promise.all(
        agents.map(async (a) => ({
          ...a,
          swarmScore: await getCached(`swarm:score:${a.id}`, () => getSwarmScore(a.id)),
        }))
      );

      return withScores
        .sort((a, b) => b.swarmScore - a.swarmScore)
        .slice(0, input.limit)
        .map((a) => ({
          id: a.id,
          name: a.name,
          category: a.category,
          reputationScore: a.reputationScore ? Number(a.reputationScore) : 0,
          trustTier: a.trustTier,
          swarmScore: a.swarmScore,
        }));
    }),
});

// ============================================================
// Helper: Calculate clustering coefficient
// ============================================================

async function calculateClusteringCoefficient(): Promise<number> {
  const interactions = await db
    .select({
      fromAgent: schema.agentInteractions.fromAgentId,
      toAgent: schema.agentInteractions.toAgentId,
    })
    .from(schema.agentInteractions);

  // Build adjacency list (undirected)
  const adj = new Map<string, Set<string>>();
  for (const i of interactions) {
    if (!adj.has(i.fromAgent)) adj.set(i.fromAgent, new Set());
    if (!adj.has(i.toAgent)) adj.set(i.toAgent, new Set());
    adj.get(i.fromAgent)!.add(i.toAgent);
    adj.get(i.toAgent)!.add(i.fromAgent);
  }

  let totalCoefficient = 0;
  let countedNodes = 0;

  for (const [node, neighbors] of adj) {
    const k = neighbors.size;
    if (k < 2) continue;

    let triangles = 0;
    const neighborList = Array.from(neighbors);
    for (let i = 0; i < neighborList.length; i++) {
      for (let j = i + 1; j < neighborList.length; j++) {
        if (adj.get(neighborList[i])?.has(neighborList[j])) {
          triangles++;
        }
      }
    }

    const possible = (k * (k - 1)) / 2;
    totalCoefficient += triangles / possible;
    countedNodes++;
  }

  return countedNodes > 0 ? Math.round((totalCoefficient / countedNodes) * 1000) / 1000 : 0;
}
