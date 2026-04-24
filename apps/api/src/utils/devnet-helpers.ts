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
// Set BACKEND_PAYER_SECRET_KEY as base64-encoded secret key, or one will be generated
let _backendPayer: Keypair | null = null;

export function getBackendPayer(): Keypair {
  if (_backendPayer) return _backendPayer;

  const envKey = process.env.BACKEND_PAYER_SECRET_KEY;
  if (envKey) {
    try {
      const secretKey = Buffer.from(envKey, "base64");
      _backendPayer = Keypair.fromSecretKey(secretKey);
      console.log(`[Devnet] Loaded backend payer: ${_backendPayer.publicKey.toBase58()}`);
      return _backendPayer;
    } catch {
      console.warn("[Devnet] Failed to parse BACKEND_PAYER_SECRET_KEY, generating new one");
    }
  }

  _backendPayer = Keypair.generate();
  console.log(`[Devnet] Generated backend payer: ${_backendPayer.publicKey.toBase58()}`);
  console.log(`[Devnet] SAVE THIS KEY (BACKEND_PAYER_SECRET_KEY): ${Buffer.from(_backendPayer.secretKey).toString("base64")}`);
  return _backendPayer;
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
 * Transfer SOL from backend payer to a recipient.
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
    console.log(`[Devnet] Transferred ${solAmount} SOL to ${to.toBase58()}: ${sig}`);
    return sig;
  } catch (err: any) {
    console.error(`[Devnet] SOL transfer failed: ${err.message}`);
    return null;
  }
}
