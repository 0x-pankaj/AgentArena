import type { ServerWebSocket } from "bun";
import { redisSub } from "../utils/redis";
import type { FeedEvent } from "@agent-arena/shared";

const FEED_CHANNEL = "feed:live";
const FEED_AGENT_PREFIX = "feed:agent:";
const FEED_CATEGORY_PREFIX = "feed:category:";

export interface WsData {
  id: string;
  subscriptions: Set<string>;
  lastActivity: number;
  lastPong: number;
}

const clients = new Map<string, ServerWebSocket<WsData>>();
const subscribedChannels = new Set<string>();
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let viewerCountInterval: ReturnType<typeof setInterval> | null = null;
let redisListenerAttached = false;

export function makeWsData(): WsData {
  return {
    id: crypto.randomUUID(),
    subscriptions: new Set(["feed"]),
    lastActivity: Date.now(),
    lastPong: Date.now(),
  };
}

export function startWebSocketServer(_server: unknown): void {
  if (!subscribedChannels.has(FEED_CHANNEL)) {
    subscribedChannels.add(FEED_CHANNEL);
    subscribeToRedis();
  }

  if (!heartbeatInterval) {
    heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, ws] of clients) {
        if (now - ws.data.lastPong > 60_000) {
          console.log(`[WS] Client ${id} timed out (no pong)`);
          try { ws.close(1008, "ping timeout"); } catch { /* ignore */ }
          clients.delete(id);
          continue;
        }
        try { ws.ping(); } catch { /* ignore */ }
      }
      pruneUnusedRedisSubscriptions();
    }, 30_000);
  }

  if (!viewerCountInterval) {
    viewerCountInterval = setInterval(broadcastViewerCounts, 10_000);
  }

  console.log("[WS] WebSocket handler attached to HTTP server");
}

export const websocketHandler = {
  open(ws: ServerWebSocket<WsData>) {
    clients.set(ws.data.id, ws);
    ws.data.lastActivity = Date.now();
    ws.data.lastPong = Date.now();
    ws.send(
      JSON.stringify({
        type: "connected",
        clientId: ws.data.id,
        subscriptions: Array.from(ws.data.subscriptions),
      })
    );
    console.log(`[WS] Client connected: ${ws.data.id} (total: ${clients.size})`);
  },

  message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
    try {
      const msg = JSON.parse(raw.toString()) as {
        action: "subscribe" | "unsubscribe" | "heartbeat";
        channel?: string;
      };

      ws.data.lastActivity = Date.now();

      if (msg.action === "subscribe" && msg.channel) {
        ws.data.subscriptions.add(msg.channel);
        ensureRedisSubscription(msg.channel);
        ws.send(JSON.stringify({ type: "subscribed", channel: msg.channel }));
        broadcastViewerCounts();
      } else if (msg.action === "unsubscribe" && msg.channel) {
        ws.data.subscriptions.delete(msg.channel);
        ws.send(JSON.stringify({ type: "unsubscribed", channel: msg.channel }));
        pruneUnusedRedisSubscriptions();
        broadcastViewerCounts();
      } else if (msg.action === "heartbeat") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch {
      // ignore invalid messages
    }
  },

  pong(ws: ServerWebSocket<WsData>) {
    ws.data.lastPong = Date.now();
  },

  close(ws: ServerWebSocket<WsData>) {
    clients.delete(ws.data.id);
    pruneUnusedRedisSubscriptions();
    broadcastViewerCounts();
    console.log(`[WS] Client disconnected: ${ws.data.id} (total: ${clients.size})`);
  },
};

// --- Viewer count tracking ---

function getViewerCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ws of clients.values()) {
    for (const channel of ws.data.subscriptions) {
      counts[channel] = (counts[channel] ?? 0) + 1;
    }
  }
  return counts;
}

function broadcastViewerCounts(): void {
  const payload = JSON.stringify({ type: "viewer_count", data: getViewerCounts() });
  for (const ws of clients.values()) {
    if (ws.readyState === 1) {
      try { ws.send(payload); } catch { /* ignore */ }
    }
  }
}

