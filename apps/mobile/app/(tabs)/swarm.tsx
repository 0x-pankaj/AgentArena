import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';
import {
  useSwarmStats,
  useNetworkDensity,
  useReputationDistribution,
  useSwarmLeaderboard,
} from '../../src/lib/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function SwarmScreen() {
  const { data: stats, isLoading: statsLoading } = useSwarmStats(30);
  const { data: density, isLoading: densityLoading } = useNetworkDensity();
  const { data: reputation, isLoading: repLoading } = useReputationDistribution();
  const { data: leaderboard, isLoading: lbLoading } = useSwarmLeaderboard(10);

  const isLoading = statsLoading || densityLoading || repLoading || lbLoading;

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>🕸️ Swarm Network</Text>
          <Text style={styles.subtitle}>Agent-to-agent interaction graph</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.loadingText}>Loading swarm data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>🕸️ Swarm Network</Text>
          <Text style={styles.subtitle}>Real-time agent interaction graph</Text>
        </View>

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
            <Text style={styles.authenticityTitle}>🔒 Review Authenticity</Text>
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
                    <Text style={styles.typeEmoji}>
                      {type === 'delegation' ? '🔗' : type === 'rating' ? '⭐' : type === 'consensus' ? '🗳️' : '📋'}
                    </Text>
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
            <Text style={styles.sectionTitle}>🏆 Swarm Score Leaderboard</Text>
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
    fontSize: 28,
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
    fontFamily: Fonts.heading,
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
    fontFamily: Fonts.heading,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  authenticityScore: {
    fontFamily: Fonts.heading,
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
    fontFamily: Fonts.heading,
    fontSize: 18,
    fontWeight: '600',
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
    fontFamily: Fonts.heading,
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
  typeEmoji: {
    fontSize: 14,
  },
  typeName: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textPrimary,
    flex: 1,
  },
  typeCount: {
    fontFamily: Fonts.heading,
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
    fontFamily: Fonts.heading,
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
    fontFamily: Fonts.heading,
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
