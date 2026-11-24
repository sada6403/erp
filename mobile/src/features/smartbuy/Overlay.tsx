import React, { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { fontScale, radii, shadows, useTheme } from '@/theme';

/**
 * In-screen modal layer (not an RN Modal: a Modal is its own window and would not inherit the
 * screen's FLAG_SECURE). Dim overlay over the content area; tap outside closes.
 */
export function Overlay({ children, onClose, align }: { children: React.ReactNode; onClose: () => void; align: 'center' | 'bottom' }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay, justifyContent: align === 'center' ? 'center' : 'flex-end', alignItems: 'center' }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.close')} />
      {children}
    </View>
  );
}

/** 32 dp round close button inside a 48 dp hit area (demo .modal-close-btn, optionally .white). */
export function CloseButton({ onPress, white }: { onPress: () => void; white?: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onPress} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radii.round,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: white ? theme.colors.glass : theme.colors.surfaceSubtle,
          borderWidth: white ? 0 : 1,
          borderColor: theme.colors.surfaceBorder,
        }}
      >
        <Text size={fontScale.s14} color={white ? 'white' : 'textMain'}>✕</Text>
      </View>
    </Pressable>
  );
}

/** Bottom sheet (demo .bottom-sheet): radius 26, padding 16/20/24, handle, slide-up 0.3 s. */
export function SheetSurface({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const theme = useTheme();
  const [y] = useState(() => new Animated.Value(40));
  // A native-driven translateY leaves the touch area at the pre-animation position (taps land ~40 dp off).
  // Once the slide-up finishes the transform is dropped, so the hit area is exactly where the sheet is drawn.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    Animated.timing(y, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => setSettled(true));
  }, [y]);
  return (
    <Animated.View
      style={[
        {
          width: '100%',
          backgroundColor: theme.colors.surface,
          borderTopLeftRadius: radii.sheet,
          borderTopRightRadius: radii.sheet,
          paddingTop: 16,
          paddingHorizontal: 20,
          paddingBottom: 24,
          maxHeight: '90%',
          transform: settled ? undefined : [{ translateY: y }],
        },
        shadows.sheet,
      ]}
    >
      <View style={{ width: 40, height: 4, borderRadius: radii.xxs, backgroundColor: theme.colors.slate300, alignSelf: 'center', marginBottom: 12 }} />
      <View style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}>
        <CloseButton onPress={onClose} />
      </View>
      {children}
    </Animated.View>
  );
}
