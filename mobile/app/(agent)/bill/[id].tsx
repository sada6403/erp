import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { ErrorState, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatQty, formatRs } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { useUiStore } from '@/store/uiStore';
import { useBill } from '@/features/agent/hooks';
import type { AgentBillDto } from '@/api/localTypes';

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);

/** 58mm-style receipt as HTML, used for the PDF share (no Bluetooth printing in v1.0). */
export function billHtml(b: AgentBillDto): string {
  const rows = b.lines
    .map((l) => `<tr><td>${esc(l.name)}<br/>${esc(formatQty(l.quantity, l.unit))} x ${esc(formatRs(l.unit_price))}</td><td style="text-align:right">${esc(formatRs(l.line_total))}</td></tr>`)
    .join('');
  return `<html><body style="font-family:monospace;width:280px;font-size:12px"><h3 style="text-align:center">${esc(b.company_name)}</h3>
<p style="text-align:center">${esc(b.branch_name ?? '')}<br/>${esc(b.branch_phone ?? '')}</p><hr/>
<p>Bill ${esc(b.bill_no)}<br/>Order ${esc(b.order_number)}<br/>${esc(formatDate(b.date))}<br/>${esc(b.customer_name)}</p><hr/>
<table style="width:100%">${rows}</table><hr/>
<p>Subtotal ${esc(formatRs(b.subtotal))}<br/>Delivery ${esc(formatRs(b.delivery_fee))}<br/><b>Total ${esc(formatRs(b.total))}</b><br/>${esc(b.payment_label)}</p></body></html>`;
}

/** Thermal receipt preview (monospace). PDF share works now; Bluetooth printing arrives in a later update. */
export default function BillPreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const showToast = useUiStore((s) => s.showToast);
  const { data: b, isLoading, isError, refetch } = useBill(id);

  const sharePdf = async () => {
    if (!b) return;
    try {
      const { uri } = await Print.printToFileAsync({ html: billHtml(b), width: 226 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch {
      showToast(t('errors.UNKNOWN'));
    }
  };

  if (isLoading) return <Screen><SkeletonList rows={1} height={320} /></Screen>;
  if (isError || !b) return <Screen><ErrorState onRetry={() => refetch()} /></Screen>;

  const line = <View style={{ borderTopWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.goldMid, marginVertical: 8 }} />;
  return (
    <Screen>
      <View style={{ backgroundColor: theme.colors.goldBg, borderWidth: 1, borderColor: theme.colors.goldBorder, padding: 16, borderRadius: 6 }}>
        <Text mono size={13} weight={700} align="center" color="goldDark">{b.company_name}</Text>
        {b.branch_name ? <Text mono size={11} align="center" color="goldMid">{b.branch_name}</Text> : null}
        {line}
        <Text mono size={11} color="goldDark">{t('bill.billNo')}: {b.bill_no}</Text>
        <Text mono size={11} color="goldDark">{t('confirmed.orderNo')}: {b.order_number}</Text>
        <Text mono size={11} color="goldDark">{formatDate(b.date)}</Text>
        <Text mono size={11} color="goldDark">{b.customer_name}</Text>
        {line}
        {b.lines.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text mono size={11} color="goldDark" style={{ flex: 1 }}>{l.name} {formatQty(l.quantity, l.unit)}</Text>
            <Text mono size={11} color="goldDark">{formatRs(l.line_total)}</Text>
          </View>
        ))}
        {line}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text mono size={11} color="goldDark">{t('checkout.deliveryFee')}</Text><Text mono size={11} color="goldDark">{formatRs(b.delivery_fee)}</Text></View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text mono size={13} weight={800} color="goldDark">{t('checkout.total')}</Text><Text mono size={13} weight={800} color="goldDark">{formatRs(b.total)}</Text></View>
        <Text mono size={11} color="goldMid" align="center" style={{ marginTop: 6 }}>{b.payment_label}</Text>
      </View>
      <Button label={t('bill.sharePdf')} icon="📄" variant="pdf" onPress={sharePdf} />
      <Button label={t('bill.bluetooth')} icon="🖨️" variant="printBill" disabled onPress={() => undefined} />
      <Text size={11} color="textMuted" align="center">{t('bill.bluetoothSoon')}</Text>
    </Screen>
  );
}
