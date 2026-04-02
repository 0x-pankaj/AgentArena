import { useEffect, useRef, useState } from 'react';
import { usePrivy, useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useAuthStore } from '../stores/authStore';

// Syncs Privy authentication state with the zustand auth store
// MWA connections (Phantom/Solflare) bypass Privy entirely
export function AuthSync() {
  const { user, isReady } = usePrivy();
  const { create } = useEmbeddedSolanaWallet();
  const { connect, disconnect, isConnected, connectionMethod } = useAuthStore();
  const [isCreatingWallet, setIsCreatingWallet] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    // Premature logout logic removed to prevent dropping valid sessions
    // before the wallet is created or synchronized.
  }, [isReady, isConnected, user]);

  useEffect(() => {
    if (!isReady) return;

    // MWA connections don't go through Privy — never touch them
    if (connectionMethod === 'mwa') return;

    // Only sync when Privy has a real user (email/social login)
    if (user) {
      const solanaWallet = user.linked_accounts?.find(
        (account: any) =>
          account.type === 'wallet' &&
          account.chain_type === 'solana'
      );

      if (solanaWallet && 'address' in solanaWallet) {
        connect(solanaWallet.address as string, user.id);
      } else {
        const anyWallet = user.linked_accounts?.find(
          (account: any) => account.type === 'wallet'
        );
        if (anyWallet && 'address' in anyWallet) {
          connect(anyWallet.address as string, user.id);
        } else if (!isCreatingWallet && create) {
          setIsCreatingWallet(true);
          create()
            .then(() => {
              // The `user` object will update automatically, which will re-trigger this effect
              // and connect the Solana wallet.
            })
            .catch((err) => {
              console.error("Error creating embedded wallet:", err);
            })
            .finally(() => {
              if (mountedRef.current) setIsCreatingWallet(false);
            });
        }
      }
    }
    // No else — don't disconnect here.
    // Disconnect only happens explicitly via the disconnect button in profile.
  }, [user, isReady, isCreatingWallet, connectionMethod]);

  return null;
}
//i disconnect and try with another email
// already logged in, use `useLinkWithEmail` if you are trying to link to an email to an existing account
