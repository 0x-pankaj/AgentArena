import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Keypair,
} from "@solana/web3.js";
import { SOLANA_RPC_URL, SOLANA_COMMITMENT } from "@agent-arena/shared";
import { getBackendPayer, ensureBackendPayerBalance } from "./devnet-helpers";

// ═══════════════════════════════════════════════════════════════
// ATOM Reputation Engine Integration
// Direct Anchor integration with ATOM program via 8004 CPI
// ═══════════════════════════════════════════════════════════════

const ATOM_ENGINE_PROGRAM_ID = new PublicKey(
  "AToMufS4QD6hEXvcvBDg9m1AHeCLpmZQsyfYa5h9MwAF"
);

const REGISTRY_PROGRAM_ID = new PublicKey(
  "8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C"
);

const connection = new Connection(
  SOLANA_RPC_URL || "https://api.devnet.solana.com",
  SOLANA_COMMITMENT
);

// ATOM Tag enum (from spec)
export enum AtomTag {
  uptime = 0,
  profit = 1,
  loss = 2,
  response_time = 3,
  accuracy = 4,
  day = 5,
  week = 6,
  month = 7,
}

// ATOM Stats account layout (approximate — 460 bytes)
interface AtomStats {
  feedbackCount: number;
  qualityScore: number; // EMA 0-100
  hllPacked: Buffer; // 128 bytes
  hllSalt: Buffer; // 8 bytes
  recentCallers: Buffer; // ring buffer
  evictionCursor: number;
  trustTier: number;
  confidence: number;
  riskScore: number;
  diversityRatio: number;
}

// Trust tiers (from ATOM spec)
export const TRUST_TIERS = [
  "Unknown",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Legendary",
] as const;

export type TrustTier = (typeof TRUST_TIERS)[number];

function getInstructionDiscriminator(name: string): Buffer {
  const hash = require("crypto").createHash("sha256").update(`global:${name}`).digest();
  return hash.subarray(0, 8);
}

export function getAtomStatsPDA(agentAsset: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("atom_stats"), agentAsset.toBytes()],
    ATOM_ENGINE_PROGRAM_ID
  );
}

// ── Types ──────────────────────────────────────────────────────

export interface FeedbackParams {
  agentAsset: string;
  value: string; // e.g. "99.77" for uptime, "23.50" for profit%
  tag1: AtomTag;
  tag2?: AtomTag;
  reviewerAddress: string;
}

export interface AtomSummary {
  trustTier: TrustTier;
  qualityScore: number;
  feedbackCount: number;
  uniqueClients: number;
  confidence: number;
  riskScore: number;
  diversityRatio: number;
}

// ── Core Functions ─────────────────────────────────────────────

/**
 * Build ATOM feedback transaction (unsigned, for frontend signing).
 */
export async function buildAtomFeedbackTx(
  params: FeedbackParams
): Promise<{ txBase64: string; statsPDA: string } | null> {
  try {
    const agentAsset = new PublicKey(params.agentAsset);
    const reviewer = new PublicKey(params.reviewerAddress);
    const [atomStats] = getAtomStatsPDA(agentAsset);

    const valueBytes = Buffer.from(params.value, "utf-8");
    const data = Buffer.concat([
      getInstructionDiscriminator("giveFeedback"),
      (() => { const b = Buffer.alloc(4); b.writeUInt32LE(valueBytes.length); return b; })(),
      valueBytes,
      Buffer.from([params.tag1]),
      Buffer.from([params.tag2 ?? AtomTag.day]),
    ]);

    const keys = [
      { pubkey: agentAsset, isSigner: false, isWritable: false },
      { pubkey: atomStats, isSigner: false, isWritable: true },
      { pubkey: reviewer, isSigner: true, isWritable: true },
      { pubkey: REGISTRY_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const ix = new TransactionInstruction({ keys, programId: ATOM_ENGINE_PROGRAM_ID, data });
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: reviewer }).add(ix);

    return {
      txBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
      statsPDA: atomStats.toBase58(),
    };
  } catch (err) {
    console.error("[ATOM] buildAtomFeedbackTx error:", err);
    return null;
  }
}

/**
 * Submit feedback to ATOM reputation engine using backend signer.
 * For hackathon traction: backend acts as reputation oracle.
 */
export async function submitAtomFeedback(
  params: FeedbackParams
): Promise<{ txSignature: string; statsPDA: string } | null> {
  try {
    await ensureBackendPayerBalance(0.1);
    const payer = getBackendPayer();

    const agentAsset = new PublicKey(params.agentAsset);
    const [atomStats] = getAtomStatsPDA(agentAsset);

    const valueBytes = Buffer.from(params.value, "utf-8");
    const data = Buffer.concat([
      getInstructionDiscriminator("giveFeedback"),
      (() => { const b = Buffer.alloc(4); b.writeUInt32LE(valueBytes.length); return b; })(),
      valueBytes,
      Buffer.from([params.tag1]),
      Buffer.from([params.tag2 ?? AtomTag.day]),
    ]);

    const keys = [
      { pubkey: agentAsset, isSigner: false, isWritable: false },
      { pubkey: atomStats, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: REGISTRY_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const ix = new TransactionInstruction({ keys, programId: ATOM_ENGINE_PROGRAM_ID, data });
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: payer.publicKey }).add(ix);

    tx.sign(payer);
    const txSignature = await connection.sendRawTransaction(tx.serialize({ requireAllSignatures: true }));
    await connection.confirmTransaction(txSignature, "confirmed");

    console.log(`[ATOM] Feedback submitted: ${txSignature} for agent ${params.agentAsset}`);
    return { txSignature, statsPDA: atomStats.toBase58() };
  } catch (err) {
    console.error("[ATOM] submitAtomFeedback error:", err);
    return null;
  }
}

