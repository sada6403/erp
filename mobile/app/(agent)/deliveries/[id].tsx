import React, { useRef, useState } from 'react';
import { Linking, Pressable, Switch, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Card, ErrorState, SectionHeader, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatQty, formatRs } from '@/lib/money';
import { errorMessage } from '@/lib/errors';
import { useUiStore } from '@/store/uiStore';
import { isDelivered, useCompleteDelivery, useDeliveries } from '@/features/agent/hooks';

/** Agent field completion: customer's 4-digit OTP, COD cash confirmation, then complete (queues offline). */
export default function DeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const showToast = useUiStore((s) => s.showToast);
  const { items, isLoading, isError, refetch } = useDeliveries();
  const complete = useCompleteDelivery();
  const [otp, setOtp] = useState('');
  const [cashOk, setCashOk] = useState(false);
  const [wrong, setWrong] = useState(false);
  const input = useRef<React.ElementRef<typeof TextInput>>(null);
  const d = items.find((i) => i.id === id);

  if (!d) return <Screen>{isError ? <ErrorState onRetry={() => refetch()} /> : isLoading ? <SkeletonList rows={3} height={110} /> : <ErrorState message={t('errors.NOT_FOUND')} />}</Screen>;
  const finished = isDelivered(d);
  const ready = otp.length === 4 && (!d.collect_cash || cashOk);

  const submit = async () => {
    setWrong(false);
    try {
      const r = await complete.mutateAsync({ delivery: d, otp });
      if (r === 'wrong_otp') {
        setWrong(true);
        setOtp('');
        return;
      }
      showToast(r === 'queued' ? t('agent.queued') : t('agent.completed'));
      router.replace('/deliveries');
    } catch (e) {
      setWrong(true);
      setOtp('');
      showToast(errorMessage(e, t));
    }
  };

  return (
    <Screen>
      <View>
        <Text size={16} weight={800} mono>{d.order_number}</Text>
        <Text size={13} weight={700}>{d.customer_name}</Text>
        {d.address ? <Text size={12} color="textMuted">📍 {d.address}</Text> : null}
      </View>
      {d.customer_phone ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label={t('common.call')} icon="📞" variant="verify" style={{ flex: 1 }} onPress={() => Linking.openURL(`tel:${d.customer_phone}`)} />
          <Button label={t('common.whatsapp')} icon="💬" variant="whatsapp" style={{ flex: 1 }} onPress={() => Linking.openURL(`https://wa.me/${d.customer_phone!.replace(/\D/g, '')}`)} />
        </View>
      ) : null}

      {d.items?.length ? (
        <Card>
          <SectionHeader icon="🧺" title={t('orders.itemsTitle')} />
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
        <Card><Text size={14} weight={800} color="success" align="center">✅ {t('agent.delivered')}</Text></Card>
      ) : (
        <Card>
          <Text size={13} weight={800}>{t('agent.enterOtp')}</Text>
          <Text size={11} color="textMuted" style={{ marginBottom: 10 }}>{t('agent.otpHelp')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('agent.enterOtp')} onPress={() => input.current?.focus()} style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
            {[0, 1, 2, 3].map((n) => (
              <View key={n} style={{ width: 56, height: 64, borderRadius: radii.control, borderWidth: 2, borderColor: wrong ? theme.colors.error : otp.length === n ? theme.colors.primary : theme.colors.surfaceBorder, backgroundColor: theme.colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' }}>
                <Text size={26} weight={800} mono>{otp[n] ?? ''}</Text>
              </View>
            ))}
          </Pressable>
          <TextInput ref={input} value={otp} onChangeText={(v) => { setWrong(false); setOtp(v.replace(/\D/g, '').slice(0, 4)); }} keyboardType="number-pad" maxLength={4} style={{ height: 1, opacity: 0 }} accessibilityLabel={t('agent.enterOtp')} />
          {wrong ? <Text size={12} weight={700} color="error" align="center">{t('agent.wrongOtp')}</Text> : null}
          {d.collect_cash ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, marginTop: 10 }}>
              <Text size={12} weight={700} style={{ flex: 1 }}>{t('agent.cashCollected', { amount: formatRs(d.amount_due) })}</Text>
              <Switch accessibilityLabel={t('agent.cashCollectedShort')} value={cashOk} onValueChange={setCashOk} trackColor={{ true: theme.colors.primary, false: theme.colors.slate300 }} thumbColor={theme.colors.white} />
            </View>
          ) : null}
          <Button label={t('agent.complete')} variant="checkout" disabled={!ready} loading={complete.isPending} onPress={submit} style={{ marginTop: 10 }} />
        </Card>
      )}
      <Button label={t('agent.printBill')} icon="🖨️" variant="printBill" onPress={() => router.push({ pathname: '/bill/[id]', params: { id: d.id } })} />
    </Screen>
  );
}
