import React from 'react';
import { Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Badge, Card, EmptyState, ErrorState, MetricCard, ProgressBar, SkeletonList } from '@/components/ui';
import { Gradient } from '@/components/Gradient';
import { Screen } from '@/components/Shell';
import { formatRs } from '@/lib/money';
import { useSessionStore } from '@/store/sessionStore';
import { codToCollect, isDelivered, useAgentDashboard, useDeliveries } from '@/features/agent/hooks';

/** Agent home: hero, today metrics, commission and the delivery queue (offline-capable). */
export default function AgentDeliveriesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const user = useSessionStore((s) => s.user);
  const dash = useAgentDashboard();
  const del = useDeliveries();
  const x = dash.data?.extras;
  const d = dash.data;
  const pending = del.items.filter((i) => !isDelivered(i));
  const done = del.items.filter(isDelivered);

  return (
    <Screen onRefresh={() => { dash.refetch(); del.refetch(); }} refreshing={del.isRefetching}>
      <View style={{ borderRadius: radii.hero, overflow: 'hidden' }}>
        <Gradient direction="diagonal" from={theme.colors.primary} to={theme.colors.primaryDark} style={{ padding: 18 }}>
          <Text size={12} weight={700} color="glassText">{t('agent.welcome')}</Text>
          <Text size={20} weight={800} color="white">{d?.agent.name ?? user?.name}</Text>
          <Text size={11} color="glassText" mono>{d?.agent.code ?? user?.agent_code}{x?.branch_name ? ` · ${x.branch_name}` : ''}</Text>
          {x?.rank_label ? <Text size={11} weight={800} color="yellowText" style={{ marginTop: 4 }}>{x.rank_label}{x.tier ? ` · ${x.tier}` : ''}</Text> : null}
        </Gradient>
      </View>

      {d ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <MetricCard value={String(d.deliveries_pending)} label={t('agent.pending')} highlight />
          <MetricCard value={String(d.deliveries_completed_today)} label={t('agent.doneToday')} />
          <MetricCard value={String(d.members_count)} label={t('agent.members')} />
        </View>
      ) : null}

      {d ? (
        <Card>
          <Text size={12} weight={700} color="textMuted">{t('agent.commissionMonth')}</Text>
          <Text size={22} weight={800} color="primary" mono>{formatRs(d.commission_this_month)}</Text>
          <Text size={11} color="textMuted">{t('agent.commissionPending')}: {formatRs(d.commission_pending)}</Text>
          {x?.goal ? (
            <View style={{ marginTop: 10, gap: 4 }}>
              <Text size={12} weight={700}>{x.goal.title}</Text>
              <ProgressBar pct={(x.goal.earned / Math.max(1, x.goal.target)) * 100} />
              <Text size={10} color="textMuted">{x.goal.subtitle}</Text>
            </View>
          ) : null}
          <Button label={t('agent.viewEarnings')} variant="secondaryBlock" style={{ marginTop: 10 }} onPress={() => router.push('/commission')} />
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text size={15} weight={800}>{t('agent.queue')}</Text>
        {pending.length ? <Text size={11} weight={700} color="warning">{t('agent.cashToCollect')}: {formatRs(codToCollect(del.items))}</Text> : null}
      </View>

      {del.isLoading ? (
        <SkeletonList rows={3} height={130} />
      ) : del.isError && !del.data ? (
        <ErrorState onRetry={() => del.refetch()} />
      ) : del.items.length === 0 ? (
        <EmptyState icon="🛵" title={t('agent.noDeliveries')} />
      ) : (
        [...pending, ...done].map((i) => (
          <Card key={i.id} onPress={() => router.push({ pathname: '/deliveries/[id]', params: { id: i.id } })} accessibilityLabel={`${i.order_number} ${i.customer_name}`}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text size={13} weight={800} mono>{i.order_number}</Text>
              <Badge label={isDelivered(i) ? t('agent.delivered') : t(`agent.status.${i.status}`, { defaultValue: i.status })} bg={isDelivered(i) ? 'successBg' : 'warningBg'} fg={isDelivered(i) ? 'success' : 'warningText'} size={10} />
            </View>
            <Text size={13} weight={700} style={{ marginTop: 6 }}>{i.customer_name}</Text>
            {i.address ? <Text size={11} color="textMuted">📍 {i.address}</Text> : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <Text size={13} weight={800} color={i.collect_cash ? 'warning' : 'success'}>{i.collect_cash ? `${t('agent.collect')} ${formatRs(i.amount_due)}` : t('agent.prepaid')}</Text>
              {i.customer_phone ? <Button label={t('common.call')} icon="📞" variant="verify" onPress={() => Linking.openURL(`tel:${i.customer_phone}`)} /> : null}
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
