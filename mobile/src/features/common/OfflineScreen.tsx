import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Frame, Screen } from '@/components/Shell';
import { selectIsOffline, useUiStore } from '@/store/uiStore';

/** Full-screen "No internet" state (first run with no cache). Cached screens never route here. */
export function OfflineScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const offline = useUiStore(selectIsOffline);
  return (
    <Frame tabs={false}>
      <Screen>
        <View style={{ alignItems: 'center', paddingVertical: 48, gap: 10 }}>
          <Text size={44}>📡</Text>
          <Text size={16} weight={800} align="center">{t('offline.title')}</Text>
          <Text size={13} color="textMuted" align="center" lineHeightRatio={1.45}>{t('offline.screenBody')}</Text>
          <Button
            label={offline ? t('common.retry') : t('offline.backOnlineGo')}
            fullWidth
            style={{ marginTop: 20 }}
            onPress={() => {
              qc.invalidateQueries();
              if (!offline) router.replace('/');
            }}
          />
        </View>
      </Screen>
    </Frame>
  );
}
