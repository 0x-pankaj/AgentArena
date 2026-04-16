# Graph Report - .  (2026-04-14)

## Corpus Check
- 124 files · ~114,632 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 607 nodes · 1103 edges · 32 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `JupiterPredictClient` - 15 edges
2. `pass()` - 14 edges
3. `fail()` - 14 edges
4. `section()` - 14 edges
5. `main()` - 14 edges
6. `runPoliticsAgentTick()` - 14 edges
7. `runCryptoAgentTick()` - 14 edges
8. `AgentFSM` - 13 edges
9. `runSportsAgentTick()` - 13 edges
10. `runGeneralAgentTick()` - 13 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (26): getConflictSignal(), searchAcled(), getCircuit(), isCircuitOpen(), recordCircuitFailure(), recordCircuitSuccess(), withCircuitBreaker(), getMacroSignal() (+18 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (5): getBaseUrl(), handleCreate(), formatCurrency(), formatNumber(), GlobalStatsBanner()

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (18): buildInitializeJobTx(), getInstructionDiscriminator(), getJobProfile(), getJobProfilePDA(), jobIdToSeed(), jobProfileExists(), agentProfileExists(), buildRegisterAgentTx() (+10 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (19): broadcast(), broadcastAgentDecision(), broadcastFeedEvent(), broadcastLeaderboardUpdate(), broadcastPositionUpdate(), broadcastPriceUpdate(), channelToRedisChannel(), enrichLeaderboardEntry() (+11 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (34): extractJsonFromText(), runAdversarialReview(), calculateEffectiveExposure(), checkCrossMarketCorrelation(), classifyMarket(), getCorrelation(), getAnthropicProvider(), getModelOverrides() (+26 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (28): ActivateJob, AgentAction, AgentProfile, AgentRegistered, AgentRegistryError, ApproveRelease, CancelJob, CreateJob (+20 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (13): acquireLock(), cachedFetch(), cacheKey(), releaseLock(), setCached(), getCoinData(), getCryptoSignals(), getGlobalMarket() (+5 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (14): AgentFSM, aggregateSignals(), buildAnalysisContext(), buildDecisionContext(), buildGeneralAgentConfig(), buildResearchContext(), calculateEdge(), conflictToProbability() (+6 more)

### Community 8 - "Community 8"
Cohesion: 0.1
Nodes (14): buildPortfolioSnapshot(), getSOLPrice(), refreshSOLPrice(), analyzeMarketMicrostructure(), calculateDepthInRange(), checkMicrostructure(), estimatePriceImpact(), calculatePnl() (+6 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (2): fetchFromAPI(), getBaseUrl()

### Community 10 - "Community 10"
Cohesion: 0.16
Nodes (19): checkMonitoredPositions(), getCachedPrice(), monitorKey(), pollPriceUpdates(), priceCacheKey(), registerPositionForMonitoring(), unregisterPositionFromMonitoring(), updatePriceCache() (+11 more)

### Community 11 - "Community 11"
Cohesion: 0.16
Nodes (16): aggregateSignals(), buildAnalysisContext(), buildCryptoAgentConfig(), buildDecisionContext(), buildResearchContext(), calculateEdge(), cryptoToProbability(), extractProbabilityFromText() (+8 more)

### Community 12 - "Community 12"
Cohesion: 0.43
Nodes (18): fail(), main(), pass(), section(), skip(), testAlertService(), testCoinGecko(), testEdgeAndSizing() (+10 more)

### Community 13 - "Community 13"
Cohesion: 0.21
Nodes (14): aggregateSignals(), buildAnalysisContext(), buildDecisionContext(), buildPoliticsAgentConfig(), buildResearchContext(), calculateEdge(), conflictToProbability(), extractProbabilityFromText() (+6 more)

### Community 14 - "Community 14"
Cohesion: 0.21
Nodes (12): clearPromptCache(), collectEvolutionData(), createPromptVersion(), evolveStep(), generateEvolution(), getActivePrompt(), getActivePrompts(), promotePromptVersion() (+4 more)

### Community 15 - "Community 15"
Cohesion: 0.18
Nodes (7): eventsToMarkets(), getCachedEvents(), getMarket(), getTrendingMarkets(), mapJupiterMarketToDb(), searchMarkets(), syncMarketsFromJupiter()

### Community 16 - "Community 16"
Cohesion: 0.55
Nodes (14): fail(), main(), pass(), section(), skip(), testAcled(), testCoinGecko(), testDefiLlama() (+6 more)

### Community 17 - "Community 17"
Cohesion: 0.18
Nodes (1): JupiterPredictClient

### Community 18 - "Community 18"
Cohesion: 0.21
Nodes (2): getWsUrl(), WSClient

### Community 19 - "Community 19"
Cohesion: 0.26
Nodes (9): decayConfidence(), decaySignalConfidence(), findBucket(), getAllCalibratedWeights(), getCalibratedWeight(), getCalibrationScores(), getConfidenceAdjustment(), saveCalibrationScores() (+1 more)

### Community 20 - "Community 20"
Cohesion: 0.31
Nodes (7): initializeAgentRegistry(), listRegisteredAgents(), registerAgent(), cleanup(), log(), main(), section()

### Community 21 - "Community 21"
Cohesion: 0.47
Nodes (3): getBayesianWeight(), getSignalSourceWeight(), parseWeightOverride()

### Community 22 - "Community 22"
Cohesion: 0.6
Nodes (5): getAlertKey(), isAlertCooldown(), recordAlert(), sendAlert(), sendWebhookAlert()

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (1): ErrorCode

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **29 isolated node(s):** `RegisterAgent`, `UpdateAgent`, `VerifyAgent`, `ResetDailySpent`, `RecordSpending` (+24 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 23`** (2 nodes): `error.rs`, `ErrorCode`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (2 nodes): `seed-prompts.ts`, `seedPrompts()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (2 nodes): `metro.config.js`, `findJoseBrowserDir()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `agent-escrow.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (1 nodes): `constants.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (1 nodes): `deploy.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `expo-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `entrypoint.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `mock-data.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `JupiterPredictClient` connect `Community 17` to `Community 8`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **What connects `RegisterAgent`, `UpdateAgent`, `VerifyAgent` to the rest of the system?**
  _29 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._