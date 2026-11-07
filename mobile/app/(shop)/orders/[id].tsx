import React from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Badge, Card, ErrorState, SectionHeader, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatQty, formatRs } from '@/lib/money';
import { formatDate, formatTime } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useUiStore } from '@/store/uiStore';
import { useCancelOrder, useOrder, useTracking } from '@/features/shop/hooks';
import { useServerActionGuard } from '@/features/common/hooks';
import { stageTone } from '@/features/shop/stageTone';

/** Order tracking: timeline, delivery OTP box, agent card, items, cancel while allowed. */
export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const guard = useServerActionGuard();
  const showToast = useUiStore((s) => s.showToast);
  const order = useOrder(id);
  const tracking = useTracking(id);
  const cancel = useCancelOrder();
  const o = order.data;

  if (!o) return <Screen>{order.isError ? <ErrorState onRetry={() => order.refetch()} /> : <SkeletonList rows={4} height={110} />}</Screen>;
  const tone = stageTone(o.stage);
  const otp = tracking.data?.delivery_otp ?? o.delivery_otp;
  const agent = tracking.data?.agent ?? o.agent;
  const steps = tracking.data?.steps ?? [];
  const lastDone = steps.reduce((n, s, i) => (s.done ? i : n), -1);

  const doCancel = () =>
    guard(async () => {
      try {
        await cancel.mutateAsync({ id: o.id });
        order.refetch();
        tracking.refetch();
      } catch (e) {
        showToast(errorMessage(e, t));
      }
    });

  return (
    <Screen onRefresh={() => { order.refetch(); tracking.refetch(); }} refreshing={order.isRefetching}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text size={16} weight={800} mono>{o.order_number}</Text>
          <Text size={11} color="textMuted">{formatDate(o.created_at)} · {formatTime(o.created_at)}</Text>
        </View>
        <Badge label={t(`orders.stage.${o.stage}`)} bg={tone.bg} fg={tone.fg} size={11} />
      </View>

      {otp && o.stage !== 'delivered' && o.stage !== 'cancelled' ? (
        <View style={{ padding: 14, borderRadius: radii.card, backgroundColor: theme.colors.container, borderWidth: 1, borderColor: theme.colors.primary, alignItems: 'center' }}>
          <Text size={11} weight={700} color="textMuted">{t('orders.otpTitle')}</Text>
          <Text size={32} weight={800} color="primary" mono style={{ letterSpacing: 8 }} accessibilityLabel={`${t('orders.otpTitle')} ${otp.split('').join(' ')}`}>{otp}</Text>
          <Text size={10} color="textMuted" align="center">{t('orders.otpHint')}</Text>
        </View>
      ) : null}

      <Card>
        <SectionHeader icon="📍" title={t('orders.timeline')} />
        {steps.map((s, i) => (
          <View key={s.key} style={{ flexDirection: 'row', gap: 12, minHeight: 44 }}>
            <View style={{ alignItems: 'center' }}>
              <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: s.done ? theme.colors.primary : theme.colors.slate200, alignItems: 'center', justifyContent: 'center' }}>
                {s.done ? <Text size={10} color="white" weight={800}>✓</Text> : null}
              </View>
              {i < steps.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: i < lastDone ? theme.colors.primary : theme.colors.slate200 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: 10 }}>
              <Text size={13} weight={s.done ? 800 : 600} color={s.done ? 'textMain' : 'textMuted'}>{s.label}</Text>
              {s.at ? <Text size={10} color="textMuted">{formatDate(s.at)} · {formatTime(s.at)}</Text> : null}
            </View>
          </View>
        ))}
        {o.estimated_delivery_date && o.stage !== 'delivered' ? <Text size={11} weight={700} color="primary">{t('confirmed.eta')}: {formatDate(o.estimated_delivery_date)}</Text> : null}
      </Card>

      {agent ? (
        <Card>
          <SectionHeader icon="🛵" title={t('orders.yourAgent')} />
          <Text size={13} weight={800}>{agent.name}</Text>
          {agent.phone ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Button label={t('common.call')} icon="📞" variant="verify" style={{ flex: 1 }} onPress={() => Linking.openURL(`tel:${agent.phone}`)} />
              <Button label={t('common.whatsapp')} icon="💬" variant="whatsapp" style={{ flex: 1 }} onPress={() => Linking.openURL(`https://wa.me/${agent.phone!.replace(/\D/g, '')}`)} />
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <SectionHeader icon="🧺" title={t('orders.itemsTitle')} />
        {o.items.map((it) => (
          <View key={`${it.product_id}:${it.variant_id}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 4 }}>
            <Text size={12} style={{ flex: 1 }}>{it.name}{it.variant_name ? ` · ${it.variant_name}` : ''} × {formatQty(it.quantity, it.unit)}</Text>
            <Text size={12} color="textMuted">{formatRs(it.line_total)}</Text>
          </View>
        ))}
        <View style={{ height: 1, backgroundColor: theme.colors.surfaceBorder, marginVertical: 8 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text size={12} color="textMuted">{t('checkout.subtotal')}</Text><Text size={12} color="textMuted">{formatRs(o.subtotal)}</Text></View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text size={12} color="textMuted">{t('checkout.deliveryFee')}</Text><Text size={12} color="textMuted">{formatRs(o.delivery_fee)}</Text></View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}><Text size={14} weight={800}>{t('checkout.total')}</Text><Text size={14} weight={800}>{formatRs(o.total_amount)}</Text></View>
        {o.address ? <Text size={11} color="textMuted" style={{ marginTop: 8 }}>📍 {o.address}</Text> : null}
      </Card>

      {o.can_cancel ? <Button label={t('orders.cancel')} variant="logout" loading={cancel.isPending} onPress={doCancel} /> : null}
    </Screen>
  );
}
