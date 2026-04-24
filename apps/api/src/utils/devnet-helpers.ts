import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { SOLANA_RPC_URL, SOLANA_COMMITMENT, IS_DEVNET } from "@agent-arena/shared";

// ═══════════════════════════════════════════════════════════════
// Devnet Helpers — Backend payer keypair, airdrops, balance checks
// ═══════════════════════════════════════════════════════════════

const connection = new Connection(
  SOLANA_RPC_URL || "https://api.devnet.solana.com",
  SOLANA_COMMITMENT
);

// Backend payer keypair — used for 8004 mints, ATOM fees, agent wallet funding
// Set BACKEND_PAYER_SECRET_KEY as base58 string (standard Solana private key)
// or base64-encoded Uint8Array. Falls back to generating a new one.
let _backendPayer: Keypair | null = null;

function parseSecretKey(envKey: string): Uint8Array | null {
  // Try base58 first (standard Solana format, 88 chars)
  if (/^[1-9A-HJ-NP-Za-km-z]{85,90}$/.test(envKey.trim())) {
    try {
      const { bs58 } = require("@project-serum/anchor/dist/cjs/utils/bytes");
      return bs58.decode(envKey.trim());
    } catch {
      // bs58 not available, try web3
      try {
        const { decode } = require("bs58");
        return decode(envKey.trim());
      } catch {
        // fall through
      }
    }
  }

  // Try base64
  try {
    const decoded = Buffer.from(envKey, "base64");
    if (decoded.length === 64) {
      return new Uint8Array(decoded);
    }
  } catch {
    // fall through
  }

  // Try JSON array
  try {
    const parsed = JSON.parse(envKey);
    if (Array.isArray(parsed) && parsed.length === 64) {
      return new Uint8Array(parsed);
    }
  } catch {
    // fall through
  }

  return null;
}

export function getBackendPayer(): Keypair {
  if (_backendPayer) return _backendPayer;

  const envKey = process.env.BACKEND_PAYER_SECRET_KEY;
  if (envKey) {
    const secretKey = parseSecretKey(envKey);
    if (secretKey) {
      try {
        _backendPayer = Keypair.fromSecretKey(secretKey);
        console.log(`[Devnet] ✅ Loaded backend payer: ${_backendPayer.publicKey.toBase58()}`);
        return _backendPayer;
      } catch {
        console.warn("[Devnet] Failed to parse BACKEND_PAYER_SECRET_KEY, generating new one");
      }
    } else {
      console.warn("[Devnet] BACKEND_PAYER_SECRET_KEY format not recognized (expected base58, base64, or JSON array)");
    }
  }

  _backendPayer = Keypair.generate();
  console.log(`[Devnet] ⚠️ Generated RANDOM backend payer: ${_backendPayer.publicKey.toBase58()}`);
  console.log(`[Devnet] This will NOT work for 8004/ATOM transactions. Set BACKEND_PAYER_SECRET_KEY in .env`);
  return _backendPayer;
}

/**
 * Startup check: verify backend payer has devnet SOL.
 * Call this once when the server starts.
 */
export async function verifyBackendPayer(): Promise<{
  address: string;
  balanceSol: number;
  hasFunds: boolean;
}> {
  const payer = getBackendPayer();
  const address = payer.publicKey.toBase58();

  if (!IS_DEVNET) {
    return { address, balanceSol: 0, hasFunds: true };
  }

  try {
    const balance = await connection.getBalance(payer.publicKey, "confirmed");
    const balanceSol = balance / LAMPORTS_PER_SOL;
    const hasFunds = balanceSol >= 0.1;

    if (hasFunds) {
      console.log(`[Devnet] ✅ Backend payer funded: ${balanceSol.toFixed(3)} SOL`);
    } else {
      console.warn(`[Devnet] ⚠️ Backend payer LOW BALANCE: ${balanceSol.toFixed(3)} SOL. Airdrop needed at ${address}`);
    }

    return { address, balanceSol, hasFunds };
  } catch (err: any) {
    console.error(`[Devnet] Failed to check backend payer balance: ${err.message}`);
    return { address, balanceSol: 0, hasFunds: false };
  }
}

