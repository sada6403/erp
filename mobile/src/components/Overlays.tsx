import React, { useEffect, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { makeStyles, radii, shadows, useTheme } from '@/theme';
import { splitAge } from '@/lib/format';
import { selectIsOffline, useUiStore } from '@/store/uiStore';
import { useServerStatus } from '@/features/common/hooks';
import { Text } from './Text';
import { Button } from './Button';

/** Bottom sheet (.bottom-sheet): overlay + white sheet with radius 26 and a handle. */
export function BottomSheet({
  visible,
  onClose,
  children,
  showClose = false,
  padding,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  showClose?: boolean;
  /** .alert-sheet overrides the sheet padding with a flat 24 on every side. */
  padding?: number;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [slide] = useState(() => new Animated.Value(40));
  useEffect(() => {
    if (visible) {
      slide.setValue(40);
      Animated.timing(slide, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    }
  }, [visible, slide]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.overlay, { backgroundColor: theme.colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.close')} />
        <Animated.View
          style={{
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: radii.sheet,
            borderTopRightRadius: radii.sheet,
            paddingTop: padding ?? 16,
            paddingHorizontal: padding ?? 20,
            paddingBottom: (padding ?? 24) + insets.bottom,
            maxHeight: '85%',
            ...shadows.sheet,
            transform: [{ translateY: slide }],
          }}
        >
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.slate300, alignSelf: 'center', marginBottom: 12 }} />
          {showClose ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              style={{ position: 'absolute', top: 8, right: 8, width: 48, height: 48, alignItems: 'center', justifyContent: 'center', zIndex: 2 }}
            >
              <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.surfaceBorder, backgroundColor: theme.colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }}>
                <Text size={14}>✕</Text>
              </View>
            </Pressable>
          ) : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({ overlay: { flex: 1, justifyContent: 'flex-end' } });

/** Offline "buy later" sheet (ARCHITECTURE section 7). Cart is kept; Notify me fires on reconnect. */
export function BuyLaterSheet() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.buyLaterOpen);
  const close = useUiStore((s) => s.closeBuyLater);
  const setNotify = useUiStore((s) => s.setNotifyMePending);
  const showToast = useUiStore((s) => s.showToast);
  const { data } = useServerStatus();
  const message = data?.ordering_enabled === false ? data.maintenance_message : null;
  return (
    <BottomSheet visible={open} onClose={close} padding={24}>
      <View style={{ alignItems: 'center' }}>
        <Text size={44} style={{ marginBottom: 8 }}>📡</Text>
        <Text size={16} weight={800} align="center" style={{ marginBottom: 6 }}>
          {t('offline.title')}
        </Text>
        <Text size={13} color="textMuted" align="center" lineHeightRatio={1.45} style={{ marginBottom: 18 }}>
          {message ?? t('offline.desc')}
        </Text>
        <Button
          label={t('offline.notifyMe')}
          icon="🔔"
          fullWidth
          onPress={() => {
            setNotify(true);
            close();
            showToast(t('offline.notifyRegistered'));
          }}
        />
        <Button label={t('offline.keepBrowsing')} variant="link" onPress={close} style={{ marginTop: 12 }} />
      </View>
    </BottomSheet>
  );
}

/** Banner under the header: offline + cache age, or the maintenance message. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const offline = useUiStore(selectIsOffline);
  const updatedAt = useUiStore((s) => s.catalogUpdatedAt);
  const { data } = useServerStatus();
  const maintenance = data?.maintenance_message;
  const theme = useTheme();
  const text = bannerText(t, offline, updatedAt, maintenance);
  if (!text) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: theme.colors.warningBg,
        paddingVertical: 6,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.warningBorder,
      }}
    >
      <Text size={11}>⚠️</Text>
      <Text size={11} weight={700} color="warningText" style={{ flexShrink: 1 }}>
        {text}
      </Text>
    </View>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** Pure helper (unit-tested): the banner string for a given connectivity/cache state, or null. */
