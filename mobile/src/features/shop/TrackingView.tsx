import React from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, radii, rings } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Gradient } from '@/components/Gradient';
import { Card, ErrorState, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatQty, formatRs } from '@/lib/money';
import { formatDate, formatTime } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useUiStore } from '@/store/uiStore';
import { useCancelOrder, useOrder, useTracking } from './hooks';
import { useServerActionGuard } from '@/features/common/hooks';
import { stageTone } from './stageTone';
import { SlipCard } from './SlipCard';

/**
 * Order tracking (#view-customer-track): header card, secure delivery OTP box, 5-step timeline,
 * assigned agent card, then the real order items / cancel button and "Continue Shopping".
 */
export function TrackingView({ id }: { id: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
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
  const activeIdx = steps.findIndex((s) => !s.done);
  const closed = o.stage === 'delivered' || o.stage === 'cancelled';

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
    <Screen
      onRefresh={() => {
        order.refetch();
        tracking.refetch();
      }}
      refreshing={order.isRefetching}
    >
      {/* .tracking-header-card */}
      <Card radius={radii.card} padding={14}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <Text size={14} weight={800}>
            {t('track.orderN', { n: o.order_number })}
          </Text>
          <View style={{ backgroundColor: theme.colors[tone.bg], paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.lg - 4 }}>
            <Text size={11} weight={800} color={tone.fg === 'warningText' ? 'warning' : tone.fg}>
              {t(`orders.stage.${o.stage}`)}
            </Text>
          </View>
        </View>
        {o.estimated_delivery_date && o.stage !== 'cancelled' ? (
          <Text size={12} color="textMuted">
            {t('track.eta')}{' '}
            <Text size={12} weight={700} color="textMuted">
              {formatDate(o.estimated_delivery_date)}
            </Text>
          </Text>
        ) : null}
      </Card>

      {/* .otp-security-box */}
      {otp && !closed ? (
        <Gradient from={theme.colors.primary} to={theme.colors.primaryDark} style={{ borderRadius: radii.hero, padding: 18, flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <Text size={32}>🔐</Text>
          <View style={{ flex: 1 }}>
            <Text size={10} weight={800} color="white" letterSpacing={0.5} style={{ opacity: 0.9 }}>
              {t('track.otpLabel')}
            </Text>
            <Text size={28} weight={900} mono color="accent" letterSpacing={4} style={{ marginVertical: 2 }} accessibilityLabel={`${t('track.otpLabel')} ${otp.split('').join(' ')}`}>
              {otp}
            </Text>
            <Text size={11} color="white" lineHeightRatio={1.35} style={{ opacity: 0.88 }}>
              {agent?.name ? t('track.otpInstruction', { name: agent.name }) : t('track.otpInstructionNoAgent')}
            </Text>
          </View>
        </Gradient>
      ) : null}

      {/* .timeline-stepper (a cancelled order has no progress to show) */}
      {steps.length > 0 && o.stage !== 'cancelled' ? (
        <Card radius={radii.card} padding={18} style={{ gap: 16 }}>
          {steps.map((s, i) => {
            const active = i === activeIdx;
            const last = i === steps.length - 1;
            const bullet = (
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: radii.circle,
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 2,
                  backgroundColor: s.done ? theme.colors.success : active ? theme.colors.accent : theme.colors.fill,
                }}
              >
                <Text size={11} weight={800} color={s.done ? 'white' : active ? 'accentText' : 'textSubtle'}>
                  {s.done ? '✓' : active ? '🛵' : '📦'}
                </Text>
              </View>
            );
            return (
              <View key={s.key} style={{ flexDirection: 'row', gap: 12 }}>
                {/* the connector line runs from below the bullet to the next one (gap 16) */}
                {!last ? <View style={{ position: 'absolute', top: 26, left: 11, bottom: -16, width: 2, backgroundColor: s.done ? theme.colors.success : theme.colors.slate200 }} /> : null}
                {active ? (
                  <View style={{ width: 24 + rings.accent4.width * 2, height: 24 + rings.accent4.width * 2, margin: -rings.accent4.width, borderRadius: radii.circle, backgroundColor: rings.accent4.color, alignItems: 'center', justifyContent: 'center' }}>
                    {bullet}
                  </View>
                ) : (
                  bullet
                )}
                <View style={{ flex: 1 }}>
                  <Text size={13} weight={800}>
                    {s.label}
                  </Text>
                  {s.at ? (
                    <Text size={11} color="textMuted">
                      {formatTime(s.at)} • {formatDate(s.at)}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

      {/* .assigned-agent-card */}
      {agent ? (
        <Card radius={radii.card} padding={14} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: radii.circle, backgroundColor: theme.colors.container, alignItems: 'center', justifyContent: 'center' }}>
            <Text size={22}>🛵</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text size={13} weight={800}>
              {agent.name}
            </Text>
          </View>
          {agent.phone ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.call')}
                hitSlop={5}
                onPress={() => Linking.openURL(`tel:${agent.phone}`)}
                style={{ width: 38, height: 38, borderRadius: radii.circle, backgroundColor: theme.colors.container, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text size={16}>📞</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.whatsapp')}
                hitSlop={5}
                onPress={() => Linking.openURL(`https://wa.me/${agent.phone!.replace(/\D/g, '')}`)}
                style={{ width: 38, height: 38, borderRadius: radii.circle, backgroundColor: theme.colors.whatsappBg, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text size={16}>💬</Text>
              </Pressable>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* Real order lines (not in the demo, needed to see what was ordered) */}
      <Card radius={radii.card} padding={14}>
        {o.items.map((it) => (
          <View key={`${it.product_id}:${it.variant_id}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 4 }}>
            <Text size={12} style={{ flex: 1 }}>
              {it.name}
              {it.variant_name ? ` · ${it.variant_name}` : ''} × {formatQty(it.quantity, it.unit)}
            </Text>
            <Text size={12} color="textMuted">
              {formatRs(it.line_total)}
            </Text>
          </View>
        ))}
        <View style={{ height: 1, backgroundColor: theme.colors.surfaceBorder, marginVertical: 8 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text size={12} color="textMuted">
            {t('checkout.sumSubtotal')}
          </Text>
          <Text size={12} color="textMuted">
            {formatRs(o.subtotal)}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text size={12} color="textMuted">
            {t('checkout.sumDelivery')}
          </Text>
          <Text size={12} color="textMuted">
            {formatRs(o.delivery_fee)}
          </Text>
        </View>
        <View style={{ height: 1, backgroundColor: theme.colors.surfaceBorder, marginVertical: 8 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text size={15} weight={700}>
            {t('checkout.sumTotal')}
          </Text>
          <Text size={15} weight={700}>
            {formatRs(o.total_amount)}
          </Text>
        </View>
        {o.address ? (
          <Text size={11} color="textMuted" style={{ marginTop: 8 }}>
            📍 {o.address}
          </Text>
        ) : null}
      </Card>

      <SlipCard order={o} />

      {o.can_cancel ? <Button label={t('orders.cancel')} variant="logout" fullWidth loading={cancel.isPending} onPress={doCancel} /> : null}
      <Button label={t('track.continueShopping')} variant="secondaryBlock" fullWidth onPress={() => router.replace('/')} />
    </Screen>
  );
}
