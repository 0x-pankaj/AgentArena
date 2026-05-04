import { z } from "zod";
import { JUPITER_PREDICT_BASE_URL } from "@agent-arena/shared";
import { jupiterRateLimiter, getAgentPriority, withJupiterRateLimit } from "../services/jupiter-rate-limiter";

const API_KEY = process.env.JUPITER_API_KEY ?? "";

// --- Zod schemas for Jupiter Predict API responses ---

export const JupiterEventSchema = z.object({
  eventId: z.string(),
  category: z.string().nullish(),
  subcategory: z.string().nullish(),
  isActive: z.boolean().nullish(),
  isLive: z.boolean().nullish(),
  volumeUsd: z.union([z.number(), z.string()]).nullish(),
  volume24hr: z.union([z.number(), z.string()]).nullish(),
  beginAt: z.string().nullish(),
  metadata: z
    .object({
      title: z.string().nullish(),
      subtitle: z.string().nullish(),
      slug: z.string().nullish(),
      imageUrl: z.string().nullish(),
      closeTime: z.string().nullish(),
    })
    .nullish(),
  markets: z
    .array(
      z.object({
        marketId: z.string(),
        status: z.string().nullish(),
        result: z.string().nullable().optional(),
        openTime: z.union([z.string(), z.number()]).nullish(),
        closeTime: z.union([z.string(), z.number()]).nullish(),
        resolveAt: z.union([z.string(), z.number(), z.null()]).optional(),
        pricing: z.any().optional(),
        // Top-level fields Jupiter actually returns. Previously these lived
        // only inside a `metadata` sub-object that the API never sends, so
        // every market looked title-less to our extractors.
        title: z.string().nullish(),
        rulesPrimary: z.string().nullish(),
        rulesSecondary: z.string().nullish(),
        imageUrl: z.string().nullable().optional(),
        outcomes: z.array(z.string()).nullish(),
        outcomePrices: z.array(z.string()).nullish(),
        eventId: z.string().nullish(),
        isTeamMarket: z.boolean().nullish(),
        // Keep metadata in case Jupiter ever adds it back — best-effort
        // fallback path in the extractors.
        metadata: z
          .object({
            question: z.string().nullish(),
            title: z.string().nullish(),
            rulesPrimary: z.string().nullish(),
            imageUrl: z.string().nullish(),
          })
          .nullish(),
      })
    )
    .nullish(),
});
export type JupiterEvent = z.infer<typeof JupiterEventSchema>;

export const JupiterMarketSchema = z.object({
  marketId: z.string(),
  status: z.string().nullish(),
  result: z.string().nullable().optional(),
  openTime: z.union([z.string(), z.number()]).nullish(),
  closeTime: z.union([z.string(), z.number()]).nullish(),
  resolveAt: z.union([z.string(), z.number(), z.null()]).optional(),
  pricing: z.any().optional(),
  // Same top-level fields as the inline event-markets shape above.
  title: z.string().nullish(),
  rulesPrimary: z.string().nullish(),
  rulesSecondary: z.string().nullish(),
  imageUrl: z.string().nullable().optional(),
  outcomes: z.array(z.string()).nullish(),
  outcomePrices: z.array(z.string()).nullish(),
  eventId: z.string().nullish(),
  isTeamMarket: z.boolean().nullish(),
  metadata: z
    .object({
      question: z.string().nullish(),
      title: z.string().nullish(),
      rulesPrimary: z.string().nullish(),
      imageUrl: z.string().nullish(),
    })
    .nullish(),
});
export type JupiterMarket = z.infer<typeof JupiterMarketSchema>;

