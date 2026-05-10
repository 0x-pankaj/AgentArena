import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is not set");
}

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },
});

export const redisPub = new Redis(redisUrl);

// Subscriber-only client. Disable the periodic ready-check (INFO) since it's
// rejected once the connection enters subscribe mode and only produces noise
// on every reconnect against managed Redis (Upstash drops idle TLS conns).
export const redisSub = new Redis(redisUrl, { enableReadyCheck: false });
