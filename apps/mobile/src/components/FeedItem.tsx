import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, LayoutAnimation, Platform, UIManager } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  withDelay,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Colors, Fonts, BorderRadius, Spacing } from '../../constants/Colors';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  isActive?: boolean;
  index?: number;
  onReact?: (eventId: string, emoji: string) => void;
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

const REACTIONS = ['🔥', '📈', '🤔', '💎'];

// ─── Sub-components ───────────────────────────────────────────

function PulseDot() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.7);

  useEffect(() => {
    scale.value = withRepeat(withTiming(1.5, { duration: 1000 }), -1, true);
    opacity.value = withRepeat(withTiming(0.3, { duration: 1000 }), -1, true);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return <Animated.View style={[styles.pulseDot, animatedStyle]} />;
}

function AnimatedConfidenceBar({ confidence }: { confidence: number }) {
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withSpring(Math.min(confidence * 100, 100), {
      damping: 15,
      stiffness: 120,
    });
  }, [confidence]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${width.value}%`,
  }));

  const fillColor =
    confidence > 0.8 ? Colors.success : confidence > 0.5 ? Colors.accent : Colors.danger;

  return (
    <View style={styles.confidenceRow}>
      <View style={styles.confidenceBar}>
        <Animated.View style={[styles.confidenceFill, { backgroundColor: fillColor }, animatedStyle]} />
      </View>
      <Text style={styles.confidenceText}>{(confidence * 100).toFixed(0)}%</Text>
    </View>
  );
}

function TimeAgo({ timestamp }: { timestamp: string }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const diff = now - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  let display: string;
  if (mins < 1) display = 'Just now';
  else if (mins < 60) display = `${mins}m ago`;
  else {
    const hours = Math.floor(mins / 60);
    display = hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
  }

  return <Text style={styles.time}>{display}</Text>;
}

function ReactionBar({ eventId, onReact }: { eventId?: string; onReact?: (eventId: string, emoji: string) => void }) {
  const [userReactions, setUserReactions] = useState<Record<string, number>>({});

  const handlePress = useCallback(
    (emoji: string) => {
      if (!eventId) return;
      setUserReactions((prev) => ({
        ...prev,
        [emoji]: (prev[emoji] || 0) + 1,
      }));
      onReact?.(eventId, emoji);
    },
    [eventId, onReact]
  );

  return (
    <View style={styles.reactionBar}>
      {REACTIONS.map((emoji) => {
        const count = userReactions[emoji] || 0;
        const isActive = count > 0;
        return (
          <Pressable
            key={emoji}
            style={[styles.reactionBtn, isActive && styles.reactionBtnActive]}
            onPress={() => handlePress(emoji)}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={styles.reactionEmoji}>{emoji}</Text>
            {isActive && <Text style={styles.reactionCount}>{count}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────

export function FeedItem({ event, onAgentPress, isActive, index = 0, onReact }: FeedItemProps) {
  const [expanded, setExpanded] = useState(false);

  const icon = categoryIcons[event.category ?? ''] || '📋';
  const categoryLabel = categoryLabels[event.category ?? ''] || 'ACTIVITY';
  const severityColor = severityColors[event.severity ?? 'info'] || Colors.textSecondary;
  const agentName = event.agent_display_name ?? event.agentName ?? 'Agent';
  const agentId = event.agent_id;
  const message = event.display_message ?? event.displayMessage ?? '';
  const timestamp = event.timestamp ?? new Date().toISOString();
  const content = event.content ?? {};

  const isSignal = event.category === 'signal_update';
  const isEdge = event.category === 'edge_detected';
  const isThinking = event.category === 'thinking' || event.category === 'scanning';
  const isTrade = event.category === 'trade';

  // Big Win detection: PnL > $50 or > 10%
  const isBigWin = content.pnl && (content.pnl.value > 50 || content.pnl.percent > 10);
  const isBigLoss = content.pnl && (content.pnl.value < -50 || content.pnl.percent < -10);

  // Entrance animation
  const translateY = useSharedValue(30);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.96);

  useEffect(() => {
    translateY.value = withDelay(index * 60, withSpring(0, { damping: 18, stiffness: 140 }));
    opacity.value = withDelay(index * 60, withTiming(1, { duration: 400 }));
    scale.value = withDelay(index * 60, withSpring(1, { damping: 18, stiffness: 140 }));
  }, []);

  const entranceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  const handleToggleExpand = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  }, []);

  return (
    <Animated.View style={[entranceStyle]}>
      <Pressable
        style={[
          styles.card,
          isEdge && styles.edgeCard,
          isBigWin && styles.bigWinCard,
          isBigLoss && styles.bigLossCard,
          isActive && styles.activeCard,
        ]}
        onPress={handleToggleExpand}
        android_ripple={{ color: Colors.border, foreground: true }}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={[styles.iconCircle, { backgroundColor: severityColor + '18' }]}>
              <Text style={styles.icon}>{icon}</Text>
            </View>
            <Pressable
              onPress={() => agentId && onAgentPress?.(agentId)}
              disabled={!agentId || !onAgentPress}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            >
              <Text style={styles.agentName}>{agentName}</Text>
            </Pressable>
            <View style={[styles.categoryBadge, { borderColor: severityColor + '44' }]}>
              <Text style={[styles.categoryText, { color: severityColor }]}>{categoryLabel}</Text>
            </View>
          </View>
          <TimeAgo timestamp={timestamp} />
        </View>

        {/* Main message */}
        <Text style={styles.message} numberOfLines={expanded ? undefined : 2}>
          {message}
        </Text>

        {/* Expand hint */}
        {!expanded && (content.reasoning_snippet || content.confidence != null || content.pnl) && (
          <Text style={styles.expandHint}>Tap to expand</Text>
        )}

        {/* Processing indicator */}
        {isActive && isThinking && (
          <View style={styles.thinkingRow}>
            <PulseDot />
            <Text style={styles.thinkingText}>Processing...</Text>
          </View>
        )}

        {/* Expanded content */}
        {expanded && (
          <View style={styles.expandedContent}>
            {/* Signal stats */}
            {isSignal && content.signals_count != null && (
              <View style={styles.statsRow}>
                <View style={styles.statBadge}>
                  <Text style={styles.statValue}>{content.signals_count}</Text>
                  <Text style={styles.statLabel}>signals</Text>
                </View>
                {content.markets_scanned != null && (
                  <View style={styles.statBadge}>
                    <Text style={styles.statValue}>{content.markets_scanned}</Text>
                    <Text style={styles.statLabel}>markets</Text>
                  </View>
                )}
              </View>
            )}

            {/* Edge stats */}
            {isEdge && (
              <View style={styles.edgeStatsRow}>
                {content.edge_percent != null && (
                  <View style={styles.edgeBadge}>
                    <Text style={styles.edgeValue}>+{(content.edge_percent).toFixed(1)}%</Text>
                    <Text style={styles.edgeLabel}>edge</Text>
                  </View>
                )}
                {content.confidence != null && (
                  <View style={styles.edgeBadge}>
                    <Text style={styles.edgeValue}>{(content.confidence * 100).toFixed(0)}%</Text>
                    <Text style={styles.edgeLabel}>confidence</Text>
                  </View>
                )}
              </View>
            )}

            {/* Reasoning */}
            {content.reasoning_snippet && (
              <View style={styles.reasoningBox}>
                <Text style={styles.reasoningLabel}>Reasoning</Text>
                <Text style={styles.reasoningText}>"{content.reasoning_snippet}"</Text>
              </View>
            )}

            {/* Confidence bar */}
            {content.confidence != null && !isEdge && (
              <AnimatedConfidenceBar confidence={content.confidence} />
            )}

            {/* Trade details */}
            {isTrade && (
              <View style={styles.tradeDetails}>
                {content.action && (
                  <View style={[styles.tradeBadge, { backgroundColor: content.action === 'buy' ? Colors.success + '22' : Colors.danger + '22' }]}>
                    <Text style={[styles.tradeBadgeText, { color: content.action === 'buy' ? Colors.success : Colors.danger }]}>
                      {content.action.toUpperCase()}
                    </Text>
                  </View>
                )}
                {content.amount && <Text style={styles.tradeDetailText}>Amount: {content.amount}</Text>}
                {content.price && <Text style={styles.tradeDetailText}>Price: {content.price}</Text>}
              </View>
            )}

            {/* PnL display */}
            {content.pnl && (
              <View style={styles.pnlRow}>
                <Text style={[styles.pnlValue, { color: content.pnl.value >= 0 ? Colors.success : Colors.danger }]}>
                  {content.pnl.value >= 0 ? '+' : ''}${content.pnl.value.toFixed(2)}
                </Text>
                <Text style={[styles.pnlPercent, { color: content.pnl.percent >= 0 ? Colors.success : Colors.danger }]}>
                  ({content.pnl.percent >= 0 ? '+' : ''}{content.pnl.percent.toFixed(1)}%)
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Big Win badge */}
        {isBigWin && (
          <View style={styles.bigWinBadge}>
            <Text style={styles.bigWinText}>Big Win</Text>
          </View>
        )}

        {/* Reactions */}
        <ReactionBar eventId={event.event_id} onReact={onReact} />
      </Pressable>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    marginHorizontal: Spacing.screenPadding,
    marginBottom: Spacing.sm,
    padding: Spacing.lg,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  activeCard: {
    borderColor: Colors.accent + '33',
    backgroundColor: Colors.surfaceElevated,
  },
  edgeCard: {
    borderColor: Colors.accent + '44',
    backgroundColor: Colors.surfaceElevated,
  },
  bigWinCard: {
    borderColor: Colors.success + '55',
    backgroundColor: Colors.success + '08',
  },
  bigLossCard: {
    borderColor: Colors.danger + '44',
    backgroundColor: Colors.danger + '06',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexShrink: 1,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    fontSize: 14,
  },
  agentName: {
    fontFamily: Fonts.body,
    fontSize: 12,
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
    fontSize: 11,
    color: Colors.textMuted,
    flexShrink: 0,
  },
  message: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  expandHint: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textMuted,
    fontStyle: 'italic',
    marginTop: 2,
  },
  expandedContent: {
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: 4,
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
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: Colors.accent,
  },
  reasoningLabel: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMuted,
    marginBottom: Spacing.xs,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
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
  tradeDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flexWrap: 'wrap',
  },
  tradeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: 4,
  },
  tradeBadgeText: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    fontWeight: '700',
  },
  tradeDetailText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textSecondary,
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
  bigWinBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.success + '22',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.success + '44',
  },
  bigWinText: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    fontWeight: '700',
    color: Colors.success,
    letterSpacing: 0.5,
  },
  reactionBar: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  reactionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reactionBtnActive: {
    backgroundColor: Colors.accent + '18',
    borderColor: Colors.accent + '44',
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    fontWeight: '700',
    color: Colors.accent,
  },
});
