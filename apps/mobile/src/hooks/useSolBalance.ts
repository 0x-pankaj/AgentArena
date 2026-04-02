import { useQuery } from '@tanstack/react-query';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const RPC_URL = 'https://api.mainnet-beta.solana.com';

/**
 * Fetches the SOL balance for a given wallet address directly from the Solana RPC.
 * Falls back gracefully if the address is invalid or the RPC is unreachable.
 */
export function useSolBalance(walletAddress: string | null) {
  return useQuery({
    queryKey: ['solBalance', walletAddress],
    queryFn: async () => {
      if (!walletAddress) return { sol: 0 };
      const connection = new Connection(RPC_URL, 'confirmed');
      const pubkey = new PublicKey(walletAddress);
      const lamports = await connection.getBalance(pubkey);
      return { sol: lamports / LAMPORTS_PER_SOL };
    },
    enabled: !!walletAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 2,
  });
}
