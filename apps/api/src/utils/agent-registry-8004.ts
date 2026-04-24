import { PublicKey, Transaction, Keypair } from "@solana/web3.js";
import {
  SolanaSDK,
  Tag,
  getAtomStatsPDA,
  getBaseCollection,
  fetchRegistryConfig,
  IPFSClient,
} from "8004-solana";
import { SOLANA_RPC_URL, SOLANA_COMMITMENT, IS_DEVNET } from "@agent-arena/shared";

// ═══════════════════════════════════════════════════════════════
// 8004 Solana Agent Registry Integration
// Uses the official 8004-solana SDK with Pinata IPFS support
// ═══════════════════════════════════════════════════════════════

// Network-specific defaults
const CLUSTER = IS_DEVNET ? "devnet" : "mainnet-beta";

// Program IDs (from 8004-solana official deployment)
const REGISTRY_PROGRAM_ID = new PublicKey(
  "8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C"
);

const ATOM_ENGINE_PROGRAM_ID = new PublicKey(
  "AToMufS4QD6hEXvcvBDg9m1AHeCLpmZQsyfYa5h9MwAF"
);

// Devnet base collection (from official 8004-solana deployment)
const DEVNET_BASE_COLLECTION = new PublicKey(
  "C6W2bq4BoVT8FDvqhdp3sbcHFBjNBXE8TsNak2wTXQs9"
);

// Pinata JWT for IPFS uploads (set PINATA_JWT env var for production)
const PINATA_JWT = process.env.PINATA_JWT ?? "";

// ── Types ──────────────────────────────────────────────────────

export interface AgentMetadata {
  name: string;
  description: string;
  image?: string;
  category: string;
  capabilities: string[];
  pricingModel: {
    type: string;
    amount: number;
  };
  socials?: {
    twitter?: string;
    github?: string;
    website?: string;
  };
}

export interface RegisterAgentResult {
  agentAsset: string;
  atomStats: string;
  txSignature?: string;
}

// ── SDK Factory ────────────────────────────────────────────────

function createSDK(signer?: Keypair): SolanaSDK {
  const ipfsClient = PINATA_JWT
    ? new IPFSClient({ pinataEnabled: true, pinataJwt: PINATA_JWT })
    : undefined;

  return new SolanaSDK({
    cluster: CLUSTER as any,
    rpcUrl: SOLANA_RPC_URL,
    signer,
    ipfsClient,
  });
}

// ── IPFS Upload Helper ─────────────────────────────────────────

let ipfsClient: IPFSClient | undefined;

function getIPFSClient(): IPFSClient | undefined {
  if (!ipfsClient && PINATA_JWT) {
    ipfsClient = new IPFSClient({ pinataEnabled: true, pinataJwt: PINATA_JWT });
  }
  return ipfsClient;
}

async function uploadMetadata(metadata: any): Promise<string> {
  const client = getIPFSClient();
  if (client) {
    const cid = await client.addJson(metadata);
    return `ipfs://${cid}`;
  }
  // Fallback: data URI (works for hackathon, not ideal for production)
  const metadataJson = JSON.stringify(metadata);
  return `data:application/json;base64,${Buffer.from(metadataJson).toString("base64")}`;
}

// ── Core Functions ─────────────────────────────────────────────

/**
 * Get the 8004 base collection address for the current network.
 */
export async function get8004Collection(): Promise<PublicKey> {
  if (IS_DEVNET) {
    return DEVNET_BASE_COLLECTION;
  }
  const sdk = createSDK();
  const config = await fetchRegistryConfig(sdk["connection"] as any, REGISTRY_PROGRAM_ID);
  return config.collectionMint;
}

/**
 * Register a new agent on the 8004 Solana Agent Registry.
 */
export async function registerAgentOn8004(
  params: {
    ownerAddress: string;
    metadata: AgentMetadata;
    atomEnabled?: boolean;
    payerKeypair?: Keypair;
  }
): Promise<RegisterAgentResult> {
  const sdk = createSDK(params.payerKeypair);
  const collection = await get8004Collection();

  const agentMeta = {
    name: params.metadata.name,
    description: params.metadata.description,
    image: params.metadata.image ?? "",
    services: [
      { type: "website", value: params.metadata.socials?.website ?? "" },
      { type: "x", value: params.metadata.socials?.twitter ?? "" },
    ],
    skills: params.metadata.capabilities,
    domains: [params.metadata.category],
  };

  const metadataUri = await uploadMetadata(agentMeta);

  const agent = await sdk.registerAgent(metadataUri, {
    collectionPointer: collection.toBase58(),
    atomEnabled: params.atomEnabled ?? true,
  });

  const [atomStats] = getAtomStatsPDA(agent.asset);

  return {
    agentAsset: agent.asset.toBase58(),
    atomStats: atomStats.toBase58(),
  };
}

