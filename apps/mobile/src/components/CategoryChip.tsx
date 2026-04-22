import React from 'react';
import { Text, StyleSheet, Pressable } from 'react-native';
import { Colors, Fonts, BorderRadius, Spacing } from '../../constants/Colors';

interface CategoryChipProps {
  label: string;
  isActive?: boolean;
  onPress?: () => void;
}

const categoryTints: Record<string, { bg: string; border: string; text: string }> = {
  Geo: { bg: Colors.geo + '18', border: Colors.geo + '44', text: Colors.geo },
  Politics: { bg: Colors.politics + '18', border: Colors.politics + '44', text: Colors.politics },
  Sports: { bg: Colors.sports + '18', border: Colors.sports + '44', text: Colors.sports },
  Crypto: { bg: Colors.accent + '18', border: Colors.accent + '44', text: Colors.accent },
  General: { bg: Colors.textSecondary + '18', border: Colors.textSecondary + '44', text: Colors.textSecondary },
};

export function CategoryChip({ label, isActive = false, onPress }: CategoryChipProps) {
  const tint = categoryTints[label];

  return (
    <Pressable
      style={[
        styles.chip,
        isActive && styles.chipActive,
        !isActive && tint && { backgroundColor: tint.bg, borderColor: tint.border },
      ]}
      onPress={onPress}
    >
      <Text style={[
        styles.label,
        isActive && styles.labelActive,
        !isActive && tint && { color: tint.text },
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  label: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  labelActive: {
    color: Colors.textPrimary,
  },
});
