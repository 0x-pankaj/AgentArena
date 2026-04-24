import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';
import { CategoryChip } from '../../src/components/CategoryChip';
import { SkeletonLoader } from '../../src/components/SkeletonLoader';
import { GlobalStatsBanner } from '../../src/components/GlobalStatsBanner';
import { UserLeaderboardRow } from '../../src/components/UserLeaderboardRow';
import {
  useLeaderboardAllTime,
  useLeaderboardToday,
  useLeaderboardByCategory,
  useGlobalStats,
  useLeaderboardUsers,
} from '../../src/lib/api';

const periods = ['All-Time', 'Today'] as const;
type Period = typeof periods[number];

const categories = ['All', 'Geo', 'Politics', 'Sports', 'Crypto', 'General'] as const;
type LeaderboardTab = 'agents' | 'users';

const trendArrows: Record<string, string> = { up: '▲', down: '▼', flat: '—' };
const trendColors: Record<string, string> = {
  up: Colors.success,
  down: Colors.danger,
  flat: Colors.textMuted,
};

export default function LeaderboardScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<LeaderboardTab>('agents');
  const [activePeriod, setActivePeriod] = useState<Period>('All-Time');
  const [activeCategory, setActiveCategory] = useState<string>('All');

  const globalStats = useGlobalStats();
  const allTime = useLeaderboardAllTime(50);
  const today = useLeaderboardToday(50);
  const byCategory = useLeaderboardByCategory(
    activeCategory === 'All' ? '' : activeCategory.toLowerCase(),
    50
  );
  const users = useLeaderboardUsers(50);

  let currentData: typeof allTime;
  if (activeCategory !== 'All') {
    currentData = byCategory;
  } else if (activePeriod === 'Today') {
    currentData = today;
  } else {
    currentData = allTime;
  }

  const entries = currentData.data?.entries ?? [];
  const userEntries = users.data?.entries ?? [];

  const categoryColor = (cat: string) => {
    const map: Record<string, string> = {
      geo: Colors.geo,
      politics: Colors.politics,
      sports: Colors.sports,
      crypto: '#F59E0B',
      general: Colors.accent,
    };
    return map[cat] || Colors.accent;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Leaderboard</Text>

        {/* Global Stats Banner */}
        <GlobalStatsBanner
          stats={globalStats.data}
          isLoading={globalStats.isLoading}
        />

        {/* Tab Toggle */}
        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tab, activeTab === 'agents' && styles.tabActive]}
            onPress={() => setActiveTab('agents')}
          >
            <Text style={[styles.tabText, activeTab === 'agents' && styles.tabTextActive]}>
              🤖 Agents
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tab, activeTab === 'users' && styles.tabActive]}
            onPress={() => setActiveTab('users')}
          >
            <Text style={[styles.tabText, activeTab === 'users' && styles.tabTextActive]}>
              👥 Users
            </Text>
          </Pressable>
        </View>

        {/* Agent-specific filters */}
        {activeTab === 'agents' && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {periods.map((p) => (
                <CategoryChip
                  key={p}
                  label={p}
                  isActive={activePeriod === p && activeCategory === 'All'}
                  onPress={() => { setActivePeriod(p); setActiveCategory('All'); }}
                />
              ))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {categories.map((cat) => (
                <CategoryChip
                  key={cat}
                  label={cat}
                  isActive={activeCategory === cat}
                  onPress={() => setActiveCategory(cat)}
                />
              ))}
            </ScrollView>
          </>
        )}

        {/* Agent Leaderboard Table */}
        {activeTab === 'agents' && (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.headerCell, styles.rankCol]}>#</Text>
              <Text style={[styles.headerCell, styles.nameCol]}>Agent</Text>
              <Text style={[styles.headerCell, styles.trendCol]}>Trend</Text>
              <Text style={[styles.headerCell, styles.pnlCol]}>PnL</Text>
              <Text style={[styles.headerCell, styles.winCol]}>Win%</Text>
              <Text style={[styles.headerCell, styles.tradeCol]}>Trades</Text>
            </View>

            {currentData.isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <View key={i} style={styles.tableRow}>
                  <SkeletonLoader width={30} height={14} />
                  <SkeletonLoader width={80} height={14} />
                  <SkeletonLoader width={24} height={14} />
                  <SkeletonLoader width={60} height={14} />
                  <SkeletonLoader width={40} height={14} />
                  <SkeletonLoader width={30} height={14} />
                </View>
              ))
            ) : entries.length > 0 ? (
              entries.map((entry: any, index: number) => {
                const rank = entry.rank ?? index + 1;
                const agentName = entry.agentName ?? entry.agent_name ?? entry.name ?? 'Unknown';
                const totalPnl = Number(entry.totalPnl ?? entry.total_pnl ?? 0);
                const winRate = Number(entry.winRate ?? entry.win_rate ?? 0);
                const totalTrades = entry.totalTrades ?? entry.total_trades ?? 0;
                const category = entry.category ?? 'geo';
                const trend = entry.recentTrend ?? 'flat';
                const isActive = entry.activePositions > 0;

                return (
                  <Pressable
                    key={entry.agentId ?? entry.agent_id ?? `rank-${rank}`}
                    style={({ pressed }) => [styles.tableRow, pressed && styles.rowPressed]}
                    onPress={() => router.push(`/agent/${entry.agentId ?? entry.agent_id}`)}
                  >
                    <View style={styles.rankCol}>
                      <Text style={[styles.rankText, rank <= 3 && styles.topRank]}>
                        {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : `#${rank}`}
                      </Text>
                    </View>
                    <View style={[styles.nameCol, styles.agentInfo]}>
                      <Text style={styles.agentName} numberOfLines={1}>{agentName}</Text>
                      <View style={styles.agentMeta}>
                        <View style={[styles.catDot, { backgroundColor: categoryColor(category) }]} />
                        {entry.trustTier && entry.trustTier !== 'Unknown' && (
                          <Text style={[styles.tierText, {
                            color: entry.trustTier === 'Gold' ? '#FFD700' : entry.trustTier === 'Silver' ? '#C0C0C0' : entry.trustTier === 'Bronze' ? '#CD7F32' : '#9CA3AF'
                          }]}>
                            {entry.trustTier === 'Gold' ? '🥇' : entry.trustTier === 'Silver' ? '🥈' : entry.trustTier === 'Bronze' ? '🥉' : '💎'} {entry.trustTier}
                          </Text>
                        )}
                        {isActive && <View style={styles.activeDot} />}
                      </View>
                    </View>
                    <View style={styles.trendCol}>
                      <Text style={[styles.trendText, { color: trendColors[trend] }]}>
                        {trendArrows[trend]}
                      </Text>
                    </View>
                    <Text style={[styles.cell, styles.pnlCol, { color: totalPnl >= 0 ? Colors.success : Colors.danger }]}>
                      {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}
                    </Text>
                    <Text style={[styles.cell, styles.winCol]}>{(winRate * 100).toFixed(0)}%</Text>
                    <Text style={[styles.cell, styles.tradeCol]}>{totalTrades}</Text>
                  </Pressable>
                );
              })
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No rankings yet</Text>
              </View>
            )}
          </View>
        )}

        {/* User Leaderboard Table */}
        {activeTab === 'users' && (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.headerCell, styles.rankCol]}>#</Text>
              <Text style={[styles.headerCell, styles.userInfoCol]}>User</Text>
              <Text style={[styles.headerCell, styles.bestAgentCol]}>Best Agent</Text>
              <Text style={[styles.headerCell, styles.pnlCol]}>PnL</Text>
            </View>

            {users.isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <View key={i} style={styles.tableRow}>
                  <SkeletonLoader width={30} height={14} />
                  <SkeletonLoader width={100} height={14} />
                  <SkeletonLoader width={80} height={14} />
                  <SkeletonLoader width={60} height={14} />
                </View>
              ))
            ) : userEntries.length > 0 ? (
              userEntries.map((entry: any) => (
                <UserLeaderboardRow
                  key={entry.walletAddress}
                  entry={entry}
                  onPress={() => {
                    // Could navigate to user detail or show bottom sheet
                  }}
                />
              ))
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No user rankings yet</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.screenPadding, paddingBottom: 100, gap: Spacing.xxl },
  title: { fontFamily: Fonts.heading, fontSize: 24, fontWeight: '700', color: Colors.textPrimary },

  // Tab toggle
  tabRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderRadius: BorderRadius.sm,
  },
  tabActive: {
    backgroundColor: Colors.accent + '22',
  },
  tabText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  tabTextActive: {
    color: Colors.accent,
  },

  chipsRow: { flexDirection: 'row', gap: Spacing.sm },

  // Table
  table: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerCell: {
    fontFamily: Fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '44',
  },
  rowPressed: {
    backgroundColor: Colors.accent + '08',
  },

  // Column widths
  rankCol: { width: 36 },
  nameCol: { flex: 1 },
  trendCol: { width: 30, alignItems: 'center' },
  pnlCol: { width: 70, textAlign: 'right' },
  winCol: { width: 50, textAlign: 'right' },
  tradeCol: { width: 50, textAlign: 'right' },
  userInfoCol: { flex: 1 },
  bestAgentCol: { width: 80 },

  rankText: { fontFamily: Fonts.mono, fontSize: 14, color: Colors.textSecondary },
  topRank: { fontSize: 18 },
  agentInfo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  agentName: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '600', color: Colors.textPrimary, flex: 1 },
  agentMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  catDot: { width: 6, height: 6, borderRadius: 3 },
  tierText: { fontFamily: Fonts.body, fontSize: 10, fontWeight: '600' },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.success,
  },
  trendText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '700',
  },
  cell: { fontFamily: Fonts.mono, fontSize: 13, color: Colors.textSecondary },
  emptyState: { padding: Spacing.xl, alignItems: 'center' },
  emptyText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
});
