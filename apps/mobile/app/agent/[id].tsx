import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, ActivityIndicator, Clipboard, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VersionedTransaction, PublicKey } from '@solana/web3.js';
import { getSolanaConnection } from '../../src/lib/solana';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';
import { SkeletonCard, SkeletonLoader } from '../../src/components/SkeletonLoader';
import { FeedItem } from '../../src/components/FeedItem';
import { useAgentGet, useFeedByAgent, useJobCreate, useJobFund, useJobResume, useJobWalletBalance, useJobConfirmOnChain } from '../../src/lib/api';
import { useAuthStore } from '../../src/stores/authStore';
import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useSolBalance } from '../../src/hooks/useSolBalance';

// MWA for Phantom/Solflare on Android
let transact: any = null;
try { transact = require('@solana-mobile/mobile-wallet-adapter-protocol').transact; } catch {}

type HireStep = 'config' | 'sign' | 'fund' | 'done';

export default function AgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isConnected, walletAddress, connectionMethod } = useAuthStore();
  const { wallets } = useEmbeddedSolanaWallet();
  const userSolBalance = useSolBalance(walletAddress);

  const { data: agentData, isLoading } = useAgentGet(id!);
  const { data: feedData } = useFeedByAgent(id!, 20);
  const hireJob = useJobCreate();
  const fundJob = useJobFund();
  const resumeJob = useJobResume();
  const confirmOnChain = useJobConfirmOnChain();

  const [step, setStep] = useState<HireStep>('config');
  const [jobId, setJobId] = useState<string | null>(null);
  const [privyWallet, setPrivyWallet] = useState<string | null>(null);
  const [pendingPda, setPendingPda] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [signing, setSigning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

  // Poll balance in fund step
  useEffect(() => {
    if (step !== 'fund' || !jobId) return;
    const interval = setInterval(() => walletBalance.refetch(), 5000);
    return () => clearInterval(interval);
  }, [step, jobId]);

  const agent = agentData ?? null;
  const agentFeed = feedData?.events ?? [];

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

  // Step 1: Create job (Privy wallet + on-chain tx)
  const handleHire = () => {
    if (!isConnected) { router.push('/login'); return; }
    hireJob.mutate(
      { agentId: agent.id, maxCap: parseFloat(maxCap) || 100, dailyCap: parseFloat(dailyCap) || 500 },
      {
        onSuccess: (data: any) => {
          setJobId(data.id);
          setPrivyWallet(data.privyWalletAddress);
          setPendingPda(data.onChainAddress || null);
          setStep('sign');
        },
        onError: (err: any) => Alert.alert('Error', err?.message ?? 'Failed to hire'),
      }
    );
  };

  // Step 2: Sign on-chain tx (build locally with fresh blockhash)
  const handleSign = async () => {
    if (!walletAddress || !jobId || !privyWallet) return;
    setSigning(true);
    try {
      const { Connection, PublicKey, TransactionInstruction, SystemProgram, TransactionMessage, VersionedTransaction } = await import('@solana/web3.js');
      const conn = getSolanaConnection();

      // Fetch registration data from backend
      const baseUrl = process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3001';
      const res = await fetch(`${baseUrl}/trpc/job.registerOnChain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': walletAddress },
        body: JSON.stringify({ id: jobId }),
      });
      const resJson = await res.json();
      const regInfo = resJson.result?.data;

      if (!regInfo?.jobIdHash) {
        Alert.alert('Error', regInfo?.message || 'Could not get registration data');
        setSigning(false);
        return;
      }

      if (regInfo.message === 'Already registered') {
        setSigned(true);
        setStep('fund');
        setSigning(false);
        return;
      }

      const programId = new PublicKey(regInfo.programId);
      const user = new PublicKey(walletAddress);
      const privyWalletPk = new PublicKey(privyWallet);

      // Build instruction
      const jobIdHashBytes = Buffer.from(regInfo.jobIdHash, 'hex');
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('job'), user.toBytes(), jobIdHashBytes], programId
      );

      const discriminator = Buffer.from([137, 22, 138, 41, 76, 208, 114, 50]);
      const agentIdBytes = Buffer.from(jobId, 'utf-8');
      const agentIdLen = Buffer.alloc(4);
      agentIdLen.writeUInt32LE(agentIdBytes.length);
      const data = Buffer.concat([discriminator, agentIdLen, agentIdBytes, privyWalletPk.toBuffer()]);

      const ix = new TransactionInstruction({
        keys: [
          { pubkey: pda, isSigner: false, isWritable: true },
          { pubkey: user, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId, data,
      });

      // Fresh blockhash + build tx
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      const messageV0 = new TransactionMessage({
        payerKey: user, recentBlockhash: blockhash, instructions: [ix],
      }).compileToV0Message();
      const tx = new VersionedTransaction(messageV0);

      // Sign and send
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
        const result = await (provider as any).request({
          method: 'signAndSendTransaction',
          params: { transaction: tx, connection: conn },
        });
        txSig = result.signature;
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
        Alert.alert('No Wallet', 'No wallet available for signing. Connect Phantom/Solflare via MWA.');
        setSigning(false);
        return;
      }

      console.log('On-chain TX:', txSig);

      // Confirm on-chain registration with backend
      await confirmOnChain.mutateAsync({ id: jobId, onChainAddress: pda.toBase58(), txSignature: txSig });
      setSigned(true);
      setStep('fund');
    } catch (err: any) {
      console.error('Sign error:', err);
      Alert.alert('Signing Failed', err?.message ?? 'Could not sign transaction');
    } finally {
      setSigning(false);
    }
  };

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
                  <View style={[styles.categoryBadge, { backgroundColor: (categoryColor as string) + '22' }]}>
                    <Text style={[styles.categoryText, { color: categoryColor as string }]}>{agent.category.toUpperCase()}</Text>
                  </View>
                </View>
              </View>
              <Text style={styles.description}>{agent.description}</Text>
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

            {/* === STEP INDICATOR === */}
            <View style={styles.stepsRow}>
              {['Configure', 'Sign', 'Fund & Start'].map((label, i) => {
                const stepIdx = step === 'config' ? 0 : step === 'sign' ? 1 : 2;
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
                  style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed, hireJob.isPending && styles.disabled]}
                  onPress={handleHire} disabled={hireJob.isPending}>
                  {hireJob.isPending ? <ActivityIndicator size="small" color={Colors.textPrimary} />
                    : <Text style={styles.primaryBtnText}>Configure & Continue</Text>}
                </Pressable>
              </View>
            )}

            {/* === STEP 2: SIGN === */}
            {step === 'sign' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Register On-Chain</Text>
                <Text style={styles.sectionDesc}>
                  Sign a transaction to register this job on Solana devnet. This creates a transparent on-chain record linking your wallet to the agent.
                </Text>

                <View style={styles.infoCard}>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Your Wallet</Text>
                    <Text style={styles.infoValue} numberOfLines={1}>{walletAddress?.substring(0, 8)}...{walletAddress?.slice(-4)}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Agent Wallet</Text>
                    <Text style={styles.infoValue} numberOfLines={1}>{privyWallet?.substring(0, 8)}...{privyWallet?.slice(-4)}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Max / Trade</Text>
                    <Text style={styles.infoValue}>${maxCap}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Daily Cap</Text>
                    <Text style={styles.infoValue}>${dailyCap}</Text>
                  </View>
                </View>

                {!signed ? (
                  <>
                    {/* Connected wallet balance */}
                    <View style={styles.walletBalanceCard}>
                      <Text style={styles.walletBalanceLabel}>Your Wallet Balance</Text>
                      <Text style={styles.walletBalanceValue}>
                        {(userSolBalance.data?.sol ?? 0).toFixed(4)} SOL
                      </Text>
                      {(userSolBalance.data?.sol ?? 0) < 0.01 && (
                        <View style={styles.lowBalanceRow}>
                          <Text style={styles.lowBalanceText}>Low balance — airdrop SOL for tx fees</Text>
                          <Pressable
                            style={styles.airdropBtn}
                            onPress={async () => {
                              try {
                                const { Connection, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
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
                    </View>

                    <Pressable
                      style={({ pressed }) => [styles.signBtn, pressed && styles.pressed, signing && styles.disabled]}
                      onPress={handleSign} disabled={signing}>
                      {signing ? <ActivityIndicator size="small" color={Colors.textPrimary} />
                        : <Text style={styles.primaryBtnText}>
                            {connectionMethod === 'mwa' ? 'Sign with Phantom/Solflare' : 'Register On-Chain'}
                          </Text>}
                    </Pressable>
                    <Pressable style={styles.skipBtn} onPress={() => setStep('fund')}>
                      <Text style={styles.skipBtnText}>Skip for now</Text>
                    </Pressable>
                  </>
                ) : (
                  <View style={styles.successBanner}>
                    <Text style={styles.successBannerText}>✓ Registered on-chain</Text>
                  </View>
                )}

                {signed && (
                  <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                    onPress={() => setStep('fund')}>
                    <Text style={styles.primaryBtnText}>Continue to Funding</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* === STEP 3: FUND & START === */}
            {step === 'fund' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Fund Your Agent</Text>
                <Text style={styles.sectionDesc}>
                  Send SOL or USDC to the agent wallet to start trading.
                </Text>

                <Pressable style={styles.walletCard} onPress={copyWallet}>
                  <Text style={styles.walletLabel}>Agent Wallet (tap to copy)</Text>
                  <Text style={styles.walletAddr} numberOfLines={1}>
                    {privyWallet ? `${privyWallet.substring(0, 12)}...${privyWallet.slice(-8)}` : '...'}
                  </Text>
                </Pressable>

                <View style={styles.balanceCard}>
                  <Text style={styles.balanceLabel}>Current Balance</Text>
                  {walletBalance.isLoading ? <SkeletonLoader width={120} height={28} /> : (
                    <View style={styles.balanceValues}>
                      <Text style={styles.balanceValue}>${(walletBalance.data?.usdc ?? 0).toFixed(2)} USDC</Text>
                      <Text style={styles.balanceSol}>{(walletBalance.data?.sol ?? 0).toFixed(4)} SOL</Text>
                    </View>
                  )}
                  <Text style={styles.balanceHint}>
                    {hasBalance ? '✓ Funds detected!' : 'Waiting for funds... (checks every 5s)'}
                  </Text>
                </View>

                {/* Fund options */}
                <View style={styles.fundOptions}>
                  <Pressable style={styles.fundOptionBtn} onPress={() => {
                    Clipboard.setString(privyWallet || '');
                    Alert.alert('Copied', 'Send USDC from your wallet app to this address');
                  }}>
                    <Text style={styles.fundOptionText}>Copy Address</Text>
                  </Pressable>
                  <Pressable style={styles.fundOptionBtn} onPress={async () => {
                    try {
                      const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
                      const conn = getSolanaConnection();
                      const sig = await conn.requestAirdrop(new PublicKey(privyWallet!), 1 * LAMPORTS_PER_SOL);
                      Alert.alert('Airdrop Sent', `1 SOL sent to agent wallet\nTX: ${sig.slice(0, 16)}...`);
                      setTimeout(() => walletBalance.refetch(), 3000);
                    } catch (err: any) {
                      Alert.alert('Airdrop Failed', err?.message ?? 'Rate limited. Try again later.');
                    }
                  }}>
                    <Text style={styles.fundOptionText}>Airdrop 1 SOL (devnet)</Text>
                  </Pressable>
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.primaryBtn, pressed && styles.pressed,
                    (!hasBalance || fundJob.isPending || resumeJob.isPending) && styles.disabled,
                  ]}
                  onPress={handleStart}
                  disabled={!hasBalance || fundJob.isPending || resumeJob.isPending}>
                  {(fundJob.isPending || resumeJob.isPending)
                    ? <ActivityIndicator size="small" color={Colors.textPrimary} />
                    : <Text style={styles.primaryBtnText}>
                        {hasBalance ? 'Start Trading Agent' : 'Fund wallet first'}
                      </Text>}
                </Pressable>
              </View>
            )}

            {/* === DONE === */}
            {step === 'done' && (
              <View style={styles.successCard}>
                <Text style={styles.successIcon}>✓</Text>
                <Text style={styles.successTitle}>Agent is Active!</Text>
                <Text style={styles.successDesc}>Your agent is now scanning markets and making trades.</Text>
                <Pressable style={styles.profileBtn} onPress={() => router.push('/(tabs)/profile')}>
                  <Text style={styles.profileBtnText}>View in Profile</Text>
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
  activityHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  categoryBadgeSmall: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.sm },
  categoryTextSmall: { fontFamily: Fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
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

  feedList: { gap: Spacing.md },
  skeletonList: { gap: Spacing.md },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  emptyText: { fontFamily: Fonts.body, fontSize: 16, color: Colors.textMuted },
});