/**
 * Build a register transaction for frontend signing.
 */
export async function buildRegisterAgentTx8004(
  params: {
    ownerAddress: string;
    metadata: AgentMetadata;
    atomEnabled?: boolean;
  }
): Promise<Transaction> {
  const sdk = createSDK();
  const collection = await get8004Collection();

  const agentMeta = {
    name: params.metadata.name,
    description: params.metadata.description,
    image: params.metadata.image ?? "",
    services: [
      { type: "website", value: params.metadata.socials?.website ?? "" },
      { type: "x", value: params.metadata.socials?.twitter ?? "" },
    ],
    skills: params.metadata.capabilities,
    domains: [params.metadata.category],
  };

  const metadataUri = await uploadMetadata(agentMeta);

  const result = await sdk.registerAgent(metadataUri, {
    collectionPointer: collection.toBase58(),
    atomEnabled: params.atomEnabled ?? true,
    skipSend: true,
  });

  return result.transaction ?? new Transaction();
}

/**
 * Check if an agent is registered on 8004.
 */
export async function isAgentRegisteredOn8004(ownerAddress: string): Promise<boolean> {
  try {
    const sdk = createSDK();
    const owner = new PublicKey(ownerAddress);
    const agents = await sdk.getAgentsByOwner(owner);
    return agents.length > 0;
  } catch {
    return false;
  }
}

/**
 * Fetch agent asset data from 8004 registry.
 */
export async function fetchAgentAsset(ownerAddress: string): Promise<{
  assetAddress: string;
  owner: string;
  metadataUri: string;
  atomEnabled: boolean;
  createdAt: number;
} | null> {
  try {
    const sdk = createSDK();
    const owner = new PublicKey(ownerAddress);
    const agents = await sdk.getAgentsByOwner(owner);

    if (agents.length === 0) return null;

    const agent = agents[0];
    const asset = await sdk.loadAgent(agent.asset);

    return {
      assetAddress: agent.asset.toBase58(),
      owner: ownerAddress,
      metadataUri: asset.metadata?.uri ?? "",
      atomEnabled: agent.atomEnabled ?? false,
      createdAt: 0,
    };
  } catch {
    return null;
  }
}

/**
 * Update agent metadata on 8004.
 */
export async function updateAgentMetadata8004(
  ownerAddress: string,
  newMetadata: AgentMetadata
): Promise<string | null> {
  try {
    const sdk = createSDK();
    const owner = new PublicKey(ownerAddress);
    const agents = await sdk.getAgentsByOwner(owner);

    if (agents.length === 0) return null;

    const agentMeta = {
      name: newMetadata.name,
      description: newMetadata.description,
      image: newMetadata.image ?? "",
      services: [
        { type: "website", value: newMetadata.socials?.website ?? "" },
        { type: "x", value: newMetadata.socials?.twitter ?? "" },
      ],
      skills: newMetadata.capabilities,
      domains: [newMetadata.category],
    };

    const metadataUri = await uploadMetadata(agentMeta);

    const result = await sdk.setAgentURI(agents[0].asset, metadataUri, { skipSend: true });
    return result.transaction?.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64") ?? null;
  } catch {
    return null;
  }
}

/**
 * Enable ATOM for an existing 8004 agent (one-way, irreversible).
 */
export async function enableAtomForAgent(ownerAddress: string): Promise<string | null> {
  try {
    const sdk = createSDK();
    const owner = new PublicKey(ownerAddress);
    const agents = await sdk.getAgentsByOwner(owner);

    if (agents.length === 0) return null;

    await sdk.enableAtom(agents[0].asset);
    return agents[0].asset.toBase58();
  } catch {
    return null;
  }
}

/**
 * Get the explorer URL for an agent asset.
 */
export function getAgentExplorerUrl(assetAddress: string): string {
  const cluster = IS_DEVNET ? "devnet" : "mainnet-beta";
  return `https://explorer.solana.com/address/${assetAddress}?cluster=${cluster}`;
}

// Re-export SDK types for convenience
export { Tag, getAtomStatsPDA };
