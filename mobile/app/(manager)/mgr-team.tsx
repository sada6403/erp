import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/Shell';
import { Text } from '@/components/Text';
import { Badge, Card, EmptyState, ErrorState, SectionHeader, SkeletonList } from '@/components/ui';
import { LEVEL_KEY, useTeam, useVisitReport } from '@/features/staff/hooks';
import { PerformanceBar, treeOrder } from '@/features/staff/ManagerParts';
import { thisMonth } from '@/features/agent/month';

/** Everyone below me as a tree (indented by level), with this month's achievement and visit counts. Tap a person to open their sales, collections and visits. */
export default function ManagerTeam() {
  const { t } = useTranslation();
  const router = useRouter();
  const period = thisMonth();
  const team = useTeam(period);
  const visits = useVisitReport(period);
  const meId = team.data?.me ?? '';
  const rows = useMemo(() => treeOrder(team.data?.items ?? [], meId), [team.data, meId]);
  const visitBy = useMemo(() => new Map((visits.data?.items ?? []).map((r) => [r.staff_id, r])), [visits.data]);

  return (
    <Screen
      onRefresh={() => {
        void team.refetch();
        void visits.refetch();
      }}
      refreshing={team.isRefetching}
    >
      <Text size={18} weight={800}>{t('mgr.team.title')}</Text>
      <SectionHeader icon={'👥'} title={t('sf.team.below')} />
      {team.isLoading ? <SkeletonList rows={4} height={96} /> : team.isError ? <ErrorState onRetry={() => team.refetch()} /> : rows.length === 0 ? (
        <EmptyState icon={'👥'} title={t('sf.team.empty')} />
      ) : (
        <View style={{ gap: 8 }}>
          {rows.map(({ item: m, depth }) => {
            const vr = visitBy.get(m.staff_id);
            return (
              <Pressable key={m.staff_id} accessibilityRole="button" style={{ marginLeft: Math.min(depth, 4) * 14 }} onPress={() => router.push({ pathname: '/mgr-person/[id]', params: { id: m.staff_id } })}>
                <Card radius={14} padding={12}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text size={13} weight={700}>{m.name}</Text>
                      <Text size={11} color="textMuted">{`${t(LEVEL_KEY[m.level])}${m.code ? ` • ${m.code}` : ''}`}</Text>
                    </View>
                    {m.team_size > 0 ? <Badge label={t('sf.team.members', { n: m.team_size })} bg="surfaceSubtle" fg="textMuted" /> : null}
                  </View>
                  <PerformanceBar p={m} />
                  {vr ? <Text size={11} color="textMuted" style={{ marginTop: 6 }}>{t('sf.visits.reportRow', { total: vr.total, bought: vr.purchased, gps: vr.gps_missing, done: vr.follow_ups_done, due: vr.follow_ups_due })}</Text> : null}
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
