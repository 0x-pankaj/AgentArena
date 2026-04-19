# Graph Report - .  (2026-04-19)

## Corpus Check
- 139 files · ~132,123 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 768 nodes · 1393 edges · 35 communities detected
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
Cohesion: 0.03
Nodes (7): fetchFromAPI(), getBaseUrl(), getBaseUrl(), handleCreate(), formatCurrency(), formatNumber(), GlobalStatsBanner()

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (50): extractJsonFromText(), repairAdversarialJson(), runAdversarialReview(), calculateEffectiveExposure(), checkCrossMarketCorrelation(), classifyMarket(), getCorrelation(), aggregateSignals() (+42 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (24): getConflictSignal(), searchAcled(), getCircuit(), isCircuitOpen(), recordCircuitFailure(), recordCircuitSuccess(), withCircuitBreaker(), getMacroSignal() (+16 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (19): broadcast(), broadcastAgentDecision(), broadcastFeedEvent(), broadcastLeaderboardUpdate(), broadcastPositionUpdate(), broadcastPriceUpdate(), channelToRedisChannel(), enrichLeaderboardEntry() (+11 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (28): ActivateJob, AgentAction, AgentProfile, AgentRegistered, AgentRegistryError, ApproveRelease, CancelJob, CreateJob (+20 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (9): buildPortfolioSnapshot(), getSOLPrice(), refreshSOLPrice(), agentProfileExists(), buildRegisterAgentTx(), getAgentProfile(), getAgentProfilePDA(), getProgram() (+1 more)

### Community 6 - "Community 6"
Cohesion: 0.1
Nodes (26): checkMonitoredPositions(), getCachedPrice(), monitorKey(), pollPriceUpdates(), priceCacheKey(), registerPositionForMonitoring(), unregisterPositionFromMonitoring(), updatePriceCache() (+18 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (2): MockJupiterPredictClient, JupiterPredictClient

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (15): AgentFSM, aggregateSignals(), buildPoliticsAgentConfig(), buildPoliticsDecisionContext(), buildPoliticsResearchContext(), calculateEdge(), computePoliticsTemporalAdjustment(), conflictToProbability() (+7 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (13): acquireLock(), cachedFetch(), cacheKey(), releaseLock(), setCached(), getCoinData(), getCryptoSignals(), getGlobalMarket() (+5 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (7): RealTimePriceMonitor, registerOpenPositionsFromDB(), invalidateOnBreakingNews(), invalidateOnPriceSpike(), invalidateOnThreshold(), invalidateOnVolumeSurge(), SignalInvalidationManager

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (17): buildInitializeJobTx(), getInstructionDiscriminator(), getJobProfile(), getJobProfilePDA(), jobIdToSeed(), jobProfileExists(), createAgentPolicy(), createDevelopmentPolicy() (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.27
Nodes (21): getBayesianWeight(), getSignalSourceWeight(), parseWeightOverride(), fail(), main(), pass(), section(), skip() (+13 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (3): getJupiterMetrics(), JupiterMetricsTracker, logJupiterSummary()

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (9): categoryCacheKey(), categoryMetaKey(), fetchAndCacheCategory(), getCachedJupiterEvents(), getCacheStats(), invalidateCategoryCache(), getMarketsForAgent(), MarketEventBus (+1 more)

### Community 15 - "Community 15"
Cohesion: 0.16
Nodes (18): aggregateSignals(), buildCryptoAgentConfig(), buildPerMarketDecisionContext(), buildPerMarketResearchContext(), calculateEdge(), computeTemporalAdjustment(), cryptoToProbability(), extractProbabilityFromText() (+10 more)

### Community 16 - "Community 16"
Cohesion: 0.23
Nodes (2): JupiterRateLimiter, withJupiterRateLimit()

### Community 17 - "Community 17"
Cohesion: 0.19
Nodes (16): analyzeMarketsInParallel(), analyzeMarketsSequentially(), chunkMarkets(), smartAnalyzeMarkets(), acquireLLMSlot(), extractJsonFromText(), getAgentLimiter(), isRetryableError() (+8 more)

### Community 18 - "Community 18"
Cohesion: 0.21
Nodes (12): clearPromptCache(), collectEvolutionData(), createPromptVersion(), evolveStep(), generateEvolution(), getActivePrompt(), getActivePrompts(), promotePromptVersion() (+4 more)

### Community 19 - "Community 19"
Cohesion: 0.18
Nodes (6): eventsToMarkets(), getMarket(), getTrendingMarkets(), mapJupiterMarketToDb(), searchMarkets(), syncMarketsFromJupiter()

### Community 20 - "Community 20"
Cohesion: 0.55
Nodes (14): fail(), main(), pass(), section(), skip(), testAcled(), testCoinGecko(), testDefiLlama() (+6 more)

### Community 21 - "Community 21"
Cohesion: 0.25
Nodes (4): cacheLLMResponse(), calculateSimilarity(), getCachedLLMResponse(), LLMResponseCache

### Community 22 - "Community 22"
Cohesion: 0.26
Nodes (9): decayConfidence(), decaySignalConfidence(), findBucket(), getAllCalibratedWeights(), getCalibratedWeight(), getCalibrationScores(), getConfidenceAdjustment(), saveCalibrationScores() (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.25
Nodes (2): getWsUrl(), WSClient

### Community 24 - "Community 24"
Cohesion: 0.22
Nodes (2): runAllAgentBacktests(), runBayesianBacktest()

### Community 25 - "Community 25"
Cohesion: 0.6
Nodes (5): getAlertKey(), isAlertCooldown(), recordAlert(), sendAlert(), sendWebhookAlert()

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (1): ErrorCode

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

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **29 isolated node(s):** `RegisterAgent`, `UpdateAgent`, `VerifyAgent`, `ResetDailySpent`, `RecordSpending` (+24 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 26`** (2 nodes): `error.rs`, `ErrorCode`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (2 nodes): `seed-prompts.ts`, `seedPrompts()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (2 nodes): `metro.config.js`, `findJoseBrowserDir()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `agent-escrow.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `constants.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `deploy.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `expo-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `entrypoint.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `mock-data.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `RegisterAgent`, `UpdateAgent`, `VerifyAgent` to the rest of the system?**
  _29 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 5` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._