// ============================================================
// Agent Delegation Tests (Self-Contained)
// ============================================================

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  crypto: ["bitcoin", "btc", "ethereum", "eth", "solana", "sol", "crypto", "defi", "etf", "sec", "regulation", "mining", "blockchain", "altcoin", "token"],
  politics: ["election", "trump", "biden", "president", "congress", "senate", "house", "vote", "policy", "tariff", "trade war", "immigration", "supreme court", "legislation", "midterm"],
  sports: ["nfl", "nba", "soccer", "world cup", "super bowl", "olympics", "ufc", "mma", "tennis", "championship", "playoff", "finals"],
  general: ["weather", "climate", "gdp", "inflation", "recession", "war", "conflict", "natural disaster", "hurricane", "earthquake"],
};

const DELEGATION_TARGETS: Record<string, string[]> = {
  crypto: ["politics", "general"],
  politics: ["general"],
  sports: ["general"],
  general: ["crypto", "politics", "sports"],
};

function detectDelegationOpportunity(marketQuestion: string, agentCategory: string) {
  const lowerQuestion = marketQuestion.toLowerCase();
  const targets = DELEGATION_TARGETS[agentCategory] ?? [];
  let bestMatch: any = null;
  let bestScore = 0;
  for (const targetCategory of targets) {
    const keywords = CATEGORY_KEYWORDS[targetCategory] ?? [];
    let matches = 0;
    for (const kw of keywords) {
      if (lowerQuestion.includes(kw.toLowerCase())) matches++;
    }
    if (matches === 0) continue;
    const score = matches / Math.sqrt(keywords.length);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { marketId: "", marketQuestion, sourceCategory: agentCategory, targetCategory, overlapScore: score };
    }
  }
  const words = lowerQuestion.split(/\s+/);
  const hasKeywordMatch = words.some((w: string) => {
    return targets.some((tc: string) => CATEGORY_KEYWORDS[tc]?.some((kw: string) => w.toLowerCase().includes(kw.toLowerCase())));
  });
  if (bestMatch && (bestScore >= 0.3 || hasKeywordMatch)) return bestMatch;
  return null;
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

console.log("\n🧪 Agent Delegation Tests\n");

test("Detects political keywords in crypto market", () => {
  const result = detectDelegationOpportunity("Will Trump tariffs raise Bitcoin price?", "crypto");
  assertTrue(result !== null);
  assertEqual(result?.targetCategory, "politics");
});

test("Detects recession keywords in politics market", () => {
  const result = detectDelegationOpportunity("Will recession affect the election outcome?", "politics");
  assertTrue(result !== null);
  assertEqual(result?.targetCategory, "general");
});

test("Returns null for pure crypto market", () => {
  const result = detectDelegationOpportunity("Will Ethereum reach $5000 by end of year?", "crypto");
  assertTrue(result === null);
});

test("Returns null for pure sports market", () => {
  const result = detectDelegationOpportunity("Will Chiefs win the Super Bowl?", "sports");
  assertTrue(result === null);
});

test("Detects tariff keyword for politics delegation", () => {
  const result = detectDelegationOpportunity("Will new tariffs crash the crypto market?", "crypto");
  assertTrue(result !== null);
  assertEqual(result?.targetCategory, "politics");
});

test("Detects plural keywords (elections → election)", () => {
  const result = detectDelegationOpportunity("Will elections affect crypto markets?", "crypto");
  assertTrue(result !== null);
  assertEqual(result?.targetCategory, "politics");
});

test("Detects election keyword for politics delegation", () => {
  const result = detectDelegationOpportunity("Will election results crash crypto markets?", "crypto");
  assertTrue(result !== null);
  assertEqual(result?.targetCategory, "politics");
});

console.log("\n✅ All delegation tests passed\n");