/**
 * Revoke previously submitted feedback.
 */
export async function revokeAtomFeedback(
  agentAsset: string,
  feedbackIndex: number,
  reviewerAddress: string
): Promise<string | null> {
  try {
    const asset = new PublicKey(agentAsset);
    const reviewer = new PublicKey(reviewerAddress);
    const [atomStats] = getAtomStatsPDA(asset);

    const data = Buffer.concat([
      getInstructionDiscriminator("revokeFeedback"),
      (() => { const b = Buffer.alloc(4); b.writeUInt32LE(feedbackIndex); return b; })(),
    ]);

    const keys = [
      { pubkey: asset, isSigner: false, isWritable: false },
      { pubkey: atomStats, isSigner: false, isWritable: true },
      { pubkey: reviewer, isSigner: true, isWritable: false },
    ];

    const ix = new TransactionInstruction({ keys, programId: ATOM_ENGINE_PROGRAM_ID, data });
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: reviewer }).add(ix);

    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  } catch {
    return null;
  }
}

/**
 * Fetch ATOM summary for an agent.
 * Returns tier, score, and stats from on-chain account.
 */
export async function getAtomSummary(agentAsset: string): Promise<AtomSummary | null> {
  try {
    const [atomStats] = getAtomStatsPDA(new PublicKey(agentAsset));
    const account = await connection.getAccountInfo(atomStats);
    if (!account) {
      // Agent hasn't received feedback yet
      return {
        trustTier: "Unknown",
        qualityScore: 0,
        feedbackCount: 0,
        uniqueClients: 0,
        confidence: 0,
        riskScore: 0,
        diversityRatio: 0,
      };
    }

    // Parse AtomStats account data
    // Layout: discriminator(8) + feedback_count(u64) + quality_score(u64) + hll(128) + salt(8) + ...
    const data = account.data.subarray(8);

    const feedbackCount = Number(data.readBigUInt64LE(0));
    const qualityScoreRaw = Number(data.readBigUInt64LE(8));
    const qualityScore = qualityScoreRaw / 1e4; // scaled by 10000

    // HLL unique client estimate (simplified)
    const hllPacked = data.subarray(16, 144);
    const uniqueClients = estimateHllCardinality(hllPacked);

    // Trust tier from cached field (offset varies by version — adjust as needed)
    const trustTierIndex = data[300] ?? 0;
    const confidence = Number(data.readBigUInt64LE(304)) / 1e4;
    const riskScore = Number(data.readBigUInt64LE(312)) / 1e4;
    const diversityRatio = Number(data.readBigUInt64LE(320)) / 1e4;

    return {
      trustTier: TRUST_TIERS[Math.min(trustTierIndex, TRUST_TIERS.length - 1)],
      qualityScore: Math.round(qualityScore * 100) / 100,
      feedbackCount,
      uniqueClients,
      confidence: Math.round(confidence * 100) / 100,
      riskScore: Math.round(riskScore * 100) / 100,
      diversityRatio: Math.round(diversityRatio * 100) / 100,
    };
  } catch (err) {
    console.error("[ATOM] getAtomSummary error:", err);
    return null;
  }
}

/**
 * Simple HLL cardinality estimate.
 * Real ATOM uses 256 registers, 4-bit packed.
 * This is a rough approximation for demo purposes.
 */
function estimateHllCardinality(packed: Buffer): number {
  try {
    let maxZeros = 0;
    for (let i = 0; i < packed.length; i++) {
      const byte = packed[i];
      if (byte === 0) {
        maxZeros++;
      }
    }
    // Very rough: use linear approximation
    return Math.max(1, Math.floor(maxZeros * 2.5));
  } catch {
    return 0;
  }
}

/**
 * Format a trust tier with emoji for UI display.
 */
export function formatTrustTier(tier: TrustTier): string {
  const emojis: Record<TrustTier, string> = {
    Unknown: "⚪",
    Bronze: "🥉",
    Silver: "🥈",
    Gold: "🥇",
    Platinum: "💎",
    Legendary: "👑",
  };
  return `${emojis[tier]} ${tier}`;
}

/**
 * Get trust tier color for UI.
 */
export function getTrustTierColor(tier: TrustTier): string {
  const colors: Record<TrustTier, string> = {
    Unknown: "#9CA3AF",
    Bronze: "#CD7F32",
    Silver: "#C0C0C0",
    Gold: "#FFD700",
    Platinum: "#E5E4E2",
    Legendary: "#FF4500",
  };
  return colors[tier];
}

/**
 * Compute a composite reputation score (0-100) from ATOM summary.
 */
export function computeReputationScore(summary: AtomSummary): number {
  const tierWeights: Record<TrustTier, number> = {
    Unknown: 0,
    Bronze: 20,
    Silver: 40,
    Gold: 60,
    Platinum: 80,
    Legendary: 100,
  };

  const tierScore = tierWeights[summary.trustTier];
  const qualityScore = summary.qualityScore; // 0-100
  const diversityBonus = Math.min(summary.diversityRatio * 20, 20);

  return Math.round((tierScore * 0.4 + qualityScore * 0.4 + diversityBonus) * 100) / 100;
}
