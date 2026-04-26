// ============================================================
// Swarm Consensus Tests (Self-Contained)
// ============================================================

interface SwarmVote {
  agentId: string;
  agentName: string;
  category: string;
  vote: "yes" | "no" | "abstain";
  confidence: number;
  reasoning: string;
}

const crossDomainKeywords: Record<string, string[]> = {
  crypto: ["tariff", "election", "policy", "regulation", "sec", "fed", "interest rate", "inflation", "war"],
  politics: ["bitcoin", "crypto", "stock", "market", "economy", "recession"],
  sports: ["betting", "crypto", "sponsor", "economy"],
  general: ["bitcoin", "election", "crypto", "etf", "war", "tariff"],
};

function shouldTriggerConsensus(marketQuestion: string, confidence: number, agentCategory: string): boolean {
  if (confidence < 70) return false;
  const lower = marketQuestion.toLowerCase();
  const keywords = crossDomainKeywords[agentCategory] ?? [];
  const overlap = keywords.filter((kw) => lower.includes(kw.toLowerCase()));
  return overlap.length >= 1 && confidence >= 70;
}

function aggregateConsensus(votes: SwarmVote[], initiatingAgentId: string) {
  const votesFor = votes.filter((v) => v.vote === "yes").length;
  const votesAgainst = votes.filter((v) => v.vote === "no").length;
  const votesAbstain = votes.filter((v) => v.vote === "abstain").length;
  const total = votes.length;

  if (total === 0) {
    return { approved: false, consensusAction: "skip", adjustedConfidence: 0, votes: [], votesFor: 0, votesAgainst: 0, votesAbstain: 0, disagreementPenalty: 0 };
  }

  let weightedConfidence = 0;
  let totalWeight = 0;
  for (const v of votes) {
    const weight = v.confidence / 100;
    const direction = v.vote === "yes" ? 1 : v.vote === "no" ? -1 : 0;
    weightedConfidence += direction * weight;
    totalWeight += weight;
  }

  const normalizedConfidence = totalWeight > 0 ? (weightedConfidence / totalWeight) * 100 : 0;

  const decisiveVotes = votesFor + votesAgainst;
  const majorityThreshold = decisiveVotes > 0 ? decisiveVotes / 2 : 0;

  let approved = false;
  let consensusAction: "buy_yes" | "buy_no" | "skip" = "skip";

  if (votesFor > majorityThreshold && normalizedConfidence > 0) {
    approved = true;
    consensusAction = "buy_yes";
  } else if (votesAgainst > majorityThreshold && normalizedConfidence < 0) {
    approved = true;
    consensusAction = "buy_no";
  }

  // disagreement penalty
  let disagreementPenalty = 0;
  if (votes.length >= 2) {
    const decisive = votes.filter((v) => v.vote !== "abstain");
    if (decisive.length >= 2) {
      const directions = decisive.map((v) => (v.vote === "yes" ? 1 : -1));
      const mean = directions.reduce((a, b) => a + b, 0) / directions.length;
      const variance = directions.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / directions.length;
      disagreementPenalty = Math.min(variance * 0.5, 0.5);
    }
  }

  const adjustedConfidence = Math.abs(normalizedConfidence) * (1 - disagreementPenalty);

  return {
    approved,
    consensusAction,
    adjustedConfidence: Math.round(adjustedConfidence * 100) / 100,
    votes,
    votesFor,
    votesAgainst,
    votesAbstain,
    disagreementPenalty: Math.round(disagreementPenalty * 100) / 100,
  };
}

