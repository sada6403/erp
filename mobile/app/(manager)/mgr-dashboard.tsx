import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/Shell';
import { Text } from '@/components/Text';
import { Card, EmptyState, ErrorState, MetricCard, SectionHeader, SkeletonList } from '@/components/ui';
import { LEVEL_KEY, useStaffDashboard, useTeam, useVisitReport } from '@/features/staff/hooks';
import { PerformanceBar, treeOrder } from '@/features/staff/ManagerParts';
import { thisMonth } from '@/features/agent/month';
import { formatRs } from '@/lib/money';

/** Management dashboard: my team's target vs achievement this month, the headline counts, and my direct reports. Everything shown is inside my scope (the server sends only that). */
export default function ManagerDashboard() {
  const { t } = useTranslation();
  const router = useRouter();
  const period = thisMonth();
  const dash = useStaffDashboard(period);
  const team = useTeam(period);
  const visits = useVisitReport(period);

  const meId = team.data?.me ?? '';
  const below = useMemo(() => treeOrder(team.data?.items ?? [], meId), [team.data, meId]);
  const direct = below.filter((b) => b.depth === 0).map((b) => b.item);
  const officers = below.filter((b) => b.item.level === 'field_officer').length;
  const v = useMemo(() => {
    const rows = (visits.data?.items ?? []).filter((r) => r.staff_id !== meId);
    return rows.reduce((s, r) => ({ total: s.total + r.total, done: s.done + r.follow_ups_done, due: s.due + r.follow_ups_due }), { total: 0, done: 0, due: 0 });
  }, [visits.data, meId]);

  const refresh = () => {
    void dash.refetch();
    void team.refetch();
    void visits.refetch();
  };

  return (
    <Screen onRefresh={refresh} refreshing={team.isRefetching}>
      <View>
        <Text size={18} weight={800}>{t('mgr.dash.title')}</Text>
        {dash.data ? <Text size={12} color="textMuted" style={{ marginTop: 3 }}>{`${t(LEVEL_KEY[dash.data.level])} • ${t('mgr.dash.scope')}`}</Text> : null}
      </View>

      {dash.isError ? <ErrorState onRetry={() => dash.refetch()} /> : !dash.data ? <SkeletonList rows={2} height={120} /> : (
        <Card radius={16} padding={16}>
          <Text size={11} weight={600} color="textMuted">{t('mgr.dash.teamThisMonth')}</Text>
          <Text size={26} weight={800} color="primary" style={{ marginTop: 3 }}>{formatRs(dash.data.performance.achieved, { decimals: 2 })}</Text>
          <PerformanceBar p={dash.data.performance} />
          <Text size={11} color="textMuted" style={{ marginTop: 8 }}>{t('sf.team.rule')}</Text>
        </Card>
      )}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><MetricCard value={String(officers)} label={t('mgr.dash.officers')} /></View>
        <View style={{ flex: 1 }}><MetricCard value={String(v.total)} label={t('mgr.dash.visits')} /></View>
        <View style={{ flex: 1 }}><MetricCard value={`${v.done}/${v.due}`} label={t('mgr.dash.followUps')} /></View>
      </View>

      <SectionHeader icon={'👥'} title={t('mgr.dash.direct')} />
      {team.isLoading ? <SkeletonList rows={3} height={80} /> : team.isError ? <ErrorState onRetry={() => team.refetch()} /> : direct.length === 0 ? (
        <EmptyState icon={'👥'} title={t('sf.team.empty')} />
      ) : (
        <View style={{ gap: 8 }}>
          {direct.map((m) => (
            <Pressable key={m.staff_id} accessibilityRole="button" onPress={() => router.push({ pathname: '/mgr-person/[id]', params: { id: m.staff_id } })}>
              <Card radius={14} padding={12}>
                <Text size={13} weight={700}>{m.name}</Text>
                <Text size={11} color="textMuted">{`${t(LEVEL_KEY[m.level])}${m.code ? ` • ${m.code}` : ''} • ${t('sf.team.members', { n: m.team_size })}`}</Text>
                <PerformanceBar p={m} />
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
