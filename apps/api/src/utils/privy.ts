import { PrivyClient } from "@privy-io/server-auth";
import {
  Connection,
  VersionedTransaction,
  clusterApiUrl,
  PublicKey,
  SystemProgram,
  Keypair,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { SOLANA_RPC_URL, SOLANA_COMMITMENT, SOLANA_CAIP2, IS_DEVNET } from "@agent-arena/shared";

const appId = process.env.PRIVY_APP_ID ?? "";
const appSecret = process.env.PRIVY_APP_SECRET ?? "";

export const privy = new PrivyClient(appId, appSecret);

export const solanaConnection = new Connection(
  SOLANA_RPC_URL || clusterApiUrl("devnet"),
  SOLANA_COMMITMENT
);

export async function createAgentWallet(agentName: string) {
  const wallet = await privy.walletApi.create({
    chainType: "solana",
    policyIds: [],
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

export async function fundAgentWallet(
  agentWalletAddress: string,
  solAmount: number = 0.1
): Promise<{ solSig: string }> {
  const treasuryKeypair = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        await Bun.file(`${process.env.HOME}/.config/solana/id.json`).text()
      )
    )
  );

  // Send SOL for transaction fees
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
  const solSig = await solanaConnection.sendRawTransaction(
    tx.serialize({ requireAllSignatures: true })
  );
  await solanaConnection.confirmTransaction(solSig, "confirmed");

  return { solSig };
}

export async function getWalletBalance(
  walletAddress: string
): Promise<{ usdc: number; sol: number }> {
  try {
    const solBalance = await solanaConnection.getBalance(
      new PublicKey(walletAddress)
    );
    const sol = solBalance / 1e9;

    const usdcMint = new PublicKey(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );
    const owner = new PublicKey(walletAddress);

    try {
      const ata = await getAssociatedTokenAddress(usdcMint, owner);
      const accountInfo = await solanaConnection.getTokenAccountBalance(ata);
      return {
        usdc: Number(accountInfo.value.uiAmount ?? 0),
        sol,
      };
    } catch {
      return { usdc: 0, sol };
    }
  } catch {
    return { usdc: 0, sol: 0 };
  }
}