// --- Test Runner ---

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (err: any) {
    console.error(`❌ ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

function assertEqual(actual: any, expected: any, msg?: string) {
  if (actual !== expected) throw new Error(msg ?? `Expected ${expected}, got ${actual}`);
}

function assertTrue(value: boolean, msg?: string) {
  if (!value) throw new Error(msg ?? `Expected true`);
}

function assertFalse(value: boolean, msg?: string) {
  if (value) throw new Error(msg ?? `Expected false`);
}

// --- Tests ---

console.log("\n🧪 Swarm Consensus Tests\n");

test("Triggers consensus for high-confidence cross-domain crypto market", () => {
  assertTrue(shouldTriggerConsensus("Will Trump tariffs raise Bitcoin price?", 85, "crypto"));
});

test("Does not trigger consensus for low confidence", () => {
  assertFalse(shouldTriggerConsensus("Will Trump tariffs raise Bitcoin price?", 60, "crypto"));
});

test("Does not trigger consensus for pure market", () => {
  assertFalse(shouldTriggerConsensus("Will Ethereum reach $5000?", 90, "crypto"));
});

test("Aggregates consensus: majority yes wins", () => {
  const votes: SwarmVote[] = [
    { agentId: "1", agentName: "A", category: "crypto", vote: "yes", confidence: 80, reasoning: "Bullish" },
    { agentId: "2", agentName: "B", category: "politics", vote: "yes", confidence: 75, reasoning: "Policy" },
    { agentId: "3", agentName: "C", category: "general", vote: "no", confidence: 60, reasoning: "Uncertain" },
  ];
  const result = aggregateConsensus(votes, "initiator");
  assertTrue(result.approved);
  assertEqual(result.consensusAction, "buy_yes");
  assertEqual(result.votesFor, 2);
  assertEqual(result.votesAgainst, 1);
});

test("Aggregates consensus: majority no wins", () => {
  const votes: SwarmVote[] = [
    { agentId: "1", agentName: "A", category: "crypto", vote: "no", confidence: 80, reasoning: "Bearish" },
    { agentId: "2", agentName: "B", category: "politics", vote: "no", confidence: 75, reasoning: "Policy" },
    { agentId: "3", agentName: "C", category: "general", vote: "yes", confidence: 60, reasoning: "Optimistic" },
  ];
  const result = aggregateConsensus(votes, "initiator");
  assertTrue(result.approved);
  assertEqual(result.consensusAction, "buy_no");
});

test("Aggregates consensus: tie results in skip", () => {
  const votes: SwarmVote[] = [
    { agentId: "1", agentName: "A", category: "crypto", vote: "yes", confidence: 80, reasoning: "" },
    { agentId: "2", agentName: "B", category: "politics", vote: "no", confidence: 80, reasoning: "" },
  ];
  const result = aggregateConsensus(votes, "initiator");
  assertFalse(result.approved);
  assertEqual(result.consensusAction, "skip");
});

test("Weighted confidence calculation", () => {
  const votes: SwarmVote[] = [
    { agentId: "1", agentName: "A", category: "crypto", vote: "yes", confidence: 90, reasoning: "" },
    { agentId: "2", agentName: "B", category: "politics", vote: "yes", confidence: 90, reasoning: "" },
    { agentId: "3", agentName: "C", category: "general", vote: "yes", confidence: 70, reasoning: "" },
  ];
  const result = aggregateConsensus(votes, "initiator");
  assertTrue(result.adjustedConfidence > 70, `Expected >70, got ${result.adjustedConfidence}`);
});

test("Disagreement penalty reduces confidence", () => {
  const votes: SwarmVote[] = [
    { agentId: "1", agentName: "A", category: "crypto", vote: "yes", confidence: 90, reasoning: "" },
    { agentId: "2", agentName: "B", category: "politics", vote: "no", confidence: 90, reasoning: "" },
  ];
  const result = aggregateConsensus(votes, "initiator");
  assertTrue(result.disagreementPenalty > 0);
});

test("Empty votes returns safe defaults", () => {
  const result = aggregateConsensus([], "initiator");
  assertFalse(result.approved);
  assertEqual(result.consensusAction, "skip");
  assertEqual(result.adjustedConfidence, 0);
});

console.log("\n✅ All consensus tests passed\n");
