import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { SOLANA_RPC_URL } from "@agent-arena/shared";
import type { AgentRegistry } from "./agent_registry";
import idl from "./agent_registry.json";
import { privy, solanaConnection, signSolanaTransaction } from "../utils/privy";

const PROGRAM_ID = new PublicKey(idl.address);

export function getProgram(wallet?: anchor.Wallet) {
  const provider = new anchor.AnchorProvider(
    solanaConnection,
    (wallet ?? {}) as anchor.Wallet,
    { commitment: "confirmed" }
  );
  return new anchor.Program<AgentRegistry>(idl as AgentRegistry, provider);
}

export function getAgentProfilePDA(ownerPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), ownerPubkey.toBytes()],
    PROGRAM_ID
  );
}

const CATEGORY_MAP: Record<string, number> = {
  geo: 0,
  politics: 1,
  sports: 2,
};

const PRICING_TYPE_MAP: Record<string, number> = {
  subscription: 0,
  per_trade: 1,
  profit_share: 2,
};

export interface RegisterAgentParams {
  ownerAddress: string;
  name: string;
  category: string;
  description: string;
  pricingModel: {
    type: string;
    amount: number;
  };
  capabilities: string[];
  maxCap: number;
  dailyCap: number;
  totalCap: number;
}

export async function buildRegisterAgentTx(
  params: RegisterAgentParams
): Promise<Transaction> {
  const program = getProgram();
  const owner = new PublicKey(params.ownerAddress);
  const [agentPDA] = getAgentProfilePDA(owner);

  const category = CATEGORY_MAP[params.category] ?? 0;
  const pricingType = PRICING_TYPE_MAP[params.pricingModel.type] ?? 0;
  const pricingAmount = new anchor.BN(params.pricingModel.amount * 1e6); // USDC has 6 decimals
  const maxCap = new anchor.BN(params.maxCap * 1e6);
  const dailyCap = new anchor.BN(params.dailyCap * 1e6);
  const totalCap = new anchor.BN(params.totalCap * 1e6);

  const ix = await program.methods
    .registerAgent(
      params.name,
      category,
      params.description,
      pricingType,
      pricingAmount,
      params.capabilities,
      maxCap,
      dailyCap,
      totalCap
    )
    .accounts({
      agentProfile: agentPDA,
      owner: owner,
      systemProgram: SystemProgram.programId,
    } as any)
    .instruction();

  const { blockhash } = await solanaConnection.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: owner,
  }).add(ix);

  return tx;
}

export async function registerAgentWithPrivy(
  privyWalletId: string,
  params: RegisterAgentParams
): Promise<{ signature: string; agentPDA: string }> {
  const tx = await buildRegisterAgentTx(params);

  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  const base64 = serialized.toString("base64");

  const signature = await signSolanaTransaction(privyWalletId, base64);
  const [agentPDA] = getAgentProfilePDA(new PublicKey(params.ownerAddress));

  return { signature, agentPDA: agentPDA.toBase58() };
}

export async function getAgentProfile(ownerAddress: string) {
  const program = getProgram();
  const [agentPDA] = getAgentProfilePDA(new PublicKey(ownerAddress));

  try {
    const account = await (program.account as any).agentProfile.fetch(agentPDA);
    return {
      authority: account.authority.toBase58(),
      name: account.name,
      category: account.category,
      description: account.description,
      pricingModelType: account.pricingModelType,
      pricingAmount: account.pricingAmount.toString(),
      capabilities: account.capabilities,
      maxCap: account.maxCap.toString(),
      dailyCap: account.dailyCap.toString(),
      totalCap: account.totalCap.toString(),
      dailySpent: account.dailySpent.toString(),
      totalSpent: account.totalSpent.toString(),
      isActive: account.isActive,
      isVerified: account.isVerified,
      registrationTime: account.registrationTime.toNumber(),
      pda: agentPDA.toBase58(),
    };
  } catch {
    return null;
  }
}

export async function agentProfileExists(
  ownerAddress: string
): Promise<boolean> {
  const profile = await getAgentProfile(ownerAddress);
  return profile !== null;
}
