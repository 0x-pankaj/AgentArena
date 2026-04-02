import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Colors, Fonts, BorderRadius, Spacing } from '../../constants/Colors';

interface AgentCardProps {
  agent: {
    id: string;
    name: string;
    category: string;
    isActive?: boolean;
    isVerified?: boolean;
    runtimeStatus?: {
      state?: string;
      running?: boolean;
      lastRun?: string;
    };
    performance?: {
      totalTrades?: number;
      winningTrades?: number;
      totalPnl?: number | string;
      winRate?: number | string;
      sharpeRatio?: number | string;
      maxDrawdown?: number | string;
    };
  };
  onPress?: () => void;
}

export function AgentCard({ agent, onPress }: AgentCardProps) {
  const categoryColor = Colors[agent.category as keyof typeof Colors] || Colors.accent;
  const perf = agent.performance ?? {};
  const winRate = Number(perf.winRate ?? 0);
  const totalPnl = Number(perf.totalPnl ?? 0);
  const totalTrades = perf.totalTrades ?? 0;

  const runtimeState = agent.runtimeStatus?.state;
  const isActiveAgent = agent.runtimeStatus?.running === true;
  const activeStates = ['SCANNING', 'ANALYZING', 'EXECUTING', 'MONITORING'];
  const isCurrentlyActive = isActiveAgent && activeStates.includes(runtimeState || '');

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={styles.header}>
        <View style={styles.avatarRow}>
          <View style={[styles.avatar, { backgroundColor: (categoryColor as string) + '22' }]}>
            <Text style={[styles.avatarText, { color: categoryColor as string }]}>
              {agent.name.substring(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={styles.nameColumn}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{agent.name}</Text>
              {agent.isVerified && (
                <Text style={styles.verifiedBadge}>✓</Text>
              )}
            </View>
            <View style={[styles.categoryBadge, { backgroundColor: (categoryColor as string) + '22' }]}>
              <Text style={[styles.categoryText, { color: categoryColor as string }]}>
                {agent.category.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.statusDot}>
          {isCurrentlyActive ? (
            <View style={styles.activeContainer}>
              <View style={styles.pulseDot} />
              <Text style={styles.activeText}>Active</Text>
            </View>
          ) : (
            <View
              style={[
                styles.dot,
                { backgroundColor: agent.isActive !== false ? Colors.success : Colors.textMuted },
              ]}
            />
          )}
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>
            {(winRate * 100).toFixed(0)}%
          </Text>
          <Text style={styles.statLabel}>Win Rate</Text>
        </View>
        <View style={styles.stat}>
          <Text
            style={[
              styles.statValue,
              {
                color: totalPnl >= 0 ? Colors.success : Colors.danger,
              },
            ]}
          >
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}
          </Text>
          <Text style={styles.statLabel}>PnL</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{totalTrades}</Text>
          <Text style={styles.statLabel}>Trades</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  cardPressed: {
    opacity: 0.85,
    borderColor: Colors.accent,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontFamily: Fonts.mono,
    fontSize: 16,
    fontWeight: '700',
  },
  nameColumn: {
    gap: Spacing.xs,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  name: {
    fontFamily: Fonts.body,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  verifiedBadge: {
    fontSize: 12,
    color: Colors.accent,
    fontWeight: '700',
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  categoryText: {
    fontFamily: Fonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  statusDot: {
    paddingTop: 4,
    alignItems: 'flex-end',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  activeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.success + '15',
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.success,
  },
  activeText: {
    fontFamily: Fonts.body,
    fontSize: 10,
    fontWeight: '600',
    color: Colors.success,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: {
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontFamily: Fonts.mono,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  statLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textMuted,
  },
});
