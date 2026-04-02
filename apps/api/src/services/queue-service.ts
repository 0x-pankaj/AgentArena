import { Queue, Worker, type Job } from "bullmq";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const QUEUE_NAME = "trade-execution";

// --- Job types ---

export interface TradeJobData {
  type: "agent_tick" | "stop_loss_check" | "position_sync" | "market_sync";
  agentId: string;
  jobId: string;
  config?: Record<string, unknown>;
}

export interface TradeJobResult {
  success: boolean;
  detail: string;
  timestamp: string;
}

// --- Queue (use URL string to avoid ioredis version conflicts) ---

export const tradeQueue = new Queue<TradeJobData, TradeJobResult>(QUEUE_NAME, {
  connection: { url: REDIS_URL },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

// --- Job processors (set by supervisor on startup) ---

type JobProcessor = (data: TradeJobData) => Promise<TradeJobResult>;
let processor: JobProcessor | null = null;

export function setTradeProcessor(p: JobProcessor): void {
  processor = p;
}

// --- Worker ---

let worker: Worker<TradeJobData, TradeJobResult> | null = null;

export function startWorker(): Worker<TradeJobData, TradeJobResult> {
  if (worker) return worker;

  worker = new Worker<TradeJobData, TradeJobResult>(
    QUEUE_NAME,
    async (job: Job<TradeJobData>) => {
      if (!processor) {
        return {
          success: false,
          detail: "No processor registered",
          timestamp: new Date().toISOString(),
        };
      }
      return processor(job.data);
    },
    {
      connection: { url: REDIS_URL },
      concurrency: 5,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[Queue] Job ${job.id} completed: ${job.data.type}`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Queue] Job ${job?.id} failed: ${err.message}`);
  });

  console.log("[Queue] Trade execution worker started");
  return worker;
}

export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

// --- Enqueue helpers ---

export async function enqueueAgentTick(
  agentId: string,
  jobId: string
): Promise<void> {
  await tradeQueue.add(
    `tick-${agentId}`,
    { type: "agent_tick", agentId, jobId }
  );
}

export async function enqueueStopLossCheck(
  agentId: string,
  jobId: string
): Promise<void> {
  await tradeQueue.add(
    `sl-${agentId}`,
    { type: "stop_loss_check", agentId, jobId }
  );
}

export async function enqueuePositionSync(
  agentId: string,
  jobId: string
): Promise<void> {
  await tradeQueue.add(
    `sync-${agentId}`,
    { type: "position_sync", agentId, jobId }
  );
}

export async function enqueueMarketSync(): Promise<void> {
  await tradeQueue.add(
    "market-sync",
    { type: "market_sync", agentId: "", jobId: "" },
    { repeat: { every: 15 * 60 * 1000 } }
  );
}

// --- Schedule repeating jobs ---

export async function scheduleRecurringJobs(): Promise<void> {
  await tradeQueue.add(
    "market-sync",
    { type: "market_sync", agentId: "", jobId: "" },
    {
      repeat: { every: 15 * 60 * 1000 },
    }
  );

  console.log("[Queue] Recurring jobs scheduled");
}
