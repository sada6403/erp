import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { Text } from '@/components/Text';
import { Badge, Card, EmptyState, ErrorState, ScreenHeading, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatRs } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { useStatement } from '@/features/smartbuy/hooks';

/** Scheme statement (passbook rows). Screen capture is blocked: it shows financial data. */
export default function StatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  usePreventScreenCapture();
  const { data, isLoading, isError, refetch } = useStatement(id);
  return (
    <Screen>
      <ScreenHeading title={data?.scheme_name ?? t('schemes.statement')} sub={data ? `${t('schemes.paid')}: ${formatRs(data.total_paid)}` : undefined} />
      {isLoading ? (
        <SkeletonList rows={4} height={60} />
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : data.rows.length === 0 ? (
        <EmptyState icon="🧾" title={t('wallet.noTransactions')} />
      ) : (
        <Card>
          {data.rows.map((r) => (
            <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 52, gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text size={13} weight={700}>{r.cycle_no ? t('schemes.cycleN', { n: r.cycle_no }) : t('schemes.payment')}</Text>
                <Text size={10} color="textMuted">{formatDate(r.paid_at)}{r.receipt_number ? ` · ${r.receipt_number}` : ''}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text size={13} weight={800}>{formatRs(r.amount)}</Text>
                <Badge label={r.status} bg="successBg" fg="success" />
              </View>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
