import React, { useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, FlatList, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';
import { FeedItem } from '../../src/components/FeedItem';
import { SkeletonCard } from '../../src/components/SkeletonLoader';
import { FeedFilterBar } from '../../src/components/FeedFilterBar';
import { AgentSelector } from '../../src/components/AgentSelector';
import { useFeedRecent, useFeedByCategory, useAgentList, useGlobalStats, useReactionsForEvents, useToggleReaction } from '../../src/lib/api';
import { useLiveFeed } from '../../src/hooks/useLiveFeed';
import { GlobalStatsBanner } from '../../src/components/GlobalStatsBanner';
import { useAuthStore } from '../../src/stores/authStore';

export default function FeedScreen() {
  const router = useRouter();
  const { walletAddress } = useAuthStore();
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showAgentFilter, setShowAgentFilter] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // REST data hooks
  const { data: recentData, isLoading: recentLoading, refetch: refetchRecent } = useFeedRecent(50);
  const { data: categoryData, isLoading: categoryLoading, refetch: refetchCategory } = useFeedByCategory(
    activeCategory !== 'all' ? activeCategory : '',
    50
  );
  const { data: agentsData } = useAgentList();
  const { data: globalStats, isLoading: statsLoading } = useGlobalStats();

  // Determine WS channel based on filters
  const wsChannel = selectedAgentId
    ? `feed:agent:${selectedAgentId}`
    : activeCategory !== 'all'
      ? `feed:category:${activeCategory}`
      : 'feed';

  // Fallback polling function
  const fallbackPollFn = useCallback(async () => {
    if (selectedAgentId) {
      return { events: [] as any[] };
    }
    if (activeCategory !== 'all') {
      const result = await refetchCategory();
      return result.data ?? { events: [] };
    }
    const result = await refetchRecent();
    return result.data ?? { events: [] };
  }, [selectedAgentId, activeCategory, refetchRecent, refetchCategory]);

  const { events: wsEvents, status, newCount, resetNewCount, setAtBottom, viewerCount, reactionUpdates } = useLiveFeed({
    channel: wsChannel,
    fallbackPollFn,
  });

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
    const restIds = new Set(restEvents.map((e: any) => e.event_id));
    const filteredWs = selectedAgentId
      ? wsEvents.filter((e: any) => e.agent_id === selectedAgentId)
      : activeCategory !== 'all'
        ? wsEvents
        : wsEvents;
    displayEvents = [...filteredWs, ...restEvents.filter((e: any) => !wsEvents.some((w: any) => w.event_id === e.event_id))]
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    isLoading = false;
  } else {
    displayEvents = restEvents;
    isLoading = recentLoading || (activeCategory !== 'all' && categoryLoading);
  }

  // Batch fetch reactions for visible events
  const visibleEventIds = useMemo(() =>
    displayEvents.filter((e: any) => e.event_id).map((e: any) => e.event_id),
    [displayEvents]
  );

  const { data: reactionsData } = useReactionsForEvents(visibleEventIds, walletAddress);
  const toggleReaction = useToggleReaction();

  // Merge REST reactions with live WS reaction updates
  const mergedReactions = useMemo(() => {
    const base = reactionsData?.reactions ?? {};
    const myBase = reactionsData?.myReactions ?? {};

    const result: Record<string, { counts: Record<string, number>; myReactions: string[] }> = {};

    for (const eventId of visibleEventIds) {
      const counts = { ...(base[eventId] ?? {}) };
      const myReacts = [...(myBase[eventId] ?? [])];

      // Apply WS updates
      const wsUpdate = reactionUpdates[eventId];
      if (wsUpdate) {
        for (const [type, count] of Object.entries(wsUpdate.counts)) {
          counts[type] = count;
        }
        // Rebuild myReactions from WS update
        const myWsReacts = wsUpdate.userReactions
          .filter((r: any) => r.userWallet === walletAddress)
          .map((r: any) => r.reactionType);
        // Replace my reactions with server truth
        if (myWsReacts.length > 0) {
          result[eventId] = { counts, myReactions: myWsReacts };
          continue;
        }
      }

      result[eventId] = { counts, myReactions: myReacts };
    }

    return result;
  }, [reactionsData, reactionUpdates, visibleEventIds, walletAddress]);

  const handleToggleReaction = useCallback((eventId: string, reactionType: 'fire' | 'up' | 'think' | 'gem') => {
    toggleReaction.mutate({ eventId, reactionType });
  }, [toggleReaction]);

  // Pull-to-refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (activeCategory !== 'all') {
      await refetchCategory();
    } else {
      await refetchRecent();
    }
    setRefreshing(false);
  }, [activeCategory, refetchCategory, refetchRecent]);

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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.accent}
            colors={[Colors.accent]}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Live Feed</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            {viewerCount > 0 && (
              <View style={styles.viewerBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.viewerText}>{viewerCount} watching</Text>
              </View>
            )}
            <Pressable
              style={[styles.filterButton, showAgentFilter && styles.filterButtonActive]}
              onPress={() => setShowAgentFilter(!showAgentFilter)}
            >
              <Ionicons name={showAgentFilter ? 'close-outline' : 'options-outline'} size={20} color={showAgentFilter ? Colors.accent : Colors.textPrimary} />
            </Pressable>
          </View>
        </View>

        {/* Live arena stats */}
        <GlobalStatsBanner stats={globalStats} isLoading={statsLoading} />

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
            <View style={styles.liveDot} />
            <Text style={styles.newEventsText}>{newCount} new event{newCount !== 1 ? 's' : ''}</Text>
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
            displayEvents.map((event: any, index: number) => {
              const eventReactions = mergedReactions[event.event_id] ?? { counts: {}, myReactions: [] };
              return (
                <FeedItem
                  key={event.event_id ?? `event-${index}`}
                  event={event}
                  isActive={index === 0}
                  index={index}
                  onAgentPress={(agentId) => router.push(`/agent/${agentId}`)}
                  reactions={eventReactions.counts}
                  myReactions={eventReactions.myReactions}
                  onToggleReaction={handleToggleReaction}
                />
              );
            })
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="radio-outline" size={32} color={Colors.textMuted} style={{ marginBottom: Spacing.sm }} />
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
  scrollContent: { paddingBottom: 100, gap: Spacing.lg },
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
  viewerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.success + '18',
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.success + '33',
  },
  viewerText: {
    fontFamily: Fonts.body,
    fontSize: 11,
    fontWeight: '600',
    color: Colors.success,
  },
  feedList: { gap: 0 },
  emptyState: { padding: Spacing.xl, alignItems: 'center', gap: Spacing.xs },
  emptyText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  emptySubtext: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, textAlign: 'center' },
  newEventsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.accent + '22',
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.accent,
  },
  newEventsText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.accent,
  },
});