// Compose a human-readable question for a Jupiter market by combining the
// event-level template (e.g. "Bitcoin above ___ on May 5?") with the
// market-level title that fills it in (e.g. "78,000"). Falls through to
// the next-best source on each market shape Jupiter returns. Returns null
// when nothing usable is available — callers should drop the market in
// that case rather than persist a placeholder.
export function composeMarketQuestion(
  market: Pick<JupiterMarket, "title" | "rulesPrimary" | "metadata">,
  event?: { metadata?: { title?: string | null; subtitle?: string | null } | null } | null,
): string | null {
  const eventTitle = event?.metadata?.title?.trim() || null;
  const eventSubtitle = event?.metadata?.subtitle?.trim() || null;
  const marketTitle = market.title?.trim() || market.metadata?.title?.trim() || null;
  const marketQuestion = market.metadata?.question?.trim() || null;
  const rules =
    market.rulesPrimary?.trim() || market.metadata?.rulesPrimary?.trim() || null;

  // 1. Explicit question wins outright.
  if (marketQuestion) return marketQuestion.slice(0, 200);

  // 2. Templated event title with `___` placeholder filled by market title.
  if (eventTitle && marketTitle && eventTitle.includes("___")) {
    return eventTitle.replace("___", marketTitle).slice(0, 200);
  }

  // 3. Event title + market title disambiguator (tennis match → which player).
  if (eventTitle && marketTitle && marketTitle !== eventTitle) {
    return `${eventTitle} — ${marketTitle}`.slice(0, 200);
  }

  // 4. Either alone.
  if (eventTitle) return eventTitle.slice(0, 200);
  if (marketTitle) return marketTitle.slice(0, 200);
  if (eventSubtitle) return eventSubtitle.slice(0, 200);

  // 5. First sentence of rulesPrimary as a last resort.
  if (rules) {
    const firstSentence = rules.split(/(?<=[.!?])\s+/)[0]?.trim();
    if (firstSentence && firstSentence.length > 10) return firstSentence.slice(0, 200);
  }

  return null;
}

export const JupiterOrderSchema = z.object({
  orderPubkey: z.string(),
  positionPubkey: z.string().optional(),
  transaction: z.string(), // base64 encoded Solana tx
});
export type JupiterOrder = z.infer<typeof JupiterOrderSchema>;

export const JupiterPositionSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  marketQuestion: z.string().nullish(),
  side: z.string(),
  size: z.string(),
  avgPrice: z.string().nullish(),
  currentPrice: z.string().nullish(),
  unrealizedPnl: z.string().nullish(),
  createdAt: z.string().nullish(),
});
export type JupiterPosition = z.infer<typeof JupiterPositionSchema>;

export const JupiterOrderbookSchema = z.object({
  marketId: z.string(),
  bids: z.array(
    z.object({
      price: z.string(),
      size: z.string(),
    })
  ),
  asks: z.array(
    z.object({
      price: z.string(),
      size: z.string(),
    })
  ),
});
export type JupiterOrderbook = z.infer<typeof JupiterOrderbookSchema>;

// --- Request types ---

export interface CreateOrderParams {
  ownerPubkey: string;
  marketId: string;
  isYes: boolean;
  isBuy: boolean;
  depositAmount: string;
  depositMint?: string;
}

export interface ListEventsParams {
  category?: string;
  sortBy?: "volume" | "beginAt";
  sortDirection?: "asc" | "desc";
  includeMarkets?: boolean;
  filter?: "new" | "live" | "trending";
  start?: number;
  end?: number;
}

export interface SearchEventsParams {
  query: string;
  limit?: number;
}

export interface ListPositionsParams {
  marketId?: string;
  limit?: number;
}

export interface HistoryParams {
  limit?: number;
  offset?: number;
}

// --- Jupiter Predict API Client ---

class JupiterPredictClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = JUPITER_PREDICT_BASE_URL;
    this.apiKey = API_KEY;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    category?: string
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
      ...(options.headers as Record<string, string> ?? {}),
    };

    // Determine category from path for rate limiting
    const requestCategory = category ?? this.extractCategory(path);
    const priority = category ? getAgentPriority(category) : undefined;

    // Execute with rate limiting
    return withJupiterRateLimit(requestCategory, async () => {
      try {
        const response = await fetch(url, {
          ...options,
          headers,
        });

        if (!response.ok) {
          const body = await response.text();
          const error = new Error(
            `Jupiter Predict API error ${response.status}: ${body}`
          );
          // Record failure for rate limiter
          jupiterRateLimiter.recordFailure(requestCategory, response.status);
          throw error;
        }

        // Record success
        jupiterRateLimiter.recordSuccess(requestCategory);
        return response.json() as Promise<T>;
      } catch (err) {
        if (err instanceof Error && !err.message.includes('Jupiter Predict API error')) {
          jupiterRateLimiter.recordFailure(requestCategory);
        }
        throw err;
      }
    }, priority);
  }

  // Extract category from API path for rate limiting
  private extractCategory(path: string): string {
    if (path.includes('/events')) {
      // Try to extract category from query params
      const match = path.match(/category=([^&]+)/);
      if (match) return match[1];
      return 'general';
    }
    if (path.includes('/markets')) return 'markets';
    if (path.includes('/orderbook')) return 'markets';
    if (path.includes('/positions')) return 'positions';
    if (path.includes('/orders')) return 'orders';
    return 'general';
  }

  // --- Events ---

  async listEvents(params: ListEventsParams = {}): Promise<JupiterEvent[]> {
    const searchParams = new URLSearchParams();
    searchParams.set("provider", "polymarket");
    if (params.category) searchParams.set("category", params.category);
    if (params.sortBy) searchParams.set("sortBy", params.sortBy);
    if (params.sortDirection) searchParams.set("sortDirection", params.sortDirection);
    if (params.filter) searchParams.set("filter", params.filter);
    if (params.includeMarkets) searchParams.set("includeMarkets", "true");
    if (params.start !== undefined) searchParams.set("start", String(params.start));
    if (params.end !== undefined) searchParams.set("end", String(params.end));

    const qs = searchParams.toString();
    const raw = await this.request<any>(
      `/events${qs ? `?${qs}` : ""}`,
      undefined,
      params.category // Pass category for rate limiting
    );

    // Jupiter API returns { data: [...], pagination: {...} }
    const events = raw?.data ?? (Array.isArray(raw) ? raw : []);
    return z.array(JupiterEventSchema).parse(events);
  }

  async searchEvents(params: SearchEventsParams): Promise<JupiterEvent[]> {
    const searchParams = new URLSearchParams();
    searchParams.set("query", params.query);
    if (params.limit) searchParams.set("limit", String(params.limit));

    const raw = await this.request<any>(
      `/events/search?${searchParams.toString()}`
    );
    const events = raw?.data ?? (Array.isArray(raw) ? raw : []);
    return z.array(JupiterEventSchema).parse(events);
  }

  async getEvent(eventId: string): Promise<JupiterEvent> {
    const data = await this.request<JupiterEvent>(`/events/${eventId}`);
    return JupiterEventSchema.parse(data);
  }

  // --- Markets ---

  async getMarket(marketId: string): Promise<JupiterMarket> {
    const data = await this.request<JupiterMarket>(`/markets/${marketId}`);
    return JupiterMarketSchema.parse(data);
  }

  async getOrderbook(marketId: string): Promise<JupiterOrderbook> {
    const data = await this.request<JupiterOrderbook>(
      `/orderbook/${marketId}`
    );
    return JupiterOrderbookSchema.parse(data);
  }

  // --- Orders ---

  async createOrder(params: CreateOrderParams): Promise<JupiterOrder> {
    const body: Record<string, unknown> = {
      ownerPubkey: params.ownerPubkey,
      marketId: params.marketId,
      isYes: params.isYes,
      isBuy: params.isBuy,
      depositAmount: params.depositAmount,
    };
    if (params.depositMint) {
      body.depositMint = params.depositMint;
    }

    const data = await this.request<JupiterOrder>("/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return JupiterOrderSchema.parse(data);
  }

  async getOrderStatus(orderPubkey: string): Promise<unknown> {
    return this.request(`/orders/${orderPubkey}`);
  }

  // --- Positions ---

  async listPositions(
    params: ListPositionsParams = {}
  ): Promise<JupiterPosition[]> {
    const searchParams = new URLSearchParams();
    if (params.marketId) searchParams.set("marketId", params.marketId);
    if (params.limit) searchParams.set("limit", String(params.limit));

    const qs = searchParams.toString();
    const raw = await this.request<any>(
      `/positions${qs ? `?${qs}` : ""}`
    );
    const positions = raw?.data ?? (Array.isArray(raw) ? raw : []);
    return z.array(JupiterPositionSchema).parse(positions);
  }

  async closePosition(positionPubkey: string): Promise<unknown> {
    return this.request(`/positions/${positionPubkey}`, {
      method: "DELETE",
    });
  }

  async claimPayout(positionPubkey: string): Promise<unknown> {
    return this.request(`/positions/${positionPubkey}/claim`, {
      method: "POST",
    });
  }

  // --- History ---

  async getHistory(params: HistoryParams = {}): Promise<unknown> {
    const searchParams = new URLSearchParams();
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.offset) searchParams.set("offset", String(params.offset));

    const qs = searchParams.toString();
    return this.request(`/history${qs ? `?${qs}` : ""}`);
  }

  // --- Trading Status ---

  async getTradingStatus(): Promise<{ isTrading: boolean }> {
    return this.request("/trading-status");
  }
}

export const jupiterPredict = new JupiterPredictClient();
