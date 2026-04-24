import { PrivyClient } from "@privy-io/server-auth";
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  Keypair,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
} from "@solana/spl-token";
import {
  SOLANA_RPC_URL,
  SOLANA_COMMITMENT,
  SOLANA_CAIP2,
  USDC_MINT,
  IS_DEVNET,
} from "@agent-arena/shared";

// ═══════════════════════════════════════════════════════════════
// Privy Agentic Wallet Integration
// Upgraded from static policies to dynamic, job-specific policies
// ═══════════════════════════════════════════════════════════════

const appId = process.env.PRIVY_APP_ID ?? "";
const appSecret = process.env.PRIVY_APP_SECRET ?? "";

export const privy = new PrivyClient(appId, appSecret);

export const solanaConnection = new Connection(
  SOLANA_RPC_URL || (IS_DEVNET ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com"),
  SOLANA_COMMITMENT
);

// Jupiter Predict program (for policy allowlisting)
const JUPITER_PREDICT_PROGRAM = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

// ── Types ──────────────────────────────────────────────────────

export type PolicyMethod =
  | "eth_signTransaction"
  | "eth_sendTransaction"
  | "eth_signTypedData_v4"
  | "eth_sign7702Authorization"
  | "signAndSendTransaction"
  | "signTransaction"
  | "signMessage"
  | "personal_sign"
  | "exportPrivateKey"
  | "*";

export type PolicyActionType = "ALLOW" | "DENY";

export interface AgenticPolicyCondition {
  field_source:
    | "solana_program_instruction"
    | "solana_system_program_instruction"
    | "solana_token_program_instruction"
    | "ethereum_transaction"
    | "system";
  field: string;
  operator: "eq" | "gt" | "gte" | "lt" | "lte" | "in" | "in_condition_set";
  value: string | number | string[];
}

export interface AgenticPolicyRule {
  name: string;
  method: PolicyMethod;
  conditions: AgenticPolicyCondition[];
  action: PolicyActionType;
}

export interface JobPolicyConfig {
  jobId: string;
  maxBudgetUsdc: number;
  dailyCapUsdc?: number;
  durationDays: number;
  allowedPrograms?: string[];
  denySolTransfers?: boolean;
  denyKeyExport?: boolean;
}

// ── Wallet Operations ──────────────────────────────────────────

export async function createAgentWallet(agentName: string, policyIds: string[] = []) {
  const wallet = await privy.walletApi.create({
    chainType: "solana",
    policyIds,
  });
  return wallet;
}

export async function signSolanaTransaction(
  walletId: string,
  transactionBase64: string
): Promise<string> {
  const txBytes = Buffer.from(transactionBase64, "base64");
  const tx = VersionedTransaction.deserialize(txBytes);

  const { hash } = await privy.walletApi.solana.signAndSendTransaction({
    walletId,
    caip2: SOLANA_CAIP2,
    transaction: tx,
  });

  return hash;
}

export async function getWalletBalance(
  walletAddress: string
): Promise<{ usdc: number; sol: number }> {
  try {
    const solBalance = await solanaConnection.getBalance(new PublicKey(walletAddress));
    const sol = solBalance / 1e9;

    const usdcMint = new PublicKey(USDC_MINT);
    const owner = new PublicKey(walletAddress);

    try {
      const ata = await getAssociatedTokenAddress(usdcMint, owner);
      const accountInfo = await solanaConnection.getTokenAccountBalance(ata);
      return { usdc: Number(accountInfo.value.uiAmount ?? 0), sol };
    } catch {
      return { usdc: 0, sol };
    }
  } catch {
    return { usdc: 0, sol: 0 };
  }
}

export async function fundAgentWallet(
  agentWalletAddress: string,
  solAmount: number = 0.1
): Promise<{ solSig: string }> {
  const treasuryKeypair = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(await Bun.file(`${process.env.HOME}/.config/solana/id.json`).text())
    )
  );

  const solIx = SystemProgram.transfer({
    fromPubkey: treasuryKeypair.publicKey,
    toPubkey: new PublicKey(agentWalletAddress),
    lamports: Math.floor(solAmount * LAMPORTS_PER_SOL),
  });

  const { blockhash } = await solanaConnection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: treasuryKeypair.publicKey,
  }).add(solIx);

  tx.sign(treasuryKeypair);
  const solSig = await solanaConnection.sendRawTransaction(tx.serialize({ requireAllSignatures: true }));
  await solanaConnection.confirmTransaction(solSig, "confirmed");

  return { solSig };
}

/**
 * Return USDC from agent wallet back to client.
 * Used on job cancellation/completion.
 */
export async function returnUsdcToClient(
  agentWalletId: string,
  agentWalletAddress: string,
  clientAddress: string,
  amountUsdc: number
): Promise<string | null> {
  try {
    const usdcMint = new PublicKey(USDC_MINT);
    const agentAta = await getAssociatedTokenAddress(usdcMint, new PublicKey(agentWalletAddress));
    const clientAta = await getAssociatedTokenAddress(usdcMint, new PublicKey(clientAddress));

    const ix = createTransferInstruction(
      agentAta,
      clientAta,
      new PublicKey(agentWalletAddress),
      Math.floor(amountUsdc * 1e6)
    );

    const { blockhash } = await solanaConnection.getLatestBlockhash("confirmed");
    const msg = new Transaction({
      recentBlockhash: blockhash,
      feePayer: new PublicKey(agentWalletAddress),
    }).add(ix);

    // Serialize for Privy to sign
    const serialized = msg.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    const signature = await privy.walletApi.solana.signAndSendTransaction({
      walletId: agentWalletId,
      caip2: SOLANA_CAIP2,
      transaction: VersionedTransaction.deserialize(serialized),
    });

    return signature.hash;
  } catch (err) {
    console.error("[PrivyAgentic] returnUsdcToClient error:", err);
    return null;
  }
}

