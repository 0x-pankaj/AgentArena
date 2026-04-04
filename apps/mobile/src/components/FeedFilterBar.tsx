import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';

interface FeedFilterBarProps {
  activeCategory: string;
  onCategoryChange: (category: string) => void;
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
}

const categories = [
  { key: 'all', label: 'All' },
  { key: 'politics', label: 'Politics' },
  { key: 'sports', label: 'Sports' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'geo', label: 'Geo' },
  { key: 'general', label: 'General' },
];

const statusConfig = {
  connected: { color: Colors.success, label: 'Live' },
  connecting: { color: Colors.warning, label: 'Connecting' },
  disconnected: { color: Colors.danger, label: 'Offline' },
};

export function FeedFilterBar({ activeCategory, onCategoryChange, connectionStatus }: FeedFilterBarProps) {
  const statusInfo = statusConfig[connectionStatus];

  return (
    <View style={styles.container}>
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: statusInfo.color }]} />
        <Text style={[styles.statusText, { color: statusInfo.color }]}>
          {statusInfo.label}
        </Text>
        <Text style={styles.separator}>—</Text>
        <Text style={styles.scopeText}>
          {activeCategory === 'all' ? 'All agents' : `${activeCategory.charAt(0).toUpperCase() + activeCategory.slice(1)} agents`}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        {categories.map((cat) => (
          <Pressable
            key={cat.key}
            style={[
              styles.chip,
              activeCategory === cat.key && styles.chipActive,
            ]}
            onPress={() => onCategoryChange(cat.key)}
          >
            <Text
              style={[
                styles.chipText,
                activeCategory === cat.key && styles.chipTextActive,
              ]}
            >
              {cat.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.screenPadding,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    fontWeight: '600',
  },
  separator: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  scopeText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textMuted,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingBottom: 4,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: 'transparent',
  },
  chipActive: {
    backgroundColor: Colors.accent + '22',
    borderColor: Colors.accent,
  },
  chipText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  chipTextActive: {
    color: Colors.accent,
  },
});
