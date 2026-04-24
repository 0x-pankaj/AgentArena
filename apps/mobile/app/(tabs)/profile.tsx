import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Clipboard, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';
import { useAuthStore } from '../../src/stores/authStore';
import { SkeletonCard, SkeletonLoader } from '../../src/components/SkeletonLoader';
import { useUserPortfolio, useJobList, useJobPause, useJobResume, useJobWalletBalance, useJobFund, usePaperTradingBalance } from '../../src/lib/api';
import { useSolBalance } from '../../src/hooks/useSolBalance';
import { usePrivy } from '@privy-io/expo';

function JobWalletBadge({ jobId, tradingMode }: { jobId: string; tradingMode?: string }) {
  const isPaper = (tradingMode ?? 'paper') === 'paper';
  const liveBalance = useJobWalletBalance(jobId);
  const paperBalance = usePaperTradingBalance(jobId);

  if (isPaper) {
    const bal = paperBalance.data?.balance ?? 0;
    return (
      <Text style={[styles.walletBadge, { color: Colors.accent }]}>
        ${Number(bal).toFixed(0)} PAPER
      </Text>
    );
  }

  const usdc = liveBalance.data?.usdc ?? 0;
  return (
    <Text style={styles.walletBadge}>
      ${usdc.toFixed(0)} USDC
    </Text>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { isConnected, walletAddress, balance, disconnect, connectionMethod } = useAuthStore();
  const {logout} = usePrivy()

  const portfolio = useUserPortfolio();
  const jobs = useJobList(20);
  const pauseJob = useJobPause();
  const resumeJob = useJobResume();
  const fundJob = useJobFund();
  const solBalance = useSolBalance(walletAddress);

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      portfolio.refetch(),
      jobs.refetch(),
      solBalance.refetch(),
    ]);
    setRefreshing(false);
  }, [portfolio, jobs, solBalance]);

  const handleDisconnect = () => {
    Alert.alert('Disconnect Wallet', 'Are you sure you want to disconnect?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async() => {
          if(connectionMethod === 'privy') {
            await logout(); //clear privy session
          }

          disconnect(); //clears zustand
          router.replace('/(tabs)');
        },
      },
    ]);
  };

  const handleResume = async (jobId: string) => {
    try {
      // First try to fund
      const fundResult = await fundJob.mutateAsync(jobId);
      if (!fundResult.success) {
        Alert.alert(
          'No Funds',
          'This agent wallet has no USDC. Fund the wallet first.',
          [{ text: 'OK' }]
        );
        return;
      }
      // Then resume
      await resumeJob.mutateAsync(jobId);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to resume');
    }
  };

  const copyWallet = (addr: string) => {
    Clipboard.setString(addr);
    Alert.alert('Copied', 'Wallet address copied');
  };

  const jobList = jobs.data?.jobs ?? [];
  const displayJobs = jobList.map((job: any) => ({
    ...job,
    totalInvested: Number(job.totalInvested ?? 0),
    totalProfit: Number(job.totalProfit ?? 0),
    positions: job.positions ?? [],
  }));

  // Determine displayed balance — prefer on-chain SOL, fall back to backend portfolio
  const displayedSol = solBalance.data?.sol ?? 0;
  const displayedUsdc = portfolio.data?.walletBalance?.usdc ?? balance.usdc;
  const isBalanceLoading = solBalance.isLoading || (connectionMethod === 'privy' && portfolio.isLoading);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Profile</Text>
          <Pressable style={styles.settingsButton}>
            <Text style={styles.settingsIcon}>⚙️</Text>
          </Pressable>
        </View>

        <View style={styles.walletCard}>
          <Text style={styles.balanceLabel}>Wallet Balance</Text>
          {isBalanceLoading ? (
            <SkeletonLoader width={150} height={32} />
          ) : (
            <View style={{ gap: Spacing.xs }}>
              <Text style={styles.balanceValue}>
                {displayedSol.toFixed(4)} SOL
              </Text>
              {displayedUsdc > 0 && (
                <Text style={styles.balanceSecondary}>
                  {displayedUsdc.toFixed(2)} USDC
                </Text>
              )}
            </View>
          )}
          <Text style={styles.walletAddress}>
            Wallet: {walletAddress ? `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}` : 'Not connected'}
          </Text>
        {isConnected ? (
          <Pressable style={styles.disconnectBtn} onPress={handleDisconnect}>
            <Text style={styles.disconnectText}>Disconnect</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.connectBtn} onPress={() => router.push('/login')}>
            <Text style={styles.connectBtnText}>Connect Wallet</Text>
          </Pressable>
        )}
        {isConnected && (
          <Pressable
            style={styles.createAgentBtn}
            onPress={() => router.push('/create-agent')}
          >
            <Text style={styles.createAgentText}>+ Create Agent</Text>
          </Pressable>
        )}
        </View>

        {portfolio.data && (
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>${(portfolio.data.totalInvested ?? 0).toFixed(0)}</Text>
              <Text style={styles.summaryLabel}>Total Invested</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: (portfolio.data.totalProfit ?? 0) >= 0 ? Colors.success : Colors.danger }]}>
                {(portfolio.data.totalProfit ?? 0) >= 0 ? '+' : ''}${(portfolio.data.totalProfit ?? 0).toFixed(2)}
              </Text>
              <Text style={styles.summaryLabel}>Total Profit</Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active Hired Agents</Text>
          {jobs.isLoading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : displayJobs.length > 0 ? (
            displayJobs.map((job: any) => (
              <Pressable
                key={job.id}
                style={({ pressed }) => [styles.jobCard, pressed && styles.jobCardPressed]}
                onPress={() => router.push(`/job/${job.id}`)}
              >
                <View style={styles.jobHeader}>
                  <View style={styles.jobAgent}>
                    <View style={styles.jobAvatar}>
                      <Text style={styles.jobAvatarText}>{(job.agentName ?? 'AG').substring(0, 2)}</Text>
                    </View>
                    <View>
                      <Text style={styles.jobAgentName}>{job.agentName ?? 'Agent'}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={[
                          styles.jobStatus,
                          { color: job.status === 'active' ? Colors.success : job.status === 'paused' ? Colors.warning : Colors.textMuted }
                        ]}>{(job.status ?? 'paused').toUpperCase()}</Text>
                        <View style={[styles.modeBadgeSmall, { backgroundColor: (job.tradingMode ?? 'paper') === 'paper' ? Colors.accent + '22' : Colors.success + '22' }]}>
                          <Text style={[styles.modeBadgeTextSmall, { color: (job.tradingMode ?? 'paper') === 'paper' ? Colors.accent : Colors.success }]}>
                            {(job.tradingMode ?? 'paper') === 'paper' ? 'PAPER' : 'LIVE'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                  <View style={styles.jobPnl}>
                    <Text style={[styles.jobPnlValue, { color: job.totalProfit >= 0 ? Colors.success : Colors.danger }]}>
                      {job.totalProfit >= 0 ? '+' : ''}${job.totalProfit.toFixed(2)}
                    </Text>
                    <JobWalletBadge jobId={job.id} tradingMode={job.tradingMode} />
                  </View>
                </View>
                <View style={styles.positionsRow}>
                  {job.privyWalletAddress && (
                    <Pressable onPress={() => copyWallet(job.privyWalletAddress)}>
                      <Text style={styles.walletAddr} numberOfLines={1}>
                        {job.privyWalletAddress.substring(0, 8)}...{job.privyWalletAddress.slice(-4)}
                      </Text>
                    </Pressable>
                  )}
                  <View style={styles.jobActions}>
                    {job.status === 'active' && (
                      <Pressable
                        style={styles.pauseBtn}
                        onPress={(e: any) => {
                          e.stopPropagation?.();
                          pauseJob.mutate(job.id);
                        }}
                      >
                        <Text style={styles.pauseBtnText}>Pause</Text>
                      </Pressable>
                    )}
                    {job.status === 'paused' && (
                      <Pressable
                        style={styles.resumeBtn}
                        onPress={(e: any) => {
                          e.stopPropagation?.();
                          handleResume(job.id);
                        }}
                      >
                        <Text style={styles.resumeBtnText}>Resume</Text>
                      </Pressable>
                    )}
                    <Text style={styles.viewText}>View</Text>
                  </View>
                </View>
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No hired agents yet. Browse the marketplace to hire one.</Text>
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
  title: { fontFamily: Fonts.heading, fontSize: 24, fontWeight: '700', color: Colors.textPrimary },
  settingsButton: {
    width: 40, height: 40, borderRadius: BorderRadius.xl, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, justifyContent: 'center', alignItems: 'center',
  },
  settingsIcon: { fontSize: 18 },
  walletCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1,
    borderColor: Colors.accent, padding: Spacing.xl, gap: Spacing.lg,
  },
  balanceLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textSecondary },
  balanceValue: { fontFamily: Fonts.mono, fontSize: 32, fontWeight: '700', color: Colors.textPrimary },
  balanceSecondary: { fontFamily: Fonts.mono, fontSize: 18, fontWeight: '600', color: Colors.textSecondary },
  walletAddress: { fontFamily: Fonts.mono, fontSize: 12, color: Colors.textMuted },
  disconnectBtn: {
    alignSelf: 'flex-start', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm, backgroundColor: Colors.danger + '22',
  },
  disconnectText: { fontFamily: Fonts.body, fontSize: 13, fontWeight: '600', color: Colors.danger },
  connectBtn: {
    alignSelf: 'flex-start', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm, backgroundColor: Colors.accent + '22',
  },
  connectBtnText: { fontFamily: Fonts.body, fontSize: 13, fontWeight: '600', color: Colors.accent },
  createAgentBtn: {
    alignSelf: 'flex-start', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm, backgroundColor: Colors.accent + '22',
  },
  createAgentText: { fontFamily: Fonts.body, fontSize: 13, fontWeight: '600', color: Colors.accent },
  summaryRow: { flexDirection: 'row', gap: Spacing.lg },
  summaryItem: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.xs,
  },
  summaryValue: { fontFamily: Fonts.mono, fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  summaryLabel: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  section: { gap: Spacing.lg },
  sectionTitle: { fontFamily: Fonts.body, fontSize: 18, fontWeight: '600', color: Colors.textPrimary },
  jobCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.lg,
  },
  jobCardPressed: { borderColor: Colors.accent, opacity: 0.85 },
  jobHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobAgent: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  jobAvatar: {
    width: 40, height: 40, borderRadius: BorderRadius.md, backgroundColor: Colors.accent + '22',
    justifyContent: 'center', alignItems: 'center',
  },
  jobAvatarText: { fontFamily: Fonts.mono, fontSize: 14, fontWeight: '700', color: Colors.accent },
  jobAgentName: { fontFamily: Fonts.body, fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  jobStatus: { fontFamily: Fonts.body, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  jobPnl: { alignItems: 'flex-end', gap: 2 },
  jobPnlValue: { fontFamily: Fonts.mono, fontSize: 16, fontWeight: '700' },
  walletBadge: { fontFamily: Fonts.mono, fontSize: 10, color: Colors.textMuted },
  modeBadgeSmall: {
    paddingHorizontal: 4, paddingVertical: 1,
    borderRadius: BorderRadius.sm,
  },
  modeBadgeTextSmall: { fontFamily: Fonts.body, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  positionsRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  walletAddr: { fontFamily: Fonts.mono, fontSize: 11, color: Colors.textMuted },
  jobActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pauseBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm, backgroundColor: Colors.warning + '22',
  },
  pauseBtnText: { fontFamily: Fonts.body, fontSize: 12, fontWeight: '600', color: Colors.warning },
  resumeBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm, backgroundColor: Colors.success + '22',
  },
  resumeBtnText: { fontFamily: Fonts.body, fontSize: 12, fontWeight: '600', color: Colors.success },
  viewText: { fontFamily: Fonts.body, fontSize: 13, fontWeight: '600', color: Colors.accent },
  emptyState: { padding: Spacing.xl, alignItems: 'center' },
  emptyText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
});
