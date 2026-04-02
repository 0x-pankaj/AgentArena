import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Colors, Fonts, BorderRadius, Spacing } from '../../constants/Colors';

interface FeedItemProps {
  event: {
    event_id?: string;
    timestamp?: string;
    agent_id?: string;
    agent_display_name?: string;
    agentName?: string;
    category?: string;
    severity?: string;
    content?: {
      market_analyzed?: string;
      summary?: string;
      action?: 'buy' | 'sell';
      amount?: string;
      price?: string;
      reasoning_snippet?: string;
      pnl?: { value: number; percent: number };
      confidence?: number;
      edge_percent?: number;
      signals_count?: number;
      markets_scanned?: number;
      pipeline_stage?: string;
    };
    display_message?: string;
    displayMessage?: string;
  };
  onAgentPress?: (agentId: string) => void;
}

const categoryIcons: Record<string, string> = {
  analysis: '🔍',
  trade: '💳',
  decision: '🎯',
  position_update: '📊',
  reasoning: '🧠',
  scanning: '📡',
  thinking: '⚙️',
  signal_update: '📊',
  edge_detected: '💡',
};

const categoryLabels: Record<string, string> = {
  analysis: 'ANALYSIS',
  trade: 'TRADE',
  decision: 'DECISION',
  position_update: 'POSITION',
  reasoning: 'REASONING',
  scanning: 'SCANNING',
  thinking: 'THINKING',
  signal_update: 'SIGNALS',
  edge_detected: 'EDGE FOUND',
};

const severityColors: Record<string, string> = {
  info: Colors.textSecondary,
  significant: Colors.accent,
  critical: Colors.danger,
};

function getTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function FeedItem({ event, onAgentPress }: FeedItemProps) {
  const icon = categoryIcons[event.category ?? ''] || '📋';
  const categoryLabel = categoryLabels[event.category ?? ''] || 'ACTIVITY';
  const severityColor = severityColors[event.severity ?? 'info'] || Colors.textSecondary;
  const agentName = event.agent_display_name ?? event.agentName ?? 'Agent';
  const agentId = event.agent_id;
  const message = event.display_message ?? event.displayMessage ?? '';
  const timestamp = event.timestamp ?? new Date().toISOString();
  const content = event.content ?? {};

  const isThinking = event.category === 'thinking' || event.category === 'scanning';
  const isSignal = event.category === 'signal_update';
  const isEdge = event.category === 'edge_detected';

  return (
    <View style={[styles.card, isEdge && styles.edgeCard]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.icon}>{icon}</Text>
          <Pressable
            onPress={() => agentId && onAgentPress?.(agentId)}
            disabled={!agentId || !onAgentPress}
          >
            <Text style={styles.agentName}>{agentName}</Text>
          </Pressable>
          <View style={[styles.categoryBadge, { borderColor: severityColor }]}>
            <Text style={[styles.categoryText, { color: severityColor }]}>
              {categoryLabel}
            </Text>
          </View>
        </View>
        <Text style={styles.time}>{getTimeAgo(timestamp)}</Text>
      </View>

      <Text style={styles.message}>{message}</Text>

      {/* Thinking/scanning pulse indicator */}
      {isThinking && (
        <View style={styles.thinkingRow}>
          <View style={styles.pulseDot} />
          <Text style={styles.thinkingText}>Processing...</Text>
        </View>
      )}

      {/* Signal stats */}
      {isSignal && content.signals_count != null && (
        <View style={styles.statsRow}>
          <View style={styles.statBadge}>
            <Text style={styles.statValue}>{content.signals_count}</Text>
            <Text style={styles.statLabel}>signals</Text>
          </View>
        </View>
      )}

      {/* Edge detected with confidence + edge % */}
      {isEdge && (
        <View style={styles.edgeStatsRow}>
          {content.edge_percent != null && (
            <View style={styles.edgeBadge}>
              <Text style={styles.edgeValue}>
                +{(content.edge_percent).toFixed(1)}%
              </Text>
              <Text style={styles.edgeLabel}>edge</Text>
            </View>
          )}
          {content.confidence != null && (
            <View style={styles.edgeBadge}>
              <Text style={styles.edgeValue}>
                {(content.confidence * 100).toFixed(0)}%
              </Text>
              <Text style={styles.edgeLabel}>confidence</Text>
            </View>
          )}
        </View>
      )}

      {/* Reasoning snippet */}
      {content.reasoning_snippet && (
        <View style={styles.reasoningBox}>
          <Text style={styles.reasoningText}>
            "{content.reasoning_snippet}"
          </Text>
        </View>
      )}

      {/* Confidence bar */}
      {content.confidence != null && !isEdge && (
        <View style={styles.confidenceRow}>
          <View style={styles.confidenceBar}>
            <View
              style={[
                styles.confidenceFill,
                {
                  width: `${Math.min(content.confidence * 100, 100)}%`,
                  backgroundColor:
                    content.confidence > 0.8
                      ? Colors.success
                      : content.confidence > 0.5
                      ? Colors.accent
                      : Colors.danger,
                },
              ]}
            />
          </View>
          <Text style={styles.confidenceText}>
            {(content.confidence * 100).toFixed(0)}%
          </Text>
        </View>
      )}

      {/* PnL display */}
      {content.pnl && (
        <View style={styles.pnlRow}>
          <Text
            style={[
              styles.pnlValue,
              {
                color: content.pnl.value >= 0 ? Colors.success : Colors.danger,
              },
            ]}
          >
            {content.pnl.value >= 0 ? '+' : ''}${content.pnl.value.toFixed(2)}
          </Text>
          <Text
            style={[
              styles.pnlPercent,
              {
                color: content.pnl.percent >= 0 ? Colors.success : Colors.danger,
              },
            ]}
          >
            ({content.pnl.percent >= 0 ? '+' : ''}{content.pnl.percent.toFixed(1)}%)
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  edgeCard: {
    borderColor: Colors.accent + '66',
    backgroundColor: Colors.accent + '08',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  icon: {
    fontSize: 16,
  },
  agentName: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.accent,
  },
  categoryBadge: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  categoryText: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  time: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textMuted,
  },
  message: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
    opacity: 0.7,
  },
  thinkingText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statValue: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.accent,
  },
  statLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textMuted,
  },
  edgeStatsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  edgeBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    backgroundColor: Colors.accent + '15',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: 6,
  },
  edgeValue: {
    fontFamily: Fonts.mono,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.accent,
  },
  edgeLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textMuted,
  },
  reasoningBox: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accent,
  },
  reasoningText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    fontStyle: 'italic',
    color: Colors.textMuted,
    lineHeight: 18,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  confidenceBar: {
    flex: 1,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    borderRadius: 2,
  },
  confidenceText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.textMuted,
    minWidth: 32,
    textAlign: 'right',
  },
  pnlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  pnlValue: {
    fontFamily: Fonts.mono,
    fontSize: 14,
    fontWeight: '700',
  },
  pnlPercent: {
    fontFamily: Fonts.mono,
    fontSize: 12,
  },
});
