import { redis } from "../utils/redis";
import { REDIS_KEYS } from "@agent-arena/shared";

const TWITTER_API_BASE = "https://api.twitter.com/2";
const TWITTER_BEARER = process.env.TWITTER_BEARER_TOKEN ?? "";
const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes

// --- Types ---

export interface Tweet {
  id: string;
  text: string;
  authorId: string;
  createdAt: string;
  publicMetrics: {
    retweetCount: number;
    replyCount: number;
    likeCount: number;
    quoteCount: number;
  };
  entities?: {
    urls?: Array<{ expanded_url: string }>;
    hashtags?: Array<{ tag: string }>;
  };
}

export interface TwitterUser {
  id: string;
  name: string;
  username: string;
  description: string;
  publicMetrics: {
    followersCount: number;
    tweetCount: number;
  };
}

export interface SocialSignal {
  topic: string;
  tweetCount: number;
  avgEngagement: number;
  sentiment: "positive" | "negative" | "neutral";
  topTweets: Tweet[];
  trending: string[];
  timestamp: string;
}

// --- API helpers ---

async function twitterRequest<T>(path: string): Promise<T> {
  if (!TWITTER_BEARER) {
    throw new Error("TWITTER_BEARER_TOKEN not configured");
  }

  const response = await fetch(`${TWITTER_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${TWITTER_BEARER}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Twitter API error ${response.status}: ${await response.text()}`
    );
  }

  return response.json() as Promise<T>;
}

// --- Search recent tweets ---

export async function searchTweets(
  query: string,
  maxResults: number = 20
): Promise<Tweet[]> {
  const cacheKey = `${REDIS_KEYS.TWITTER_CACHE}:${query}:${maxResults}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as Tweet[];
  }

  const params = new URLSearchParams({
    query: `${query} -is:retweet lang:en`,
    max_results: String(Math.min(maxResults, 100)),
    "tweet.fields": "created_at,public_metrics,entities",
    expansions: "author_id",
  });

  const data = await twitterRequest<{
    data?: Array<{
      id: string;
      text: string;
      author_id: string;
      created_at: string;
      public_metrics: Tweet["publicMetrics"];
      entities?: Tweet["entities"];
    }>;
  }>(`/tweets/search/recent?${params.toString()}`);

  const tweets: Tweet[] = (data.data ?? []).map((t) => ({
    id: t.id,
    text: t.text,
    authorId: t.author_id,
    createdAt: t.created_at,
    publicMetrics: t.public_metrics,
    entities: t.entities,
  }));

  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(tweets));
  return tweets;
}

// --- Get user tweets ---

export async function getUserTweets(
  userId: string,
  maxResults: number = 20
): Promise<Tweet[]> {
  const cacheKey = `${REDIS_KEYS.TWITTER_CACHE}:user:${userId}:${maxResults}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as Tweet[];
  }

  const params = new URLSearchParams({
    max_results: String(Math.min(maxResults, 100)),
    "tweet.fields": "created_at,public_metrics,entities",
    exclude: "retweets,replies",
  });

  const data = await twitterRequest<{
    data?: Array<{
      id: string;
      text: string;
      author_id: string;
      created_at: string;
      public_metrics: Tweet["publicMetrics"];
      entities?: Tweet["entities"];
    }>;
  }>(`/users/${userId}/tweets?${params.toString()}`);

  const tweets: Tweet[] = (data.data ?? []).map((t) => ({
    id: t.id,
    text: t.text,
    authorId: t.author_id,
    createdAt: t.created_at,
    publicMetrics: t.public_metrics,
    entities: t.entities,
  }));

  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(tweets));
  return tweets;
}

// --- Social signal for a topic ---

export async function getSocialSignal(
  topic: string,
  maxResults: number = 50
): Promise<SocialSignal> {
  const cacheKey = `${REDIS_KEYS.TWITTER_CACHE}:signal:${topic}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached) as SocialSignal;
  }

  const tweets = await searchTweets(topic, maxResults);

  // Calculate engagement
  const totalEngagement = tweets.reduce(
    (sum, t) =>
      sum +
      t.publicMetrics.likeCount +
      t.publicMetrics.retweetCount * 2 +
      t.publicMetrics.replyCount * 3,
    0
  );
  const avgEngagement = tweets.length > 0 ? totalEngagement / tweets.length : 0;

  // Extract trending hashtags
  const hashtagCounts = new Map<string, number>();
  for (const tweet of tweets) {
    for (const tag of tweet.entities?.hashtags ?? []) {
      hashtagCounts.set(tag.tag, (hashtagCounts.get(tag.tag) ?? 0) + 1);
    }
  }
  const trending = Array.from(hashtagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => `#${tag}`);

  // Simple sentiment based on engagement (high engagement = notable)
  const sentiment =
    avgEngagement > 100
      ? "positive"
      : avgEngagement < 20
        ? "negative"
        : "neutral";

  const signal: SocialSignal = {
    topic,
    tweetCount: tweets.length,
    avgEngagement: Math.round(avgEngagement),
    sentiment,
    topTweets: tweets.slice(0, 10),
    trending,
    timestamp: new Date().toISOString(),
  };

  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(signal));
  return signal;
}

// --- Key accounts for geo monitoring ---

export const TWITTER_GEO_ACCOUNTS = {
  BREAKING: "7241572", // @BreakingNews
  REUTERS: "1652541", // @Reuters
  AP: "51241574", // @AP
  ALJAZEERA: "7232512", // @AJABreaking
  BBC_WORLD: "742143", // @BBCWorld
  NYT: "807095", // @nytimes
  WSJ: "3108351", // @WSJ
  BLOOMBERG: "34713362", // @business
  PENTAGON: "39672196", // @PentagonPresSec
  NATO: "214908090", // @NATO
} as const;

// --- Get signals from key accounts ---

export async function getKeyAccountSignals(): Promise<
  Record<string, Tweet[]>
> {
  const results: Record<string, Tweet[]> = {};
  const entries = Object.entries(TWITTER_GEO_ACCOUNTS);

  const tweets = await Promise.allSettled(
    entries.map(([, userId]) => getUserTweets(userId, 5))
  );

  for (let i = 0; i < entries.length; i++) {
    const [key] = entries[i];
    const result = tweets[i];
    if (result.status === "fulfilled") {
      results[key] = result.value;
    }
  }

  return results;
}
