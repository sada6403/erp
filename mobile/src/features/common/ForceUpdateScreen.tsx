import React from 'react';
import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { ENV } from '@/lib/env';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';

/** Blocking "Please update" screen when /status.min_app_version is above the installed version. */
export function ForceUpdateScreen({ latest, apkUrl }: { latest?: string; apkUrl?: string | null }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const open = () => {
    // Play builds open the store listing; the sideload pilot uses apk_url.
    const target = apkUrl ?? `market://details?id=${ENV.androidPackage}`;
    Linking.openURL(target).catch(() => Linking.openURL(`https://play.google.com/store/apps/details?id=${ENV.androidPackage}`));
  };
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', padding: 32, paddingTop: insets.top + 32, gap: 12 }}>
      <Text size={56}>⬆️</Text>
      <Text size={20} weight={800} align="center">
        {t('update.requiredTitle')}
      </Text>
      <Text size={13} color="textMuted" align="center" lineHeightRatio={1.45}>
        {t('update.requiredBody', { version: latest ?? '' })}
      </Text>
      <Button label={t('update.updateNow')} fullWidth onPress={open} style={{ marginTop: 16 }} />
    </View>
  );
}
