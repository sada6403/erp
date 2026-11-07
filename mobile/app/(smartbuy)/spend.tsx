import React from 'react';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { Screen } from '@/components/Shell';
import { SpendView } from '@/features/smartbuy/WalletView';

/** Spend wallet in shop: same UI everywhere; the action is enabled only on the demo mock. */
export default function SpendScreen() {
  usePreventScreenCapture();
  return (
    <Screen>
      <SpendView />
    </Screen>
  );
}
