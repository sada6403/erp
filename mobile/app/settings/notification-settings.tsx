import React from 'react';
import { Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from '@/components/Text';
import { Card, ErrorState, Loading, ScreenHeading } from '@/components/ui';
import { Frame, Screen } from '@/components/Shell';
import { useNotificationSettings, useSaveNotificationSettings } from '@/features/notifications/hooks';
import { useServerActionGuard } from '@/features/common/hooks';
import type { NotificationChannel } from '@contracts/notifications';

const CHANNEL_KEYS: NotificationChannel[] = ['orders', 'deliveries', 'smartbuy', 'account', 'offers'];

/** Per-channel push toggles. Quiet hours apply to offers only (server-enforced). */
export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const guard = useServerActionGuard();
  const { data, isLoading, isError, refetch } = useNotificationSettings();
  const save = useSaveNotificationSettings();
  return (
    <Frame>
      <Screen>
        <ScreenHeading title={t('settings.notificationSettings')} sub={t('settings.notificationSettingsSub')} />
        {isLoading ? <Loading /> : isError || !data ? <ErrorState onRetry={() => refetch()} /> : (
          <Card>
            {CHANNEL_KEYS.map((k) => (
              <View key={k} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text size={13} weight={700}>{t(`channel.${k}`)}</Text>
                  <Text size={11} color="textMuted">{t(`channel.${k}Sub`)}</Text>
                </View>
                <Switch
                  accessibilityLabel={t(`channel.${k}`)}
                  value={data[k]}
                  trackColor={{ true: theme.colors.primary, false: theme.colors.slate300 }}
                  thumbColor={theme.colors.white}
                  onValueChange={(v) => { guard(() => { save.mutate({ ...data, [k]: v }); }); }}
                />
              </View>
            ))}
          </Card>
        )}
      </Screen>
    </Frame>
  );
}
