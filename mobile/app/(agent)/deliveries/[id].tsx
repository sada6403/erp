import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Card, ErrorState, SectionHeader, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatQty, formatRs } from '@/lib/money';
import { isDelivered, useDeliveries } from '@/features/agent/hooks';
import { OtpSheet } from '@/features/agent/components';

/** Delivery handover: order details with the demo's OTP bottom sheet (4 boxes + cash confirmation) opened on top. */
export default function DeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const { items, isLoading, isError, refetch } = useDeliveries();
  const d = items.find((i) => i.id === id);
  const [open, setOpen] = useState(true);

  if (!d) {
    return (
      <Screen>
        {isError ? <ErrorState onRetry={() => refetch()} /> : isLoading ? <SkeletonList rows={3} height={110} /> : <ErrorState message={t('errors.NOT_FOUND')} />}
      </Screen>
    );
  }
  const finished = isDelivered(d);

  return (
    <Screen>
      <View>
        <Text size={16} weight={800} mono>{d.order_number}</Text>
        <Text size={13} weight={700}>{d.customer_name}</Text>
        {d.address ? <Text size={12} color="textMuted">{`📍 ${d.address}`}</Text> : null}
      </View>
      {d.customer_phone ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label={t('common.call')} icon={'📞'} variant="verify" style={{ flex: 1 }} onPress={() => Linking.openURL(`tel:${d.customer_phone}`)} />
          <Button label={t('common.whatsapp')} icon={'💬'} variant="whatsapp" style={{ flex: 1 }} onPress={() => Linking.openURL(`https://wa.me/${d.customer_phone!.replace(/\D/g, '')}`)} />
        </View>
      ) : null}
      {d.items?.length ? (
        <Card>
          <SectionHeader icon={'🧺'} title={t('orders.itemsTitle')} />
          {d.items.map((it) => (
            <Text key={`${it.product_id}:${it.variant_id}`} size={12} style={{ paddingVertical: 2 }}>{it.name} × {formatQty(it.quantity, it.unit)}</Text>
          ))}
        </Card>
      ) : null}
      <Card>
        <Text size={12} color="textMuted">{d.collect_cash ? t('agent.cashToCollect') : t('agent.prepaid')}</Text>
        <Text size={22} weight={800} color={d.collect_cash ? 'warning' : 'success'} mono>{formatRs(d.collect_cash ? d.amount_due : 0)}</Text>
      </Card>
      {finished ? (
        <Card>
          <Text size={14} weight={800} color="success" align="center">{`✅ ${t('agent.delivered')}`}</Text>
        </Card>
      ) : (
        <Button label={`🔐 ${t('agent.verifyOtp')}`} variant="checkout" onPress={() => setOpen(true)} />
      )}
      <Button label={t('agent.escBill')} icon={'📄'} variant="printBill" onPress={() => router.push({ pathname: '/bill/[id]', params: { id: d.id } })} />
      {!finished ? <OtpSheet visible={open} onClose={() => setOpen(false)} delivery={d} /> : null}
    </Screen>
  );
}
