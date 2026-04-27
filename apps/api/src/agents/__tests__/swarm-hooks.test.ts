// ============================================================
// Swarm Hooks Integration Tests (Self-Contained)
// Tests the orchestration of delegation + consensus without
// requiring DB or external services.
// ============================================================

interface TradeDecision {
  action: string;
  marketId?: string;
  marketQuestion?: string;
  confidence: number;
  reasoning: string;
}

interface SwarmHookResult {
  proceed: boolean;
  decision?: TradeDecision;
  detail: string;
  consensus?: any;
  delegation?: { targetCategory: string; delegatedAnalysis: any };
}

// --- Mocks for dependency functions ---

let mockDelegationResult: any = null;
let mockConsensusResult: any = null;
let shouldDelegate = false;
let shouldConsensus = false;

function detectDelegationOpportunity(_marketQuestion: string, _category: string): any {
  return shouldDelegate ? { targetCategory: "politics", overlapScore: 0.5 } : null;
}

function shouldTriggerConsensus(_marketQuestion: string, confidence: number, _category: string): boolean {
  return shouldConsensus && confidence >= 70;
}

async function requestPeerAnalysis(): Promise<any> {
  return mockDelegationResult ?? { success: false };
}

async function collectSwarmVotes(): Promise<any> {
  return mockConsensusResult ?? { approved: true, votesFor: 0, votesAgainst: 0, adjustedConfidence: 50 };
}

// --- Implementation under test (mirrors swarm-hooks.ts logic) ---

async function runSwarmHooks(
  _ctx: any,
  agentId: string,
  category: string,
  decision: TradeDecision
): Promise<SwarmHookResult> {
  if (!decision.marketId || !decision.marketQuestion) {
    return { proceed: true, decision, detail: "No market data for swarm hooks" };
  }

  let workingDecision: TradeDecision = { ...decision };
  let delegatedAnalysis: any = null;
  let delegationTarget: string | null = null;

  // --- 1. Delegation ---
  try {
    const delegationOpportunity = detectDelegationOpportunity(workingDecision.marketQuestion!, category);

    if (delegationOpportunity) {
      const delegationResult = await requestPeerAnalysis();

      if (delegationResult.success && delegationResult.delegatedAnalysis) {
        delegatedAnalysis = delegationResult.delegatedAnalysis;
        delegationTarget = delegationOpportunity.targetCategory;

        const originalConfidence = (workingDecision.confidence ?? 0.5) * 100;
        const peerConfidence = delegatedAnalysis.confidence ?? 50;
        const mergedConfidence = (originalConfidence + peerConfidence) / 2;
        workingDecision = { ...workingDecision, confidence: mergedConfidence / 100 };
      }
    }
  } catch (err: any) {
    // Continue without delegation
  }

  // --- 2. Consensus ---
  try {
    const confidencePercent = (workingDecision.confidence ?? 0.5) * 100;

    if (shouldTriggerConsensus(workingDecision.marketQuestion!, confidencePercent, category)) {
      const consensus = await collectSwarmVotes();

      if (!consensus.approved) {
        return {
          proceed: false,
          decision: workingDecision,
          detail: `Swarm consensus rejected: ${consensus.votesFor}-${consensus.votesAgainst}-${consensus.votesAbstain ?? 0}`,
          consensus,
          delegation: delegationTarget ? { targetCategory: delegationTarget, delegatedAnalysis } : undefined,
        };
      }

      workingDecision = { ...workingDecision, confidence: consensus.adjustedConfidence / 100 };

      return {
        proceed: true,
        decision: workingDecision,
        detail: `Swarm approved (${consensus.votesFor}-${consensus.votesAgainst}), confidence adjusted to ${consensus.adjustedConfidence}%`,
        consensus,
        delegation: delegationTarget ? { targetCategory: delegationTarget, delegatedAnalysis } : undefined,
      };
    }
  } catch (err: any) {
    // Continue without consensus
  }

  return {
    proceed: true,
    decision: workingDecision,
    detail: delegationTarget
      ? `Delegated to ${delegationTarget}, merged analysis`
      : "No swarm intervention needed",
    delegation: delegationTarget ? { targetCategory: delegationTarget, delegatedAnalysis } : undefined,
  };
}

// --- Test Runner (Sequential) ---

const tests: Array<{ name: string; fn: () => Promise<void> }> = [];

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

