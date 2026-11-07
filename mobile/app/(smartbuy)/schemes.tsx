import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Badge, Card, EmptyState, ErrorState, MetricCard, ProgressBar, ScreenHeading, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatRs } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { useMySchemes } from '@/features/smartbuy/hooks';

/** My Schemes: progress, next draw and contributions (read-only in v1.0). */
export default function SchemesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useMySchemes();
  const items = data?.items ?? [];
  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      <ScreenHeading title={t('schemes.title')} sub={t('schemes.sub')} />
      {isLoading ? (
        <SkeletonList rows={3} height={150} />
      ) : isError && !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="💎" title={t('schemes.empty')} body={t('schemes.emptyBody')} actionLabel={t('join.title')} onAction={() => router.push('/join')} />
      ) : (
        items.map((s) => (
          <Card key={s.member_id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text size={15} weight={800}>{s.name}</Text>
                {s.scheme_number ? <Text size={11} color="textMuted" mono>{s.scheme_number}</Text> : null}
              </View>
              <Badge label={s.badge} bg="successBg" fg="success" size={11} />
            </View>
            <View style={{ marginVertical: 10, gap: 4 }}>
              <ProgressBar pct={s.cycle_count ? (s.cycles_paid / s.cycle_count) * 100 : 0} />
              <Text size={11} color="textMuted">{t('schemes.cycles', { paid: s.cycles_paid, total: s.cycle_count })}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <MetricCard value={formatRs(s.contribution_amount)} label={t(`frequency.${s.frequency}`)} />
              <MetricCard value={formatRs(s.contributions_paid)} label={t('schemes.paid')} highlight />
              <MetricCard value={formatRs(s.chit_value)} label={t('schemes.chitValue')} />
            </View>
            {s.next_draw_date ? <Text size={12} weight={700} color="primary" style={{ marginTop: 10 }}>🏆 {t('schemes.nextDraw')}: {formatDate(s.next_draw_date)}</Text> : null}
            {s.won_cycle_no ? <Text size={12} weight={800} color="goldText" style={{ marginTop: 4 }}>🎉 {t('schemes.won', { cycle: s.won_cycle_no })}</Text> : null}
            {s.agent_name ? <Text size={11} color="textMuted" style={{ marginTop: 4 }}>🧑‍💼 {s.agent_name}</Text> : null}
            <Button label={t('schemes.statement')} variant="secondaryBlock" style={{ marginTop: 10 }} onPress={() => router.push({ pathname: '/statement', params: { id: s.scheme_id } })} />
          </Card>
        ))
      )}
    </Screen>
  );
}
