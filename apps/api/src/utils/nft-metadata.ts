import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { fromWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters";
import { fetchAsset, fetchCollection } from "@metaplex-foundation/mpl-core";
import { PublicKey } from "@solana/web3.js";
import { connection } from "./agent-registry-8004";

export interface NftMetadata {
  image?: string;
  name?: string;
  description?: string;
  attributes?: Array<{ trait_type: string; value: string }>;
  symbol?: string;
  uri?: string;
}

export async function fetchAgentNftMetadata(assetAddress: string): Promise<NftMetadata | null> {
  try {
    const umi = createUmi(connection.rpcEndpoint);
    const assetPubkey = fromWeb3JsPublicKey(new PublicKey(assetAddress));

    const asset = await fetchAsset(umi, assetPubkey);
    if (!asset) return null;

    // Try to fetch metadata from URI if available
    let metadata: NftMetadata = {
      name: asset.name,
      uri: asset.uri,
    };

    if (asset.uri) {
      try {
        const response = await fetch(asset.uri, { timeout: 5000 } as any);
        if (response.ok) {
          const json = (await response.json()) as Partial<NftMetadata>;
          metadata = {
            ...metadata,
            image: json.image,
            description: json.description,
            attributes: json.attributes,
            symbol: json.symbol,
          };
        }
      } catch {
        // If metadata fetch fails, return basic info
      }
    }

    return metadata;
  } catch (error) {
    console.error("[fetchAgentNftMetadata] Failed:", error);
    return null;
  }
}