async function runTests() {
  console.log("\n🧪 Swarm Hooks Integration Tests\n");
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✅ ${t.name}`);
    } catch (err: any) {
      console.error(`❌ ${t.name}: ${err.message}`);
      process.exitCode = 1;
    }
  }
  console.log("\n✅ All swarm hooks tests completed\n");
}

function assertEqual(actual: any, expected: any, msg?: string) {
  if (actual !== expected) throw new Error(msg ?? `Expected ${expected}, got ${actual}`);
}

function assertTrue(value: boolean, msg?: string) {
  if (!value) throw new Error(msg ?? `Expected true, got ${value}`);
}

function assertFalse(value: boolean, msg?: string) {
  if (value) throw new Error(msg ?? `Expected false, got ${value}`);
}

function assertClose(actual: number, expected: number, tolerance = 0.01, msg?: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(msg ?? `Expected ~${expected}, got ${actual}`);
  }
}

// --- Tests ---

function resetMocks() {
  shouldDelegate = false;
  shouldConsensus = false;
  mockDelegationResult = null;
  mockConsensusResult = null;
}

const baseDecision: TradeDecision = {
  action: "buy",
  marketId: "m1",
  marketQuestion: "Will tariffs affect Bitcoin?",
  confidence: 0.85,
  reasoning: "Policy risk",
};

const baseCtx = {};

test("No market data returns early", async () => {
  resetMocks();
  const result = await runSwarmHooks(baseCtx, "agent-1", "crypto", {
    action: "buy",
    confidence: 0.8,
    reasoning: "test",
  });
  assertTrue(result.proceed);
  assertEqual(result.detail, "No market data for swarm hooks");
});

test("No delegation or consensus: passes through", async () => {
  resetMocks();
  const result = await runSwarmHooks(baseCtx, "agent-1", "crypto", { ...baseDecision });
  assertTrue(result.proceed);
  assertEqual(result.detail, "No swarm intervention needed");
  assertEqual(result.decision!.confidence, 0.85);
});

test("Delegation merges confidence without mutating original", async () => {
  resetMocks();
  shouldDelegate = true;
  mockDelegationResult = {
    success: true,
    delegatedAnalysis: { confidence: 60, direction: "hold", reasoning: "uncertain" },
  };

  const original = { ...baseDecision };
  const result = await runSwarmHooks(baseCtx, "agent-1", "crypto", original);

  assertTrue(result.proceed);
  assertTrue(result.delegation !== undefined);
  assertEqual(result.delegation!.targetCategory, "politics");
  // Original should NOT be mutated
  assertEqual(original.confidence, 0.85, "Original decision was mutated!");
  // Merged confidence: (85 + 60) / 2 = 72.5% => 0.725
  assertClose(result.decision!.confidence, 0.725);
});

test("Delegation failure is handled gracefully", async () => {
  resetMocks();
  shouldDelegate = true;
  mockDelegationResult = { success: false, error: "Agent not found" };

  const result = await runSwarmHooks(baseCtx, "agent-1", "crypto", { ...baseDecision });
  assertTrue(result.proceed);
  assertEqual(result.delegation, undefined);
});

test("Consensus approval adjusts confidence", async () => {
  resetMocks();
  shouldConsensus = true;
  mockConsensusResult = {
    approved: true,
    votesFor: 2,
    votesAgainst: 1,
    adjustedConfidence: 65,
  };

  const result = await runSwarmHooks(baseCtx, "agent-1", "crypto", { ...baseDecision });
  assertTrue(result.proceed);
  assertTrue(result.consensus !== undefined);
  assertEqual(result.consensus!.approved, true);
  assertClose(result.decision!.confidence, 0.65);
});

test("Consensus rejection blocks execution", async () => {
  resetMocks();
  shouldConsensus = true;
  mockConsensusResult = {
    approved: false,
    votesFor: 1,
    votesAgainst: 2,
    votesAbstain: 0,
    adjustedConfidence: 30,
  };

  const result = await runSwarmHooks(baseCtx, "agent-1", "crypto", { ...baseDecision });
  assertFalse(result.proceed);
  assertTrue(result.detail.includes("rejected"));
  assertTrue(result.consensus !== undefined);
});

test("Delegation then consensus: both apply", async () => {
  resetMocks();
  shouldDelegate = true;
  shouldConsensus = true;
  mockDelegationResult = {
    success: true,
    delegatedAnalysis: { confidence: 70, direction: "buy", reasoning: "bullish" },
  };
  mockConsensusResult = {
    approved: true,
    votesFor: 3,
    votesAgainst: 0,
    adjustedConfidence: 80,
  };

  const result = await runSwarmHooks(baseCtx, "agent-1", "crypto", { ...baseDecision });
  assertTrue(result.proceed);
  assertTrue(result.delegation !== undefined);
  assertTrue(result.consensus !== undefined);
  // Delegation merged: (85+70)/2 = 77.5 => 0.775
  // Then consensus adjusted to 80 => 0.80
  assertClose(result.decision!.confidence, 0.80);
});

test("Low confidence skips consensus even with trigger keywords", async () => {
  resetMocks();
  shouldConsensus = true;
  const lowConfidenceDecision: TradeDecision = {
    ...baseDecision,
    confidence: 0.5, // 50% < 70 threshold
  };

  const result = await runSwarmHooks(baseCtx, "agent-1", "crypto", lowConfidenceDecision);
  assertTrue(result.proceed);
  assertEqual(result.consensus, undefined);
});

runTests();
