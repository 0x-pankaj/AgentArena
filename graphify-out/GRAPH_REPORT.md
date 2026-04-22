# Graph Report - .  (2026-04-22)

## Corpus Check
- 150 files · ~153,361 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 852 nodes · 1577 edges · 38 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `JupiterMetricsTracker` - 19 edges
2. `JupiterRateLimiter` - 18 edges
3. `JupiterPredictClient` - 16 edges
4. `RealTimePriceMonitor` - 15 edges
5. `pass()` - 14 edges
6. `fail()` - 14 edges
7. `section()` - 14 edges
8. `main()` - 14 edges
9. `runPoliticsAgentTick()` - 14 edges
10. `runCryptoAgentTick()` - 14 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (5): getBaseUrl(), handleCreate(), formatCurrency(), formatNumber(), GlobalStatsBanner()

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (48): aggregateSignals(), buildGeneralAgentConfig(), buildGeneralDecisionContext(), buildGeneralResearchContext(), calculateEdge(), computeGeneralTemporalAdjustment(), conflictToProbability(), extractProbabilityFromText() (+40 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (27): getConflictSignal(), searchAcled(), getMacroSignal(), getSeriesInfo(), getSeriesObservations(), getGdeltToneSignal(), searchGdelt(), orchestrateMarketResearch() (+19 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (22): buildPortfolioSnapshot(), getSOLPrice(), refreshSOLPrice(), scanAndRankMarkets(), scanMarkets(), scanMarketsWithResearch(), extractSearchQuery(), generateExtraSearchQueries() (+14 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (19): broadcast(), broadcastAgentDecision(), broadcastFeedEvent(), broadcastLeaderboardUpdate(), broadcastPositionUpdate(), broadcastPriceUpdate(), channelToRedisChannel(), enrichLeaderboardEntry() (+11 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (28): ActivateJob, AgentAction, AgentProfile, AgentRegistered, AgentRegistryError, ApproveRelease, CancelJob, CreateJob (+20 more)

### Community 6 - "Community 6"
Cohesion: 0.09
Nodes (26): checkMonitoredPositions(), getCachedPrice(), monitorKey(), pollPriceUpdates(), priceCacheKey(), registerPositionForMonitoring(), unregisterPositionFromMonitoring(), updatePriceCache() (+18 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (15): AgentFSM, aggregateSignals(), buildPoliticsAgentConfig(), buildPoliticsDecisionContext(), buildPoliticsResearchContext(), calculateEdge(), computePoliticsTemporalAdjustment(), conflictToProbability() (+7 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (14): runAllAgentBacktests(), runBayesianBacktest(), getCircuit(), isCircuitOpen(), recordCircuitFailure(), recordCircuitSuccess(), withCircuitBreaker(), analyzeMarketsInParallel() (+6 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (7): RealTimePriceMonitor, registerOpenPositionsFromDB(), invalidateOnBreakingNews(), invalidateOnPriceSpike(), invalidateOnThreshold(), invalidateOnVolumeSurge(), SignalInvalidationManager

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (17): buildInitializeJobTx(), getInstructionDiscriminator(), getJobProfile(), getJobProfilePDA(), jobIdToSeed(), jobProfileExists(), createAgentPolicy(), createDevelopmentPolicy() (+9 more)

### Community 11 - "Community 11"
Cohesion: 0.1
Nodes (8): analyzeMarketMicrostructure(), calculateDepthInRange(), checkMicrostructure(), estimatePriceImpact(), MockJupiterPredictClient, analyzeOrderFlowTrend(), batchAnalyzeOrderFlow(), takeOrderFlowSnapshot()

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (2): fetchFromAPI(), getBaseUrl()

### Community 13 - "Community 13"
Cohesion: 0.13
Nodes (19): getCoinData(), getCryptoSignals(), getGlobalMarket(), getSolanaSignals(), getTopCoins(), aggregateSignals(), buildCryptoAgentConfig(), buildPerMarketDecisionContext() (+11 more)

### Community 14 - "Community 14"
Cohesion: 0.27
Nodes (21): getBayesianWeight(), getSignalSourceWeight(), parseWeightOverride(), fail(), main(), pass(), section(), skip() (+13 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (8): acquireLock(), cachedFetch(), cacheKey(), releaseLock(), setCached(), getDeFiSignals(), getSolanaTVL(), getTopProtocols()

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (3): getJupiterMetrics(), JupiterMetricsTracker, logJupiterSummary()

### Community 17 - "Community 17"
Cohesion: 0.14
Nodes (9): categoryCacheKey(), categoryMetaKey(), fetchAndCacheCategory(), getCachedJupiterEvents(), getCacheStats(), invalidateCategoryCache(), getMarketsForAgent(), MarketEventBus (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.23
Nodes (2): JupiterRateLimiter, withJupiterRateLimit()

### Community 19 - "Community 19"
Cohesion: 0.18
Nodes (14): initializeAgentRegistry(), listRegisteredAgents(), registerAgent(), banner(), error(), info(), main(), section() (+6 more)

### Community 20 - "Community 20"
Cohesion: 0.19
Nodes (16): bootstrapCorrelationsFromDB(), computeCorrelation(), extractCorrelationCategory(), getAllLearnedCorrelations(), getHybridCorrelation(), getLearnedCorrelation(), getPairKey(), isRelatedCategory() (+8 more)

### Community 21 - "Community 21"
Cohesion: 0.21
Nodes (12): clearPromptCache(), collectEvolutionData(), createPromptVersion(), evolveStep(), generateEvolution(), getActivePrompt(), getActivePrompts(), promotePromptVersion() (+4 more)

### Community 22 - "Community 22"
Cohesion: 0.17
Nodes (1): JupiterPredictClient

### Community 23 - "Community 23"
Cohesion: 0.55
Nodes (14): fail(), main(), pass(), section(), skip(), testAcled(), testCoinGecko(), testDefiLlama() (+6 more)

### Community 24 - "Community 24"
Cohesion: 0.25
Nodes (4): cacheLLMResponse(), calculateSimilarity(), getCachedLLMResponse(), LLMResponseCache

### Community 25 - "Community 25"
Cohesion: 0.26
Nodes (9): decayConfidence(), decaySignalConfidence(), findBucket(), getAllCalibratedWeights(), getCalibratedWeight(), getCalibrationScores(), getConfidenceAdjustment(), saveCalibrationScores() (+1 more)

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (2): getWsUrl(), WSClient

### Community 27 - "Community 27"
Cohesion: 0.54
Nodes (6): agentProfileExists(), buildRegisterAgentTx(), getAgentProfile(), getAgentProfilePDA(), getProgram(), registerAgentWithPrivy()

### Community 28 - "Community 28"
Cohesion: 0.6
Nodes (5): getAlertKey(), isAlertCooldown(), recordAlert(), sendAlert(), sendWebhookAlert()

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (1): ErrorCode

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **29 isolated node(s):** `RegisterAgent`, `UpdateAgent`, `VerifyAgent`, `ResetDailySpent`, `RecordSpending` (+24 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 29`** (2 nodes): `error.rs`, `ErrorCode`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (2 nodes): `seed-prompts.ts`, `seedPrompts()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (2 nodes): `metro.config.js`, `findJoseBrowserDir()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `agent-escrow.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `constants.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `deploy.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `expo-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `entrypoint.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (1 nodes): `mock-data.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `JupiterPredictClient` connect `Community 22` to `Community 11`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **What connects `RegisterAgent`, `UpdateAgent`, `VerifyAgent` to the rest of the system?**
  _29 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._