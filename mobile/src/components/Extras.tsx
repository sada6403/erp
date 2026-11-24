import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, radii } from '@/theme';
import { splitCountdown } from '@/lib/format';
import { Text } from './Text';
import { Button } from './Button';
import { Screen } from './Shell';

/** Flash-deal countdown (HH:MM:SS boxes). `endsAt` is a ms epoch from the server; absent => nothing shown. */
export function Countdown({ endsAt }: { endsAt: number }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [left, setLeft] = useState(() => Math.max(0, (endsAt - Date.now()) / 1000));
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, (endsAt - Date.now()) / 1000)), 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  const { h, m, s } = splitCountdown(left);
  const box = (v: string) => (
    <View style={{ backgroundColor: theme.colors.errorBg, paddingHorizontal: 6, paddingVertical: 3, borderRadius: radii.xs }}>
      <Text mono weight={700} size={11} color="error">
        {v}
      </Text>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }} accessibilityLabel={`${h}:${m}:${s}`}>
      <Text size={11} weight={700} color="error">
        {t('home.endsIn')}
      </Text>
      {box(h)}
      <Text size={11} weight={700} color="error">:</Text>
      {box(m)}
      <Text size={11} weight={700} color="error">:</Text>
      {box(s)}
    </View>
  );
}

/** "Coming in the next update" - used for features outside v1.0 in non-dev builds. Never shows mock data. */
export function ComingSoon({ icon = '🚧', title, body, shopLink = false }: { icon?: string; title: string; body?: string; shopLink?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Screen>
      <View style={{ alignItems: 'center', paddingVertical: 40, gap: 10 }}>
        <Text size={52}>{icon}</Text>
        <Text size={18} weight={800} align="center">
          {title}
        </Text>
        <Text size={13} color="textMuted" align="center" lineHeightRatio={1.45}>
          {body ?? t('soon.body')}
        </Text>
        <Text size={12} weight={800} color="primary" align="center">
          {t('soon.badge')}
        </Text>
        {shopLink ? <Button label={t('soon.browseShop')} variant="secondaryBlock" fullWidth onPress={() => router.navigate('/')} style={{ marginTop: 16 }} /> : null}
      </View>
    </Screen>
  );
}
