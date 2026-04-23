import { eq, desc } from "drizzle-orm";
import { db, schema } from "../db";
import { redis, redisPub, redisSub } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";
import type { FeedEvent } from "@agent-arena/shared";

const MAX_RECENT_EVENTS = 200;
const FEED_CHANNEL = "feed:live";

// --- UUID validation helper ---
function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

// Derive category from hardcoded agent IDs like "politics-agent" → "politics"
function deriveCategoryFromAgentId(agentId: string): string | undefined {
  const knownPrefixes = ["politics", "crypto", "sports", "general"];
  const prefix = agentId.split("-")[0]?.toLowerCase();
  if (prefix && knownPrefixes.includes(prefix)) {
    return prefix;
  }
  return undefined;
}

// --- Agent name cache: resolve agentId → actual DB name ---
const agentNameCache = new Map<string, string>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cacheTimestamps = new Map<string, number>();

async function resolveAgentName(agentId: string, fallbackName: string): Promise<string> {
  const now = Date.now();
  const cached = agentNameCache.get(agentId);
  const cachedAt = cacheTimestamps.get(agentId);
  if (cached && cachedAt && now - cachedAt < CACHE_TTL) {
    return cached;
  }

  // Skip DB lookup for hardcoded non-UUID agent IDs (e.g., "politics-agent")
  if (!isValidUUID(agentId)) {
    return fallbackName;
  }

  try {
    const [agent] = await db
      .select({ name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId))
      .limit(1);

    const name = agent?.name ?? fallbackName;
    agentNameCache.set(agentId, name);
    cacheTimestamps.set(agentId, now);
    return name;
  } catch {
    return fallbackName;
  }
}

export function clearAgentNameCache(): void {
  agentNameCache.clear();
  cacheTimestamps.clear();
}

// --- Get recent events from Redis sorted set ---

export async function getRecentEvents(
  limit: number = 50
): Promise<FeedEvent[]> {
  const raw = await redis.zrange(
    REDIS_KEYS.FEED_RECENT,
    0,
    limit - 1,
    "REV"
  );
  return raw.map((r) => JSON.parse(r) as FeedEvent);
}

// --- Get events for a specific agent ---

export async function getEventsByAgent(
  agentId: string,
  limit: number = 50
): Promise<FeedEvent[]> {
  // Use agent-specific sorted set if available
  const agentKey = `${REDIS_KEYS.FEED_RECENT}:agent:${agentId}`;
  const raw = await redis.zrange(agentKey, 0, limit - 1, "REV");

  if (raw.length > 0) {
    return raw.map((r) => JSON.parse(r) as FeedEvent);
  }

  // Fallback: scan global feed
  const allRaw = await redis.zrange(
    REDIS_KEYS.FEED_RECENT,
    0,
    MAX_RECENT_EVENTS - 1,
    "REV"
  );

  const events = allRaw
    .map((r) => JSON.parse(r) as FeedEvent)
    .filter((e) => e.agent_id === agentId)
    .slice(0, limit);

  return events;
}

// --- Get events for a specific job ---

export async function getEventsByJob(
  jobId: string,
  limit: number = 50
): Promise<FeedEvent[]> {
  const jobKey = `${REDIS_KEYS.FEED_RECENT}:job:${jobId}`;
  const raw = await redis.zrange(jobKey, 0, limit - 1, "REV");

  if (raw.length > 0) {
    return raw.map((r) => JSON.parse(r) as FeedEvent);
  }

  // Fallback: scan global feed and filter by job_id
  const allRaw = await redis.zrange(
    REDIS_KEYS.FEED_RECENT,
    0,
    MAX_RECENT_EVENTS - 1,
    "REV"
  );

  const events = allRaw
    .map((r) => JSON.parse(r) as FeedEvent)
    .filter((e) => e.job_id === jobId)
    .slice(0, limit);

  return events;
}

// --- Get events by category ---

export async function getEventsByCategory(
  category: string,
  limit: number = 50
): Promise<FeedEvent[]> {
  const key = `${REDIS_KEYS.FEED_CATEGORY_PREFIX}${category}`;
  const raw = await redis.zrange(key, 0, limit - 1, "REV");

  if (raw.length > 0) {
    return raw.map((r) => JSON.parse(r) as FeedEvent);
  }

  // Fallback: filter from global feed
  const allRaw = await redis.zrange(REDIS_KEYS.FEED_RECENT, 0, MAX_RECENT_EVENTS - 1, "REV");
  const events = allRaw
    .map((r) => JSON.parse(r) as FeedEvent)
    .filter((e) => {
      // Match category by looking up agent
      return e.agent_display_name?.toLowerCase().includes(category) || false;
    })
    .slice(0, limit);

  return events;
}

// --- Publish a feed event ---

