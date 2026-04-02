import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Spacing, BorderRadius } from '../constants/Colors';
import { useLoginWithEmail } from '@privy-io/expo';
import { useAuthStore } from '../src/stores/authStore';
import { Buffer } from 'buffer';
import bs58 from 'bs58';

// MWA for Phantom/Solflare on Android
let transact: any = null;
try {
  transact = require('@solana-mobile/mobile-wallet-adapter-protocol').transact;
} catch {
  // MWA not available on this platform
}

export default function LoginScreen() {
  const router = useRouter();
  const { isConnected, connect } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  const { sendCode, loginWithCode } = useLoginWithEmail();

  // Redirect if already connected
  React.useEffect(() => {
    if (isConnected) {
      router.replace('/(tabs)');
    }
  }, [isConnected]);

  // --- Path A: Connect Phantom/Solflare via MWA ---
  const handleConnectWallet = async () => {
    if (!transact) {
      Alert.alert(
        'Not Available',
        'Mobile Wallet Adapter requires Android with Phantom or Solflare installed.'
      );
      return;
    }

    setIsLoading(true);
    try {
      const addressBase64 = await transact(async (wallet: any) => {
        const auth = await wallet.authorize({
          cluster: 'devnet',
          identity: {
            name: 'AgentArena',
            uri: 'https://agentarena.dev',
            icon: 'favicon.ico',
          },
        });
        return auth.accounts[0]?.address;
      });

      if (addressBase64) {
        // MWA returns the public key as a Base64-encoded byte array.
        // Decode to bytes, then encode to Base58 for the standard Solana address.
        const pubkeyBytes = Buffer.from(addressBase64, 'base64');
        const address = bs58.encode(pubkeyBytes);
        console.log('MWA connected wallet:', address);
        connect(address, 'mwa');
        router.replace('/(tabs)');
      }
    } catch (err: any) {
      console.error('MWA error:', err);
      Alert.alert('Connection Failed', err?.message ?? 'Could not connect wallet');
    } finally {
      setIsLoading(false);
    }
  };

  // --- Path B: Email OTP via Privy ---
  const handleSendCode = async () => {
    if (!email || !email.includes('@')) {
      Alert.alert('Invalid', 'Please enter a valid email');
      return;
    }
    setIsLoading(true);
    try {
      await sendCode({ email });
      setShowEmailModal(false);
      setShowCodeModal(true);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to send code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code || code.length < 4) {
      Alert.alert('Invalid', 'Please enter the code from your email');
      return;
    }
    setIsLoading(true);
    try {
      await loginWithCode({ code, email });
      setShowCodeModal(false);
      // AuthSync handles state update
      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Invalid code');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backIcon}>←</Text>
      </Pressable>

      <View style={styles.content}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>AA</Text>
        </View>

        {/* Title */}
        <Text style={styles.appName}>AgentArena</Text>
        <Text style={styles.subtitle}>
          Hire AI agents for prediction{'\n'}markets on Solana
        </Text>

        {/* Buttons */}
        <View style={styles.buttonContainer}>
          <Pressable
            style={({ pressed }) => [styles.btnPrimary, pressed && styles.pressed]}
            onPress={handleConnectWallet}
            disabled={isLoading}
          >
            <Text style={styles.btnPrimaryText}>Connect Wallet</Text>
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable
            style={({ pressed }) => [styles.btnSecondary, pressed && styles.pressed]}
            onPress={() => setShowEmailModal(true)}
            disabled={isLoading}
          >
            <Text style={styles.btnSecondaryText}>Sign in with Email</Text>
          </Pressable>
        </View>

        <Text style={styles.footer}>Powered by Privy & Solana</Text>
      </View>

      {/* Email Input Modal */}
      <Modal visible={showEmailModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Enter your email</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={Colors.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
            />
            <View style={styles.modalButtons}>
              <Pressable
                style={styles.modalBtnCancel}
                onPress={() => { setShowEmailModal(false); setEmail(''); }}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.modalBtnConfirm}
                onPress={handleSendCode}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={Colors.textPrimary} />
                ) : (
                  <Text style={styles.modalBtnConfirmText}>Send Code</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Code Input Modal */}
      <Modal visible={showCodeModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Enter verification code</Text>
            <Text style={styles.modalSubtitle}>Sent to {email}</Text>
            <TextInput
              style={styles.input}
              placeholder="123456"
              placeholderTextColor={Colors.textMuted}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoFocus
            />
            <View style={styles.modalButtons}>
              <Pressable
                style={styles.modalBtnCancel}
                onPress={() => { setShowCodeModal(false); setCode(''); }}
              >
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.modalBtnConfirm}
                onPress={handleVerifyCode}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={Colors.textPrimary} />
                ) : (
                  <Text style={styles.modalBtnConfirmText}>Verify</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  backButton: {
    width: 40, height: 40, borderRadius: BorderRadius.xl, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, justifyContent: 'center', alignItems: 'center',
    marginLeft: Spacing.screenPadding, marginTop: Spacing.md,
  },
  backIcon: { fontSize: 18, color: Colors.textPrimary },
  content: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: Spacing.screenPadding, gap: Spacing.lg,
  },
  logoContainer: {
    width: 80, height: 80, borderRadius: BorderRadius.xl,
    backgroundColor: Colors.surface, justifyContent: 'center', alignItems: 'center',
    marginBottom: Spacing.md,
  },
  logoText: { fontFamily: Fonts.mono, fontSize: 32, fontWeight: '700', color: Colors.accent },
  appName: { fontFamily: Fonts.heading, fontSize: 28, fontWeight: '700', color: Colors.textPrimary },
  subtitle: {
    fontFamily: Fonts.body, fontSize: 15, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 22, marginBottom: Spacing.xl,
  },
  buttonContainer: { width: '100%', gap: Spacing.lg },
  btnPrimary: {
    backgroundColor: Colors.accent, height: 56, borderRadius: BorderRadius.md,
    justifyContent: 'center', alignItems: 'center',
  },
  btnPrimaryText: { fontFamily: Fonts.body, fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  btnSecondary: {
    backgroundColor: Colors.surface, height: 56, borderRadius: BorderRadius.md,
    borderWidth: 2, borderColor: Colors.border, justifyContent: 'center', alignItems: 'center',
  },
  btnSecondaryText: { fontFamily: Fonts.body, fontSize: 16, fontWeight: '600', color: Colors.textSecondary },
  pressed: { opacity: 0.8 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  footer: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: Spacing.xxxl },

  // Modal styles
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center',
    alignItems: 'center', padding: Spacing.xl,
  },
  modalContent: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.xl, width: '100%', maxWidth: 360, gap: Spacing.lg,
  },
  modalTitle: { fontFamily: Fonts.body, fontSize: 18, fontWeight: '600', color: Colors.textPrimary },
  modalSubtitle: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginTop: -Spacing.sm },
  input: {
    backgroundColor: Colors.background, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, height: 48,
    paddingHorizontal: Spacing.lg, fontFamily: Fonts.body, fontSize: 16,
    color: Colors.textPrimary,
  },
  modalButtons: { flexDirection: 'row', gap: Spacing.md },
  modalBtnCancel: {
    flex: 1, height: 44, borderRadius: BorderRadius.md, borderWidth: 1,
    borderColor: Colors.border, justifyContent: 'center', alignItems: 'center',
  },
  modalBtnCancelText: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  modalBtnConfirm: {
    flex: 1, height: 44, borderRadius: BorderRadius.md, backgroundColor: Colors.accent,
    justifyContent: 'center', alignItems: 'center',
  },
  modalBtnConfirmText: { fontFamily: Fonts.body, fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
});
