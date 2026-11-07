import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { Frame, Screen } from '@/components/Shell';
import { SchemesView } from '@/features/smartbuy/SchemesView';
import { JoinSheet } from '@/features/smartbuy/JoinSheet';

/** Join Smart Buy bottom sheet over My Schemes (demo #joinSchemeModal). It takes an NIC, so capture is blocked. */
export default function JoinScreen() {
  const router = useRouter();
  usePreventScreenCapture();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/schemes'));
  return (
    <Frame>
      <View style={{ flex: 1 }}>
        <Screen>
          <SchemesView />
        </Screen>
        <JoinSheet onClose={close} />
      </View>
    </Frame>
  );
}
