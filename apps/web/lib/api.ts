const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function trpcQuery<T>(procedure: string, input?: unknown): Promise<T | null> {
  try {
    const url = new URL(`${API_BASE}/trpc/${procedure}`);
    if (input !== undefined) {
      url.searchParams.set("input", JSON.stringify({ json: input }));
    }
    const res = await fetch(url.toString(), {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.result?.data?.json ?? json.result?.data ?? null;
  } catch {
    return null;
  }
}

export class TRPCMutationError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "TRPCMutationError";
  }
}

async function trpcMutation<T>(procedure: string, input: unknown): Promise<T> {
  // tRPC v10 over HTTP without a transformer expects the raw input as the POST body.
  const url = `${API_BASE}/trpc/${procedure}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    const msg = json?.error?.json?.message ?? json?.error?.message ?? `Request failed (${res.status})`;
    const code = json?.error?.json?.data?.code ?? json?.error?.data?.code;
    throw new TRPCMutationError(msg, code);
  }
  return (json?.result?.data?.json ?? json?.result?.data) as T;
}

export async function fetchHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchAgentList() {
  return trpcQuery<{ agents: any[]; total: number }>("agent.list", { category: undefined, limit: 50, offset: 0 });
}

export async function fetchActiveAgents() {
  return trpcQuery<{ agents: any[] }>("agent.listActive");
}

export async function fetchFeedRecent(limit = 5) {
  return trpcQuery<{ items: any[] }>("feed.getRecent", { limit });
}

export async function fetchLeaderboard() {
  return trpcQuery<{ entries: any[] }>("leaderboard.getAllTime", { limit: 10 });
}

export async function fetchSwarmLeaderboard() {
  return trpcQuery<{ leaderboard: any[] }>("swarmGraph.getSwarmLeaderboard", { limit: 5 });
}

export interface SwarmActivityItem {
  id: string;
  type: string;
  from: { name: string; category: string };
  to: { name: string; category: string };
  marketQuestion: string | null;
  confidence: number | null;
  metadata: any;
  at: string | null;
}

export async function fetchSwarmActivity(limit = 12) {
  return trpcQuery<{ items: SwarmActivityItem[] }>(
    "swarmGraph.getRecentActivity",
    { limit },
  );
}

export async function fetchAgentReputation(agentId: string) {
  return trpcQuery<{
    assetAddress: string;
    trustTier: string;
    formattedTier: string;
    compositeScore: number;
    totalWins: number;
    totalLosses: number;
    winRate: number;
    totalFeedback: number;
  }>("agent.getReputation", { id: agentId });
}

export async function fetchAgentNftMetadata(assetAddress: string) {
  return trpcQuery<{
    image?: string;
    name?: string;
    description?: string;
    attributes?: Array<{ trait_type: string; value: string }>;
    symbol?: string;
    uri?: string;
  }>("agent.getNftMetadata", { assetAddress });
}

// --- Feedback ---

export type FeedbackType = "bug" | "feature" | "general" | "praise";

export interface FeedbackInput {
  type: FeedbackType;
  message: string;
  rating?: number;
  contact?: string;
  pageUrl?: string;
}

export async function submitFeedback(input: FeedbackInput): Promise<{ success: boolean; id: string | null }> {
  return trpcMutation("feedback.submit", {
    type: input.type,
    message: input.message,
    rating: input.rating,
    contact: input.contact,
    pageUrl: input.pageUrl,
    source: "web",
    website: "", // honeypot — must stay empty
  });
}

export async function fetchFeedbackStats() {
  return trpcQuery<{
    total: number;
    avgRating: number | null;
    bugs: number;
    features: number;
    praise: number;
  }>("feedback.stats");
}

export async function fetchRecentFeedback(limit = 10) {
  return trpcQuery<{
    items: Array<{
      id: string;
      type: FeedbackType;
      rating: number | null;
      message: string;
      source: string;
      createdAt: string;
    }>;
  }>("feedback.recent", { limit });
}

type SolanaCluster = "mainnet-beta" | "devnet" | "testnet";

const SOLANA_CLUSTER: SolanaCluster = ((): SolanaCluster => {
  const raw = process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
  if (raw === "mainnet-beta" || raw === "mainnet") return "mainnet-beta";
  if (raw === "testnet") return "testnet";
  return "devnet";
})();

export function getSolanaExplorerUrl(address: string | null, type: "address" | "tx" = "address") {
  if (!address) return null;
  const suffix = SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${SOLANA_CLUSTER}`;
  return `https://explorer.solana.com/${type}/${address}${suffix}`;
}
