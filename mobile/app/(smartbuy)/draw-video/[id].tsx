import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { Screen } from '@/components/Shell';
import { DrawsView } from '@/features/smartbuy/DrawsView';
import { DrawVideoModal } from '@/features/smartbuy/DrawVideoModal';
import type { DrawView } from '@/features/smartbuy/demo';
import { useDraws, useMySchemes } from '@/features/smartbuy/hooks';

/** Draw proof video modal over the draws list (demo #videoModal). Capture is blocked (FLAG_SECURE). */
export default function DrawVideoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  usePreventScreenCapture();
  const schemes = useMySchemes();
  const draws = useDraws(schemes.data?.items[0]?.scheme_id);
  const draw = draws.data?.items.find((d) => d.id === id) as DrawView | undefined;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/draws'));
  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <DrawsView />
      </Screen>
      <DrawVideoModal draw={draw} onClose={close} />
    </View>
  );
}
