import { Connection } from "@solana/web3.js";

// Force Expo to detect this env var
void process.env.EXPO_PUBLIC_HELIUS_API_KEY;

const HELIUS_API_KEY = process.env.EXPO_PUBLIC_HELIUS_API_KEY ?? "";
const SOLANA_RPC_URL = process.env.EXPO_PUBLIC_SOLANA_RPC_URL
  ?? (HELIUS_API_KEY ? `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}` : "https://api.devnet.solana.com");

export function getSolanaConnection(commitment: "confirmed" | "finalized" = "confirmed"): Connection {
  return new Connection(SOLANA_RPC_URL, commitment);
}
