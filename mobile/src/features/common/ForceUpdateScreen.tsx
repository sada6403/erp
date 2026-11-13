import React from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { useAppUpdate } from '@/features/updates/useAppUpdate';
import { UpdateProgress } from '@/features/updates/UpdateProgress';

/** Blocking full-screen "Please update" when the installed version is below the minimum (server-decided). */
export function ForceUpdateScreen({ latest }: { latest?: string; apkUrl?: string | null }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const u = useAppUpdate();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', padding: 32, paddingTop: insets.top + 32, gap: 12 }}>
      <Text size={56}>⬆️</Text>
      <Text size={20} weight={800} align="center">
        {t('update.requiredTitle')}
      </Text>
      <Text size={13} color="textMuted" align="center" lineHeightRatio={1.45}>
        {t('update.requiredBody', { version: latest ?? u.latest })}
      </Text>
      {u.notes ? (
        <ScrollView style={{ maxHeight: 160, alignSelf: 'stretch' }}>
          <Text size={13} align="center">{u.notes}</Text>
        </ScrollView>
      ) : null}
      <UpdateProgress stage={u.stage} progress={u.progress} error={u.error} />
      <Button label={t('update.updateNow')} fullWidth disabled={u.stage != null} onPress={u.start} style={{ marginTop: 16 }} />
    </View>
  );
}
