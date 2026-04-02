import { create } from 'zustand';


interface AuthState {
  isConnected: boolean;
  walletAddress: string | null;
  privyUserId: string | null;
  connectionMethod: 'mwa' | 'privy' | null;
  balance: { usdc: number; sol: number };
  isLoading: boolean;
  connect: (address: string, method?: string) => void;
  disconnect: () => void;
  setBalance: (balance: { usdc: number; sol: number }) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isConnected: false,
  walletAddress: null,
  privyUserId: null,
  connectionMethod: null,
  balance: { usdc: 0, sol: 0 },
  isLoading: true,
  connect: (address: string, method?: string) =>
    set({
      isConnected: true,
      walletAddress: address,
      privyUserId: method === 'mwa' ? null : (method ?? null),
      connectionMethod: (method === 'mwa' ? 'mwa' : 'privy'),
      isLoading: false,
    }),
  disconnect: () =>
    set({ isConnected: false, walletAddress: null, privyUserId: null, connectionMethod: null, isLoading: false }),
  setBalance: (balance: { usdc: number; sol: number }) =>
    set({ balance }),
  setLoading: (loading: boolean) =>
    set({ isLoading: loading }),
}));
