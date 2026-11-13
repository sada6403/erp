import React, { useState } from 'react';
import { Animated, FlatList, Modal, PanResponder, Pressable, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from './Text';

const MAX_SCALE = 4;

function dist(e: GestureResponderEvent): number {
  const [a, b] = e.nativeEvent.touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/** Gesture engine for one page: everything is created once (lazy state), handlers only touch this object. */
function createZoom(width: number, height: number, onZoomChange: (zoomed: boolean) => void) {
  const scale = new Animated.Value(1);
  const tx = new Animated.Value(0);
  const ty = new Animated.Value(0);
  const c = { scale: 1, x: 0, y: 0, startDist: 0, startScale: 1, startX: 0, startY: 0, lastTap: 0, moved: false };
  const apply = (s: number, x: number, y: number) => {
    c.scale = Math.min(MAX_SCALE, Math.max(1, s));
    const maxX = ((c.scale - 1) * width) / 2;
    const maxY = ((c.scale - 1) * height) / 2;
    c.x = c.scale === 1 ? 0 : Math.max(-maxX, Math.min(maxX, x));
    c.y = c.scale === 1 ? 0 : Math.max(-maxY, Math.min(maxY, y));
    scale.setValue(c.scale);
    tx.setValue(c.x);
    ty.setValue(c.y);
    onZoomChange(c.scale > 1.01);
  };
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2 || c.scale > 1.01,
    onPanResponderTerminationRequest: () => c.scale <= 1.01,
    onPanResponderGrant: (e) => {
      c.moved = false;
      c.startDist = e.nativeEvent.touches.length === 2 ? dist(e) : 0;
      c.startScale = c.scale;
      c.startX = c.x;
      c.startY = c.y;
    },
    onPanResponderMove: (e, g) => {
      if (e.nativeEvent.touches.length === 2) {
        if (!c.startDist) {
          c.startDist = dist(e);
          c.startScale = c.scale;
        }
        c.moved = true;
        apply(c.startScale * (dist(e) / c.startDist), c.x, c.y);
      } else if (c.scale > 1.01) {
        if (Math.abs(g.dx) + Math.abs(g.dy) > 4) c.moved = true;
        apply(c.scale, c.startX + g.dx, c.startY + g.dy);
      }
    },
    onPanResponderRelease: () => {
      if (c.moved) return;
      const now = Date.now();
      if (now - c.lastTap < 300) apply(c.scale > 1.01 ? 1 : 2.5, 0, 0);
      c.lastTap = now;
    },
  });
  return { scale, tx, ty, pan };
}

/** One zoomable page: two-finger pinch, drag when zoomed, double-tap toggles 1x / 2.5x. Built-in RN gestures only. */
function ZoomPage({ uri, width, height, onZoomChange }: { uri: string; width: number; height: number; onZoomChange: (zoomed: boolean) => void }) {
  const [z] = useState(() => createZoom(width, height, onZoomChange));
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }} {...z.pan.panHandlers}>
      <Animated.View style={{ width, height, transform: [{ translateX: z.tx }, { translateY: z.ty }, { scale: z.scale }] }}>
        <Image source={{ uri }} style={{ width, height }} contentFit="contain" cachePolicy="disk" />
      </Animated.View>
    </View>
  );
}

/** Full-screen viewer for a product gallery: swipe between images (when not zoomed), pinch to zoom. */
export function ImageViewer({ images, index, visible, onClose }: { images: string[]; index: number; visible: boolean; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { t } = useTranslation();
  const [zoomed, setZoomed] = useState(false);
  const [page, setPage] = useState(index);
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: theme.colors.viewerBg }}>
        <FlatList
          data={images}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          initialScrollIndex={Math.min(index, Math.max(0, images.length - 1))}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(u, i) => `${i}-${u}`}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => <ZoomPage uri={item} width={width} height={height} onZoomChange={setZoomed} />}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('product.close')}
          onPress={onClose}
          hitSlop={12}
          style={{ position: 'absolute', top: Math.max(12, insets.top + 4), right: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.glass30, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text size={18} weight={800} color="white">✕</Text>
        </Pressable>
        <View pointerEvents="none" style={{ position: 'absolute', bottom: Math.max(16, insets.bottom + 8), left: 0, right: 0, alignItems: 'center', gap: 4 }}>
          {images.length > 1 ? <Text size={12} weight={700} color="white">{page + 1} / {images.length}</Text> : null}
          <Text size={11} color="white" style={{ opacity: 0.8 }}>{t('product.zoomHint')}</Text>
        </View>
      </View>
    </Modal>
  );
}
