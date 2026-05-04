import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Pressable,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';
import {
  useSwarmStats,
  useNetworkDensity,
  useReputationDistribution,
  useSwarmLeaderboard,
  useSwarmGraph,
  useEdgeDetails,
} from '../../src/lib/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type TypeFilter = 'all' | 'delegation' | 'consensus' | 'rating';
type DaysFilter = 1 | 7 | 30;

export default function SwarmScreen() {
  // Default to 7 days + delegation-only — that's the cleanest signal for
  // "who actually asked whom" and avoids the legacy 30-day bucket where
  // recursive-delegation cascades from before c6c5934 still distort the
  // picture (sports → general → crypto → politics chains).
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('delegation');
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(7);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useSwarmStats(daysFilter);
  const { data: density, isLoading: densityLoading, refetch: refetchDensity } = useNetworkDensity();
  const { data: reputation, isLoading: repLoading, refetch: refetchReputation } = useReputationDistribution();
  const { data: leaderboard, isLoading: lbLoading, refetch: refetchLeaderboard } = useSwarmLeaderboard(10);
  const { data: graph, isLoading: graphLoading, refetch: refetchGraph } = useSwarmGraph(undefined, daysFilter);

  const isLoading = statsLoading || densityLoading || repLoading || lbLoading || graphLoading;

  const [refreshing, setRefreshing] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);

  // Apply the type filter client-side (the API returns all types — keeps
  // a single cache entry per time window). Then drop nodes that have no
  // visible edges so the focus mode reads cleanly.
  const filteredEdges = useMemo(() => {
    if (!graph?.edges) return [];
    if (typeFilter === 'all') return graph.edges;
    return graph.edges.filter((e: GraphEdge) =>
      (e.byType?.[typeFilter] ?? 0) > 0,
    );
  }, [graph?.edges, typeFilter]);

  const visibleNodes = useMemo(() => {
    if (!graph?.nodes) return [];
    const ids = new Set<string>();
    for (const e of filteredEdges) {
      ids.add(e.source);
      ids.add(e.target);
    }
    // If a node was tapped but has no edges in the current filter, still
    // keep it visible so the focus banner makes sense.
    if (focusedNodeId) ids.add(focusedNodeId);
    return graph.nodes.filter((n: GraphNode) => ids.has(n.id));
  }, [graph?.nodes, filteredEdges, focusedNodeId]);

  const focusedNode = useMemo(
    () => visibleNodes.find((n: GraphNode) => n.id === focusedNodeId) ?? null,
    [visibleNodes, focusedNodeId],
  );

  // Tap-to-focus: first tap focuses, second tap on same node opens details.
  const handleNodeTap = useCallback(
    (n: GraphNode) => {
      if (focusedNodeId === n.id) {
        setSelectedNode(n);
      } else {
        setFocusedNodeId(n.id);
      }
    },
    [focusedNodeId],
  );

  const clearFocus = useCallback(() => setFocusedNodeId(null), []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      refetchStats(),
      refetchDensity(),
      refetchReputation(),
      refetchLeaderboard(),
      refetchGraph(),
    ]);
    setRefreshing(false);
  }, [refetchStats, refetchDensity, refetchReputation, refetchLeaderboard, refetchGraph]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} colors={[Colors.accent]} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Swarm Network</Text>
          <Text style={styles.subtitle}>Real-time agent interaction graph</Text>
        </View>

        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={styles.loadingText}>Loading swarm data...</Text>
          </View>
        )}

        {/* Filter chips — shape what the graph shows BEFORE visuals */}
        {!isLoading && graph?.nodes?.length ? (
          <View style={styles.filterRowGroup}>
            <FilterChipRow
              label="Show"
              options={[
                { value: 'delegation', label: 'Delegations' },
                { value: 'consensus', label: 'Consensus' },
                { value: 'rating', label: 'Ratings' },
                { value: 'all', label: 'All' },
              ]}
              value={typeFilter}
              onChange={(v) => setTypeFilter(v as TypeFilter)}
            />
            <FilterChipRow
              label="Window"
              options={[
                { value: 1, label: '24h' },
                { value: 7, label: '7d' },
                { value: 30, label: '30d' },
              ]}
              value={daysFilter}
              onChange={(v) => setDaysFilter(v as DaysFilter)}
            />
          </View>
        ) : null}

        {/* Graph Visualization */}
        {!isLoading && (
          <View style={styles.graphSection}>
            {graph && visibleNodes.length > 0 ? (
              <>
                {focusedNode && (
                  <View style={styles.focusBanner}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.focusBannerLabel}>Focused on</Text>
                      <Text style={styles.focusBannerName}>
                        {focusedNode.name} — outgoing {typeFilter === 'all' ? 'interactions' : `${typeFilter}s`} only
                      </Text>
                    </View>
                    <Pressable onPress={clearFocus} hitSlop={10} style={styles.focusBannerClear}>
                      <Ionicons name="close" size={16} color={Colors.textPrimary} />
                    </Pressable>
                  </View>
                )}
                <SwarmGraphView
                  nodes={visibleNodes}
                  edges={filteredEdges}
                  focusedNodeId={focusedNodeId}
                  onNodeTap={handleNodeTap}
                  onEdgeTap={setSelectedEdge}
                />
                <Text style={styles.graphHint}>
                  {focusedNodeId
                    ? `Tap ${focusedNode?.name ?? 'node'} again for full details · tap another node to switch focus`
                    : 'Tap a node to focus on its outgoing connections · tap an edge for details'}
                </Text>
                <View style={styles.graphSummary}>
                  <Text style={styles.graphSummaryText}>
                    {visibleNodes.length} agents · {filteredEdges.length} {typeFilter === 'all' ? 'edge' : typeFilter} edge
                    {filteredEdges.length === 1 ? '' : 's'} · last {daysFilter}d
                  </Text>
                </View>
              </>
            ) : (
              <View style={styles.graphEmpty}>
                <Ionicons name="git-network-outline" size={36} color={Colors.textMuted} />
                <Text style={styles.graphEmptyTitle}>
                  {graph?.nodes?.length ? `No ${typeFilter}s in last ${daysFilter}d` : 'Swarm warming up'}
                </Text>
                <Text style={styles.graphEmptyText}>
                  {graph?.nodes?.length
                    ? 'Try a wider time window or a different interaction type.'
                    : 'Agents will start delegating, voting, and rating each other as they trade. First interactions appear within minutes.'}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Network Stats Cards */}
        <View style={styles.statsGrid}>
          <StatCard
            label="Interactions"
            value={stats?.totalInteractions ?? 0}
            color={Colors.accent}
          />
          <StatCard
            label="Consensus"
            value={stats?.consensusRounds ?? 0}
            color={Colors.success}
          />
          <StatCard
            label="Density"
            value={density?.density ? `${(density.density * 100).toFixed(1)}%` : '0%'}
            color={Colors.warning}
          />
          <StatCard
            label="On-Chain"
            value={stats?.onChainVerified ?? 0}
            color={Colors.accent}
          />
        </View>

        {/* Review Authenticity */}
        <View style={styles.authenticityCard}>
          <View style={styles.authenticityHeader}>
            <Text style={styles.authenticityTitle}>Review Authenticity</Text>
            <Text style={styles.authenticityScore}>
              {stats?.reviewAuthenticityRate?.toFixed?.(1) ?? 0}%
            </Text>
          </View>
          <View style={styles.authenticityBar}>
            <View
              style={[
                styles.authenticityFill,
                {
                  width: `${Math.min(stats?.reviewAuthenticityRate ?? 0, 100)}%`,
                },
              ]}
            />
          </View>
          <Text style={styles.authenticitySubtitle}>
            {stats?.onChainVerified ?? 0} of {stats?.totalInteractions ?? 0} interactions verified on-chain
          </Text>
        </View>

        {/* Interaction Type Breakdown */}
        {stats?.byType && Object.keys(stats.byType).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Interaction Types</Text>
            <View style={styles.typeList}>
              {Object.entries(stats.byType).map(([type, count]) => (
                <View key={type} style={styles.typeRow}>
                  <View style={styles.typeDot}>
                    <Ionicons
                      name={type === 'delegation' ? 'link' : type === 'rating' ? 'star' : type === 'consensus' ? 'people' : 'document-text'}
                      size={14}
                      color={Colors.accent}
                    />
                  </View>
                  <Text style={styles.typeName}>{type.charAt(0).toUpperCase() + type.slice(1)}</Text>
                  <Text style={styles.typeCount}>{count as number}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Network Density Detail */}
        {density && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Network Topology</Text>
            <View style={styles.detailCard}>
              <DetailRow label="Agents" value={String(density.agentCount)} />
              <DetailRow label="Possible Edges" value={String(density.possibleEdges)} />
              <DetailRow label="Actual Edges" value={String(density.actualEdges)} />
              <DetailRow label="Density" value={`${(density.density * 100).toFixed(2)}%`} />
              <DetailRow label="Clustering" value={`${(density.clusteringCoefficient * 100).toFixed(2)}%`} />
            </View>
          </View>
        )}

        {/* Reputation Distribution */}
        {reputation && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reputation Distribution</Text>
            <View style={styles.detailCard}>
              <DetailRow label="Total Agents" value={String(reputation.totalAgents)} />
              <DetailRow label="Average Score" value={`${reputation.averageScore}`} />
              {Object.entries(reputation.byTier).map(([tier, count]) => (
                <DetailRow key={tier} label={tier} value={String(count)} />
              ))}
            </View>
          </View>
        )}

        {/* Swarm Leaderboard */}
        {leaderboard && leaderboard.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Swarm Score Leaderboard</Text>
            <View style={styles.leaderboardCard}>
              {leaderboard.map((agent: any, index: number) => (
                <View key={agent.id} style={styles.leaderboardRow}>
                  <Text style={styles.leaderboardRank}>#{index + 1}</Text>
                  <View style={styles.leaderboardInfo}>
                    <Text style={styles.leaderboardName}>{agent.name}</Text>
                    <Text style={styles.leaderboardCategory}>{agent.category}</Text>
                  </View>
                  <View style={styles.leaderboardScoreContainer}>
                    <Text style={styles.leaderboardScore}>{agent.swarmScore?.toFixed?.(1) ?? 0}</Text>
                    <Text style={styles.leaderboardTier}>{agent.trustTier}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {selectedNode && (
        <NodeDetailsModal
          node={selectedNode}
          allNodes={graph?.nodes ?? []}
          edges={graph?.edges ?? []}
          onClose={() => setSelectedNode(null)}
        />
      )}
      {selectedEdge && (
        <EdgeDetailsModal
          edge={selectedEdge}
          nodes={graph?.nodes ?? []}
          onClose={() => setSelectedEdge(null)}
        />
      )}
    </SafeAreaView>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <View style={[styles.statCard, { borderLeftColor: color, borderLeftWidth: 3 }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

// --- Ring-layout graph visualization ---
// Nodes placed on a circle, edges drawn as rotated thin Views.
// Pure RN — no SVG dependency. Edge weight controls line opacity.

// Slightly taller container + extra padding so the always-on node labels
// rendered below each circle don't clip against the bottom border of the
// graph card on small screens.
const GRAPH_HEIGHT = 320;
const GRAPH_PADDING = 36;

const CATEGORY_COLOR: Record<string, string> = {
  crypto: Colors.accent,
  politics: Colors.politics,
  sports: Colors.sports,
  geo: Colors.geo,
  general: Colors.textSecondary,
};

interface GraphNode {
  id: string;
  name: string;
  category: string;
  reputationScore?: number;
  trustTier?: string;
  degree?: {
    out: Record<string, number>;
    in: Record<string, number>;
    totalOut: number;
    totalIn: number;
  };
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  types: string[];
  byType?: Record<string, number>;
  lastInteractionAt?: string | null;
  recentMarkets?: Array<{
    marketId: string | null;
    marketQuestion: string | null;
    type: string;
    at: string | null;
  }>;
}

function SwarmGraphView({
  nodes,
  edges,
  focusedNodeId,
  onNodeTap,
  onEdgeTap,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusedNodeId?: string | null;
  onNodeTap: (n: GraphNode) => void;
  onEdgeTap: (e: GraphEdge) => void;
}) {
  const width = SCREEN_WIDTH - Spacing.lg * 2;
  const radius = Math.min(width, GRAPH_HEIGHT) / 2 - GRAPH_PADDING - 18;
  const cx = width / 2;
  const cy = GRAPH_HEIGHT / 2;

  // Layout: place nodes evenly around a circle
  const positioned = nodes.map((node, i) => {
    const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    return {
      ...node,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
  const posById = new Map(positioned.map((p) => [p.id, p]));

  const maxWeight = edges.reduce((m, e) => Math.max(m, e.weight), 1);
  // Scale node radius with total degree so heavy hubs read as bigger.
  const maxDegree = nodes.reduce(
    (m, n) => Math.max(m, (n.degree?.totalOut ?? 0) + (n.degree?.totalIn ?? 0)),
    1,
  );

  return (
    <View style={[styles.graphContainer, { width, height: GRAPH_HEIGHT }]}>
      {/* Edges — wrapped in Pressable with a tall hit area */}
      {edges.map((e, i) => {
        const a = posById.get(e.source);
        const b = posById.get(e.target);
        if (!a || !b) return null;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        // Focus mode: edges that originate from the focused node stay
        // bright; everything else fades to ~10% opacity. This is the
        // "who actually asked whom" answer — only outgoing edges from
        // the focused agent are highlighted.
        const isFocusedEdge = !focusedNodeId || e.source === focusedNodeId;
        const baseOpacity = 0.35 + 0.55 * (e.weight / maxWeight);
        const opacity = isFocusedEdge ? baseOpacity : 0.08;
        const isConsensus = e.types.includes('consensus');
        const isDelegation = e.types.includes('delegation');
        const color = isConsensus ? Colors.success : isDelegation ? Colors.accent : Colors.textMuted;
        // Edge thickness scales with weight (1–3 px). Hit area stays ~14 px.
        const thickness = Math.min(3, 1 + Math.floor((e.weight / maxWeight) * 2));
        const HIT = 14;
        return (
          <Pressable
            key={`${e.source}-${e.target}-${i}`}
            onPress={() => onEdgeTap(e)}
            style={{
              position: 'absolute',
              left: a.x,
              top: a.y - HIT / 2,
              width: length,
              height: HIT,
              transform: [{ translateX: 0 }, { rotate: `${angle}deg` }],
              transformOrigin: '0 50%',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: '100%',
                height: thickness,
                backgroundColor: color,
                opacity,
                borderRadius: thickness / 2,
              }}
            />
            {/* Direction arrow at midpoint, oriented along the edge. */}
            <View
              style={{
                position: 'absolute',
                left: length / 2 - 4,
                top: HIT / 2 - 4,
                width: 0,
                height: 0,
                borderTopWidth: 4,
                borderBottomWidth: 4,
                borderLeftWidth: 6,
                borderTopColor: 'transparent',
                borderBottomColor: 'transparent',
                borderLeftColor: color,
                opacity,
              }}
            />
            {e.weight > 1 && (
              <View
                style={{
                  position: 'absolute',
                  left: length / 2 - 10,
                  top: -2,
                  backgroundColor: Colors.background,
                  paddingHorizontal: 4,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: color,
                  // Counter-rotate so the label stays upright relative to screen.
                  transform: [{ rotate: `${-angle}deg` }],
                }}
              >
                <Text style={{ fontSize: 9, color, fontWeight: '700' }}>{e.weight}</Text>
              </View>
            )}
          </Pressable>
        );
      })}

      {/* Nodes — pressable, scaled by total degree, with always-on labels */}
      {positioned.map((n) => {
        const color = CATEGORY_COLOR[n.category] ?? Colors.textSecondary;
        const initials = (n.name ?? '?').slice(0, 2).toUpperCase();
        const total = (n.degree?.totalOut ?? 0) + (n.degree?.totalIn ?? 0);
        const size = 30 + Math.round(14 * (total / maxDegree));
        // Focused node gets a thicker ring; non-focused fade slightly when
        // *anything* is focused so the highlighted node pops visually.
        const isFocused = focusedNodeId === n.id;
        const isOtherFocused = !!focusedNodeId && !isFocused;
        const borderWidth = isFocused ? 3 : 2;
        const opacity = isOtherFocused ? 0.45 : 1;
        // Short label under the circle — full agent name truncated. Avoid
        // wrapping by capping length; this gives a clear "this is Sports"
        // signal without the cryptic 2-letter initials game.
        const label = (n.name ?? '').replace(/\s*Agent$/i, '').trim().slice(0, 12);
        return (
          <React.Fragment key={n.id}>
            <Pressable
              onPress={() => onNodeTap(n)}
              style={[
                styles.graphNode,
                {
                  left: n.x - size / 2,
                  top: n.y - size / 2,
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  borderWidth,
                  borderColor: color,
                  backgroundColor: color + (isFocused ? '44' : '22'),
                  opacity,
                },
              ]}
            >
              <Text style={[styles.graphNodeText, { color }]}>{initials}</Text>
            </Pressable>
            <Text
              style={[
                styles.graphNodeLabel,
                {
                  left: n.x - 50,
                  top: n.y + size / 2 + 2,
                  color,
                  opacity,
                  fontWeight: isFocused ? '700' : '500',
                },
              ]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </React.Fragment>
        );
      })}

      {/* Legend */}
      <View style={styles.graphLegend}>
        <LegendDot color={Colors.accent} label="delegate" />
        <LegendDot color={Colors.success} label="consensus" />
        <LegendDot color={Colors.textMuted} label="rating" />
      </View>
    </View>
  );
}

// --- Tap-node modal: in/out delegation breakdown + top peers ---

function NodeDetailsModal({
  node,
  allNodes,
  edges,
  onClose,
}: {
  node: GraphNode | null;
  allNodes: GraphNode[];
  edges: GraphEdge[];
  onClose: () => void;
}) {
  const stats = useMemo(() => {
    if (!node) return null;
    const nameById = new Map(allNodes.map((n) => [n.id, n.name]));
    const outgoing = edges
      .filter((e) => e.source === node.id)
      .map((e) => ({ peer: nameById.get(e.target) ?? e.target, ...e }))
      .sort((a, b) => b.weight - a.weight);
    const incoming = edges
      .filter((e) => e.target === node.id)
      .map((e) => ({ peer: nameById.get(e.source) ?? e.source, ...e }))
      .sort((a, b) => b.weight - a.weight);
    return { outgoing, incoming };
  }, [node, allNodes, edges]);

  if (!node || !stats) return null;
  const d = node.degree ?? { out: {}, in: {}, totalOut: 0, totalIn: 0 };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalContainer} edges={['top']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>{node.name}</Text>
              <Text style={styles.modalSubtitle}>{node.category} agent</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.modalGrid}>
            <ModalStat label="Sent" value={d.totalOut} color={Colors.accent} />
            <ModalStat label="Received" value={d.totalIn} color={Colors.success} />
            <ModalStat
              label="Delegations out"
              value={(d.out.delegation ?? 0) as number}
              color={Colors.accent}
            />
            <ModalStat
              label="Delegations in"
              value={(d.in.delegation ?? 0) as number}
              color={Colors.success}
            />
          </View>

          <Text style={styles.modalSectionTitle}>Top peers (sent to)</Text>
          {stats.outgoing.length === 0 ? (
            <Text style={styles.modalEmpty}>No outgoing interactions yet.</Text>
          ) : (
            stats.outgoing.slice(0, 5).map((p, i) => (
              <View key={i} style={styles.modalRow}>
                <Text style={styles.modalRowName}>{p.peer}</Text>
                <Text style={styles.modalRowMeta}>{p.weight} · {p.types.join(', ')}</Text>
              </View>
            ))
          )}

          <Text style={styles.modalSectionTitle}>Top peers (received from)</Text>
          {stats.incoming.length === 0 ? (
            <Text style={styles.modalEmpty}>No incoming interactions yet.</Text>
          ) : (
            stats.incoming.slice(0, 5).map((p, i) => (
              <View key={i} style={styles.modalRow}>
                <Text style={styles.modalRowName}>{p.peer}</Text>
                <Text style={styles.modalRowMeta}>{p.weight} · {p.types.join(', ')}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// --- Tap-edge modal: per-type counts + recent markets ---

function EdgeDetailsModal({
  edge,
  nodes,
  onClose,
}: {
  edge: GraphEdge | null;
  nodes: GraphNode[];
  onClose: () => void;
}) {
  const fromName = useMemo(
    () => (edge ? nodes.find((n) => n.id === edge.source)?.name ?? edge.source : ''),
    [edge, nodes],
  );
  const toName = useMemo(
    () => (edge ? nodes.find((n) => n.id === edge.target)?.name ?? edge.target : ''),
    [edge, nodes],
  );

  const { data: details, isLoading } = useEdgeDetails(edge?.source, edge?.target, 30);

  if (!edge) return null;

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalContainer} edges={['top']}>
        <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>{fromName} → {toName}</Text>
              <Text style={styles.modalSubtitle}>
                {edge.weight} interaction{edge.weight === 1 ? '' : 's'} (last 30d)
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.modalGrid}>
            {Object.entries(edge.byType ?? {}).map(([type, count]) => (
              <ModalStat
                key={type}
                label={type}
                value={count}
                color={
                  type === 'delegation' ? Colors.accent
                  : type === 'consensus' ? Colors.success
                  : Colors.warning
                }
              />
            ))}
          </View>

          <Text style={styles.modalSectionTitle}>Recent interactions</Text>
          {isLoading ? (
            <ActivityIndicator color={Colors.accent} style={{ marginTop: Spacing.md }} />
          ) : !details?.interactions || details.interactions.length === 0 ? (
            <Text style={styles.modalEmpty}>No recent interactions.</Text>
          ) : (
            details.interactions.slice(0, 10).map((i: any) => (
              <View key={i.id} style={styles.modalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalRowName} numberOfLines={1}>
                    {i.marketQuestion ?? i.marketId ?? '(no market)'}
                  </Text>
                  <Text style={styles.modalRowMeta}>
                    {i.type} · {i.at ? new Date(i.at).toLocaleString() : ''}
                    {i.confidence != null ? ` · conf ${i.confidence.toFixed(0)}%` : ''}
                    {i.onChain ? ' · ⛓ on-chain' : ''}
                  </Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// --- Filter chip row: horizontal scrolling pill selector ---

function FilterChipRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.filterRow}>
      <Text style={styles.filterRowLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRowChips}
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <Pressable
              key={String(opt.value)}
              onPress={() => onChange(opt.value)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function ModalStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.modalStat, { borderLeftColor: color }]}>
      <Text style={[styles.modalStatValue, { color }]}>{value}</Text>
      <Text style={styles.modalStatLabel}>{label}</Text>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  title: {
    fontFamily: Fonts.heading,
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  loadingText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textSecondary,
  },
  graphSection: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  graphContainer: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    position: 'relative',
  },
  graphNode: {
    position: 'absolute',
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  graphHint: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.sm,
    fontStyle: 'italic',
  },
  graphSummary: {
    alignItems: 'center',
    marginTop: 4,
  },
  graphSummaryText: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
  },
  graphNodeLabel: {
    position: 'absolute',
    width: 100,
    textAlign: 'center',
    fontFamily: Fonts.body,
    fontSize: 10,
  },
  filterRowGroup: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    gap: Spacing.xs,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  filterRowLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textMuted,
    width: 50,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  filterRowChips: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingRight: Spacing.lg,
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.accent + '22',
    borderColor: Colors.accent,
  },
  filterChipText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textSecondary,
  },
  filterChipTextActive: {
    color: Colors.accent,
    fontWeight: '600',
  },
  focusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.accent + '11',
    borderWidth: 1,
    borderColor: Colors.accent + '55',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  focusBannerLabel: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  focusBannerName: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: 1,
  },
  focusBannerClear: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.lg,
  },
  modalTitle: {
    fontFamily: Fonts.heading,
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  modalSubtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  modalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  modalStat: {
    flexBasis: '47%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderLeftWidth: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalStatValue: {
    fontFamily: Fonts.body,
    fontSize: 22,
    fontWeight: '700',
  },
  modalStatLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  modalSectionTitle: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  modalEmpty: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic',
    paddingVertical: Spacing.sm,
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '44',
  },
  modalRowName: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textPrimary,
    flex: 1,
  },
  modalRowMeta: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  graphNodeText: {
    fontFamily: Fonts.body,
    fontSize: 11,
    fontWeight: '700',
  },
  graphLegend: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    gap: Spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textSecondary,
  },
  graphEmpty: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  graphEmptyTitle: {
    fontFamily: Fonts.body,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: Spacing.xs,
  },
  graphEmptyText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  statCard: {
    width: (SCREEN_WIDTH - Spacing.lg * 2 - Spacing.md * 3) / 2,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statValue: {
    fontFamily: Fonts.body,
    fontSize: 24,
    fontWeight: '700',
  },
  statLabel: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  authenticityCard: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  authenticityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  authenticityTitle: {
    fontFamily: Fonts.body,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  authenticityScore: {
    fontFamily: Fonts.body,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.success,
  },
  authenticityBar: {
    height: 8,
    backgroundColor: Colors.border,
    borderRadius: BorderRadius.sm,
    overflow: 'hidden',
  },
  authenticityFill: {
    height: '100%',
    backgroundColor: Colors.success,
    borderRadius: BorderRadius.sm,
  },
  authenticitySubtitle: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
  },
  section: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  sectionTitle: {
    fontFamily: Fonts.body,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  detailCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '44',
  },
  detailLabel: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textSecondary,
  },
  detailValue: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  typeList: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '44',
  },
  typeDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.accent + '22',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  typeName: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textPrimary,
    flex: 1,
  },
  typeCount: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.accent,
  },
  leaderboardCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '44',
  },
  leaderboardRank: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.accent,
    width: 36,
  },
  leaderboardInfo: {
    flex: 1,
  },
  leaderboardName: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  leaderboardCategory: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textSecondary,
    textTransform: 'capitalize',
  },
  leaderboardScoreContainer: {
    alignItems: 'flex-end',
  },
  leaderboardScore: {
    fontFamily: Fonts.body,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.accent,
  },
  leaderboardTier: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textSecondary,
  },
});
