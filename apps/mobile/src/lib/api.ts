import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const getBaseUrl = () => {
  // EXPO_PUBLIC_API_URL takes priority (set in .env or EAS build env)
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (__DEV__) {
    return 'http://10.0.2.2:3001';
  }
  return 'https://api.agentarena.dev';
};

async function fetchFromAPI(path: string, options?: RequestInit) {
  const url = `${getBaseUrl()}/trpc/${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add wallet address header if available
  try {
    const { useAuthStore } = require('../stores/authStore');
    const { walletAddress } = useAuthStore.getState();
    if (walletAddress) {
      headers['x-wallet-address'] = walletAddress;
    }
  } catch {}

  const res = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error: ${res.status} ${body}`);
  }

  const json = await res.json();
  return json.result?.data ?? json;
}

// --- Agent hooks ---

export function useAgentList(category?: string) {
  return useQuery({
    queryKey: ['agent', 'list', category],
    queryFn: () => {
      const input = JSON.stringify({ category, limit: 20, offset: 0 });
      return fetchFromAPI(`agent.list?input=${encodeURIComponent(input)}`);
    },
    staleTime: 30_000,
  });
}

export function useAgentGet(id: string) {
  return useQuery({
    queryKey: ['agent', 'get', id],
    queryFn: () => {
      const input = JSON.stringify({ id });
      return fetchFromAPI(`agent.get?input=${encodeURIComponent(input)}`);
    },
    enabled: !!id,
  });
}

// --- Feed hooks ---

export function useFeedRecent(limit: number = 50) {
  return useQuery({
    queryKey: ['feed', 'recent', limit],
    queryFn: () => {
      const input = JSON.stringify({ limit });
      return fetchFromAPI(`feed.getRecent?input=${encodeURIComponent(input)}`);
    },
    staleTime: 10_000,
  });
}

export function useFeedByAgent(agentId: string, limit: number = 10) {
  return useQuery({
    queryKey: ['feed', 'byAgent', agentId, limit],
    queryFn: () => {
      const input = JSON.stringify({ agentId, limit });
      return fetchFromAPI(`feed.getByAgent?input=${encodeURIComponent(input)}`);
    },
    enabled: !!agentId,
  });
}

export function useFeedByCategory(category: string, limit: number = 50) {
  return useQuery({
    queryKey: ['feed', 'byCategory', category, limit],
    queryFn: () => {
      const input = JSON.stringify({ category, limit });
      return fetchFromAPI(`feed.getByCategory?input=${encodeURIComponent(input)}`);
    },
    enabled: !!category && category !== 'all',
    staleTime: 10_000,
  });
}

export function useFeedByJob(jobId: string, limit: number = 50) {
  return useQuery({
    queryKey: ['feed', 'byJob', jobId, limit],
    queryFn: () => {
      const input = JSON.stringify({ jobId, limit });
      return fetchFromAPI(`feed.getByJob?input=${encodeURIComponent(input)}`);
    },
    enabled: !!jobId,
    staleTime: 10_000,
  });
}

// --- Leaderboard hooks ---

export function useLeaderboardAllTime(limit: number = 50) {
  return useQuery({
    queryKey: ['leaderboard', 'allTime', limit],
    queryFn: () => {
      const input = JSON.stringify({ limit });
      return fetchFromAPI(`leaderboard.getAllTime?input=${encodeURIComponent(input)}`);
    },
    staleTime: 30_000,
  });
}

export function useLeaderboardToday(limit: number = 50) {
  return useQuery({
    queryKey: ['leaderboard', 'today', limit],
    queryFn: () => {
      const input = JSON.stringify({ limit });
      return fetchFromAPI(`leaderboard.getToday?input=${encodeURIComponent(input)}`);
    },
    staleTime: 30_000,
  });
}

export function useLeaderboardByCategory(category: string, limit: number = 50) {
  return useQuery({
    queryKey: ['leaderboard', 'category', category, limit],
    queryFn: () => {
      const input = JSON.stringify({ category, limit });
      return fetchFromAPI(`leaderboard.getByCategory?input=${encodeURIComponent(input)}`);
    },
    staleTime: 30_000,
    enabled: !!category && category !== 'all',
  });
}

export function useGlobalStats() {
  return useQuery({
    queryKey: ['leaderboard', 'globalStats'],
    queryFn: () => fetchFromAPI('leaderboard.getGlobalStats'),
    staleTime: 30_000,
  });
}

export function useLeaderboardUsers(limit: number = 50) {
  return useQuery({
    queryKey: ['leaderboard', 'users', limit],
    queryFn: () => {
      const input = JSON.stringify({ limit });
      return fetchFromAPI(`leaderboard.getUsers?input=${encodeURIComponent(input)}`);
    },
    staleTime: 30_000,
  });
}

export function useTrendingAgents(limit: number = 10) {
  return useQuery({
    queryKey: ['leaderboard', 'trending', limit],
    queryFn: () => {
      const input = JSON.stringify({ limit });
      return fetchFromAPI(`leaderboard.getTrending?input=${encodeURIComponent(input)}`);
    },
    staleTime: 15_000,
  });
}

