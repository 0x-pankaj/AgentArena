import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { trpcServer } from "@hono/trpc-server";
import { eq } from "drizzle-orm";
import { appRouter } from "./routers/_app";
import { createContext } from "./utils/context";
import { startWebSocketServer } from "./ws";
import { startWorker, stopWorker, setTradeProcessor, scheduleRecurringJobs } from "./services/queue-service";
import { initializeSupervisor, resumeActiveAgents } from "./agents/supervisor";
import { runAgentTick } from "./agents/registry";
import { syncMarketsFromJupiter } from "./services/market-service";
import { runEvolutionCycle } from "./services/evolution-service";
import { stopWebSocketServer } from "./ws";
import { db, schema } from "./db";
import { EVOLUTION_CONFIG } from "@agent-arena/shared";
import type { TradeJobData, TradeJobResult } from "./services/queue-service";

const app = new Hono();

app.use("*", cors());
app.use("*", logger());

app.get("/health", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    ws: "running",
  })
);

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext,
  })
);

const port = Number(process.env.PORT) || 3001;
const wsPort = Number(process.env.WS_PORT) || 3002;

// --- Startup ---

async function startup() {
  // 1. Initialize agent registry
  initializeSupervisor();

  // 2. Start WebSocket server
  startWebSocketServer(wsPort);

  // 2. Start BullMQ worker with processor
  setTradeProcessor(async (data: TradeJobData): Promise<TradeJobResult> => {
    switch (data.type) {
      case "agent_tick": {
        const [job] = await db
          .select()
          .from(schema.jobs)
          .where(eq(schema.jobs.id, data.jobId))
          .limit(1);

        if (!job || !job.privyWalletId) {
          return {
            success: false,
            detail: `Job ${data.jobId} not found or has no wallet`,
            timestamp: new Date().toISOString(),
          };
        }

        const result = await runAgentTick(data.agentId, {
          agentId: data.agentId,
          jobId: data.jobId,
          agentWalletId: job.privyWalletId,
          agentWalletAddress: job.privyWalletAddress ?? "",
          ownerPubkey: job.clientAddress,
        });
        return {
          success: true,
          detail: `${result.action}: ${result.detail}`,
          timestamp: new Date().toISOString(),
        };
      }
      case "market_sync": {
        const count = await syncMarketsFromJupiter();
        return {
          success: true,
          detail: `Synced ${count} markets`,
          timestamp: new Date().toISOString(),
        };
      }
      default:
        return {
          success: false,
          detail: `Unknown job type: ${data.type}`,
          timestamp: new Date().toISOString(),
        };
    }
  });

  startWorker();

  // 3. Schedule recurring jobs
  await scheduleRecurringJobs();

  // 4. Resume active agents from DB
  await resumeActiveAgents();

  // 5. Seed initial prompt versions if not already done
  try {
    const [existingVersion] = await db
      .select({ id: schema.agentPromptVersions.id })
      .from(schema.agentPromptVersions)
      .limit(1);

    if (!existingVersion) {
      console.log("[Startup] No prompt versions found, running seed-prompts...");
      const { seedPrompts } = await import("./seed-prompts");
      await seedPrompts();
    }
  } catch (err) {
    console.warn("[Startup] Prompt seeding skipped:", err instanceof Error ? err.message : err);
  }

  // 6. Schedule evolution cycle (every 6 hours)
  const evolutionInterval = setInterval(async () => {
    try {
      console.log("[Scheduler] Running evolution cycle...");
      await runEvolutionCycle();
    } catch (err) {
      console.error("[Scheduler] Evolution cycle failed:", err);
    }
  }, EVOLUTION_CONFIG.EVOLUTION_INTERVAL_MS);

  // 7. Graceful shutdown
  async function shutdown(signal: string) {
    console.log(`[Shutdown] ${signal} received, shutting down gracefully...`);
    clearInterval(evolutionInterval);
    try { await stopWorker(); } catch (err) { console.error("[Shutdown] Worker stop error:", err); }
    try { await stopWebSocketServer(); } catch (err) { console.error("[Shutdown] WS stop error:", err); }
    console.log("[Shutdown] Complete");
    process.exit(0);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  console.log(`AgentArena API running on port ${port} (WS: ${wsPort})`);
}

startup().catch(console.error);

export default {
  port,
  fetch: app.fetch,
};
