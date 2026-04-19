import { PrivyClient } from "@privy-io/server-auth";
import { DEPLOY_PHASE, type DeployPhase } from "@agent-arena/shared";

type PolicyMethod = "eth_signTransaction" | "eth_sendTransaction" | "eth_signTypedData_v4" | "eth_sign7702Authorization" | "signAndSendTransaction" | "signTransaction" | "signMessage" | "personal_sign" | "exportPrivateKey" | "*";
type PolicyActionType = "ALLOW" | "DENY";

interface WalletApiPolicyRuleConditionType {
  field_source: "solana_program_instruction" | "solana_system_program_instruction" | "solana_token_program_instruction" | "ethereum_transaction" | "system";
  field: string;
  operator: "eq" | "gt" | "gte" | "lt" | "lte" | "in" | "in_condition_set";
  value: string | number | string[];
}

const appId = process.env.PRIVY_APP_ID ?? "";
const appSecret = process.env.PRIVY_APP_SECRET ?? "";

export const privy = new PrivyClient(appId, appSecret);

export interface PolicyRule {
  name: string;
  method: PolicyMethod;
  conditions: WalletApiPolicyRuleConditionType[];
  action: PolicyActionType;
}

interface CreatePolicyParams {
  name: string;
  rules: PolicyRule[];
}

async function createPolicy(params: CreatePolicyParams): Promise<string> {
  const policy = await privy.walletApi.createPolicy({
    version: "1.0",
    name: params.name,
    chainType: "solana",
    rules: params.rules as any, // SDK types are compatible but TypeScript doesn't recognize it
  });

  return policy.id;
}

export async function createDevelopmentPolicy(): Promise<string> {
  console.log("[PrivyPolicies] Creating development policy (permissive)...");

  const rules: PolicyRule[] = [
    {
      name: "Deny key export",
      method: "exportPrivateKey",
      conditions: [],
      action: "DENY",
    },
    {
      name: "Allow all signAndSendTransaction",
      method: "signAndSendTransaction",
      conditions: [],
      action: "ALLOW",
    },
    {
      name: "Allow all signTransaction",
      method: "signTransaction",
      conditions: [],
      action: "ALLOW",
    },
    {
      name: "Allow all personal_sign",
      method: "personal_sign",
      conditions: [],
      action: "ALLOW",
    },
  ];

  return createPolicy({
    name: `agent-arena-dev-${DEPLOY_PHASE}-${Date.now()}`,
    rules,
  });
}

export async function createTractionPolicy(): Promise<string> {
  console.log("[PrivyPolicies] Creating traction policy (moderate restrictions)...");

  const jupiterProgram = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";
  const splTokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

  const rules: PolicyRule[] = [
    {
      name: "Deny key export",
      method: "exportPrivateKey",
      conditions: [],
      action: "DENY",
    },
    {
      name: "Allow Jupiter Predict program",
      method: "signAndSendTransaction",
      conditions: [
        {
          field_source: "solana_program_instruction",
          field: "programId",
          operator: "eq",
          value: jupiterProgram,
        },
      ],
      action: "ALLOW",
    },
    {
      name: "Allow SPL Token program",
      method: "signAndSendTransaction",
      conditions: [
        {
          field_source: "solana_program_instruction",
          field: "programId",
          operator: "eq",
          value: splTokenProgram,
        },
      ],
      action: "ALLOW",
    },
    {
      name: "Allow signTransaction (non-broadcast)",
      method: "signTransaction",
      conditions: [],
      action: "ALLOW",
    },
    {
      name: "Allow personal_sign",
      method: "personal_sign",
      conditions: [],
      action: "ALLOW",
    },
    {
      name: "Deny all other signAndSendTransaction",
      method: "signAndSendTransaction",
      conditions: [],
      action: "DENY",
    },
  ];

  return createPolicy({
    name: `agent-arena-traction-${Date.now()}`,
    rules,
  });
}

export async function createProductionPolicy(): Promise<string> {
  console.log("[PrivyPolicies] Creating production policy (strict)...");

  const jupiterProgram = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";
  const splTokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

  const rules: PolicyRule[] = [
    {
      name: "Deny key export",
      method: "exportPrivateKey",
      conditions: [],
      action: "DENY",
    },
    {
      name: "Allow Jupiter Predict program only",
      method: "signAndSendTransaction",
      conditions: [
        {
          field_source: "solana_program_instruction",
          field: "programId",
          operator: "eq",
          value: jupiterProgram,
        },
      ],
      action: "ALLOW",
    },
    {
      name: "Allow SPL Token transfers only",
      method: "signAndSendTransaction",
      conditions: [
        {
          field_source: "solana_program_instruction",
          field: "programId",
          operator: "eq",
          value: splTokenProgram,
        },
      ],
      action: "ALLOW",
    },
    {
      name: "Deny System Program transfers (no direct SOL moves)",
      method: "signAndSendTransaction",
      conditions: [
        {
          field_source: "solana_system_program_instruction",
          field: "Transfer.to",
          operator: "in_condition_set",
          value: [],
        },
      ],
      action: "DENY",
    },
    {
      name: "Allow signTransaction (non-broadcast) for signing only",
      method: "signTransaction",
      conditions: [],
      action: "ALLOW",
    },
    {
      name: "Deny all other signAndSendTransaction",
      method: "signAndSendTransaction",
      conditions: [],
      action: "DENY",
    },
    {
      name: "Deny personal_sign unless whitelisted",
      method: "personal_sign",
      conditions: [],
      action: "DENY",
    },
  ];

  return createPolicy({
    name: `agent-arena-prod-${Date.now()}`,
    rules,
  });
}

export async function createAgentPolicy(phase: DeployPhase): Promise<string> {
  switch (phase) {
    case "development":
      return createDevelopmentPolicy();
    case "traction":
      return createTractionPolicy();
    case "production":
      return createProductionPolicy();
  }
}

export async function deletePolicy(policyId: string): Promise<void> {
  console.log(`[PrivyPolicies] Deleting policy: ${policyId}`);
  await privy.walletApi.deletePolicy({ id: policyId });
}

export async function getPolicy(policyId: string) {
  return privy.walletApi.getPolicy({ id: policyId });
}