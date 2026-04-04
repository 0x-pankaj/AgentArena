import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

const secureStorage = {
  getItem: async (name: string) => SecureStore.getItem(name),
  setItem: async (name: string, value: string) => SecureStore.setItem(name, value),
  removeItem: async (name: string) => SecureStore.deleteItemAsync(name),
};

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

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
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
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => secureStorage),
    }
  )
);
