import React, { useEffect, useState } from 'react';
import { Animated, Easing, View, type LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { fontScale, lineHeights, radii, shadows, useTheme } from '@/theme';
import { useSessionStore } from '@/store/sessionStore';
import { SB_DEMO, type DrawView } from './demo';
import { CloseButton, Overlay } from './Overlay';

const VIEWPORT_H = 220;

/** Floating member watermark (demo .dynamic-watermark): rotate -15deg, drifts over 10 s, alternating. */
function Watermark({ text, width }: { text: string; width: number }) {
  const [p] = useState(() => new Animated.Value(0));
  useEffect(() => {
    // CSS "infinite alternate": forward then back
    const seq = Animated.loop(
      Animated.sequence([
        Animated.timing(p, { toValue: 1, duration: 10_000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(p, { toValue: 0, duration: 10_000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]),
    );
    seq.start();
    return () => seq.stop();
  }, [p]);
  const top = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [VIEWPORT_H * 0.15, VIEWPORT_H * 0.6, VIEWPORT_H * 0.35] });
  const left = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [width * 0.1, width * 0.3, width * 0.05] });
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top, left, zIndex: 10, transform: [{ rotate: '-15deg' }] }}>
      <Text mono size={fontScale.s11} weight={700} color="watermark">{text}</Text>
    </Animated.View>
  );
}

function Spinner({ children }: { children: string }) {
  const [r] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const a = Animated.loop(Animated.timing(r, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [r]);
  const rotate = r.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Text size={fontScale.s40}>{children}</Text>
    </Animated.View>
  );
}

/**
 * Private draw proof video modal (demo #videoModal). The demo's simulated player is shown only on the
 * demo mock; release builds keep the same frame, watermark and notices with the player disabled.
 */
export function DrawVideoModal({ draw, onClose }: { draw?: DrawView; onClose: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useSessionStore((s) => s.user);
  const [w, setW] = useState(0);
  const watermark = `NP-MEMBER #${user?.member_no ?? ''} • ${(user?.name ?? '').toUpperCase()} • SECURE-STREAM`;
  const v = SB_DEMO ? draw?.video : null;
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  return (
    <Overlay onClose={onClose} align="center">
      <View
        style={[
          {
            width: '90%',
            maxWidth: 380,
            backgroundColor: theme.colors.ink,
            borderRadius: radii.hero,
            borderWidth: 1,
            borderColor: theme.colors.glassSoft,
            padding: 16,
          },
          shadows.modal,
        ]}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginRight: -8, marginTop: -8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, paddingTop: 8 }}>
            <Text size={fontScale.s14}>🔒</Text>
            <Text size={fontScale.s13} weight={700} color="surfaceSubtle" style={{ flexShrink: 1 }}>{t('draws.videoTitle')}</Text>
          </View>
          <CloseButton white onPress={onClose} />
        </View>
        <View onLayout={onLayout} style={{ height: VIEWPORT_H, backgroundColor: theme.colors.inkDeep, borderRadius: radii.control, overflow: 'hidden', justifyContent: 'space-between' }}>
          {w > 0 ? <Watermark text={watermark} width={w} /> : null}
          {v ? (
            <View style={{ flex: 1, padding: 12, justifyContent: 'space-between' }}>
              <View style={{ alignSelf: 'flex-start', backgroundColor: theme.colors.liveBadge, paddingVertical: 2, paddingHorizontal: 6, borderRadius: radii.xs }}>
                <Text size={fontScale.s9} weight={800} color="white">{v.badge}</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Spinner>🎰</Spinner>
                <Text size={fontScale.s11} color="textSubtle" align="center" style={{ marginTop: 6 }}>{v.stage}</Text>
                <View style={{ marginTop: 6, backgroundColor: theme.colors.goldGlass20, borderWidth: 1, borderColor: theme.colors.accent, paddingVertical: 4, paddingHorizontal: 10, borderRadius: radii.sm }}>
                  <Text size={fontScale.s12} weight={800} color="accent">{v.reveal}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.colors.scrim, paddingVertical: 4, paddingHorizontal: 8, borderRadius: radii.sm }}>
                <Text size={fontScale.s10} color="slate300">{t('draws.videoPlaying')}</Text>
                <View style={{ flex: 1, height: 4, backgroundColor: theme.colors.glass30, borderRadius: radii.xxs, overflow: 'hidden' }}>
                  <View style={{ width: '62%', height: '100%', backgroundColor: theme.colors.accent }} />
                </View>
                <Text size={fontScale.s10} color="slate300">02:15 / 03:40</Text>
              </View>
            </View>
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12, gap: 6 }}>
              <Text size={fontScale.s40}>🎬</Text>
              <Text size={fontScale.s12} weight={800} color="accent" align="center">{t('soon.badge')}</Text>
            </View>
          )}
          <View style={{ position: 'absolute', bottom: 34, left: 8, right: 8, backgroundColor: theme.colors.secureToast, paddingVertical: 4, paddingHorizontal: 8, borderRadius: radii.sm }}>
            <Text size={fontScale.s9} color="white" align="center">
              {'⚠️ '}
              <Text size={fontScale.s9} weight={800} color="white">{t('draws.secureStrong')}</Text>
              {` ${t('draws.secureRest')}`}
            </Text>
          </View>
        </View>
        <Text size={fontScale.s10} color="textSubtle" lineHeightRatio={lineHeights.copy} style={{ marginTop: 10 }}>{t('draws.videoFooter')}</Text>
      </View>
    </Overlay>
  );
}
