import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking, RefreshControl } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';
import { useJobGet, useJobPause, useJobResume, useJobWalletBalance } from '../../src/lib/api';
import { SkeletonLoader, SkeletonCard } from '../../src/components/SkeletonLoader';
import { FeedItem } from '../../src/components/FeedItem';

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: job, isLoading, refetch } = useJobGet(id!);
  const [refreshing, setRefreshing] = useState(false);
  
  const pauseJob = useJobPause();
  const resumeJob = useJobResume();
  const liveBalance = useJobWalletBalance(job?.id ?? '');
  
  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (!job && !isLoading) {
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

  const categoryColor = Colors[job?.agentCategory as keyof typeof Colors] || Colors.accent;

  const handlePause = async () => {
    if (job?.id) await pauseJob.mutateAsync(job.id);
  };

  const handleResume = async () => {
    // Assuming funded
    if (job?.id) await resumeJob.mutateAsync(job.id);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
      >
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Job Detail</Text>
          {job && (
            <View style={[styles.statusBadge, { backgroundColor: job.status === 'active' ? Colors.success + '22' : Colors.warning + '22' }]}>
              <Text style={[styles.statusText, { color: job.status === 'active' ? Colors.success : Colors.warning }]}>
                {job.status.toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        {isLoading ? (
          <>
            <SkeletonLoader height={80} />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            {/* Context Header */}
            <View style={styles.card}>
              <View style={styles.agentRow}>
                <View style={[styles.avatar, { backgroundColor: (categoryColor as string) + '22' }]}>
                  <Text style={[styles.avatarText, { color: categoryColor as string }]}>
                    {job.agentName?.substring(0, 2).toUpperCase() ?? 'AG'}
                  </Text>
                </View>
                <View style={{ gap: 4 }}>
                  <Text style={styles.agentName}>{job.agentName}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                     <View style={[styles.categoryBadge, { backgroundColor: (categoryColor as string) + '22' }]}>
                      <Text style={[styles.categoryText, { color: categoryColor as string }]}>{job.agentCategory?.toUpperCase()}</Text>
                    </View>
                    <View style={styles.modeBadge}>
                      <Text style={styles.modeBadgeText}>
                        {job.tradingMode === 'paper' ? 'PAPER TRADING' : 'LIVE TRADING'}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Total Invested</Text>
                  <Text style={styles.statVal}>${Number(job.totalInvested ?? 0).toFixed(2)}</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Total Profit</Text>
                  <Text style={[styles.statVal, { color: Number(job.totalProfit ?? 0) >= 0 ? Colors.success : Colors.danger }]}>
                    {Number(job.totalProfit ?? 0) >= 0 ? '+' : ''}${Number(job.totalProfit ?? 0).toFixed(2)}
                  </Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Max Cap</Text>
                  <Text style={styles.statVal}>${Number(job.maxCap ?? 0).toFixed(0)}</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Wallet Balance</Text>
                  <Text style={styles.statVal}>
                    {job.tradingMode === 'paper' 
                      ? `$${Number(job?.paperBalance ?? 0).toFixed(0)}` 
                      : `$${(liveBalance.data?.usdc ?? 0).toFixed(0)}`}
                  </Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                {job.status === 'active' ? (
                  <Pressable style={styles.pauseBtn} onPress={handlePause}>
                    <Text style={styles.pauseBtnText}>Pause Agent</Text>
                  </Pressable>
                ) : (
                  <Pressable style={styles.resumeBtn} onPress={handleResume}>
                    <Text style={styles.resumeBtnText}>Resume Agent</Text>
                  </Pressable>
                )}
              </View>
            </View>

            {/* On-Chain Proof */}
            {job.explorerLinks && (
              <View style={styles.explorerCard}>
                <Text style={styles.explorerTitle}>On-Chain Proof</Text>
                <Text style={styles.explorerSubtitle}>Transactions & Assets on Solana Devnet</Text>

                {job.explorerLinks.agentAsset && (
                  <Pressable style={styles.explorerLink} onPress={() => Linking.openURL(job.explorerLinks.agentAsset!)}>
                    <Text style={styles.explorerLinkIcon}>🆔</Text>
                    <View style={styles.explorerLinkText}>
                      <Text style={styles.explorerLinkLabel}>Agent NFT</Text>
                      <Text style={styles.explorerLinkUrl} numberOfLines={1}>View on Solana Explorer →</Text>
                    </View>
                  </Pressable>
                )}

                {job.explorerLinks.fundTx && (
                  <Pressable style={styles.explorerLink} onPress={() => Linking.openURL(job.explorerLinks.fundTx!)}>
                    <Text style={styles.explorerLinkIcon}>💸</Text>
                    <View style={styles.explorerLinkText}>
                      <Text style={styles.explorerLinkLabel}>Wallet Funding</Text>
                      <Text style={styles.explorerLinkUrl} numberOfLines={1}>View on Solana Explorer →</Text>
                    </View>
                  </Pressable>
                )}

                {job.explorerLinks.agentWallet && (
                  <Pressable style={styles.explorerLink} onPress={() => Linking.openURL(job.explorerLinks.agentWallet!)}>
                    <Text style={styles.explorerLinkIcon}>👛</Text>
                    <View style={styles.explorerLinkText}>
                      <Text style={styles.explorerLinkLabel}>Agent Wallet</Text>
                      <Text style={styles.explorerLinkUrl} numberOfLines={1}>View on Solana Explorer →</Text>
                    </View>
                  </Pressable>
                )}
              </View>
            )}

            {/* Trades History */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent Trades</Text>
              {job.trades && job.trades.length > 0 ? (
                <View style={styles.tradesList}>
                  {job.trades.map((trade: any) => (
                    <View key={trade.id} style={styles.tradeCard}>
                      <View style={styles.tradeHeader}>
                        <Text style={styles.tradeMarket}>{trade.marketQuestion}</Text>
                        <Text style={[styles.tradePnl, { color: trade.profitLoss >= 0 ? Colors.success : Colors.danger }]}>
                          {trade.profitLoss >= 0 ? '+' : ''}${Number(trade.profitLoss).toFixed(2)}
                        </Text>
                      </View>
                      <View style={styles.tradeFooter}>
                        <Text style={styles.tradeSide}>{trade.side.toUpperCase()} at ${Number(trade.entryPrice).toFixed(2)}</Text>
                        {trade.txSignature && (
                          <Pressable onPress={() => Linking.openURL(`https://explorer.solana.com/tx/${trade.txSignature}?cluster=devnet`)}>
                            <Text style={styles.tradeLink}>View Tx ↗</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.emptyTrades}>
                  <Text style={styles.emptyTradesText}>No completed trades yet.</Text>
                </View>
              )}
            </View>

          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.screenPadding, paddingBottom: 100, gap: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  backButton: {
    width: 40, height: 40, borderRadius: BorderRadius.xl, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, justifyContent: 'center', alignItems: 'center',
  },
  backIcon: { fontSize: 18, color: Colors.textPrimary },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 20, fontWeight: '700', color: Colors.textPrimary, flex: 1 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontFamily: Fonts.body, fontSize: 12, fontWeight: '700' },
  emptyState: { padding: Spacing.xl, alignItems: 'center' },
  emptyText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.lg },
  agentRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  avatar: { width: 48, height: 48, borderRadius: BorderRadius.md, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontFamily: Fonts.mono, fontSize: 18, fontWeight: '700' },
  agentName: { fontFamily: Fonts.body, fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  categoryBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.sm },
  categoryText: { fontFamily: Fonts.body, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  modeBadge: { backgroundColor: Colors.accent + '22', borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  modeBadgeText: { fontFamily: Fonts.body, fontSize: 10, fontWeight: '700', color: Colors.accent, letterSpacing: 0.5 },
  
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statBox: { width: '48%', backgroundColor: Colors.background, padding: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  statLabel: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginBottom: 4 },
  statVal: { fontFamily: Fonts.mono, fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  
  actionRow: { marginTop: Spacing.sm },
  pauseBtn: { backgroundColor: Colors.warning + '22', padding: Spacing.md, borderRadius: BorderRadius.md, alignItems: 'center' },
  pauseBtnText: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '600', color: Colors.warning },
  resumeBtn: { backgroundColor: Colors.success, padding: Spacing.md, borderRadius: BorderRadius.md, alignItems: 'center' },
  resumeBtnText: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '600', color: Colors.background },

  explorerCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.accent, padding: Spacing.lg, gap: Spacing.md },
  explorerTitle: { fontFamily: Fonts.heading, fontSize: 16, fontWeight: '700', color: Colors.accent },
  explorerSubtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: -4 },
  explorerLink: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.background, borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  explorerLinkIcon: { fontSize: 24 },
  explorerLinkText: { flex: 1, gap: 2 },
  explorerLinkLabel: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  explorerLinkUrl: { fontFamily: Fonts.body, fontSize: 12, color: Colors.accent },

  section: { gap: Spacing.md },
  sectionTitle: { fontFamily: Fonts.body, fontSize: 18, fontWeight: '600', color: Colors.textPrimary },
  tradesList: { gap: Spacing.md },
  tradeCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: Spacing.sm },
  tradeHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  tradeMarket: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, flex: 1, lineHeight: 20 },
  tradePnl: { fontFamily: Fonts.mono, fontSize: 14, fontWeight: '700' },
  tradeFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tradeSide: { fontFamily: Fonts.mono, fontSize: 12, color: Colors.textMuted },
  tradeLink: { fontFamily: Fonts.body, fontSize: 12, color: Colors.accent },
  emptyTrades: { padding: Spacing.xl, alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md },
  emptyTradesText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
});
