import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Card, EmptyState, ScreenHeading, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatRs } from '@/lib/money';
import { useDeliveries } from '@/features/agent/hooks';

/** Print Bill: pick a delivery to preview its thermal receipt. */
export default function BillListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { items, isLoading } = useDeliveries();
  return (
    <Screen>
      <ScreenHeading title={t('bill.title')} sub={t('bill.sub')} />
      {isLoading ? (
        <SkeletonList rows={3} />
      ) : items.length === 0 ? (
        <EmptyState icon="🖨️" title={t('agent.noDeliveries')} />
      ) : (
        items.map((i) => (
          <Card key={i.id} onPress={() => router.push({ pathname: '/bill/[id]', params: { id: i.id } })}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text size={13} weight={800} mono>{i.order_number}</Text>
              <Text size={13} weight={800}>{formatRs(i.amount_due)}</Text>
            </View>
            <Text size={12} color="textMuted">{i.customer_name}</Text>
            <Button label={t('bill.preview')} variant="printBill" style={{ marginTop: 8 }} onPress={() => router.push({ pathname: '/bill/[id]', params: { id: i.id } })} />
          </Card>
        ))
      )}
    </Screen>
  );
}