export async function publishFeedEvent(event: FeedEvent): Promise<void> {
  // Resolve actual agent name from DB (with caching)
  if (event.agent_id) {
    const resolvedName = await resolveAgentName(event.agent_id, event.agent_display_name);
    event.agent_display_name = resolvedName;
  }

  const serialized = JSON.stringify(event);
  const score = new Date(event.timestamp).getTime();

  // Add to global sorted set
  await redis.zadd(REDIS_KEYS.FEED_RECENT, score, serialized);
  await redis.zremrangebyrank(REDIS_KEYS.FEED_RECENT, 0, -(MAX_RECENT_EVENTS + 1));

  // Add to agent-specific sorted set
  const agentKey = `${REDIS_KEYS.FEED_RECENT}:agent:${event.agent_id}`;
  await redis.zadd(agentKey, score, serialized);
  await redis.zremrangebyrank(agentKey, 0, -(MAX_RECENT_EVENTS + 1));

  // Add to job-specific sorted set (if jobId present)
  if (event.job_id) {
    const jobKey = `${REDIS_KEYS.FEED_RECENT}:job:${event.job_id}`;
    await redis.zadd(jobKey, score, serialized);
    await redis.zremrangebyrank(jobKey, 0, -(MAX_RECENT_EVENTS + 1));
  }

  // Add to category sorted set (look up agent category)
  try {
    let category: string | undefined;

    if (isValidUUID(event.agent_id)) {
      const [agent] = await db
        .select({ category: schema.agents.category })
        .from(schema.agents)
        .where(eq(schema.agents.id, event.agent_id))
        .limit(1);
      category = agent?.category;
    } else {
      // Hardcoded agent IDs like "politics-agent" — derive category from string
      category = deriveCategoryFromAgentId(event.agent_id);
    }

    if (category) {
      const categoryKey = `${REDIS_KEYS.FEED_CATEGORY_PREFIX}${category}`;
      await redis.zadd(categoryKey, score, serialized);
      await redis.zremrangebyrank(categoryKey, 0, -(MAX_RECENT_EVENTS + 1));
    }
  } catch (err) {
    console.error("Failed to add feed event to category set:", err);
  }

  // Publish for live subscribers (global feed)
  await redisPub.publish(FEED_CHANNEL, serialized);

  // Publish for per-agent channel
  const agentChannel = `feed:agent:${event.agent_id}`;
  await redisPub.publish(agentChannel, serialized);

  // Publish for per-job channel
  if (event.job_id) {
    const jobChannel = `feed:job:${event.job_id}`;
    await redisPub.publish(jobChannel, serialized);
  }

  // Publish for per-category channel
  try {
    let category: string | undefined;

    if (isValidUUID(event.agent_id)) {
      const [agent] = await db
        .select({ category: schema.agents.category })
        .from(schema.agents)
        .where(eq(schema.agents.id, event.agent_id))
        .limit(1);
      category = agent?.category;
    } else {
      category = deriveCategoryFromAgentId(event.agent_id);
    }

    if (category) {
      const categoryChannel = `feed:category:${category}`;
      await redisPub.publish(categoryChannel, serialized);
    }
  } catch {}

// --- DB write queue to prevent memory buildup under high load ---
let pendingDbWrites = 0;
const MAX_PENDING_DB_WRITES = 50;

  // Also persist to DB (fire-and-forget with backpressure)
  // Only persist if agent_id is a valid UUID (hardcoded agent IDs like "politics-agent"
  // are not real DB agents and would violate the UUID foreign key constraint)
  if (pendingDbWrites < MAX_PENDING_DB_WRITES && isValidUUID(event.agent_id)) {
    pendingDbWrites++;
    db.insert(schema.feedEvents)
      .values({
        agentId: event.agent_id,
        agentName: event.agent_display_name,
        category: event.category,
        content: event.content,
        displayMessage: event.display_message,
      })
      .catch((err) => console.error("Failed to persist feed event:", err))
      .finally(() => { pendingDbWrites--; });
  }
}

// --- Subscribe to live feed events ---

export function subscribeToFeed(
  callback: (event: FeedEvent) => void
): () => void {
  redisSub.subscribe(FEED_CHANNEL, (err) => {
    if (err) console.error("Failed to subscribe to feed:", err);
  });

  redisSub.on("message", (_channel, message) => {
    try {
      const event = JSON.parse(message) as FeedEvent;
      callback(event);
    } catch (err) {
      console.error("Failed to parse feed event:", err);
    }
  });

  return () => {
    redisSub.unsubscribe(FEED_CHANNEL);
  };
}

// --- Feed event builder helper ---

export function buildFeedEvent(params: {
  agentId: string;
  agentName: string;
  jobId?: string;
  category: FeedEvent["category"];
  severity: FeedEvent["severity"];
  content: FeedEvent["content"];
  displayMessage: string;
}): FeedEvent {
  return {
    event_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    agent_id: params.agentId,
    agent_display_name: params.agentName,
    job_id: params.jobId,
    category: params.category,
    severity: params.severity,
    content: params.content,
    display_message: params.displayMessage,
    is_public: true,
  };
}
