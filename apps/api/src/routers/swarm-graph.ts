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

        // Build edges with weights
        const edgeMap = new Map<string, { source: string; target: string; weight: number; types: string[] }>();

        for (const i of interactions) {
          const key = `${i.fromAgentId}-${i.toAgentId}`;
          const existing = edgeMap.get(key);
          if (existing) {
            existing.weight += 1;
            if (!existing.types.includes(i.interactionType)) {
              existing.types.push(i.interactionType);
            }
          } else {
            edgeMap.set(key, {
              source: i.fromAgentId,
              target: i.toAgentId,
              weight: 1,
              types: [i.interactionType],
            });
          }
        }

        return {
          nodes,
          edges: Array.from(edgeMap.values()),
          totalInteractions: interactions.length,
          uniqueAgents: nodes.length,
        };
      });
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

      if (!agent) {
        throw new Error("Agent not found");
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
