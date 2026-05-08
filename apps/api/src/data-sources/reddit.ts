// --- Reddit JSON API Integration ---
// Completely FREE — no API key, no auth, no rate limit (just be respectful)
// Uses Reddit's public JSON endpoints: reddit.com/r/{subreddit}.json
//
// Category-specific subreddits:
// - Crypto: cryptocurrency, solana, ethfinance, Bitcoin, defi
// - Politics: politics, worldnews, NeutralPolitics, economics
// - Sports: sportsbook, nba, nfl, soccer, MMA

import { cachedFetch } from "../utils/cache";

const REDDIT_BASE = "https://www.reddit.com";
// Reddit blocks generic bot UAs in 2024+. Format per Reddit's API guide:
// `<platform>:<app id>:<version> (by /u/<username>)` — even without OAuth this
// reduces 403s vs an anonymous fetch.
const USER_AGENT = "node:agent-arena:1.0 (by /u/agent_arena)";

// Per-subreddit circuit breaker. When a sub returns 403/429, we skip it for
// `BLOCK_TTL_MS` to avoid log spam and to stop hammering an upstream that's
// actively rejecting us.
const blockUntil = new Map<string, number>();
const BLOCK_TTL_MS = 60 * 60 * 1000; // 1 hour

// One-log-per-window: don't log the same subreddit failure more than once per BLOCK_TTL_MS.
const loggedAt = new Map<string, number>();
function logOnce(key: string, msg: string) {
  const now = Date.now();
  const last = loggedAt.get(key) ?? 0;
  if (now - last < BLOCK_TTL_MS) return;
  loggedAt.set(key, now);
  console.warn(msg);
}

// --- Types ---

export interface RedditPost {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  upvoteRatio: number;
  numComments: number;
  createdUtc: number;
  url: string;
  permalink: string;
  isSelf: boolean;
  selftext?: string;
  thumbnail?: string;
}

export interface RedditSignal {
  subreddit: string;
  postCount: number;
  avgUpvoteRatio: number;
  totalScore: number;
  commentVelocity: number; // comments per hour
  sentiment: "bullish" | "bearish" | "neutral";
  topPosts: Array<{
    title: string;
    score: number;
    upvoteRatio: number;
    numComments: number;
    url: string;
    permalink: string;
  }>;
  fetchedAt: string;
}

// --- Category subreddit mapping ---

export const CATEGORY_SUBREDDITS: Record<string, string[]> = {
  crypto: ["cryptocurrency", "solana", "ethfinance", "Bitcoin", "defi", "CryptoCurrencyTrading"],
  politics: ["politics", "worldnews", "NeutralPolitics", "economics", "geopolitics", "uspolitics"],
  sports: ["sportsbook", "nba", "nfl", "soccer", "MMA", "tennis", "baseball"],
  general: ["news", "worldnews", "technology", "science"],
};

// --- Raw fetch helper ---

function isTimeoutError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "TimeoutError";
}

async function redditFetch<T>(path: string): Promise<T> {
  const url = `${REDDIT_BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      throw new Error(`Reddit API error ${res.status}`);
    }

    return res.json() as Promise<T>;
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error("Timeout");
    }
    throw err;
  }
}

// --- Parse Reddit listing response ---

function parseListing(data: any): RedditPost[] {
  const children = data?.data?.children ?? [];
  return children
    .map((child: any) => {
      const d = child?.data;
      if (!d) return null;
      return {
        id: d.id,
        title: d.title ?? "",
        subreddit: d.subreddit ?? "",
        author: d.author ?? "",
        score: d.score ?? 0,
        upvoteRatio: d.upvote_ratio ?? 0.5,
        numComments: d.num_comments ?? 0,
        createdUtc: d.created_utc ?? 0,
        url: d.url ?? "",
        permalink: `https://www.reddit.com${d.permalink ?? ""}`,
        isSelf: d.is_self ?? false,
        selftext: d.selftext ?? undefined,
        thumbnail: d.thumbnail ?? undefined,
      };
    })
    .filter(Boolean) as RedditPost[];
}

// --- Search posts by keyword across subreddits ---

