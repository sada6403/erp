import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useSessionStore } from '@/store/sessionStore';
import { registerDevice, requestPermission } from './push';

/** Shown once after login, before the Android 13+ POST_NOTIFICATIONS prompt. */
export function PermissionExplainer() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const setExplained = useSessionStore((s) => s.setPushExplained);
  const [busy, setBusy] = useState(false);

  const done = () => {
    setExplained(true);
    router.replace((next || '/') as never);
  };
  const allow = async () => {
    setBusy(true);
    try {
      if (await requestPermission()) await registerDevice();
    } catch {
      /* push is optional; the inbox still works */
    } finally {
      setBusy(false);
      done();
    }
  };

  const points: Array<[string, string]> = [
    ['📦', t('push.pointOrders')],
    ['🛵', t('push.pointDeliveries')],
    ['🏆', t('push.pointDraws')],
  ];
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface, padding: 24, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }}>
      <Text size={56} align="center">🔔</Text>
      <Text size={20} weight={800} align="center" style={{ marginTop: 8 }}>{t('push.title')}</Text>
      <Text size={13} color="textMuted" align="center" lineHeightRatio={1.45} style={{ marginVertical: 12 }}>{t('push.body')}</Text>
      <View style={{ gap: 10, marginVertical: 12 }}>
        {points.map(([icon, text]) => (
          <View key={text} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Text size={22}>{icon}</Text>
            <Text size={13} weight={600} style={{ flex: 1 }}>{text}</Text>
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      <Button label={t('push.allow')} loading={busy} onPress={allow} />
      <Button label={t('push.notNow')} variant="link" onPress={done} />
    </View>
  );
}
