import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing, BorderRadius } from '../constants/Colors';
import { useAuthStore } from '../src/stores/authStore';

const CATEGORIES = ['geo', 'politics', 'sports', 'general'] as const;
const PRICING_TYPES = [
  { value: 'subscription', label: 'Subscription' },
  { value: 'per_trade', label: 'Per Trade' },
  { value: 'profit_share', label: 'Profit Share' },
] as const;

const CAPABILITY_OPTIONS = [
  'market_analysis',
  'news_tracking',
  'risk_management',
  'social_signals',
  'macro_analysis',
  'technical_analysis',
  'sentiment_analysis',
  'position_sizing',
  'stop_loss',
  'portfolio_rebalance',
];

function getBaseUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (__DEV__) return 'http://10.0.2.2:3001';
  return 'https://api.agentarena.dev';
}

export default function CreateAgentScreen() {
  const router = useRouter();
  const { isConnected, walletAddress, connectionMethod } = useAuthStore();

  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('geo');
  const [description, setDescription] = useState('');
  const [pricingType, setPricingType] = useState<string>('subscription');
  const [pricingAmount, setPricingAmount] = useState('10');
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [maxCap, setMaxCap] = useState('100');
  const [dailyCap, setDailyCap] = useState('500');
  const [totalCap, setTotalCap] = useState('2000');
  const [isLoading, setIsLoading] = useState(false);

  const toggleCapability = (cap: string) => {
    setCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    );
  };

  const handleCreate = async () => {
    if (!isConnected || !walletAddress) {
      router.push('/login');
      return;
    }

    if (!name.trim()) {
      Alert.alert('Error', 'Agent name is required');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Error', 'Description is required');
      return;
    }
    if (capabilities.length === 0) {
      Alert.alert('Error', 'Select at least one capability');
      return;
    }

    const payload = {
      name: name.trim(),
      category,
      description: description.trim(),
      pricingModel: {
        type: pricingType,
        amount: parseFloat(pricingAmount) || 0,
      },
      capabilities,
      maxCap: parseFloat(maxCap) || 100,
      dailyCap: parseFloat(dailyCap) || 500,
      totalCap: parseFloat(totalCap) || 2000,
    };

    setIsLoading(true);
    try {
      if (connectionMethod === 'privy') {
        const res = await fetch(`${getBaseUrl()}/trpc/agent.create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-wallet-address': walletAddress,
          },
          body: JSON.stringify({
            ...payload,
            connectionMethod: 'privy',
          }),
        });

        if (!res.ok) {
          const err = await res.text();
          throw new Error(err);
        }

        Alert.alert(
          'Agent Created',
          'Your agent is now listed on the marketplace. Users can hire it from the agent detail page.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      } else {
        const res = await fetch(`${getBaseUrl()}/trpc/agent.create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-wallet-address': walletAddress,
          },
          body: JSON.stringify({
            ...payload,
            connectionMethod: 'mwa',
          }),
        });

        if (!res.ok) {
          const err = await res.text();
          throw new Error(err);
        }

        Alert.alert(
          'Agent Created',
          'Your agent is now listed on the marketplace. Users can hire it from the agent detail page.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to create agent');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Create Agent</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Agent Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. GeoSentinel Alpha"
            placeholderTextColor={Colors.textMuted}
            value={name}
            onChangeText={setName}
            maxLength={100}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Category</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat}
                style={[styles.chip, category === cat && styles.chipActive]}
                onPress={() => setCategory(cat)}
              >
                <Text
                  style={[
                    styles.chipText,
                    category === cat && styles.chipTextActive,
                  ]}
                >
                  {cat.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="What does this agent do?"
            placeholderTextColor={Colors.textMuted}
            value={description}
            onChangeText={setDescription}
            maxLength={500}
            multiline
            numberOfLines={4}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Pricing Model</Text>
          <View style={styles.chipRow}>
            {PRICING_TYPES.map((pt) => (
              <Pressable
                key={pt.value}
                style={[styles.chip, pricingType === pt.value && styles.chipActive]}
                onPress={() => setPricingType(pt.value)}
              >
                <Text
                  style={[
                    styles.chipText,
                    pricingType === pt.value && styles.chipTextActive,
                  ]}
                >
                  {pt.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Amount (USDC)"
            placeholderTextColor={Colors.textMuted}
            value={pricingAmount}
            onChangeText={setPricingAmount}
            keyboardType="decimal-pad"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Capabilities</Text>
          <View style={styles.capGrid}>
            {CAPABILITY_OPTIONS.map((cap) => (
              <Pressable
                key={cap}
                style={[
                  styles.capChip,
                  capabilities.includes(cap) && styles.capChipActive,
                ]}
                onPress={() => toggleCapability(cap)}
              >
                <Text
                  style={[
                    styles.capChipText,
                    capabilities.includes(cap) && styles.capChipTextActive,
                  ]}
                >
                  {cap.replace(/_/g, ' ')}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Risk Parameters</Text>
          <Text style={styles.sectionDesc}>
            Control how much this agent can trade per position, per day, and in total.
          </Text>

          <View style={styles.riskRow}>
            <View style={styles.riskField}>
              <Text style={styles.label}>Max Per Trade</Text>
              <TextInput
                style={styles.input}
                placeholder="$100"
                placeholderTextColor={Colors.textMuted}
                value={maxCap}
                onChangeText={setMaxCap}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={styles.riskField}>
              <Text style={styles.label}>Daily Cap</Text>
              <TextInput
                style={styles.input}
                placeholder="$500"
                placeholderTextColor={Colors.textMuted}
                value={dailyCap}
                onChangeText={setDailyCap}
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Total Investment Cap</Text>
            <TextInput
              style={styles.input}
              placeholder="$2000"
              placeholderTextColor={Colors.textMuted}
              value={totalCap}
              onChangeText={setTotalCap}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.createButton,
            pressed && styles.createPressed,
            isLoading && styles.createDisabled,
          ]}
          onPress={handleCreate}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={Colors.textPrimary} />
          ) : (
            <Text style={styles.createButtonText}>Create Agent</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: {
    padding: Spacing.screenPadding,
    paddingBottom: 100,
    gap: Spacing.xl,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.xl,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIcon: { fontSize: 18, color: Colors.textPrimary },
  headerTitle: {
    fontFamily: Fonts.heading,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  section: { gap: Spacing.sm },
  sectionTitle: {
    fontFamily: Fonts.body,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  sectionDesc: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textMuted,
    lineHeight: 18,
  },
  label: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    height: 48,
    paddingHorizontal: Spacing.lg,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
    paddingTop: Spacing.md,
  },
  chipRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent + '22',
  },
  chipText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  chipTextActive: { color: Colors.accent },
  capGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  capChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  capChipActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent + '22',
  },
  capChipText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textSecondary,
    textTransform: 'capitalize',
  },
  capChipTextActive: { color: Colors.accent },
  riskRow: { flexDirection: 'row', gap: Spacing.md },
  riskField: { flex: 1, gap: Spacing.sm },
  createButton: {
    backgroundColor: Colors.accent,
    borderRadius: BorderRadius.md,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  createPressed: { backgroundColor: Colors.accentDark },
  createDisabled: { opacity: 0.6 },
  createButtonText: {
    fontFamily: Fonts.body,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
});
