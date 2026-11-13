import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Shell';
import { Text } from '@/components/Text';
import { Card } from '@/components/ui';
import { LEVEL_KEY, useStaffDashboard } from '@/features/staff/hooks';
import { PerformanceBar } from '@/features/staff/ManagerParts';
import { formatRs } from '@/lib/money';
import { useSessionStore } from '@/store/sessionStore';

/** Me: my own figures, what my scope covers, and the switch to the field-officer tabs for someone who is both. */
export default function ManagerMe() {
  const { t } = useTranslation();
  const router = useRouter();
  const user = useSessionStore((s) => s.user);
  const setFieldView = useSessionStore((s) => s.setFieldView);
  const setActiveRole = useSessionStore((s) => s.setActiveRole);
  const dash = useStaffDashboard();

  return (
    <Screen>
      <Text size={18} weight={800}>{t('mgr.me.title')}</Text>
      <Card radius={16} padding={16}>
        <Text size={15} weight={800}>{user?.name ?? ''}</Text>
        {dash.data ? <Text size={12} color="textMuted" style={{ marginTop: 3 }}>{`${t(LEVEL_KEY[dash.data.level])}${user?.agent_code ? ` • ${user.agent_code}` : ''}`}</Text> : null}
        {dash.data ? (
          <>
            <Text size={22} weight={800} color="primary" style={{ marginTop: 10 }}>{formatRs(dash.data.performance.achieved, { decimals: 2 })}</Text>
            <PerformanceBar p={dash.data.performance} />
          </>
        ) : null}
      </Card>
      <Card radius={16} padding={16}>
        <Text size={13} weight={700}>{t('mgr.me.scopeTitle')}</Text>
        <Text size={12} color="textMuted" lineHeightRatio={1.4} style={{ marginTop: 4 }}>{t('mgr.me.scopeBody')}</Text>
      </Card>
      <View style={{ gap: 8 }}>
        <Button
          label={t('mgr.me.fieldView')}
          variant="secondaryBlock"
          fullWidth
          onPress={() => {
            setFieldView(true);
            setActiveRole('agent');
            router.replace('/deliveries');
          }}
        />
        <Button label={t('mgr.me.settings')} variant="primaryBlock" fullWidth onPress={() => router.push('/settings')} />
      </View>
    </Screen>
  );
}
