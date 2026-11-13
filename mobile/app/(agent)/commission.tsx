import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { radii, useTheme } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { ErrorState, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatRs } from '@/lib/money';
import { useBill, useCommission, useDeliveries } from '@/features/agent/hooks';
import { usePrinter } from '@/features/agent/devApi';
import { MOCK_FEATURES } from '@/features/agent/devFeatures';
import { ReceiptModal, SoonNote } from '@/features/agent/components';
import { buildBillText } from '@/features/agent/receipt';
import { monthLabel, thisMonth } from '@/features/agent/month';

/** Earnings (demo view-agent-earnings): month commission card and the ESC/POS thermal printer card. */
export default function CommissionScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useCommission(thisMonth());
  const printer = usePrinter();
  const del = useDeliveries();
  // Sample receipt = the first delivery's bill (dev mock only; printing has no backend yet).
  const first = MOCK_FEATURES ? del.items[0]?.id : undefined;
  const bill = useBill(first ?? '');
  const [show, setShow] = useState(false);
  const p = printer.data;

  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      {isLoading ? (
        <SkeletonList rows={2} height={110} />
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <View style={{ backgroundColor: theme.colors.surface, borderRadius: radii.card, borderWidth: 1, borderColor: theme.colors.surfaceBorder, padding: 16 }}>
          <Text size={11} weight={600} color="textMuted">{t('earnings.summary', { month: monthLabel(data.month, t) })}</Text>
          <Text size={24} weight={800} color="primary" style={{ marginTop: 3, marginBottom: 6 }}>{formatRs(data.total, { decimals: 2 })}</Text>
          <Text size={11} color="textMuted" lineHeightRatio={1.4}>{t('earnings.calc')}</Text>
          {data.pending > 0 || data.paid > 0 ? (
            <Text size={11} weight={700} color="textMuted" style={{ marginTop: 6 }}>
              {`${t('earnings.pending')} ${formatRs(data.pending)} • ${t('earnings.paid')} ${formatRs(data.paid)}`}
            </Text>
          ) : null}
        </View>
      )}

      <View style={{ backgroundColor: theme.colors.surface, borderRadius: radii.card, borderWidth: 1, borderColor: theme.colors.surfaceBorder, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
          <Text size={26}>{'🖨️'}</Text>
          <View style={{ flex: 1 }}>
            <Text size={13} weight={800}>{t('earnings.printerTitle')}</Text>
            {MOCK_FEATURES && p ? (
              <Text size={11} color="textMuted" style={{ marginTop: 1 }}>
                {p.connected ? `${t('earnings.connected')}: ` : `${t('earnings.notConnected')}: `}
                <Text size={11} weight={700} color="textMuted">{p.name}</Text>
              </Text>
            ) : !MOCK_FEATURES ? (
              <Text size={11} color="textMuted" style={{ marginTop: 1 }}>{t('soon.badge')}</Text>
            ) : null}
          </View>
        </View>
        <Button
          label={t('earnings.previewReceipt')}
          icon={'📄'}
          variant="secondarySm"
          disabled={!MOCK_FEATURES || !bill.data}
          onPress={() => setShow(true)}
        />
      </View>
      <Button label={`🖨️ ${t('nav.printBill')}`} variant="secondaryBlock" fullWidth onPress={() => router.navigate('/bill' as never)} />
      <ReceiptModal visible={show && !!bill.data} text={bill.data ? buildBillText(bill.data) : ''} onClose={() => setShow(false)} />
      {!MOCK_FEATURES ? <SoonNote /> : null}
    </Screen>
  );
}
