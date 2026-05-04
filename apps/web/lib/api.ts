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

export function getSolanaExplorerUrl(address: string | null, type: "address" | "tx" = "address") {
  if (!address) return null;
  const cluster = "devnet"; // Adjust based on your env
  return `https://explorer.solana.com/${type}/${address}?cluster=${cluster}`;
}
