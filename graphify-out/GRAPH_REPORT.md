# Graph Report - .  (2026-04-16)

## Corpus Check
- 137 files · ~131,092 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 758 nodes · 1375 edges · 35 communities detected
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
Cohesion: 0.06
Nodes (44): extractJsonFromText(), repairAdversarialJson(), runAdversarialReview(), calculateEffectiveExposure(), checkCrossMarketCorrelation(), classifyMarket(), getCorrelation(), aggregateSignals() (+36 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (21): getConflictSignal(), searchAcled(), runAllAgentBacktests(), runBayesianBacktest(), getMacroSignal(), getSeriesInfo(), getSeriesObservations(), getGdeltToneSignal() (+13 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (18): buildInitializeJobTx(), getInstructionDiscriminator(), getJobProfile(), getJobProfilePDA(), jobIdToSeed(), jobProfileExists(), agentProfileExists(), buildRegisterAgentTx() (+10 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (19): broadcast(), broadcastAgentDecision(), broadcastFeedEvent(), broadcastLeaderboardUpdate(), broadcastPositionUpdate(), broadcastPriceUpdate(), channelToRedisChannel(), enrichLeaderboardEntry() (+11 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (5): getJupiterMetrics(), JupiterMetricsTracker, logJupiterSummary(), JupiterRateLimiter, withJupiterRateLimit()

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (28): ActivateJob, AgentAction, AgentProfile, AgentRegistered, AgentRegistryError, ApproveRelease, CancelJob, CreateJob (+20 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (15): buildPortfolioSnapshot(), getSOLPrice(), refreshSOLPrice(), analyzeMarketMicrostructure(), calculateDepthInRange(), checkMicrostructure(), estimatePriceImpact(), MockJupiterPredictClient (+7 more)

### Community 8 - "Community 8"
Cohesion: 0.1
Nodes (25): decayConfidence(), decaySignalConfidence(), findBucket(), getAllCalibratedWeights(), getCalibratedWeight(), getCalibrationScores(), getConfidenceAdjustment(), saveCalibrationScores() (+17 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (7): RealTimePriceMonitor, registerOpenPositionsFromDB(), invalidateOnBreakingNews(), invalidateOnPriceSpike(), invalidateOnThreshold(), invalidateOnVolumeSurge(), SignalInvalidationManager

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (14): eventsToMarkets(), getMarket(), getTrendingMarkets(), mapJupiterMarketToDb(), searchMarkets(), syncMarketsFromJupiter(), checkMonitoredPositions(), getCachedPrice() (+6 more)

### Community 11 - "Community 11"
Cohesion: 0.27
Nodes (21): getBayesianWeight(), getSignalSourceWeight(), parseWeightOverride(), fail(), main(), pass(), section(), skip() (+13 more)

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (19): getCoinData(), getCryptoSignals(), getGlobalMarket(), getSolanaSignals(), getTopCoins(), aggregateSignals(), buildCryptoAgentConfig(), buildPerMarketDecisionContext() (+11 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (8): acquireLock(), cachedFetch(), cacheKey(), releaseLock(), setCached(), getDeFiSignals(), getSolanaTVL(), getTopProtocols()

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (9): categoryCacheKey(), categoryMetaKey(), fetchAndCacheCategory(), getCachedJupiterEvents(), getCacheStats(), invalidateCategoryCache(), getMarketsForAgent(), MarketEventBus (+1 more)

### Community 15 - "Community 15"
Cohesion: 0.16
Nodes (15): analyzeMarketsInParallel(), analyzeMarketsSequentially(), chunkMarkets(), smartAnalyzeMarkets(), checkCategoryExposure(), checkCooldown(), checkDailyLossLimit(), checkDuplicateMarket() (+7 more)

### Community 16 - "Community 16"
Cohesion: 0.21
Nodes (12): clearPromptCache(), collectEvolutionData(), createPromptVersion(), evolveStep(), generateEvolution(), getActivePrompt(), getActivePrompts(), promotePromptVersion() (+4 more)

### Community 17 - "Community 17"
Cohesion: 0.17
Nodes (1): JupiterPredictClient

### Community 18 - "Community 18"
Cohesion: 0.55
Nodes (14): fail(), main(), pass(), section(), skip(), testAcled(), testCoinGecko(), testDefiLlama() (+6 more)

### Community 19 - "Community 19"
Cohesion: 0.25
Nodes (4): cacheLLMResponse(), calculateSimilarity(), getCachedLLMResponse(), LLMResponseCache

### Community 20 - "Community 20"
Cohesion: 0.14
Nodes (1): AgentFSM

### Community 21 - "Community 21"
Cohesion: 0.35
Nodes (12): acquireLLMSlot(), extractJsonFromText(), getAgentLimiter(), isRetryableError(), normalizeDecisionFields(), parseJsonWithRepair(), quickAnalysis(), quickDecision() (+4 more)

### Community 22 - "Community 22"
Cohesion: 0.21
Nodes (2): getWsUrl(), WSClient

### Community 23 - "Community 23"
Cohesion: 0.73
Nodes (5): getCircuit(), isCircuitOpen(), recordCircuitFailure(), recordCircuitSuccess(), withCircuitBreaker()

### Community 24 - "Community 24"
Cohesion: 0.6
Nodes (5): getAlertKey(), isAlertCooldown(), recordAlert(), sendAlert(), sendWebhookAlert()

### Community 25 - "Community 25"
Cohesion: 0.9
Nodes (4): cleanup(), log(), main(), section()

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

- **Why does `JupiterPredictClient` connect `Community 17` to `Community 7`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **What connects `RegisterAgent`, `UpdateAgent`, `VerifyAgent` to the rest of the system?**
  _29 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._