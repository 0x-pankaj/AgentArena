import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Clipboard, ActivityIndicator, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getSolanaConnection } from '../../src/lib/solana';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';
import { FeedItem } from '../../src/components/FeedItem';
import { SkeletonCard, SkeletonLoader } from '../../src/components/SkeletonLoader';
import { useJobGet, useFeedByJob, useJobCancel, useJobWalletBalance, useJobFund, useJobResume, usePaperTradingBalance, usePaperTradingTopUp, useJobSwitchMode, useJobPolicyDashboard } from '../../src/lib/api';
import { useAuthStore } from '../../src/stores/authStore';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useSolBalance } from '../../src/hooks/useSolBalance';

// MWA for Phantom/Solflare on Android
let transact: any = null;
try { transact = require('@solana-mobile/mobile-wallet-adapter-protocol').transact; } catch {}

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { walletAddress, connectionMethod } = useAuthStore();
  const { wallets } = useEmbeddedSolanaWallet();
  const userSolBalance = useSolBalance(walletAddress);

  const { data: jobData, isLoading } = useJobGet(id!);
  const { data: feedData } = useFeedByJob(id!, 10);
  const cancelJob = useJobCancel();
  const fundJob = useJobFund();
  const resumeJob = useJobResume();
  const walletBalance = useJobWalletBalance(id ?? '');
  const paperBalance = usePaperTradingBalance(id ?? '');
  const topUpPaper = usePaperTradingTopUp();
  const switchMode = useJobSwitchMode();
  const { data: policyData } = useJobPolicyDashboard(id ?? '');

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    userSolBalance.refetch();
    walletBalance.refetch();
    paperBalance.refetch();
    setTimeout(() => setRefreshing(false), 1000);
  };

  const job = jobData ?? null;
  const agentFeed = feedData?.events ?? [];

  if (!job) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Job Detail</Text>
        </View>
        <View style={styles.emptyState}><Text style={styles.emptyText}>Job not found</Text></View>
      </SafeAreaView>
    );
  }

  const totalInvested = Number(job.totalInvested ?? 0);
  const totalProfit = Number(job.totalProfit ?? 0);
  const positions = job.positions ?? [];
  const walletUsdc = walletBalance.data?.usdc ?? 0;
  const isOnChain = !!job.onChainAddress;
  const isPaperMode = (job.tradingMode ?? 'paper') === 'paper';
  const paperBal = paperBalance.data?.balance ?? job.paperBalance ?? 0;

  const daysSinceStart = job.startedAt
    ? Math.floor((Date.now() - new Date(job.startedAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const handleStopJob = () => {
    Alert.alert('Stop Agent', 'Are you sure you want to stop this agent?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => cancelJob.mutate(job.id, { onSuccess: () => router.back() }) },
    ]);
  };

  const handleResume = async () => {
    try {
      const fundResult = await fundJob.mutateAsync(job.id);
      if (!fundResult.success) { Alert.alert('No Funds', 'Fund the agent wallet first.'); return; }
      await resumeJob.mutateAsync(job.id);
    } catch (err: any) { Alert.alert('Error', err?.message ?? 'Failed to resume'); }
  };

  // On-chain registration removed — using Agentic Wallet + Policy instead

  const copyWallet = () => {
    if (job.privyWalletAddress) { Clipboard.setString(job.privyWalletAddress); Alert.alert('Copied', 'Wallet address copied'); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
          <Text style={styles.headerTitle}>My {job.agentName ?? 'Agent'}</Text>
        </View>

        {isLoading ? (
          <><SkeletonLoader height={120} /><SkeletonCard /><SkeletonCard /></>
        ) : (
          <>
            {/* Stats */}
            <View style={styles.statsCard}>
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Invested</Text>
                  <Text style={styles.statValue}>${totalInvested.toFixed(0)}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Profit</Text>
                  <Text style={[styles.statValue, { color: totalProfit >= 0 ? Colors.success : Colors.danger }]}>
                    {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
                  </Text>
                </View>
              </View>
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Status</Text>
                  <View style={styles.statusBadge}>
                    <View style={[styles.statusDot, {
                      backgroundColor: job.status === 'active' ? Colors.success : job.status === 'paused' ? Colors.warning : Colors.textMuted
                    }]} />
                    <Text style={[styles.statusText, {
                      color: job.status === 'active' ? Colors.success : job.status === 'paused' ? Colors.warning : Colors.textMuted
                    }]}>{(job.status ?? 'paused').toUpperCase()}</Text>
                  </View>
                  <View style={[styles.modeBadge, { backgroundColor: isPaperMode ? Colors.accent + '22' : Colors.success + '22' }]}>
                    <Text style={[styles.modeBadgeText, { color: isPaperMode ? Colors.accent : Colors.success }]}>
                      {(job.tradingMode ?? 'paper') === 'paper' ? 'PAPER' : 'LIVE'}
                    </Text>
                  </View>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Duration</Text>
                  <Text style={styles.statValue}>{daysSinceStart}d</Text>
                </View>
              </View>
            </View>

            {/* Wallet / Paper Balance */}
            {isPaperMode ? (
              <View style={styles.walletCard}>
                <View style={styles.walletRow}>
                  <View style={styles.walletInfo}>
                    <Text style={styles.walletLabel}>Paper Trading Balance</Text>
                    <Text style={styles.walletAddr}>Simulated funds for practice</Text>
                  </View>
                  <View style={styles.walletBalance}>
                    <Text style={styles.walletBalanceValue}>${Number(paperBal).toFixed(2)}</Text>
                    <Text style={styles.walletBalanceLabel}>PAPER USDC</Text>
                  </View>
                </View>
                <View style={styles.capRow}>
                  <Text style={styles.capText}>Max/trade: ${Number(job.maxCap ?? 0).toFixed(0)}</Text>
                  <Text style={styles.capText}>Daily: ${Number(job.dailyCap ?? 0).toFixed(0)}</Text>
                  <Pressable
                    style={({ pressed }) => [styles.topUpBtn, pressed && { opacity: 0.8 }, topUpPaper.isPending && { opacity: 0.5 }]}
                    onPress={() => {
                      Alert.alert(
                        'Top Up Paper Balance',
                        'Add simulated USDC to this paper trading account?',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Top Up $1000',
                            onPress: () => topUpPaper.mutate({ jobId: job.id, amount: 1000 }),
                          },
                        ]
                      );
                    }}
                    disabled={topUpPaper.isPending}>
                    <Text style={styles.topUpBtnText}>{topUpPaper.isPending ? '...' : '+ Top Up'}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              job.privyWalletAddress && (
                <Pressable style={styles.walletCard} onPress={copyWallet}>
                  <View style={styles.walletRow}>
                    <View style={styles.walletInfo}>
                      <Text style={styles.walletLabel}>Agent Wallet (tap to copy)</Text>
                      <Text style={styles.walletAddr} numberOfLines={1}>
                        {job.privyWalletAddress.substring(0, 12)}...{job.privyWalletAddress.slice(-8)}
                      </Text>
                    </View>
                    <View style={styles.walletBalance}>
                      <Text style={styles.walletBalanceValue}>${walletUsdc.toFixed(2)}</Text>
                      <Text style={styles.walletBalanceLabel}>USDC</Text>
                    </View>
                  </View>
                  {job.maxCap && (
                    <View style={styles.capRow}>
                      <Text style={styles.capText}>Max/trade: ${Number(job.maxCap).toFixed(0)}</Text>
                      <Text style={styles.capText}>Daily: ${Number(job.dailyCap).toFixed(0)}</Text>
                    </View>
                  )}
                </Pressable>
              )
            )}

            {/* Policy Dashboard */}
            {policyData && (
              <View style={styles.policyCard}>
                <Text style={styles.policyTitle}>Policy Dashboard</Text>
                <View style={styles.policyRow}>
                  <View style={styles.policyItem}>
                    <Text style={styles.policyLabel}>Max Budget</Text>
                    <Text style={styles.policyValue}>${policyData.maxCap}</Text>
                  </View>
                  <View style={styles.policyItem}>
                    <Text style={styles.policyLabel}>Daily Cap</Text>
                    <Text style={styles.policyValue}>${policyData.dailyCap}</Text>
                  </View>
                </View>
                <View style={styles.policyRow}>
                  <View style={styles.policyItem}>
                    <Text style={styles.policyLabel}>Spent</Text>
                    <Text style={styles.policyValue}>${policyData.spent.toFixed(2)}</Text>
                  </View>
                  <View style={styles.policyItem}>
                    <Text style={styles.policyLabel}>Remaining</Text>
                    <Text style={[styles.policyValue, { color: Colors.success }]}>${policyData.remaining.toFixed(2)}</Text>
                  </View>
                </View>
                {policyData.policyExpiryAt && (
                  <View style={styles.policyRow}>
                    <View style={styles.policyItem}>
                      <Text style={styles.policyLabel}>Expires</Text>
                      <Text style={styles.policyValue}>{new Date(policyData.policyExpiryAt).toLocaleDateString()}</Text>
                    </View>
                    <View style={styles.policyItem}>
                      <Text style={styles.policyLabel}>Wallet</Text>
                      <Text style={[styles.policyValue, { fontSize: 11 }]} numberOfLines={1}>
                        {policyData.walletAddress?.substring(0, 8)}...{policyData.walletAddress?.slice(-4)}
                      </Text>
                    </View>
                  </View>
                )}
                <View style={styles.policyRules}>
                  {policyData.policyRules?.slice(0, 3).map((rule: any, idx: number) => (
                    <View key={idx} style={styles.policyRule}>
                      <Text style={styles.policyRuleDot}>✓</Text>
                      <Text style={styles.policyRuleText}>{rule.name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Positions */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Open Positions ({positions.length})</Text>
              {positions.length > 0 ? positions.map((pos: any, index: number) => (
                <View key={pos.id ?? `pos-${index}`} style={styles.positionCard}>
                  <Text style={styles.posQuestion} numberOfLines={2}>
                    {pos.marketQuestion ?? pos.market_question ?? 'Market'}
                  </Text>
                  <View style={styles.posDetails}>
                    <View style={styles.posDetailItem}>
                      <Text style={styles.posDetailLabel}>Side</Text>
                      <Text style={[styles.posSide, {
                        color: pos.side === 'yes' ? Colors.success : Colors.danger,
                        backgroundColor: pos.side === 'yes' ? Colors.success + '22' : Colors.danger + '22',
                      }]}>{(pos.side ?? 'yes').toUpperCase()}</Text>
                    </View>
                    <View style={styles.posDetailItem}>
                      <Text style={styles.posDetailLabel}>Entry</Text>
                      <Text style={styles.posDetailValue}>${Number(pos.entryPrice ?? pos.entry_price ?? 0).toFixed(2)}</Text>
                    </View>
                    <View style={styles.posDetailItem}>
                      <Text style={styles.posDetailLabel}>PnL</Text>
                      <Text style={[styles.posDetailValue, { color: Number(pos.pnl ?? 0) >= 0 ? Colors.success : Colors.danger }]}>
                        {Number(pos.pnl ?? 0) >= 0 ? '+' : ''}${Number(pos.pnl ?? 0).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                </View>
              )) : <Text style={styles.noFeedText}>No open positions yet</Text>}
            </View>

            {/* Agent Activity */}
            <View style={styles.section}>
              <View style={styles.activityHeader}>
                <Text style={styles.sectionTitle}>{job.agentName ?? 'Agent'} Activity</Text>
                {job.agentCategory && (
                  <View style={[styles.categoryBadgeSmall, { backgroundColor: Colors[job.agentCategory as keyof typeof Colors] + '22' || Colors.accent + '22' }]}>
                    <Text style={[styles.categoryTextSmall, { color: Colors[job.agentCategory as keyof typeof Colors] || Colors.accent }]}>
                      {String(job.agentCategory).toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.sectionSubtitle}>Only this agent's decisions and trades</Text>
              <View style={styles.feedList}>
                {agentFeed.length > 0 ? agentFeed.map((event: any, index: number) => (
                  <FeedItem key={event.event_id ?? `event-${index}`} event={event} />
                )) : <Text style={styles.noFeedText}>No activity yet</Text>}
              </View>
            </View>
          </>
        )}

        {/* Actions */}
        <View style={styles.actionRow}>
          {job.status === 'paused' && (
            <Pressable
              style={({ pressed }) => [styles.resumeButton, pressed && { opacity: 0.7 }]}
              onPress={handleResume}
              disabled={fundJob.isPending || resumeJob.isPending}>
              <Text style={styles.resumeButtonText}>
                {fundJob.isPending || resumeJob.isPending ? 'Starting...' : 'Resume Agent'}
              </Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.stopButton, pressed && { opacity: 0.7 }, cancelJob.isPending && { opacity: 0.5 }]}
            onPress={handleStopJob} disabled={cancelJob.isPending}>
            <Text style={styles.stopButtonText}>{cancelJob.isPending ? 'Stopping...' : 'Stop Agent'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.screenPadding, paddingBottom: 100, gap: Spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  backButton: {
    width: 40, height: 40, borderRadius: BorderRadius.xl, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, justifyContent: 'center', alignItems: 'center',
  },
  backIcon: { fontSize: 18, color: Colors.textPrimary },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  statsCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.accent, padding: Spacing.xl, gap: Spacing.lg,
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statItem: { gap: Spacing.xs },
  statLabel: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  statValue: { fontFamily: Fonts.mono, fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  modeBadge: {
    marginTop: 4, paddingHorizontal: Spacing.sm, paddingVertical: 2,
    borderRadius: BorderRadius.sm, alignSelf: 'flex-start',
  },
  modeBadgeText: { fontFamily: Fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  section: { gap: Spacing.md },
  sectionTitle: { fontFamily: Fonts.body, fontSize: 18, fontWeight: '600', color: Colors.textPrimary },
  sectionSubtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: -8 },
  activityHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  categoryBadgeSmall: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.sm },
  categoryTextSmall: { fontFamily: Fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  walletCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md,
  },
  walletRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  walletInfo: { gap: 2, flex: 1 },
  walletLabel: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  walletAddr: { fontFamily: Fonts.mono, fontSize: 13, color: Colors.accent },
  walletBalance: { alignItems: 'flex-end' },
  walletBalanceValue: { fontFamily: Fonts.mono, fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  walletBalanceLabel: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted },
  capRow: { flexDirection: 'row', gap: Spacing.lg },
  capText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary },

  // On-chain status
  onChainBadge: {
    backgroundColor: Colors.success + '15', borderRadius: BorderRadius.md, borderWidth: 1,
    borderColor: Colors.success, padding: Spacing.lg, gap: 4,
  },
  onChainBadgeText: { fontFamily: Fonts.body, fontSize: 13, fontWeight: '600', color: Colors.success },
  onChainBadgeAddr: { fontFamily: Fonts.mono, fontSize: 11, color: Colors.textMuted },
  registerBtn: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1,
    borderColor: Colors.accent, height: 48, justifyContent: 'center', alignItems: 'center',
    borderStyle: 'dashed',
  },
  registerBtnText: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '600', color: Colors.accent },
  lowBalanceBanner: {
    backgroundColor: Colors.warning + '15', borderRadius: BorderRadius.md, borderWidth: 1,
    borderColor: Colors.warning, padding: Spacing.lg, gap: Spacing.sm, alignItems: 'center',
  },
  lowBalanceText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.warning },
  airdropBtn: {
    backgroundColor: Colors.success + '22', borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  airdropBtnText: { fontFamily: Fonts.body, fontSize: 12, fontWeight: '600', color: Colors.success },
  topUpBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm, backgroundColor: Colors.accent + '22',
  },
  topUpBtnText: { fontFamily: Fonts.body, fontSize: 12, fontWeight: '600', color: Colors.accent },

  // Positions
  positionCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md,
  },
  posQuestion: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '600', color: Colors.textPrimary, lineHeight: 20 },
  posDetails: { flexDirection: 'row', justifyContent: 'space-between' },
  posDetailItem: { alignItems: 'center', gap: 2 },
  posDetailLabel: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  posDetailValue: { fontFamily: Fonts.mono, fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  posSide: {
    fontFamily: Fonts.body, fontSize: 12, fontWeight: '700', paddingHorizontal: Spacing.sm,
    paddingVertical: 2, borderRadius: BorderRadius.sm, overflow: 'hidden',
  },
  feedList: { gap: Spacing.md },
  noFeedText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', padding: Spacing.xl },

  // Actions
  actionRow: { gap: Spacing.md },
  resumeButton: {
    backgroundColor: Colors.success, borderRadius: BorderRadius.md, height: 52,
    justifyContent: 'center', alignItems: 'center',
  },
  resumeButtonText: { fontFamily: Fonts.body, fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  stopButton: {
    backgroundColor: Colors.danger + '22', borderRadius: BorderRadius.md, borderWidth: 1,
    borderColor: Colors.danger, height: 52, justifyContent: 'center', alignItems: 'center',
  },
  stopButtonText: { fontFamily: Fonts.body, fontSize: 15, fontWeight: '700', color: Colors.danger },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  emptyText: { fontFamily: Fonts.body, fontSize: 16, color: Colors.textMuted },

  // Policy Dashboard
  policyCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.xl, gap: Spacing.md,
  },
  policyTitle: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  policyRow: { flexDirection: 'row', justifyContent: 'space-between' },
  policyItem: { flex: 1, alignItems: 'center', gap: 2 },
  policyLabel: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  policyValue: { fontFamily: Fonts.mono, fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  policyRules: { gap: Spacing.xs, marginTop: Spacing.sm },
  policyRule: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  policyRuleDot: { fontSize: 12, color: Colors.success },
  policyRuleText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary },
});
