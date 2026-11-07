import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Badge, Card, EmptyState, ErrorState, MetricCard, ScreenHeading, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatRs } from '@/lib/money';
import { formatDate, pad2 } from '@/lib/format';
import { useCommission } from '@/features/agent/hooks';

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

/** Agent profile and earnings: month totals and commission rows. */
export default function CommissionScreen() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch, isRefetching } = useCommission(thisMonth());
  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      <ScreenHeading title={t('earnings.title')} sub={data?.month ?? thisMonth()} />
      {isLoading ? (
        <SkeletonList rows={4} height={64} />
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <MetricCard value={formatRs(data.total)} label={t('earnings.total')} highlight />
            <MetricCard value={formatRs(data.pending)} label={t('earnings.pending')} />
            <MetricCard value={formatRs(data.paid)} label={t('earnings.paid')} />
          </View>
          {data.rows.length === 0 ? (
            <EmptyState icon="📊" title={t('earnings.empty')} />
          ) : (
            <Card>
              {data.rows.map((r) => (
                <View key={r.id} style={{ minHeight: 52, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text size={13} weight={700}>{r.source}</Text>
                    <Text size={10} color="textMuted">{formatDate(r.created_at)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text size={13} weight={800}>{formatRs(r.amount)}</Text>
                    <Badge label={r.status} bg={r.status === 'paid' ? 'successBg' : 'warningBg'} fg={r.status === 'paid' ? 'success' : 'warningText'} />
                  </View>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
