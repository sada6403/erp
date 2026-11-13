import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { BannerDto } from '@contracts/catalog';
import { useTheme, radii, shadows } from '@/theme';
import { Text } from '@/components/Text';
import { Gradient } from '@/components/Gradient';
import { useBanners } from '@/features/shop/hooks';
import { resolveBannerLink } from './bannerLink';
import { trackImpression, trackTap } from './bannerEvents';

export const BANNER_ASPECT = 16 / 7;
export const BANNER_INTERVAL_MS = 5000;
const SIDE = 16;
const GAP = 12;

/**
 * Home banner carousel: swipe, auto-slide every 5 s (paused while touched), dots, tap = deep link.
 * Shows nothing (no box, no placeholder) when the server returns no banners for this user.
 */
export function BannerCarousel() {
  const theme = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const { data } = useBanners();
  const items = data?.items ?? [];
  const cardW = width - SIDE * 2;
  const cardH = Math.round(cardW / BANNER_ASPECT);
  const step = cardW + GAP;
  const listRef = useRef<FlatList<BannerDto>>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = items.length;

  const current = items[index]?.id;
  useEffect(() => {
    if (current) trackImpression(current);
  }, [current]);

  useEffect(() => {
    if (paused || count < 2) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, BANNER_INTERVAL_MS);
    return () => clearInterval(id);
  }, [paused, count]);

  useEffect(() => {
    if (count > 0) listRef.current?.scrollToOffset({ offset: Math.min(index, count - 1) * step, animated: true });
  }, [index, count, step]);

  const onEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const i = Math.round(e.nativeEvent.contentOffset.x / step);
      setIndex(Math.max(0, Math.min(count - 1, i)));
      setPaused(false);
    },
    [step, count],
  );

  const open = async (b: BannerDto) => {
    const action = resolveBannerLink(b.link);
    if (action.kind === 'none') return;
    trackTap(b.id);
    if (action.kind === 'route') router.push(action.href as never);
    else await WebBrowser.openBrowserAsync(action.url).catch(() => undefined);
  };

  if (count === 0) return null;
  return (
    <View testID="home-banners" style={{ paddingTop: 12, paddingBottom: 8, marginHorizontal: -10 }}>
      <FlatList
        ref={listRef}
        horizontal
        data={items}
        keyExtractor={(b) => b.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: SIDE, gap: GAP }}
        onTouchStart={() => setPaused(true)}
        onScrollBeginDrag={() => setPaused(true)}
        onMomentumScrollEnd={onEnd}
        onTouchEnd={() => setTimeout(() => setPaused(false), 3000)}
        getItemLayout={(_, i) => ({ length: step, offset: step * i, index: i })}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole={item.link ? 'button' : 'image'}
            accessibilityLabel={item.title || t('home.banner')}
            onPress={() => open(item)}
            style={[{ width: cardW, height: cardH, borderRadius: radii.hero, overflow: 'hidden', backgroundColor: theme.colors.primary }, shadows.banner]}
          >
            {item.image_url ? (
              <Image source={{ uri: item.image_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="disk" transition={150} />
            ) : (
              <Gradient from={theme.colors.primary} to={theme.colors.primaryDark} style={{ flex: 1, padding: 20, justifyContent: 'center' }}>
                {item.title ? (
                  <Text size={19} weight={800} color="white" lineHeightRatio={1.25}>
                    {item.title}
                  </Text>
                ) : null}
                {item.subtitle ? (
                  <Text size={12} color="glassText" style={{ marginTop: 6 }}>
                    {item.subtitle}
                  </Text>
                ) : null}
              </Gradient>
            )}
          </Pressable>
        )}
      />
      {count > 1 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 }}>
          {items.map((b, i) => (
            <View key={b.id} style={{ width: i === index ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === index ? theme.colors.primary : theme.colors.surfaceBorder }} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