/**
 * Request devnet SOL airdrop for an address.
 * Returns true if successful.
 */
export async function requestDevnetAirdrop(
  address: string | PublicKey,
  solAmount: number = 1
): Promise<boolean> {
  if (!IS_DEVNET) {
    console.warn("[Devnet] Airdrop skipped — not on devnet");
    return false;
  }

  try {
    const pubkey = typeof address === "string" ? new PublicKey(address) : address;
    const signature = await connection.requestAirdrop(
      pubkey,
      Math.floor(solAmount * LAMPORTS_PER_SOL)
    );
    await connection.confirmTransaction(signature, "confirmed");
    console.log(`[Devnet] Airdropped ${solAmount} SOL to ${pubkey.toBase58()}: ${signature}`);
    return true;
  } catch (err: any) {
    console.error(`[Devnet] Airdrop failed: ${err.message}`);
    return false;
  }
}

/**
 * Ensure an address has at least `minSol` balance. Airdrop if needed.
 */
export async function ensureDevnetBalance(
  address: string | PublicKey,
  minSol: number = 0.5
): Promise<boolean> {
  if (!IS_DEVNET) return true;

  try {
    const pubkey = typeof address === "string" ? new PublicKey(address) : address;
    const balance = await connection.getBalance(pubkey, "confirmed");
    const balanceSol = balance / LAMPORTS_PER_SOL;

    if (balanceSol >= minSol) {
      return true;
    }

    const needed = Math.ceil(minSol - balanceSol + 0.1); // buffer
    return requestDevnetAirdrop(pubkey, needed);
  } catch (err: any) {
    console.error(`[Devnet] Balance check failed: ${err.message}`);
    return false;
  }
}

/**
 * Ensure backend payer has enough SOL. Airdrop if needed.
 */
export async function ensureBackendPayerBalance(minSol: number = 1): Promise<boolean> {
  const payer = getBackendPayer();
  return ensureDevnetBalance(payer.publicKey, minSol);
}

/**
 * Get backend payer public key.
 */
export function getBackendPayerAddress(): string {
  return getBackendPayer().publicKey.toBase58();
}

/**
 * Get Solana Explorer URL for an address or transaction.
 */
export function getExplorerUrl(type: "address" | "tx", value: string): string {
  const cluster = IS_DEVNET ? "devnet" : "mainnet-beta";
  return `https://explorer.solana.com/${type}/${value}?cluster=${cluster}`;
}

/**
 * Transfer SOL from backend payer to a recipient.
 * Returns transaction signature or null on failure.
 */
export async function transferSolFromBackend(
  recipient: string | PublicKey,
  solAmount: number
): Promise<string | null> {
  try {
    const payer = getBackendPayer();
    const to = typeof recipient === "string" ? new PublicKey(recipient) : recipient;

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = new (await import("@solana/web3.js")).Transaction({
      recentBlockhash: blockhash,
      feePayer: payer.publicKey,
    }).add(
      (await import("@solana/web3.js")).SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: to,
        lamports: Math.floor(solAmount * LAMPORTS_PER_SOL),
      })
    );

    tx.sign(payer);
    const sig = await connection.sendRawTransaction(tx.serialize({ requireAllSignatures: true }));
    await connection.confirmTransaction(sig, "confirmed");
    console.log(`[Devnet] ✅ Transferred ${solAmount} SOL to ${to.toBase58()}: ${sig}`);
    console.log(`[Devnet]    Explorer: ${getExplorerUrl("tx", sig)}`);
    return sig;
  } catch (err: any) {
    console.error(`[Devnet] ❌ SOL transfer failed: ${err.message}`);
    return null;
  }
}

/**
 * Get backend payer info for health checks.
 */
export async function getBackendPayerInfo(): Promise<{
  address: string;
  balanceSol: number;
  explorerUrl: string;
}> {
  const payer = getBackendPayer();
  const address = payer.publicKey.toBase58();
  const balance = await connection.getBalance(payer.publicKey, "confirmed");
  return {
    address,
    balanceSol: balance / LAMPORTS_PER_SOL,
    explorerUrl: getExplorerUrl("address", address),
  };
}