export async function searchReddit(
  query: string,
  subreddit?: string,
  limit: number = 25
): Promise<RedditPost[]> {
  const encodedQuery = encodeURIComponent(query);
  const path = subreddit
    ? `/r/${subreddit}/search.json?q=${encodedQuery}&sort=relevance&t=week&limit=${limit}`
    : `/search.json?q=${encodedQuery}&sort=relevance&t=week&limit=${limit}`;

  try {
    const data = await redditFetch<any>(path);
    return parseListing(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Reddit] Search failed for "${query}": ${msg}`);
    return [];
  }
}

// --- Get hot posts from a subreddit ---

export async function getSubredditPosts(
  subreddit: string,
  sort: "hot" | "new" | "top" = "hot",
  limit: number = 25
): Promise<RedditPost[]> {
  // Circuit breaker — if this sub recently 403'd, skip the network call and
  // return [] immediately. The empty result still flows through cachedFetch's
  // 30min TTL, which combined with this in-process gate means agents don't
  // spam logs every cache expiry.
  const blockKey = `${subreddit}:${sort}`;
  const breaker = blockUntil.get(blockKey) ?? 0;
  if (Date.now() < breaker) return [];

  const cacheKey = ["reddit", subreddit, sort, String(limit)];

  return cachedFetch("reddit", cacheKey, async () => {
    try {
      const data = await redditFetch<any>(`/r/${subreddit}/${sort}.json?limit=${limit}`);
      return parseListing(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 403/429 → trip the breaker so we don't re-attempt for an hour.
      if (msg.includes("403") || msg.includes("429")) {
        blockUntil.set(blockKey, Date.now() + BLOCK_TTL_MS);
        logOnce(`reddit:${subreddit}`, `[Reddit] r/${subreddit} blocked (${msg}); pausing for ${BLOCK_TTL_MS / 60000}min`);
      } else {
        logOnce(`reddit:${subreddit}`, `[Reddit] Failed to fetch r/${subreddit}: ${msg}`);
      }
      return [];
    }
  });
}

// --- Sentiment analysis for a subreddit ---

function classifySentiment(posts: RedditPost[]): "bullish" | "bearish" | "neutral" {
  if (posts.length === 0) return "neutral";

  const bullishKeywords = ["bull", "bullish", "moon", "rocket", "pump", "breakout", "rally", "surge", "soar", "explode", "win", "champion", "victory", "up", "gain", "profit", "buy", "hold", "strong"];
  const bearishKeywords = ["bear", "bearish", "crash", "dump", "collapse", "plunge", "tank", "rekt", "loss", "lose", "down", "sell", "weak", "fud", "panic", "scam", "rug"];

  let bullish = 0;
  let bearish = 0;

  for (const post of posts) {
    const text = `${post.title} ${post.selftext ?? ""}`.toLowerCase();
    const hasBullish = bullishKeywords.some((k) => text.includes(k));
    const hasBearish = bearishKeywords.some((k) => text.includes(k));
    if (hasBullish && !hasBearish) bullish++;
    if (hasBearish && !hasBullish) bearish++;
  }

  const ratio = bullish / Math.max(bearish, 1);
  if (ratio > 1.5) return "bullish";
  if (ratio < 0.67) return "bearish";
  return "neutral";
}

// --- Build sentiment signal for a subreddit ---

export async function getSubredditSentiment(subreddit: string): Promise<RedditSignal> {
  const posts = await getSubredditPosts(subreddit, "hot", 25);

  if (posts.length === 0) {
    return {
      subreddit,
      postCount: 0,
      avgUpvoteRatio: 0,
      totalScore: 0,
      commentVelocity: 0,
      sentiment: "neutral",
      topPosts: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  const avgUpvoteRatio = posts.reduce((sum, p) => sum + p.upvoteRatio, 0) / posts.length;
  const totalScore = posts.reduce((sum, p) => sum + p.score, 0);

  // Comment velocity: total comments / hours since oldest post
  const now = Date.now() / 1000;
  const oldestPost = Math.min(...posts.map((p) => p.createdUtc));
  const hoursSpan = Math.max((now - oldestPost) / 3600, 1);
  const totalComments = posts.reduce((sum, p) => sum + p.numComments, 0);
  const commentVelocity = totalComments / hoursSpan;

  const sentiment = classifySentiment(posts);

  return {
    subreddit,
    postCount: posts.length,
    avgUpvoteRatio,
    totalScore,
    commentVelocity,
    sentiment,
    topPosts: posts.slice(0, 5).map((p) => ({
      title: p.title,
      score: p.score,
      upvoteRatio: p.upvoteRatio,
      numComments: p.numComments,
      url: p.url,
      permalink: p.permalink,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

// --- Get signals for all subreddits in a category ---

export async function getRedditSignals(
  category: "crypto" | "politics" | "sports" | "general"
): Promise<Record<string, RedditSignal>> {
  const subreddits = CATEGORY_SUBREDDITS[category] ?? CATEGORY_SUBREDDITS.general;
  const signals: Record<string, RedditSignal> = {};

  // Fetch in parallel with individual error handling
  const results = await Promise.allSettled(
    subreddits.map(async (sub) => {
      try {
        return await getSubredditSentiment(sub);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Reddit] Failed r/${sub}: ${msg}`);
        return null;
      }
    })
  );

  for (let i = 0; i < subreddits.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value) {
      signals[subreddits[i]] = result.value;
    }
  }

  return signals;
}

// --- Search Reddit with keyword and return signal ---

export async function getRedditSearchSignal(
  query: string,
  limit: number = 25
): Promise<{ posts: RedditPost[]; sentiment: RedditSignal["sentiment"]; topPosts: RedditSignal["topPosts"] }> {
  const posts = await searchReddit(query, undefined, limit);
  const sentiment = classifySentiment(posts);
  return {
    posts,
    sentiment,
    topPosts: posts.slice(0, 5).map((p) => ({
      title: p.title,
      score: p.score,
      upvoteRatio: p.upvoteRatio,
      numComments: p.numComments,
      url: p.url,
      permalink: p.permalink,
    })),
  };
}
