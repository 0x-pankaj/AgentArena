import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Clipboard, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';
import { AgentCard } from '../../src/components/AgentCard';
import { CategoryChip } from '../../src/components/CategoryChip';
import { SkeletonCard, SkeletonLoader } from '../../src/components/SkeletonLoader';
import { useAuthStore } from '../../src/stores/authStore';
import { useAgentList, useTrendingAgents } from '../../src/lib/api';

const categories = ['All', 'Geo', 'Politics', 'Sports', 'Crypto', 'General'];

export default function HomeScreen() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState('All');
  const { isConnected, walletAddress } = useAuthStore();

  const categoryFilter = activeCategory === 'All' ? undefined : activeCategory.toLowerCase();
  const { data, isLoading, error } = useAgentList(categoryFilter);
  const trending = useTrendingAgents(6);

  const agents = data?.agents ?? [];
  const trendingAgents = trending.data?.agents ?? [];
  const displayAgents = agents.map((agent: any) => ({
    ...agent,
    performance: agent.performance ?? {
      totalTrades: 0, winningTrades: 0, totalPnl: 0, winRate: 0, sharpeRatio: 0, maxDrawdown: 0,
    },
  }));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable
            style={styles.userInfo}
            onPress={() => {
              if (!isConnected) {
                router.push('/login');
              } else if (walletAddress) {
                Clipboard.setString(walletAddress);
                Alert.alert('Copied', 'Wallet address copied');
              }
            }}
          >
            <View style={styles.userAvatar}>
              <Text style={styles.userAvatarText}>
                {walletAddress ? walletAddress.substring(0, 2).toUpperCase() : 'AA'}
              </Text>
            </View>
            <View>
              <Text style={styles.greeting}>Welcome back</Text>
              <Text style={[
                styles.walletText,
                !isConnected && styles.connectText,
              ]}>
                {walletAddress
                  ? `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}`
                  : 'Connect Wallet'}
              </Text>
            </View>
          </Pressable>
          <Pressable style={styles.notifButton}>
            <Text style={styles.notifIcon}>🔔</Text>
          </Pressable>
        </View>

        <Text style={styles.title}>Marketplace</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {categories.map((cat) => (
            <CategoryChip
              key={cat}
              label={cat}
              isActive={activeCategory === cat}
              onPress={() => setActiveCategory(cat)}
            />
          ))}
        </ScrollView>

        {/* Trending Agents */}
        {(trendingAgents.length > 0 || trending.isLoading) && (
          <View style={styles.trendingSection}>
            <Text style={styles.sectionTitle}>🔥 Trending Now</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.trendingRow}
            >
              {trending.isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <View key={i} style={styles.trendingCard}>
                    <SkeletonLoader width={100} height={40} />
                  </View>
                ))
              ) : (
                trendingAgents.map((agent: any) => {
                  const catColor = Colors[agent.category as keyof typeof Colors] || Colors.accent;
                  return (
                    <Pressable
                      key={agent.id}
                      style={({ pressed }) => [styles.trendingCard, pressed && { opacity: 0.7 }]}
                      onPress={() => router.push(`/agent/${agent.id}`)}
                    >
                      <View style={styles.trendingHeader}>
                        <View style={[styles.trendingCatDot, { backgroundColor: catColor }]} />
                        <Text style={styles.trendingName} numberOfLines={1}>{agent.name}</Text>
                      </View>
                      <Text style={[
                        styles.trendingPnl,
                        { color: agent.pnl >= 0 ? Colors.success : Colors.danger }
                      ]}>
                        {agent.pnl >= 0 ? '+' : ''}${agent.pnl.toFixed(0)}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        )}

        <View style={styles.agentList}>
          {isLoading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Cannot connect to API</Text>
              <Text style={styles.errorText}>
                Make sure the API server is running on port 3001
              </Text>
            </View>
          ) : displayAgents.length > 0 ? (
            displayAgents.map((agent: any) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onPress={() => router.push(`/agent/${agent.id}`)}
              />
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No agents available yet</Text>
              <Text style={styles.emptySubtext}>
                Create one from the Profile tab
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
  scrollContent: { padding: Spacing.screenPadding, paddingBottom: 100, gap: Spacing.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  userInfo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  userAvatar: {
    width: 40, height: 40, borderRadius: BorderRadius.xl, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, justifyContent: 'center', alignItems: 'center',
  },
  userAvatarText: { fontFamily: Fonts.mono, fontSize: 14, fontWeight: '700', color: Colors.accent },
  greeting: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  walletText: { fontFamily: Fonts.mono, fontSize: 13, color: Colors.textSecondary },
  connectText: { fontFamily: Fonts.body, fontSize: 13, fontWeight: '600', color: Colors.accent },
  notifButton: {
    width: 40, height: 40, borderRadius: BorderRadius.xl, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, justifyContent: 'center', alignItems: 'center',
  },
  notifIcon: { fontSize: 18 },
  title: { fontFamily: Fonts.heading, fontSize: 24, fontWeight: '700', color: Colors.textPrimary },
  chipsRow: { flexDirection: 'row', gap: Spacing.sm },
  agentList: { gap: Spacing.lg },

  // Trending section
  trendingSection: { gap: Spacing.md },
  sectionTitle: { fontFamily: Fonts.body, fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  trendingRow: { flexDirection: 'row', gap: Spacing.sm },
  trendingCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    minWidth: 130,
    gap: Spacing.xs,
  },
  trendingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trendingCatDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  trendingName: {
    fontFamily: Fonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
    flex: 1,
  },
  trendingPnl: {
    fontFamily: Fonts.mono,
    fontSize: 14,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: Colors.danger + '22', borderRadius: BorderRadius.md, padding: Spacing.xl,
    borderWidth: 1, borderColor: Colors.danger + '44', alignItems: 'center', gap: Spacing.sm,
  },
  errorTitle: { fontFamily: Fonts.body, fontSize: 16, fontWeight: '600', color: Colors.danger },
  errorText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  emptyState: { padding: Spacing.xl, alignItems: 'center', gap: Spacing.xs },
  emptyText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  emptySubtext: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
});
