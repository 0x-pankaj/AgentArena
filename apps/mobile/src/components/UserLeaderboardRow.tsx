import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';

interface UserLeaderboardEntry {
  rank: number;
  walletAddress: string;
  username: string | null;
  totalPnl: number;
  totalAgents: number;
  avgWinRate: number;
  totalTrades: number;
  bestAgent: { id: string; name: string; pnl: number };
}

interface UserLeaderboardRowProps {
  entry: UserLeaderboardEntry;
  onPress?: () => void;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.substring(0, 6)}...${addr.slice(-4)}`;
}

export function UserLeaderboardRow({ entry, onPress }: UserLeaderboardRowProps) {
  const { rank, walletAddress, username, totalPnl, totalAgents, avgWinRate, totalTrades, bestAgent } = entry;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={styles.rankCol}>
        <Text style={[styles.rankText, rank <= 3 && styles.topRank]}>
          {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : `#${rank}`}
        </Text>
      </View>

      <View style={styles.infoCol}>
        <Text style={styles.username} numberOfLines={1}>
          {username || truncateAddress(walletAddress)}
        </Text>
        <Text style={styles.meta}>
          {totalAgents} agent{totalAgents !== 1 ? 's' : ''} · {totalTrades} trades
        </Text>
      </View>

      <View style={styles.bestAgentCol}>
        <Text style={styles.bestAgentName} numberOfLines={1}>{bestAgent.name}</Text>
        <Text style={[
          styles.bestAgentPnl,
          { color: bestAgent.pnl >= 0 ? Colors.success : Colors.danger }
        ]}>
          {bestAgent.pnl >= 0 ? '+' : ''}${bestAgent.pnl.toFixed(0)}
        </Text>
      </View>

      <View style={styles.pnlCol}>
        <Text style={[styles.pnlValue, { color: totalPnl >= 0 ? Colors.success : Colors.danger }]}>
          {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}
        </Text>
        <Text style={styles.winRate}>{(avgWinRate * 100).toFixed(0)}% avg</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '44',
  },
  pressed: {
    opacity: 0.7,
    backgroundColor: Colors.surface,
  },
  rankCol: {
    width: 36,
    alignItems: 'center',
  },
  rankText: {
    fontFamily: Fonts.mono,
    fontSize: 14,
    color: Colors.textSecondary,
  },
  topRank: {
    fontSize: 18,
  },
  infoCol: {
    flex: 1,
    gap: 2,
    marginRight: Spacing.sm,
  },
  username: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  meta: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textMuted,
  },
  bestAgentCol: {
    width: 80,
    alignItems: 'flex-end',
    gap: 2,
    marginRight: Spacing.sm,
  },
  bestAgentName: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.accent,
  },
  bestAgentPnl: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    fontWeight: '600',
  },
  pnlCol: {
    width: 70,
    alignItems: 'flex-end',
    gap: 2,
  },
  pnlValue: {
    fontFamily: Fonts.mono,
    fontSize: 14,
    fontWeight: '700',
  },
  winRate: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textMuted,
  },
});