export function bannerText(t: TFn, offline: boolean, updatedAt: number | null, maintenance?: string | null, now = Date.now()): string | null {
  if (offline) {
    if (!updatedAt) return t('offline.bannerNoCache');
    const age = splitAge(now - updatedAt);
    return t('offline.banner', { age: t(`age.${age.unit}`, { count: age.value }) });
  }
  return maintenance ? maintenance : null;
}

/** Toast host (.toast-popup): dark pill, 2.8 s. Mounted once in the root layout. */
export function ToastHost() {
  const toast = useUiStore((s) => s.toast);
  const hide = useUiStore((s) => s.hideToast);
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [y] = useState(() => new Animated.Value(100));
  useEffect(() => {
    if (!toast) return;
    Animated.timing(y, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    const id = setTimeout(() => {
      Animated.timing(y, { toValue: 100, duration: 200, useNativeDriver: true }).start(() => hide(toast.id));
    }, 2800);
    return () => clearTimeout(id);
  }, [toast, y, hide]);
  if (!toast) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 24 + insets.bottom,
        alignItems: 'center',
        transform: [{ translateY: y }],
      }}
    >
      <View style={[{ backgroundColor: theme.colors.inkSoft, paddingVertical: 12, paddingHorizontal: 20, borderRadius: radii.hero }, shadows.popover]}>
        <Text size={12} weight={700} color="white" align="center">
          {toast.text}
        </Text>
      </View>
    </Animated.View>
  );
}

/** "Update ready - Restart" snackbar for OTA updates. */
export function UpdateSnackbar({ onRestart }: { onRestart: () => void }) {
  const { t } = useTranslation();
  const ready = useUiStore((s) => s.updateReady);
  const theme = useTheme();
  const s = useSnackStyles();
  if (!ready) return null;
  return (
    <View style={s.wrap} pointerEvents="box-none">
      <View style={[s.box, { backgroundColor: theme.colors.inkSoft }]}>
        <Text size={12} weight={700} color="white" style={{ flex: 1 }}>
          {t('update.ready')}
        </Text>
        <Button label={t('update.restart')} variant="accentSm" onPress={onRestart} />
      </View>
    </View>
  );
}

const useSnackStyles = makeStyles(() => ({
  wrap: { position: 'absolute', left: 12, right: 12, top: 48 },
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, paddingLeft: 16, borderRadius: radii.control, elevation: 8 },
}));

/** In-app push banner (.system-push-banner): slides in 50 dp from the top for 4.5 s; tap opens the inbox / deep link. */
export function PushBanner() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const push = useUiStore((s) => s.push);
  const hide = useUiStore((s) => s.hidePush);
  const [y] = useState(() => new Animated.Value(-170));
  useEffect(() => {
    if (!push) return;
    y.setValue(-170);
    Animated.timing(y, { toValue: 0, duration: 400, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }).start();
    const id = setTimeout(() => {
      Animated.timing(y, { toValue: -170, duration: 400, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }).start(() => hide(push.id));
    }, 4500);
    return () => clearTimeout(id);
  }, [push, y, hide]);
  if (!push) return null;
  return (
    <Animated.View style={{ position: 'absolute', top: 50, left: 12, right: 12, transform: [{ translateY: y }], zIndex: 90 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={push.title + ". " + push.body}
        onPress={() => {
          hide(push.id);
          router.push('/notifications');
        }}
        style={[
          {
            flexDirection: 'row',
            gap: 12,
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: radii.hero,
            backgroundColor: theme.colors.pushBanner,
            borderWidth: 1,
            borderColor: theme.colors.glass15,
          },
          shadows.pushBanner,
        ]}
      >
        <View style={{ width: 38, height: 38, borderRadius: radii.chip, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text size={18}>🌿</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
            <Text size={11} color="textSubtle">{t('app.name')}</Text>
            <Text size={11} color="textSubtle">{t('push.justNow')}</Text>
          </View>
          <Text size={13} weight={700} color="surfaceSubtle">{push.title}</Text>
          <Text size={12} color="slate300" lineHeightRatio={1.3}>{push.body}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
