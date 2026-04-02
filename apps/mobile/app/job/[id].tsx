import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Clipboard, ActivityIndicator, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VersionedTransaction } from '@solana/web3.js';
import { getSolanaConnection } from '../../src/lib/solana';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';
import { FeedItem } from '../../src/components/FeedItem';
import { SkeletonCard, SkeletonLoader } from '../../src/components/SkeletonLoader';
import { useJobGet, useFeedByJob, useJobCancel, useJobWalletBalance, useJobFund, useJobResume, useJobRegisterOnChain, useJobConfirmOnChain } from '../../src/lib/api';
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
  const registerOnChain = useJobRegisterOnChain();
  const confirmOnChain = useJobConfirmOnChain();
  const walletBalance = useJobWalletBalance(id ?? '');

  const [signing, setSigning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    userSolBalance.refetch();
    walletBalance.refetch();
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

  const handleRegisterOnChain = async () => {
    if (!walletAddress) return;
    setSigning(true);
    try {
      // 1. Get instruction data from backend
      const result = await registerOnChain.mutateAsync(job.id);
      if (result.message === 'Already registered') {
        Alert.alert('Info', 'Already registered on-chain');
        setSigning(false);
        return;
      }

      // 2. Build transaction locally with fresh blockhash
      const { Connection, PublicKey, TransactionInstruction, SystemProgram, VersionedTransaction, TransactionMessage } = await import('@solana/web3.js');
                          const conn = getSolanaConnection();

      const programId = new PublicKey(result.programId);
      const user = new PublicKey(walletAddress);
      const privyWalletPk = new PublicKey(result.privyWalletAddress);

      // Use hash from backend (no crypto module in RN)
      const jobIdHashBytes = Buffer.from(result.jobIdHash, 'hex');
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('job'), user.toBytes(), jobIdHashBytes],
        programId
      );

      // Build instruction data: discriminator(8) + agent_id(borsh String) + privy_wallet(32 bytes)
      const discriminator = Buffer.from([137, 22, 138, 41, 76, 208, 114, 50]); // initialize_job
      const agentIdBytes = Buffer.from(job.id, 'utf-8');
      const agentIdLen = Buffer.alloc(4);
      agentIdLen.writeUInt32LE(agentIdBytes.length);
      const privyWalletBytes = privyWalletPk.toBuffer();
      const data = Buffer.concat([discriminator, agentIdLen, agentIdBytes, privyWalletBytes]);

      const ix = new TransactionInstruction({
        keys: [
          { pubkey: pda, isSigner: false, isWritable: true },
          { pubkey: user, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId,
        data,
      });

      // Get fresh blockhash
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');

      // Build versioned transaction
      const messageV0 = new TransactionMessage({
        payerKey: user,
        recentBlockhash: blockhash,
        instructions: [ix],
      }).compileToV0Message();
      const tx = new VersionedTransaction(messageV0);

      // 3. Sign and send
      let txSig = '';

      if (connectionMethod === 'mwa' && transact) {
        await transact(async (wallet: any) => {
          await wallet.authorize({
            cluster: 'devnet',
            identity: { name: 'AgentArena', uri: 'https://agentarena.dev', icon: 'favicon.ico' },
          });
          const sigs = await (wallet as any).signAndSendTransactions({
            payloads: [Buffer.from(tx.serialize()).toString('base64')],
          });
          txSig = sigs[0];
        });
      } else if (wallets && wallets.length > 0) {
        const provider = await wallets[0].getProvider();
        const result2 = await (provider as any).request({
          method: 'signAndSendTransaction',
          params: { transaction: tx, connection: conn },
        });
        txSig = result2.signature;
      } else if (transact) {
        await transact(async (wallet: any) => {
          await wallet.authorize({
            cluster: 'devnet',
            identity: { name: 'AgentArena', uri: 'https://agentarena.dev', icon: 'favicon.ico' },
          });
          const sigs = await (wallet as any).signAndSendTransactions({
            payloads: [Buffer.from(tx.serialize()).toString('base64')],
          });
          txSig = sigs[0];
        });
      } else {
        Alert.alert('No Wallet', 'Connect Phantom/Solflare via MWA to register on-chain.');
        setSigning(false);
        return;
      }

      console.log('On-chain TX:', txSig);

      // 4. Confirm with backend
      await confirmOnChain.mutateAsync({
        id: job.id,
        onChainAddress: result.onChainAddress,
        txSignature: txSig,
      });
      Alert.alert('Registered!', 'Job registered on Solana devnet.');
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Registration failed');
    } finally {
      setSigning(false);
    }
  };

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
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>Duration</Text>
                  <Text style={styles.statValue}>{daysSinceStart}d</Text>
                </View>
              </View>
            </View>

            {/* Wallet */}
            {job.privyWalletAddress && (
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
            )}

            {/* On-Chain Registration Status */}
            {isOnChain ? (
              <View style={styles.onChainBadge}>
                <Text style={styles.onChainBadgeText}>✓ Registered on Solana</Text>
                <Text style={styles.onChainBadgeAddr} numberOfLines={1}>{job.onChainAddress}</Text>
              </View>
            ) : (
              <>
                {(userSolBalance.data?.sol ?? 0) < 0.01 && (
                  <View style={styles.lowBalanceBanner}>
                    <Text style={styles.lowBalanceText}>
                      Your wallet needs SOL for tx fees ({(userSolBalance.data?.sol ?? 0).toFixed(4)} SOL)
                    </Text>
                    <Pressable
                      style={styles.airdropBtn}
                      onPress={async () => {
                        try {
                          const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
      const conn = getSolanaConnection();
                          const sig = await conn.requestAirdrop(new PublicKey(walletAddress!), 1 * LAMPORTS_PER_SOL);
                          Alert.alert('Airdrop Sent', `1 SOL sent\nTX: ${sig.slice(0, 16)}...`);
                          setTimeout(() => userSolBalance.refetch(), 3000);
                        } catch (err: any) {
                          Alert.alert('Airdrop Failed', err?.message ?? 'Rate limited. Try again.');
                        }
                      }}>
                      <Text style={styles.airdropBtnText}>Airdrop 1 SOL</Text>
                    </Pressable>
                  </View>
                )}
                <Pressable
                  style={({ pressed }) => [styles.registerBtn, pressed && { opacity: 0.85 }, signing && { opacity: 0.5 }]}
                  onPress={handleRegisterOnChain}
                  disabled={signing}>
                  {signing ? <ActivityIndicator size="small" color={Colors.accent} />
                    : <Text style={styles.registerBtnText}>Register On-Chain</Text>}
                </Pressable>
              </>
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
});