export function getChannelViewerCount(channel: string): number {
  let count = 0;
  for (const ws of clients.values()) {
    if (ws.data.subscriptions.has(channel)) count++;
  }
  return count;
}

// --- Redis subscription management ---

function ensureRedisSubscription(channel: string): void {
  const redisChannel = channelToRedisChannel(channel);
  if (redisChannel && !subscribedChannels.has(redisChannel)) {
    subscribedChannels.add(redisChannel);
    redisSub.subscribe(redisChannel, (err) => {
      if (err) console.error(`[WS] Redis subscribe error for ${redisChannel}:`, err);
      else console.log(`[WS] Subscribed to Redis channel: ${redisChannel}`);
    });
  }
}

function pruneUnusedRedisSubscriptions(): void {
  const needed = new Set<string>([FEED_CHANNEL]);
  for (const ws of clients.values()) {
    for (const sub of ws.data.subscriptions) {
      const r = channelToRedisChannel(sub);
      if (r) needed.add(r);
    }
  }
  for (const r of subscribedChannels) {
    if (!needed.has(r) && r !== FEED_CHANNEL) {
      subscribedChannels.delete(r);
      redisSub.unsubscribe(r, (err) => {
        if (err) console.error(`[WS] Redis unsubscribe error for ${r}:`, err);
        else console.log(`[WS] Unsubscribed from Redis channel: ${r}`);
      });
    }
  }
}

function channelToRedisChannel(channel: string): string | null {
  if (channel === "feed") return FEED_CHANNEL;
  if (channel.startsWith("feed:agent:")) return channel;
  if (channel.startsWith("feed:category:")) return channel;
  return null; // leaderboard, positions, prices broadcast directly
}

function subscribeToRedis(): void {
  if (redisListenerAttached) return;
  redisListenerAttached = true;

  redisSub.subscribe(FEED_CHANNEL, (err) => {
    if (err) console.error("[WS] Redis subscribe error:", err);
  });

  redisSub.on("message", (channel, message) => {
    if (channel === FEED_CHANNEL) {
      let parsed: any;
      try { parsed = JSON.parse(message); } catch { return; }

      if (parsed.type === "reaction_update") {
        broadcast("feed", parsed);
        return;
      }

      const data = parsed as FeedEvent;
      broadcast("feed", { type: "feed_event", data });
    } else if (channel.startsWith(FEED_AGENT_PREFIX)) {
      let data: FeedEvent;
      try { data = JSON.parse(message) as FeedEvent; } catch { return; }
      broadcast(channel, { type: "feed_event", data });
    } else if (channel.startsWith(FEED_CATEGORY_PREFIX)) {
      let data: FeedEvent;
      try { data = JSON.parse(message) as FeedEvent; } catch { return; }
      broadcast(channel, { type: "feed_event", data });
    }
  });
}

// --- Broadcast helpers ---

function broadcast(channel: string, data: unknown): void {
  const payload = JSON.stringify(data);
  for (const ws of clients.values()) {
    if (ws.data.subscriptions.has(channel) && ws.readyState === 1) {
      try { ws.send(payload); } catch { /* ignore */ }
    }
  }
}

export function broadcastFeedEvent(event: FeedEvent): void {
  broadcast("feed", { type: "feed_event", data: event });
}

export function broadcastLeaderboardUpdate(data: unknown): void {
  broadcast("leaderboard", { type: "leaderboard_update", data });
}

export function broadcastPositionUpdate(data: unknown): void {
  broadcast("positions", { type: "position_update", data });
}

export function broadcastPriceUpdate(data: unknown): void {
  broadcast("prices", { type: "price_update", data });
}

export function broadcastAgentDecision(data: unknown): void {
  broadcast("feed", { type: "agent_decision", data });
}

export function getClientCount(): number {
  return clients.size;
}

export async function stopWebSocketServer(): Promise<void> {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  if (viewerCountInterval) { clearInterval(viewerCountInterval); viewerCountInterval = null; }
  for (const ws of clients.values()) {
    try { ws.close(1001, "server shutdown"); } catch { /* ignore */ }
  }
  clients.clear();
}
