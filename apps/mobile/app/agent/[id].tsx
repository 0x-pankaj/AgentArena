import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, ActivityIndicator, Clipboard, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getSolanaConnection } from '../../src/lib/solana';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';
import { SkeletonCard, SkeletonLoader } from '../../src/components/SkeletonLoader';
import { FeedItem } from '../../src/components/FeedItem';
import { useAgentGet, useFeedByAgent, useJobCreate, useJobFund, useJobResume, useJobWalletBalance, useAgentGetReputation } from '../../src/lib/api';
import { useLiveFeed } from '../../src/hooks/useLiveFeed';
import { useAuthStore } from '../../src/stores/authStore';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useSolBalance } from '../../src/hooks/useSolBalance';

// MWA for Phantom/Solflare on Android
let transact: any = null;
try { transact = require('@solana-mobile/mobile-wallet-adapter-protocol').transact; } catch {}

type HireStep = 'config' | 'done';

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isConnected, walletAddress, connectionMethod } = useAuthStore();
  const { wallets } = useEmbeddedSolanaWallet();
  const userSolBalance = useSolBalance(walletAddress);

  const { data: agentData, isLoading } = useAgentGet(id!);
  const { data: feedData } = useFeedByAgent(id!, 20);
  
  // Live WebSocket feed for this specific agent
  const { events: liveEvents, status: wsStatus, setAtBottom } = useLiveFeed({
    channel: `feed:agent:${id!}`,
  });
  
  // Merge REST feed with live WS events (deduplicated)
  const restEvents = (feedData?.events ?? []).map((e: any) => ({
    event_id: e.event_id,
    timestamp: e.timestamp,
    agent_id: e.agent_id,
    agent_display_name: e.agent_display_name,
    category: e.category,
    severity: e.severity,
    content: e.content,
    display_message: e.display_message,
    is_public: e.is_public,
  }));
  
  const agentFeed = (() => {
    const all = [...liveEvents, ...restEvents];
    const seen = new Set<string>();
    return all.filter((e) => {
      if (!e.event_id || seen.has(e.event_id)) return false;
      seen.add(e.event_id);
      return true;
    });
  })();
  const hireJob = useJobCreate();
  const fundJob = useJobFund();
  const resumeJob = useJobResume();


  const [step, setStep] = useState<HireStep>('config');
  const [jobId, setJobId] = useState<string | null>(null);
  const [privyWallet, setPrivyWallet] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    userSolBalance.refetch();
    walletBalance.refetch();
    setTimeout(() => setRefreshing(false), 1000);
  };

  const [maxCap, setMaxCap] = useState('100');
  const [dailyCap, setDailyCap] = useState('500');

  const walletBalance = useJobWalletBalance(jobId ?? '');
  const hasBalance = (walletBalance.data?.usdc ?? 0) > 0 || (walletBalance.data?.sol ?? 0) > 0;

  // Poll balance when job is active
  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(() => walletBalance.refetch(), 5000);
    return () => clearInterval(interval);
  }, [jobId]);

  const agent = agentData ?? null;
  const { data: reputationData } = useAgentGetReputation(id!);
  const atomRep = reputationData ?? agent?.atomReputation ?? null;

  if (!agent) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Agent Profile</Text>
        </View>
        <View style={styles.emptyState}><Text style={styles.emptyText}>Agent not found</Text></View>
      </SafeAreaView>
    );
  }

  const categoryColor = Colors[agent.category as keyof typeof Colors] || Colors.accent;
  const performance = agent.performance ?? { totalTrades: 0, winningTrades: 0, totalPnl: 0, winRate: 0 };

  // Step 1: Create job with Agentic Wallet + policy, then start
  const handleHire = () => {
    if (!isConnected) { router.push('/login'); return; }
    setIsLaunching(true);
    hireJob.mutate(
      { agentId: agent.id, maxCap: parseFloat(maxCap) || 100, dailyCap: parseFloat(dailyCap) || 500 },
      {
        onSuccess: async (data: any) => {
          setJobId(data.id);
          setPrivyWallet(data.privyWalletAddress);

          try {
            const fundResult = await fundJob.mutateAsync(data.id);
            if (fundResult.success) {
              const resumeResult = await resumeJob.mutateAsync(data.id);
              if (resumeResult.success) {
                setStep('done');
                Alert.alert('Agent Started!', `Trading with $${fundResult.balance.usdc.toFixed(2)} paper USDC\nPolicy: $${maxCap}/trade · $${dailyCap}/day`, [
                  { text: 'View Profile', onPress: () => router.push('/(tabs)/profile') },
                ]);
              } else {
                Alert.alert('Error', resumeResult.message ?? 'Failed to start agent');
              }
            } else {
              Alert.alert('Error', 'Failed to fund agent');
            }
          } catch (err: any) {
            Alert.alert('Error', err?.message ?? 'Failed to start agent');
          } finally {
            setIsLaunching(false);
          }
        },
        onError: (err: any) => {
          Alert.alert('Error', err?.message ?? 'Failed to hire');
          setIsLaunching(false);
        },
      }
    );
  };

  // On-chain signing removed — Agentic Wallet with policy replaces escrow

  // Step 3: Fund + Start
  const handleStart = async () => {
    if (!jobId) return;
    try {
      const fundResult = await fundJob.mutateAsync(jobId);
      if (!fundResult.success) {
        Alert.alert('No Funds', 'Fund the wallet first, then try again.');
        return;
      }
      const resumeResult = await resumeJob.mutateAsync(jobId);
      if (resumeResult.success) {
        setStep('done');
        Alert.alert('Agent Started!', `Trading with $${fundResult.balance.usdc.toFixed(2)} USDC`, [
          { text: 'View Profile', onPress: () => router.push('/(tabs)/profile') },
        ]);
      } else {
        Alert.alert('Error', resumeResult.message ?? 'Failed to start');
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to start agent');
    }
  };

  const copyWallet = () => {
    if (privyWallet) { Clipboard.setString(privyWallet); Alert.alert('Copied', 'Wallet address copied'); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Hire Agent</Text>
        </View>

        {isLoading ? (
          <>
            <SkeletonLoader height={80} />
            <SkeletonCard />
          </>
        ) : (
          <>
            {/* Agent Profile (always visible) */}
            <View style={styles.profileBox}>
              <View style={styles.avatarRow}>
                <View style={[styles.avatar, { backgroundColor: (categoryColor as string) + '22' }]}>
                  <Text style={[styles.avatarText, { color: categoryColor as string }]}>
                    {agent.name.substring(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.nameColumn}>
                  <View style={styles.nameRow}>
                    <Text style={styles.agentName}>{agent.name}</Text>
                    {agent.isVerified && <Text style={styles.verifiedBadge}>✓ Verified</Text>}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <View style={[styles.categoryBadge, { backgroundColor: (categoryColor as string) + '22' }]}>
                      <Text style={[styles.categoryText, { color: categoryColor as string }]}>{agent.category.toUpperCase()}</Text>
                    </View>
                    {atomRep?.formattedTier && (
                      <View style={[styles.tierBadge, { backgroundColor: atomRep.trustTier === 'Gold' ? '#FFD70022' : atomRep.trustTier === 'Silver' ? '#C0C0C022' : atomRep.trustTier === 'Bronze' ? '#CD7F3222' : '#9CA3AF22' }]}>
                        <Text style={[styles.tierBadgeText, { color: atomRep.trustTier === 'Gold' ? '#FFD700' : atomRep.trustTier === 'Silver' ? '#C0C0C0' : atomRep.trustTier === 'Bronze' ? '#CD7F32' : '#9CA3AF' }]}>
                          {atomRep.formattedTier}
                        </Text>
                      </View>
                    )}
                    <View style={styles.paperBadge}>
                      <Text style={styles.paperBadgeText}>PAPER TRADING</Text>
                    </View>
                  </View>
                </View>
              </View>
              <Text style={styles.description}>{agent.description}</Text>
              <View style={styles.paperBanner}>
                <Text style={styles.paperBannerTitle}>Paper Trading Mode</Text>
                <Text style={styles.paperBannerDesc}>
                  This agent trades with simulated funds. No real money is used. You get $1,000 paper USDC to start.
                </Text>
              </View>
            </View>

            {/* Stats */}
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{(performance.winRate * 100).toFixed(0)}%</Text>
                <Text style={styles.statLabel}>Win Rate</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: performance.totalPnl >= 0 ? Colors.success : Colors.danger }]}>
                  {performance.totalPnl >= 0 ? '+' : ''}${Number(performance.totalPnl).toFixed(0)}
                </Text>
                <Text style={styles.statLabel}>Total PnL</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{performance.totalTrades}</Text>
                <Text style={styles.statLabel}>Trades</Text>
              </View>
            </View>

            {/* ATOM Reputation Card */}
            {atomRep && (
              <View style={styles.reputationCard}>
                <Text style={styles.reputationTitle}>ATOM Reputation</Text>
                <View style={styles.reputationRow}>
                  <View style={styles.reputationItem}>
                    <Text style={styles.reputationValue}>{atomRep.formattedTier}</Text>
                    <Text style={styles.reputationLabel}>Trust Tier</Text>
                  </View>
                  <View style={styles.reputationItem}>
                    <Text style={styles.reputationValue}>{atomRep.qualityScore.toFixed(1)}</Text>
                    <Text style={styles.reputationLabel}>Quality Score</Text>
                  </View>
                  <View style={styles.reputationItem}>
                    <Text style={styles.reputationValue}>{atomRep.feedbackCount}</Text>
                    <Text style={styles.reputationLabel}>Feedbacks</Text>
                  </View>
                </View>
                {atomRep.compositeScore > 0 && (
                  <View style={styles.compositeScoreBar}>
                    <View style={[styles.compositeScoreFill, { width: `${Math.min(atomRep.compositeScore, 100)}%` }]} />
                    <Text style={styles.compositeScoreText}>Reputation Score: {atomRep.compositeScore.toFixed(0)}/100</Text>
                  </View>
                )}
              </View>
            )}

            {/* 8004 Registration Status */}
            {agent.assetAddress ? (
              <View style={styles.registryCard}>
                <View style={styles.registryHeader}>
                  <Text style={styles.registryTitle}>✓ 8004 Registered</Text>
                  <Text style={styles.registrySubtitle}>Solana Agent Registry</Text>
                </View>
                <Text style={styles.registryAddr} numberOfLines={1}>{agent.assetAddress}</Text>
                {agent.atomEnabled && (
                  <View style={styles.atomEnabledBadge}>
                    <Text style={styles.atomEnabledText}>ATOM Enabled</Text>
                  </View>
                )}
              </View>
            ) : (
              agent.ownerAddress === walletAddress && (
                <View style={styles.registryCardUnregistered}>
                  <Text style={styles.registryTitleUnregistered}>Register on 8004</Text>
                  <Text style={styles.registryDesc}>Mint this agent as an NFT on Solana's 8004 Agent Registry for discoverability and reputation.</Text>
                  <Pressable style={styles.registryBtn} onPress={() => Alert.alert('Coming Soon', '8004 registration will be available in the next update.')}>
                    <Text style={styles.registryBtnText}>Register Agent NFT</Text>
                  </Pressable>
                </View>
              )
            )}

            {/* === STEP INDICATOR === */}
            <View style={styles.stepsRow}>
              {['Configure', 'Launch'].map((label, i) => {
                const stepIdx = step === 'config' ? 0 : 1;
                const isActive = i === stepIdx;
                const isDone = i < stepIdx;
                return (
                  <View key={label} style={styles.stepItem}>
                    <View style={[styles.stepDot, isActive && styles.stepDotActive, isDone && styles.stepDotDone]}>
                      <Text style={[styles.stepNum, (isActive || isDone) && styles.stepNumActive]}>
                        {isDone ? '✓' : i + 1}
                      </Text>
                    </View>
                    <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>{label}</Text>
                  </View>
                );
              })}
            </View>

            {/* === STEP 1: CONFIGURE === */}
            {step === 'config' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Trading Caps</Text>
                <Text style={styles.sectionDesc}>Set limits for how much this agent can trade per position and per day.</Text>
                <View style={styles.capRow}>
                  <View style={styles.capField}>
                    <Text style={styles.capLabel}>Max Per Trade ($)</Text>
                    <TextInput style={styles.capInput} value={maxCap} onChangeText={setMaxCap}
                      keyboardType="decimal-pad" placeholder="100" placeholderTextColor={Colors.textMuted} />
                  </View>
                  <View style={styles.capField}>
                    <Text style={styles.capLabel}>Daily Cap ($)</Text>
                    <TextInput style={styles.capInput} value={dailyCap} onChangeText={setDailyCap}
                      keyboardType="decimal-pad" placeholder="500" placeholderTextColor={Colors.textMuted} />
                  </View>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed, (hireJob.isPending || isLaunching) && styles.disabled]}
                  onPress={handleHire} disabled={hireJob.isPending || isLaunching}>
                  {hireJob.isPending || isLaunching ? <ActivityIndicator size="small" color={Colors.textPrimary} />
                    : <Text style={styles.primaryBtnText}>Launch Paper Agent</Text>}
                </Pressable>
              </View>
            )}

            {/* === STEP 2: DONE === */}
            {step === 'done' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Agent Launched!</Text>
                <Text style={styles.sectionDesc}>
                  Your agent is now trading with an Agentic Wallet protected by policy limits.
                </Text>
                <View style={styles.successBanner}>
                  <Text style={styles.successBannerText}>✓ Policy Active: ${maxCap}/trade · ${dailyCap}/day</Text>
                </View>
                <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                  onPress={() => router.push('/(tabs)/profile')}>
                  <Text style={styles.primaryBtnText}>View My Jobs</Text>
                </Pressable>
              </View>
            )}

          </>
        )}

        {/* Agent Activity */}
        <View style={styles.section}>
          <View style={styles.activityHeader}>
            <Text style={styles.sectionTitle}>{agent.name} Activity</Text>
            <View style={[styles.categoryBadgeSmall, { backgroundColor: (categoryColor as string) + '22' }]}>
              <Text style={[styles.categoryTextSmall, { color: categoryColor as string }]}>
                {agent.category.toUpperCase()}
              </Text>
            </View>
            {wsStatus === 'connected' && (
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
          </View>
          <Text style={styles.sectionSubtitle}>Only this agent's decisions and trades</Text>
          {agentFeed.length > 0 ? (
            <View style={styles.feedList}>
              {agentFeed.map((event: any, index: number) => (
                <FeedItem key={event.event_id ?? `event-${index}`} event={event} />
              ))}
            </View>
          ) : (
            <View style={styles.skeletonList}><SkeletonCard /><SkeletonCard /></View>
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
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  backButton: {
    width: 40, height: 40, borderRadius: BorderRadius.xl, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, justifyContent: 'center', alignItems: 'center',
  },
  backIcon: { fontSize: 18, color: Colors.textPrimary },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  profileBox: { gap: Spacing.lg },
  paperBadge: {
    backgroundColor: Colors.accent + '22', borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
  },
  paperBadgeText: { fontFamily: Fonts.body, fontSize: 10, fontWeight: '700', color: Colors.accent, letterSpacing: 0.5 },
  paperBanner: {
    backgroundColor: Colors.accent + '15', borderRadius: BorderRadius.md, borderWidth: 1,
    borderColor: Colors.accent, padding: Spacing.lg, gap: Spacing.xs, marginTop: Spacing.sm,
  },
  paperBannerTitle: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '700', color: Colors.accent },
  paperBannerDesc: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  avatar: { width: 64, height: 64, borderRadius: BorderRadius.lg, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontFamily: Fonts.mono, fontSize: 22, fontWeight: '700' },
  nameColumn: { gap: Spacing.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  agentName: { fontFamily: Fonts.body, fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  verifiedBadge: {
    fontFamily: Fonts.body, fontSize: 11, fontWeight: '600', color: Colors.accent,
    backgroundColor: Colors.accent + '22', paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.sm,
  },
  categoryBadge: { alignSelf: 'flex-start', paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.sm },
  categoryText: { fontFamily: Fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  description: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, lineHeight: 22 },
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-between', backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.xl,
  },
  stat: { alignItems: 'center', gap: Spacing.xs },
  statValue: { fontFamily: Fonts.mono, fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  statLabel: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  section: { gap: Spacing.md },
  sectionTitle: { fontFamily: Fonts.body, fontSize: 16, fontWeight: '600', color: Colors.textPrimary },
  sectionSubtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: -4 },
  activityHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  categoryBadgeSmall: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.sm },
  categoryTextSmall: { fontFamily: Fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  tierBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.sm },
  tierBadgeText: { fontFamily: Fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, backgroundColor: Colors.success + '22' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success },
  liveText: { fontFamily: Fonts.mono, fontSize: 10, fontWeight: '700', color: Colors.success, letterSpacing: 1 },
  sectionDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, lineHeight: 18 },

  // Steps indicator
  stepsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: Spacing.md },
  stepItem: { alignItems: 'center', gap: 4 },
  stepDot: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: Colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  stepDotActive: { borderColor: Colors.accent, backgroundColor: Colors.accent + '33' },
  stepDotDone: { borderColor: Colors.success, backgroundColor: Colors.success + '33' },
  stepNum: { fontFamily: Fonts.mono, fontSize: 13, fontWeight: '700', color: Colors.textMuted },
  stepNumActive: { color: Colors.textPrimary },
  stepLabel: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  stepLabelActive: { color: Colors.accent, fontWeight: '600' },

  // Config
  capRow: { flexDirection: 'row', gap: Spacing.md },
  capField: { flex: 1, gap: Spacing.xs },
  capLabel: { fontFamily: Fonts.body, fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  capInput: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1,
    borderColor: Colors.border, height: 48, paddingHorizontal: Spacing.lg,
    fontFamily: Fonts.mono, fontSize: 15, color: Colors.textPrimary,
  },

  // Buttons
  primaryBtn: {
    backgroundColor: Colors.accent, borderRadius: BorderRadius.md, height: 56,
    justifyContent: 'center', alignItems: 'center',
  },
  signBtn: {
    backgroundColor: '#7C3AED', borderRadius: BorderRadius.md, height: 56,
    justifyContent: 'center', alignItems: 'center',
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  primaryBtnText: { fontFamily: Fonts.body, fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  skipBtn: { alignSelf: 'center', paddingVertical: Spacing.sm },
  skipBtnText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textDecorationLine: 'underline' },

  // Wallet balance card in sign step
  walletBalanceCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.lg, alignItems: 'center', gap: Spacing.xs,
  },
  walletBalanceLabel: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  walletBalanceValue: { fontFamily: Fonts.mono, fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  lowBalanceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xs },
  lowBalanceText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.warning, flex: 1 },
  airdropBtn: {
    backgroundColor: Colors.success + '22', borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  airdropBtnText: { fontFamily: Fonts.body, fontSize: 12, fontWeight: '600', color: Colors.success },

  // Sign step
  infoCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  infoValue: { fontFamily: Fonts.mono, fontSize: 13, color: Colors.textPrimary },
  successBanner: {
    backgroundColor: Colors.success + '22', borderRadius: BorderRadius.md,
    padding: Spacing.lg, alignItems: 'center',
  },
  successBannerText: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '600', color: Colors.success },

  // Fund step
  walletCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.accent, padding: Spacing.xl, alignItems: 'center', gap: Spacing.xs,
  },
  walletLabel: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  walletAddr: { fontFamily: Fonts.mono, fontSize: 14, color: Colors.accent },
  balanceCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.lg, alignItems: 'center', gap: Spacing.xs,
  },
  balanceLabel: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  balanceValues: { alignItems: 'center', gap: 2 },
  balanceValue: { fontFamily: Fonts.mono, fontSize: 24, fontWeight: '700', color: Colors.textPrimary },
  balanceSol: { fontFamily: Fonts.mono, fontSize: 14, color: Colors.textSecondary },
  balanceHint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  fundOptions: { flexDirection: 'row', gap: Spacing.md },
  fundOptionBtn: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1,
    borderColor: Colors.border, height: 44, justifyContent: 'center', alignItems: 'center',
  },
  fundOptionText: { fontFamily: Fonts.body, fontSize: 13, fontWeight: '600', color: Colors.accent },

  // Done
  successCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.success, padding: Spacing.xxl, alignItems: 'center', gap: Spacing.md,
  },
  successIcon: { fontSize: 48, color: Colors.success },
  successTitle: { fontFamily: Fonts.heading, fontSize: 22, fontWeight: '700', color: Colors.success },
  successDesc: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  profileBtn: {
    backgroundColor: Colors.accent + '22', borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  profileBtnText: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '600', color: Colors.accent },

  // Reputation card
  reputationCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md,
  },
  reputationTitle: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  reputationRow: { flexDirection: 'row', gap: Spacing.md },
  reputationItem: { flex: 1, alignItems: 'center', gap: Spacing.xs },
  reputationValue: { fontFamily: Fonts.mono, fontSize: 18, fontWeight: '700', color: Colors.accent },
  reputationLabel: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  compositeScoreBar: { height: 8, backgroundColor: Colors.border, borderRadius: 4, overflow: 'hidden', marginTop: Spacing.xs },
  compositeScoreFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: 4 },
  compositeScoreText: { fontFamily: Fonts.mono, fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  // Registry card
  registryCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.success, padding: Spacing.lg, gap: Spacing.sm,
  },
  registryHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  registryTitle: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '700', color: Colors.success },
  registrySubtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  registryAddr: { fontFamily: Fonts.mono, fontSize: 12, color: Colors.accent },
  atomEnabledBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: Colors.accent + '22', borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
  },
  atomEnabledText: { fontFamily: Fonts.body, fontSize: 10, fontWeight: '700', color: Colors.accent },
  registryCardUnregistered: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md, alignItems: 'center',
  },
  registryTitleUnregistered: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  registryDesc: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, textAlign: 'center' },
  registryBtn: {
    backgroundColor: Colors.accent, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
  },
  registryBtnText: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '600', color: Colors.textPrimary },

  feedList: { gap: Spacing.md },
  skeletonList: { gap: Spacing.md },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  emptyText: { fontFamily: Fonts.body, fontSize: 16, color: Colors.textMuted },
});
