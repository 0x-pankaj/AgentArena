import { WebSocketServer, WebSocket } from "ws";
import { redisSub } from "../utils/redis";
import type { FeedEvent } from "@agent-arena/shared";

const FEED_CHANNEL = "feed:live";
const FEED_AGENT_PREFIX = "feed:agent:";
const FEED_CATEGORY_PREFIX = "feed:category:";

interface WsClient {
  ws: WebSocket;
  subscriptions: Set<string>; // channels: "feed", "leaderboard", "positions", "prices", "feed:agent:{id}", "feed:category:{cat}"
  id: string;
}

const clients = new Map<string, WsClient>();
const subscribedChannels = new Set<string>();
const clientPongs = new Map<string, number>();
let wss: WebSocketServer | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

// --- Start WebSocket server ---

export function startWebSocketServer(port: number = 3002): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({ port });

  // Always subscribe to the global feed channel
  subscribedChannels.add(FEED_CHANNEL);

  wss.on("connection", (ws, req) => {
    const clientId = crypto.randomUUID();
    const client: WsClient = {
      ws,
      subscriptions: new Set(["feed"]), // subscribe to feed by default
      id: clientId,
    };
    clients.set(clientId, client);

    console.log(`[WS] Client connected: ${clientId} (total: ${clients.size})`);

    // Send welcome message
    ws.send(
      JSON.stringify({
        type: "connected",
        clientId,
        subscriptions: Array.from(client.subscriptions),
      })
    );

    // Handle messages (subscribe/unsubscribe)
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          action: "subscribe" | "unsubscribe";
          channel: string;
        };

        if (msg.action === "subscribe") {
          client.subscriptions.add(msg.channel);
          ensureRedisSubscription(msg.channel);
          ws.send(
            JSON.stringify({
              type: "subscribed",
              channel: msg.channel,
            })
          );
        } else if (msg.action === "unsubscribe") {
          client.subscriptions.delete(msg.channel);
          ws.send(
            JSON.stringify({
              type: "unsubscribed",
              channel: msg.channel,
            })
          );
          pruneUnusedRedisSubscriptions();
        }
      } catch {
        // ignore invalid messages
      }
    });

    ws.on("pong", () => {
      clientPongs.set(clientId, Date.now());
    });

    ws.on("close", () => {
      clients.delete(clientId);
      clientPongs.delete(clientId);
      pruneUnusedRedisSubscriptions();
      console.log(
        `[WS] Client disconnected: ${clientId} (total: ${clients.size})`
      );
    });

    ws.on("error", () => {
      clients.delete(clientId);
      clientPongs.delete(clientId);
    });
  });

  // Subscribe to Redis channels
  subscribeToRedis();

  // Heartbeat to detect dead connections (kill if no pong in 60s)
  heartbeatInterval = setInterval(() => {
    const now = Date.now();
    for (const [clientId, client] of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        const lastPong = clientPongs.get(clientId) ?? now;
        if (now - lastPong > 60_000) {
          console.log(`[WS] Client ${clientId} timed out (no pong)`);
          client.ws.terminate();
          clients.delete(clientId);
          clientPongs.delete(clientId);
          continue;
        }
        client.ws.ping();
      } else {
        clients.delete(clientId);
        clientPongs.delete(clientId);
      }
    }
    pruneUnusedRedisSubscriptions();
  }, 30_000);

  console.log(`[WS] WebSocket server started on port ${port}`);
  return wss;
}

// --- Ensure Redis subscription for a channel ---

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

// --- Remove Redis subscriptions no longer needed ---

function pruneUnusedRedisSubscriptions(): void {
  const neededChannels = new Set<string>();
  neededChannels.add(FEED_CHANNEL); // always keep global feed

  for (const client of clients.values()) {
    for (const sub of client.subscriptions) {
      const redisChannel = channelToRedisChannel(sub);
      if (redisChannel) neededChannels.add(redisChannel);
    }
  }

  for (const redisChannel of subscribedChannels) {
    if (!neededChannels.has(redisChannel) && redisChannel !== FEED_CHANNEL) {
      subscribedChannels.delete(redisChannel);
      redisSub.unsubscribe(redisChannel, (err) => {
        if (err) console.error(`[WS] Redis unsubscribe error for ${redisChannel}:`, err);
        else console.log(`[WS] Unsubscribed from Redis channel: ${redisChannel}`);
      });
    }
  }
}

// --- Map WS channel name to Redis channel name ---

function channelToRedisChannel(channel: string): string | null {
  if (channel === "feed") return FEED_CHANNEL;
  if (channel.startsWith("feed:agent:")) return channel;
  if (channel.startsWith("feed:category:")) return channel;
  return null; // leaderboard, positions, prices are broadcast directly, not via Redis
}

// --- Redis subscription for broadcast ---

function subscribeToRedis(): void {
  redisSub.subscribe(FEED_CHANNEL, (err) => {
    if (err) console.error("[WS] Redis subscribe error:", err);
  });

  redisSub.on("message", (channel, message) => {
    if (channel === FEED_CHANNEL) {
      let data: FeedEvent;
      try { data = JSON.parse(message) as FeedEvent; } catch { return; }
      broadcast("feed", {
        type: "feed_event",
        data,
      });
    } else if (channel.startsWith(FEED_AGENT_PREFIX)) {
      const wsChannel = channel;
      let data: FeedEvent;
      try { data = JSON.parse(message) as FeedEvent; } catch { return; }
      broadcast(wsChannel, {
        type: "feed_event",
        data,
      });
    } else if (channel.startsWith(FEED_CATEGORY_PREFIX)) {
      const wsChannel = channel;
      let data: FeedEvent;
      try { data = JSON.parse(message) as FeedEvent; } catch { return; }
      broadcast(wsChannel, {
        type: "feed_event",
        data,
      });
    }
  });
}

// --- Broadcast to all subscribed clients ---

function broadcast(channel: string, data: unknown): void {
  const payload = JSON.stringify(data);

  for (const client of clients.values()) {
    if (
      client.subscriptions.has(channel) &&
      client.ws.readyState === WebSocket.OPEN
    ) {
      try {
        client.ws.send(payload);
      } catch {
        // client disconnected
      }
    }
  }
}

// --- Direct broadcast helpers (for non-Redis events) ---

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

// --- Get connected client count ---

export function getClientCount(): number {
  return clients.size;
}

// --- Stop WebSocket server ---

export async function stopWebSocketServer(): Promise<void> {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (wss) {
    for (const client of clients.values()) {
      client.ws.close();
    }
    clients.clear();
    clientPongs.clear();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(), 5000);
      wss?.close(() => { clearTimeout(timeout); resolve(); });
    });
    wss = null;
  }
}