// ── Policy Engine ──────────────────────────────────────────────

async function createPolicy(params: {
  name: string;
  rules: AgenticPolicyRule[];
}): Promise<string> {
  const policy = await privy.walletApi.createPolicy({
    version: "1.0",
    name: params.name,
    chainType: "solana",
    rules: params.rules as any,
  });
  return policy.id;
}

/**
 * Create a dynamic, job-specific Agentic Wallet policy.
 * Enforces: budget cap, program allowlist, time bounds, key restrictions.
 */
export async function createJobPolicy(config: JobPolicyConfig): Promise<string> {
  const expiryTimestamp = Math.floor(Date.now() / 1000) + config.durationDays * 86400;
  const allowed = config.allowedPrograms ?? [
    JUPITER_PREDICT_PROGRAM,
    COMPUTE_BUDGET_PROGRAM,
    SPL_TOKEN_PROGRAM,
    ASSOCIATED_TOKEN_PROGRAM,
  ];

  const maxBudgetMicroCents = Math.floor(config.maxBudgetUsdc * 1e6);
  const dailyCapMicroCents = config.dailyCapUsdc
    ? Math.floor(config.dailyCapUsdc * 1e6)
    : maxBudgetMicroCents;

  const rules: AgenticPolicyRule[] = [
    {
      name: "Deny key export",
      method: "exportPrivateKey",
      conditions: [],
      action: "DENY",
    },
    {
      name: "Allow only approved programs",
      method: "signAndSendTransaction",
      conditions: [
        {
          field_source: "solana_program_instruction",
          field: "programId",
          operator: "in",
          value: allowed,
        },
      ],
      action: "ALLOW",
    },
    {
      name: "Max per-transfer budget",
      method: "signAndSendTransaction",
      conditions: [
        {
          field_source: "solana_token_program_instruction",
          field: "TransferChecked.amount",
          operator: "lte",
          value: String(maxBudgetMicroCents),
        },
      ],
      action: "ALLOW",
    },
    {
      name: "Time-bound: job expiry",
      method: "signAndSendTransaction",
      conditions: [
        {
          field_source: "system",
          field: "current_unix_timestamp",
          operator: "lte",
          value: expiryTimestamp,
        },
      ],
      action: "ALLOW",
    },
  ];

  if (config.denySolTransfers) {
    rules.push({
      name: "Deny direct SOL transfers",
      method: "signAndSendTransaction",
      conditions: [
        {
          field_source: "solana_system_program_instruction",
          field: "instructionName",
          operator: "eq",
          value: "Transfer",
        },
      ],
      action: "DENY",
    });
  }

  // Final catch-all deny
  rules.push({
    name: "Deny all other transactions",
    method: "signAndSendTransaction",
    conditions: [],
    action: "DENY",
  });

  return createPolicy({
    name: `agent-arena-job-${config.jobId}-${Date.now()}`,
    rules,
  });
}

/**
 * Update an existing policy (e.g., top up budget).
 * Note: Privy policies are immutable; we create a new one and attach it.
 */
export async function updateJobPolicy(
  walletId: string,
  oldPolicyId: string,
  config: JobPolicyConfig
): Promise<string> {
  // Delete old policy
  try {
    await privy.walletApi.deletePolicy({ id: oldPolicyId });
  } catch {
    // ignore if already deleted
  }

  // Create new policy with updated limits
  const newPolicyId = await createJobPolicy(config);

  // Update wallet policies
  await privy.walletApi.updateWallet({
    id: walletId,
    policyIds: [newPolicyId],
  });

  return newPolicyId;
}

/**
 * Revoke a policy (emergency stop).
 */
export async function revokePolicy(policyId: string): Promise<void> {
  await privy.walletApi.deletePolicy({ id: policyId });
}

/**
 * Create a complete Agentic Wallet for a job:
 * wallet + policy + optional funding.
 */
export async function createAgenticWalletForJob(config: JobPolicyConfig & {
  agentName: string;
  fundSol?: number;
}): Promise<{
  walletId: string;
  walletAddress: string;
  policyId: string;
}> {
  const policyId = await createJobPolicy(config);
  console.log(`[PrivyAgentic] Created job policy ${policyId} for job ${config.jobId}`);

  const wallet = await createAgentWallet(config.agentName, [policyId]);
  console.log(`[PrivyAgentic] Created wallet ${wallet.address} for job ${config.jobId}`);

  if (config.fundSol && config.fundSol > 0) {
    try {
      const { solSig } = await fundAgentWallet(wallet.address, config.fundSol);
      console.log(`[PrivyAgentic] Funded wallet with ${config.fundSol} SOL: ${solSig}`);
    } catch (err: any) {
      console.error(`[PrivyAgentic] Failed to fund wallet: ${err.message}`);
    }
  }

  return {
    walletId: wallet.id,
    walletAddress: wallet.address,
    policyId,
  };
}

/**
 * Get policy details by ID.
 */
export async function getPolicy(policyId: string) {
  return privy.walletApi.getPolicy({ id: policyId });
}
