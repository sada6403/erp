import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Card, Loading } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatRs } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { useOrder } from '@/features/shop/hooks';

/** Order confirmed: number, total, delivery OTP and estimated date. */
export default function OrderConfirmedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { data: o } = useOrder(id);
  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: 8, paddingVertical: 16 }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.successBg, alignItems: 'center', justifyContent: 'center' }}>
          <Text size={36}>✅</Text>
        </View>
        <Text size={20} weight={800} align="center">{t('confirmed.title')}</Text>
        <Text size={12} color="textMuted" align="center">{t('confirmed.sub')}</Text>
      </View>
      {!o ? (
        <Loading />
      ) : (
        <Card radius={radii.hero - 4}>
          <Row label={t('confirmed.orderNo')} value={o.order_number} mono />
          <Row label={t('confirmed.total')} value={formatRs(o.total_amount)} />
          {o.estimated_delivery_date ? <Row label={t('confirmed.eta')} value={formatDate(o.estimated_delivery_date)} /> : null}
          {o.delivery_otp ? (
            <View style={{ marginTop: 10, padding: 12, borderRadius: radii.control, backgroundColor: theme.colors.container, alignItems: 'center' }}>
              <Text size={11} weight={700} color="textMuted">{t('orders.otpTitle')}</Text>
              <Text size={28} weight={800} color="primary" mono style={{ letterSpacing: 6 }}>{o.delivery_otp}</Text>
              <Text size={10} color="textMuted" align="center">{t('orders.otpHint')}</Text>
            </View>
          ) : null}
        </Card>
      )}
      <Button label={t('confirmed.track')} onPress={() => router.replace({ pathname: '/orders/[id]', params: { id } })} />
      <Button label={t('confirmed.continue')} variant="secondaryBlock" onPress={() => router.replace('/')} />
    </Screen>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text size={12} color="textMuted">{label}</Text>
      <Text size={13} weight={800} mono={mono}>{value}</Text>
    </View>
  );
}
