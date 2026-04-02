import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { SOLANA_RPC_URL, SOLANA_COMMITMENT } from "@agent-arena/shared";
import idl from "./agent_registry.json";

const PROGRAM_ID = new PublicKey(idl.address);
const connection = new Connection(
  SOLANA_RPC_URL || "https://api.devnet.solana.com",
  SOLANA_COMMITMENT
);

// Use discriminator from IDL
function getInstructionDiscriminator(name: string): Buffer {
  const ix = idl.instructions.find((i: any) => i.name === name);
  if (ix?.discriminator) {
    return Buffer.from(ix.discriminator);
  }
  // Fallback: compute from sha256
  const hash = createHash("sha256").update(`global:${name}`).digest();
  return hash.subarray(0, 8);
}

// Hash job UUID to 32 bytes (Solana seed limit is 32 bytes per seed)
function jobIdToSeed(jobId: string): Buffer {
  return createHash("sha256").update(jobId).digest();
}

export function getJobProfilePDA(
  userPubkey: PublicKey,
  jobId: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("job"), userPubkey.toBytes(), jobIdToSeed(jobId)],
    PROGRAM_ID
  );
}

export interface InitializeJobParams {
  userAddress: string;
  agentId: string;
  privyWalletAddress: string;
}

export async function buildInitializeJobTx(
  params: InitializeJobParams
): Promise<Transaction> {
  const user = new PublicKey(params.userAddress);
  const privyWallet = new PublicKey(params.privyWalletAddress);
  const [jobProfilePDA] = getJobProfilePDA(user, params.agentId);

  // Serialize instruction data: discriminator + agent_id (borsh String) + privy_wallet (32 bytes)
  const agentIdBytes = Buffer.from(params.agentId, "utf-8");
  const privyWalletBytes = privyWallet.toBuffer();

  // Borsh String: 4-byte LE length prefix + UTF-8 bytes
  const agentIdLen = Buffer.alloc(4);
  agentIdLen.writeUInt32LE(agentIdBytes.length);

  const data = Buffer.concat([
    getInstructionDiscriminator("initialize_job"),
    agentIdLen,
    agentIdBytes,
    privyWalletBytes,
  ]);

  const keys = [
    { pubkey: jobProfilePDA, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: user,
  }).add(ix);

  return tx;
}

export async function getJobProfile(pdaAddress: string) {
  try {
    const accountInfo = await connection.getAccountInfo(
      new PublicKey(pdaAddress)
    );
    if (!accountInfo) return null;

    // Skip 8-byte discriminator
    const data = accountInfo.data.subarray(8);

    // Parse JobProfile: Pubkey(32) + String(4+len) + Pubkey(32) + i64(8) + u8(1)
    let offset = 0;

    // user_pubkey: Pubkey (32 bytes)
    const userPubkey = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    // agent_id: String (4-byte LE length + UTF-8 bytes)
    const agentIdLen = data.readUInt32LE(offset);
    offset += 4;
    const agentId = data.subarray(offset, offset + agentIdLen).toString("utf-8");
    offset += agentIdLen;

    // privy_wallet_pubkey: Pubkey (32 bytes)
    const privyWalletPubkey = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    // created_at: i64 (8 bytes LE)
    const createdAt = Number(data.readBigInt64LE(offset));
    offset += 8;

    // bump: u8 (1 byte)
    const bump = data[offset];

    return {
      userPubkey: userPubkey.toBase58(),
      agentId,
      privyWalletPubkey: privyWalletPubkey.toBase58(),
      createdAt,
      bump,
      pda: pdaAddress,
    };
  } catch {
    return null;
  }
}

export async function jobProfileExists(
  userAddress: string,
  agentId: string
): Promise<boolean> {
  const [pda] = getJobProfilePDA(new PublicKey(userAddress), agentId);
  const profile = await getJobProfile(pda.toBase58());
  return profile !== null;
}