// --- User hooks ---

export function useFaucet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (walletAddress: string) =>
      fetchFromAPI('user.faucet', {
        method: 'POST',
        body: JSON.stringify({ walletAddress }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

export function useUserPortfolio() {
  return useQuery({
    queryKey: ['user', 'portfolio'],
    queryFn: () => fetchFromAPI('user.getPortfolio'),
    staleTime: 30_000,
  });
}

// --- Job hooks ---

export function useJobList(limit: number = 20) {
  return useQuery({
    queryKey: ['job', 'list', limit],
    queryFn: () => {
      const input = JSON.stringify({ limit });
      return fetchFromAPI(`job.list?input=${encodeURIComponent(input)}`);
    },
    staleTime: 10_000,
  });
}

export function useJobGet(id: string) {
  return useQuery({
    queryKey: ['job', 'get', id],
    queryFn: () => {
      const input = JSON.stringify({ id });
      return fetchFromAPI(`job.get?input=${encodeURIComponent(input)}`);
    },
    enabled: !!id,
  });
}

export function useJobCreate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { agentId: string; maxCap: number; dailyCap: number }) =>
      fetchFromAPI('job.create', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job'] });
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

export function useJobFund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchFromAPI('job.fund', {
        method: 'POST',
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job'] });
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

export function useJobCancel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchFromAPI('job.cancel', {
        method: 'POST',
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job'] });
    },
  });
}

export function useJobPause() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchFromAPI('job.pause', {
        method: 'POST',
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job'] });
    },
  });
}

export function useJobResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchFromAPI('job.resume', {
        method: 'POST',
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job'] });
    },
  });
}

// --- 8004 Agent Registry hooks ---

export function useAgentRegisterOn8004() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { agentId: string; atomEnabled?: boolean }) =>
      fetchFromAPI('agent.registerOn8004', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent'] });
    },
  });
}

export function useAgentConfirm8004() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { agentId: string; txSignature: string }) =>
      fetchFromAPI('agent.confirm8004Registration', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent'] });
    },
  });
}

export function useAgentGetReputation(agentId: string) {
  return useQuery({
    queryKey: ['agent', 'reputation', agentId],
    queryFn: () => {
      const input = JSON.stringify({ id: agentId });
      return fetchFromAPI(`agent.getReputation?input=${encodeURIComponent(input)}`);
    },
    enabled: !!agentId,
  });
}

// --- Policy Dashboard hook ---

export function useJobPolicyDashboard(jobId: string) {
  return useQuery({
    queryKey: ['job', 'policyDashboard', jobId],
    queryFn: () => {
      const input = JSON.stringify({ id: jobId });
      return fetchFromAPI(`job.getPolicyDashboard?input=${encodeURIComponent(input)}`);
    },
    enabled: !!jobId,
    staleTime: 10_000,
  });
}

// --- Job Wallet hooks ---

export function useJobWalletBalance(jobId: string) {
  return useQuery({
    queryKey: ['job', 'walletBalance', jobId],
    queryFn: () => {
      const input = JSON.stringify({ id: jobId });
      return fetchFromAPI(`job.getWalletBalance?input=${encodeURIComponent(input)}`);
    },
    enabled: !!jobId,
    staleTime: 10_000,
  });
}

export function useJobRegisterOnChain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchFromAPI('job.registerOnChain', {
        method: 'POST',
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job'] });
    },
  });
}

export function useJobConfirmOnChain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; onChainAddress: string; txSignature?: string }) =>
      fetchFromAPI('job.confirmOnChain', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job'] });
    },
  });
}

// --- Paper Trading hooks ---

export function usePaperTradingBalance(jobId: string) {
  return useQuery({
    queryKey: ['paperTrading', 'balance', jobId],
    queryFn: () => {
      const input = JSON.stringify({ jobId });
      return fetchFromAPI(`paperTrading.getBalance?input=${encodeURIComponent(input)}`);
    },
    enabled: !!jobId,
    staleTime: 10_000,
  });
}

export function usePaperTradingTopUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { jobId: string; amount: number }) =>
      fetchFromAPI('paperTrading.topUp', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['paperTrading', 'balance', variables.jobId] });
      queryClient.invalidateQueries({ queryKey: ['job'] });
    },
  });
}

export function usePaperTradingPortfolio(jobId: string) {
  return useQuery({
    queryKey: ['paperTrading', 'portfolio', jobId],
    queryFn: () => {
      const input = JSON.stringify({ jobId });
      return fetchFromAPI(`paperTrading.getPortfolio?input=${encodeURIComponent(input)}`);
    },
    enabled: !!jobId,
    staleTime: 10_000,
  });
}

export function useJobSwitchMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; mode: 'paper' | 'live' }) =>
      fetchFromAPI('job.switchMode', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job'] });
    },
  });
}
