import React from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Card, ScreenHeading } from '@/components/ui';
import { ComingSoon } from '@/components/Extras';
import { Screen } from '@/components/Shell';
import { formatRs } from '@/lib/money';
import { useWallet } from '@/features/smartbuy/hooks';

function DevSpend() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data } = useWallet();
  return (
    <Screen>
      <ScreenHeading title={t('spend.title')} sub={t('spend.sub')} />
      <Card>
        <Text size={12} color="textMuted">{t('wallet.balance')}</Text>
        <Text size={22} weight={800} color="primary" mono>{data ? formatRs(data.balance) : '—'}</Text>
        <Button label={t('spend.shop')} style={{ marginTop: 10 }} onPress={() => router.navigate('/')} />
      </Card>
    </Screen>
  );
}

/** Spend wallet in shop: not part of v1.0, so release builds show the coming-soon screen. */
export default function SpendScreen() {
  const { t } = useTranslation();
  usePreventScreenCapture();
  return __DEV__ ? <DevSpend /> : <ComingSoon icon="🛒" title={t('spend.title')} shopLink />;
}
