import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';
import { SkeletonLoader } from './SkeletonLoader';

interface GlobalStatsData {
  totalVolume: number;
  totalPnl: number;
  activeAgents: number;
  totalTrades: number;
  totalUsers: number;
  topCategory: string;
}

interface GlobalStatsBannerProps {
  stats?: GlobalStatsData;
  isLoading: boolean;
}

function formatCurrency(value: number): string {
  if (value === 0) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatNumber(value: number): string {
  if (value === 0) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function GlobalStatsBanner({ stats, isLoading }: GlobalStatsBannerProps) {
  if (isLoading || !stats) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.container}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.card}>
            <SkeletonLoader width={60} height={12} />
            <SkeletonLoader width={80} height={20} />
          </View>
        ))}
      </ScrollView>
    );
  }

  const statItems = [
    {
      label: 'Total Volume',
      value: formatCurrency(stats.totalVolume),
      icon: '💰',
      color: Colors.accent,
    },
    {
      label: 'Platform PnL',
      value: stats.totalPnl === 0 ? "—" : `${stats.totalPnl > 0 ? '+' : ''}${formatCurrency(stats.totalPnl)}`,
      icon: '📈',
      color: stats.totalPnl > 0 ? Colors.success : stats.totalPnl < 0 ? Colors.danger : Colors.textPrimary,
    },
    {
      label: 'Active Agents',
      value: String(stats.activeAgents),
      icon: '🤖',
      color: Colors.accent,
    },
    {
      label: 'Total Trades',
      value: formatNumber(stats.totalTrades),
      icon: '⚡',
      color: Colors.textPrimary,
    },
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {statItems.map((item, index) => (
        <View key={index} style={styles.card}>
          <Text style={styles.icon}>{item.icon}</Text>
          <Text style={[styles.value, { color: item.color }]}>{item.value}</Text>
          <Text style={styles.label}>{item.label}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minWidth: 110,
    alignItems: 'center',
    gap: 4,
  },
  icon: {
    fontSize: 16,
  },
  value: {
    fontFamily: Fonts.mono,
    fontSize: 18,
    fontWeight: '700',
  },
  label: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
