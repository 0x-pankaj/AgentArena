# Graph Report - apps/api/src/agents  (2026-05-03)

## Corpus Check
- Corpus is ~27,567 words - fits in a single context window. You may not need a graph.

## Summary
- 157 nodes · 198 edges · 12 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `AgentFSM` - 13 edges
2. `runSwarmHooks()` - 5 edges
3. `runPoliticsAgentTick()` - 3 edges
4. `parseWeightOverride()` - 3 edges
5. `scanMarkets()` - 3 edges
6. `buildPortfolioSnapshot()` - 3 edges
7. `runSportsAgentTick()` - 3 edges
8. `runGeneralAgentTick()` - 3 edges
9. `initializeAgentRegistry()` - 3 edges
10. `startAgentLoop()` - 3 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities

### Community 0 - "Sports Agent"
Cohesion: 0.12
Nodes (3): buildSportsAgentConfig(), publishFeedStep(), runSportsAgentTick()

### Community 1 - "Politics Agent"
Cohesion: 0.13
Nodes (3): buildPoliticsAgentConfig(), publishFeedStep(), runPoliticsAgentTick()

### Community 2 - "Supervisor / Agent Lifecycle"
Cohesion: 0.15
Nodes (7): approveJob(), cancelJob(), completeJob(), resumeActiveAgents(), resumeJob(), startAgentLoop(), stopAgentLoop()

### Community 3 - "Crypto Agent"
Cohesion: 0.13
Nodes (3): buildCryptoAgentConfig(), publishFeedStep(), runCryptoAgentTick()

### Community 4 - "General Agent"
Cohesion: 0.14
Nodes (3): buildGeneralAgentConfig(), publishFeedStep(), runGeneralAgentTick()

### Community 5 - "Execution Engine"
Cohesion: 0.21
Nodes (6): buildPortfolioSnapshot(), getSOLPrice(), refreshSOLPrice(), scanAndRankMarkets(), scanMarkets(), scanMarketsWithResearch()

### Community 6 - "Agent FSM"
Cohesion: 0.15
Nodes (1): AgentFSM

### Community 7 - "Swarm Hooks Tests"
Cohesion: 0.21
Nodes (5): collectSwarmVotes(), detectDelegationOpportunity(), requestPeerAnalysis(), runSwarmHooks(), shouldTriggerConsensus()

### Community 8 - "Enhanced Pipeline + Shared Helpers"
Cohesion: 0.18
Nodes (0): 

### Community 9 - "Pipeline Utils + Strategy Engine"
Cohesion: 0.2
Nodes (0): 

### Community 10 - "Signal Weights"
Cohesion: 0.47
Nodes (3): getBayesianWeight(), getSignalSourceWeight(), parseWeightOverride()

### Community 11 - "Agent Registry"
Cohesion: 0.47
Nodes (3): initializeAgentRegistry(), listRegisteredAgents(), registerAgent()

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AgentFSM` connect `Agent FSM` to `Enhanced Pipeline + Shared Helpers`?**
  _High betweenness centrality (0.130) - this node is a cross-community bridge._
- **Should `Sports Agent` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `Politics Agent` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._
- **Should `Crypto Agent` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._
- **Should `General Agent` be split into smaller, more focused modules?**
  _Cohesion score 0.14 - nodes in this community are weakly interconnected._