import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';

interface AgentOption {
  id: string;
  name: string;
  category: string;
}

interface AgentSelectorProps {
  agents: AgentOption[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string | null) => void;
}

const categoryColors: Record<string, string> = {
  politics: Colors.politics,
  sports: Colors.sports,
  geo: Colors.geo,
  crypto: '#F59E0B',
  general: Colors.accent,
};

export function AgentSelector({ agents, selectedAgentId, onSelectAgent }: AgentSelectorProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Filter by Agent</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        <Pressable
          style={[
            styles.chip,
            selectedAgentId === null && styles.chipActive,
          ]}
          onPress={() => onSelectAgent(null)}
        >
          <Text
            style={[
              styles.chipText,
              selectedAgentId === null && styles.chipTextActive,
            ]}
          >
            All Agents
          </Text>
        </Pressable>

        {agents.map((agent) => {
          const isActive = selectedAgentId === agent.id;
          const catColor = categoryColors[agent.category] || Colors.accent;

          return (
            <Pressable
              key={agent.id}
              style={[
                styles.chip,
                isActive && [styles.chipActive, { borderColor: catColor }],
              ]}
              onPress={() => onSelectAgent(isActive ? null : agent.id)}
            >
              <View style={[styles.catDot, { backgroundColor: catColor }]} />
              <Text
                style={[
                  styles.chipText,
                  isActive && [styles.chipTextActive, { color: catColor }],
                ]}
                numberOfLines={1}
              >
                {agent.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.xs,
  },
  label: {
    fontFamily: Fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  catDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
