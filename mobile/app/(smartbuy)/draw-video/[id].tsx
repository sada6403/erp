import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useTranslation } from 'react-i18next';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { ComingSoon } from '@/components/Extras';
import { Screen } from '@/components/Shell';
import { useWatermark } from '@/features/common/hooks';

/** Dev-only player preview; production shows "Coming in the next update" (DrawDto.has_video is false in v1.0). */
function DevPlayer({ id }: { id: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });
  useWatermark({});
  return (
    <Screen>
      <View style={{ borderRadius: radii.card, overflow: 'hidden', backgroundColor: theme.colors.inkDeep, aspectRatio: 16 / 9 }}>
        <VideoView player={player} style={{ flex: 1 }} nativeControls />
        <View pointerEvents="none" style={{ position: 'absolute', top: 8, right: 8 }}>
          <Text size={10} weight={800} color="watermark">{id}</Text>
        </View>
      </View>
      <Text size={12} color="textMuted">{t('draws.devPreview')}</Text>
    </Screen>
  );
}

export default function DrawVideoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  usePreventScreenCapture();
  if (!__DEV__) return <ComingSoon icon="🎬" title={t('draws.videoSoonTitle')} />;
  return <DevPlayer id={id} />;
}
