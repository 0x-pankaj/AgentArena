import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Fonts, BorderRadius, Spacing } from '../../constants/Colors';

interface AtomBadgeProps {
  tier?: string;
  score?: number;
  size?: 'sm' | 'md' | 'lg';
  showScore?: boolean;
}

const TIER_CONFIG: Record<string, { emoji: string; color: string; bg: string; label: string }> = {
  Unknown: { emoji: '⚪', color: '#9CA3AF', bg: '#9CA3AF22', label: 'Unknown' },
  Bronze: { emoji: '🥉', color: '#CD7F32', bg: '#CD7F3222', label: 'Bronze' },
  Silver: { emoji: '🥈', color: '#C0C0C0', bg: '#C0C0C022', label: 'Silver' },
  Gold: { emoji: '🥇', color: '#FFD700', bg: '#FFD70022', label: 'Gold' },
  Platinum: { emoji: '💎', color: '#E5E4E2', bg: '#E5E4E222', label: 'Platinum' },
  Legendary: { emoji: '👑', color: '#FF4500', bg: '#FF450022', label: 'Legendary' },
};

export function AtomBadge({ tier = 'Unknown', score, size = 'md', showScore = false }: AtomBadgeProps) {
  const config = TIER_CONFIG[tier] ?? TIER_CONFIG.Unknown;
  
  const sizeStyles = {
    sm: { paddingH: Spacing.xs, paddingV: 1, fontSize: 9, scoreFontSize: 8 },
    md: { paddingH: Spacing.sm, paddingV: 2, fontSize: 10, scoreFontSize: 9 },
    lg: { paddingH: Spacing.md, paddingV: Spacing.xs, fontSize: 12, scoreFontSize: 10 },
  };
  
  const s = sizeStyles[size];

  return (
    <View style={[styles.container, { backgroundColor: config.bg, paddingHorizontal: s.paddingH, paddingVertical: s.paddingV }]}>
      <Text style={[styles.emoji, { fontSize: s.fontSize }]}>{config.emoji}</Text>
      <Text style={[styles.label, { color: config.color, fontSize: s.fontSize }]}>
        {config.label}
      </Text>
      {showScore && score !== undefined && score > 0 && (
        <Text style={[styles.score, { fontSize: s.scoreFontSize }]}>
          {score.toFixed(0)}
        </Text>
      )}
    </View>
  );
}

export function AtomBadgeMini({ tier = 'Unknown' }: { tier?: string }) {
  const config = TIER_CONFIG[tier] ?? TIER_CONFIG.Unknown;
  return (
    <View style={[styles.miniContainer, { backgroundColor: config.bg }]}>
      <Text style={[styles.miniEmoji, { color: config.color }]}>{config.emoji}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: BorderRadius.sm,
    alignSelf: 'flex-start',
  },
  emoji: {
    fontSize: 10,
  },
  label: {
    fontFamily: Fonts.body,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  score: {
    fontFamily: Fonts.mono,
    color: Colors.textMuted,
    marginLeft: 2,
  },
  miniContainer: {
    width: 20,
    height: 20,
    borderRadius: BorderRadius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniEmoji: {
    fontSize: 12,
  },
});
