import type { AgentConfig, AgentRuntimeContext, AgentTickResult } from "../ai/types";
import type { ModelConfig } from "../ai/models";
import { buildPoliticsAgentConfig, runPoliticsAgentTick } from "./politics-agent";
import { buildSportsAgentConfig, runSportsAgentTick } from "./sports-agent";
import { buildCryptoAgentConfig, runCryptoAgentTick } from "./crypto-agent";
import { buildGeneralAgentConfig, runGeneralAgentTick } from "./general-agent";
import { AGENT_LIMITS } from "@agent-arena/shared";

// --- Agent tick function type ---

type AgentTickFn = (ctx: AgentRuntimeContext) => Promise<AgentTickResult>;

// --- Agent entry in registry ---

interface AgentEntry {
  config: AgentConfig;
  tick: AgentTickFn;
}

// --- Registry ---

const registry = new Map<string, AgentEntry>();

// --- Register an agent ---

export function registerAgent(config: AgentConfig, tick: AgentTickFn): void {
  registry.set(config.identity.id, { config, tick });
  console.log(`[Registry] Registered agent: ${config.identity.name} (${config.identity.id})`);
}

// --- Get agent config ---

export function getAgentConfig(agentId: string): AgentConfig | null {
  return registry.get(agentId)?.config ?? null;
}

// --- Run agent tick ---

export async function runAgentTick(
  agentId: string,
  ctx: AgentRuntimeContext
): Promise<AgentTickResult> {
  const entry = registry.get(agentId);
  if (!entry) {
    return {
      state: "IDLE",
      action: "skipped",
      detail: `Agent ${agentId} not found in registry`,
    };
  }
  return entry.tick(ctx);
}

// --- List registered agents ---

export function listRegisteredAgents(): Array<{
  id: string;
  name: string;
  category: string;
}> {
  return Array.from(registry.values()).map((e) => ({
    id: e.config.identity.id,
    name: e.config.identity.name,
    category: e.config.identity.category,
  }));
}

// --- Initialize registry ---

export function initializeAgentRegistry(): void {
  registerAgent(buildPoliticsAgentConfig(), runPoliticsAgentTick);
  registerAgent(buildSportsAgentConfig(), runSportsAgentTick);
  registerAgent(buildCryptoAgentConfig(), runCryptoAgentTick);
  registerAgent(buildGeneralAgentConfig(), runGeneralAgentTick);

  console.log(
    `[Registry] Initialized with ${registry.size} agent(s):`,
    listRegisteredAgents().map((a) => a.name).join(", ")
  );
}
