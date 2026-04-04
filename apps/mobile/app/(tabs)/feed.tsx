import React, { useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';
import { FeedItem } from '../../src/components/FeedItem';
import { SkeletonCard } from '../../src/components/SkeletonLoader';
import { FeedFilterBar } from '../../src/components/FeedFilterBar';
import { AgentSelector } from '../../src/components/AgentSelector';
import { useFeedRecent, useFeedByCategory, useAgentList } from '../../src/lib/api';
import { useLiveFeed } from '../../src/hooks/useLiveFeed';

export default function FeedScreen() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showAgentFilter, setShowAgentFilter] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // Determine WS channel based on filters
  const wsChannel = selectedAgentId
    ? `feed:agent:${selectedAgentId}`
    : activeCategory !== 'all'
      ? `feed:category:${activeCategory}`
      : 'feed';

  // Fallback polling function
  const fallbackPollFn = useCallback(() => {
    if (selectedAgentId) {
      return { events: [] as any[] }; // Agent feed handled by useFeedByAgent
    }
    if (activeCategory !== 'all') {
      return { events: [] as any[] }; // Category feed handled by useFeedByCategory
    }
    return useFeedRecent(50).refetch?.() as any ?? { events: [] };
  }, [selectedAgentId, activeCategory]);

  const { events: wsEvents, status, newCount, resetNewCount, setAtBottom } = useLiveFeed({
    channel: wsChannel,
    fallbackPollFn,
  });

  // REST data as initial load + fallback
  const { data: recentData, isLoading: recentLoading } = useFeedRecent(50);
  const { data: categoryData, isLoading: categoryLoading } = useFeedByCategory(
    activeCategory !== 'all' ? activeCategory : '',
    50
  );
  const { data: agentsData } = useAgentList();

  // Determine which events to show
  const agents = (agentsData?.agents ?? []).map((a: any) => ({
    id: a.id,
    name: a.name,
    category: a.category,
  }));

  // Always start with REST data as the base (historical events)
  const restEvents: any[] = selectedAgentId
    ? (recentData?.events ?? []).filter((e: any) => e.agent_id === selectedAgentId)
    : activeCategory !== 'all'
      ? categoryData?.events ?? []
      : recentData?.events ?? [];

  // Merge WS events on top (deduplicated, newest first)
  let displayEvents: any[];
  let isLoading: boolean;

  if (wsEvents.length > 0) {
    // Merge WS events with REST data, deduplicate by event_id
    const restIds = new Set(restEvents.map((e: any) => e.event_id));
    const wsOnly = wsEvents.filter((e: any) => !restIds.has(e.event_id));
    // Filter WS events by agent/category if applicable
    const filteredWs = selectedAgentId
      ? wsEvents.filter((e: any) => e.agent_id === selectedAgentId)
      : activeCategory !== 'all'
        ? wsEvents
        : wsEvents;
    // Combine and sort by timestamp (newest first)
    displayEvents = [...filteredWs, ...restEvents.filter((e: any) => !wsEvents.some((w: any) => w.event_id === e.event_id))]
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    isLoading = false;
  } else {
    // No WS events — show REST data
    displayEvents = restEvents;
    isLoading = recentLoading || (activeCategory !== 'all' && categoryLoading);
  }

  const handleCategoryChange = (category: string) => {
    setActiveCategory(category);
    setSelectedAgentId(null);
    setAtBottom(true);
  };

  const handleAgentSelect = (agentId: string | null) => {
    setSelectedAgentId(agentId);
    setAtBottom(true);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          const isAtBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 100;
          setAtBottom(isAtBottom);
        }}
        scrollEventThrottle={400}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Live Feed</Text>
          <Pressable
            style={[styles.filterButton, showAgentFilter && styles.filterButtonActive]}
            onPress={() => setShowAgentFilter(!showAgentFilter)}
          >
            <Text style={styles.filterIcon}>{showAgentFilter ? '✕' : '🎯'}</Text>
          </Pressable>
        </View>

        {/* Category filter + connection status */}
        <FeedFilterBar
          activeCategory={activeCategory}
          onCategoryChange={handleCategoryChange}
          connectionStatus={status}
        />

        {/* Agent selector (toggleable) */}
        {showAgentFilter && (
          <AgentSelector
            agents={agents}
            selectedAgentId={selectedAgentId}
            onSelectAgent={handleAgentSelect}
          />
        )}

        {/* New events indicator */}
        {newCount > 0 && (
          <Pressable style={styles.newEventsBadge} onPress={() => {
            resetNewCount();
            flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
          }}>
            <Text style={styles.newEventsText}>↑ {newCount} new event{newCount !== 1 ? 's' : ''}</Text>
          </Pressable>
        )}

        {/* Feed list */}
        <View style={styles.feedList}>
          {isLoading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : displayEvents.length > 0 ? (
            displayEvents.map((event: any, index: number) => (
              <Pressable
                key={event.event_id ?? `event-${index}`}
                onPress={() => {
                  if (event.agent_id) {
                    router.push(`/agent/${event.agent_id}`);
                  }
                }}
              >
                <FeedItem event={event} isActive={index === 0} />
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📡</Text>
              <Text style={styles.emptyText}>No feed events yet</Text>
              <Text style={styles.emptySubtext}>
                {selectedAgentId
                  ? 'This agent has no activity yet'
                  : activeCategory !== 'all'
                    ? `No ${activeCategory} agent activity yet`
                    : 'Hire an agent to see activity here'}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.screenPadding, paddingTop: Spacing.lg, paddingBottom: Spacing.md },
  title: { fontFamily: Fonts.heading, fontSize: 24, fontWeight: '700', color: Colors.textPrimary },
  filterButton: {
    width: 40, height: 40, borderRadius: BorderRadius.xl, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, justifyContent: 'center', alignItems: 'center',
  },
  filterButtonActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent + '22',
  },
  filterIcon: { fontSize: 18 },
  feedList: { gap: 0 },
  emptyState: { padding: Spacing.xl, alignItems: 'center', gap: Spacing.xs },
  emptyIcon: { fontSize: 32, marginBottom: Spacing.sm },
  emptyText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  emptySubtext: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, textAlign: 'center' },
  newEventsBadge: {
    backgroundColor: Colors.accent + '22',
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  newEventsText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.accent,
  },
});
