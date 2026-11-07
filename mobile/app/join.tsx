import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Card, Field, Pill, ScreenHeading } from '@/components/ui';
import { ComingSoon } from '@/components/Extras';
import { Frame, Screen } from '@/components/Shell';
import { useUiStore } from '@/store/uiStore';
import { useOpenSchemes } from '@/features/smartbuy/hooks';

function DevJoin() {
  const { t } = useTranslation();
  const router = useRouter();
  const showToast = useUiStore((s) => s.showToast);
  const { data } = useOpenSchemes();
  const [scheme, setScheme] = useState<string | null>(null);
  const [nic, setNic] = useState('');
  return (
    <Screen>
      <ScreenHeading title={t('join.title')} sub={t('join.sub')} />
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {(data?.items ?? []).map((s) => <Pill key={s.id} label={s.name} active={scheme === s.id} onPress={() => setScheme(s.id)} />)}
        </View>
        <Field label={t('join.nic')} value={nic} onChangeText={setNic} autoCapitalize="characters" />
        <Button label={t('join.submit')} disabled={!scheme || nic.length < 9} onPress={() => { showToast(t('join.devSubmitted')); router.back(); }} />
      </Card>
    </Screen>
  );
}

/** Join Smart Buy: needs an NIC, so capture is blocked. Submission is a later update; release builds show coming-soon. */
export default function JoinScreen() {
  const { t } = useTranslation();
  usePreventScreenCapture();
  return <Frame>{__DEV__ ? <DevJoin /> : <ComingSoon icon="💎" title={t('join.title')} shopLink />}</Frame>;
}
