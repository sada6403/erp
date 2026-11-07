import React from 'react';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { Screen } from '@/components/Shell';
import { WalletView } from '@/features/smartbuy/WalletView';
import { useWallet, useWalletTransactions } from '@/features/smartbuy/hooks';

/** Wallet and passbook (demo view-smartbuy-wallet). Screen capture is blocked: it shows financial data. */
export default function WalletScreen() {
  usePreventScreenCapture();
  const wallet = useWallet();
  const tx = useWalletTransactions();
  return (
    <Screen onRefresh={() => { wallet.refetch(); tx.refetch(); }} refreshing={wallet.isRefetching}>
      <WalletView />
    </Screen>
  );
}
