import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Badge, Card, EmptyState, ErrorState, ScreenHeading, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatRs } from '@/lib/money';
import { useUiStore } from '@/store/uiStore';
import { useAgentMembers } from '@/features/agent/hooks';

/** Assigned scheme members (masked phones). Cash collection is a later update, shown only in dev. */
export default function MembersScreen() {
  const { t } = useTranslation();
  const showToast = useUiStore((s) => s.showToast);
  const { data, isLoading, isError, refetch, isRefetching } = useAgentMembers();
  const items = data?.items ?? [];
  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      <ScreenHeading title={t('members.title')} sub={t('members.sub')} />
      {isLoading ? (
        <SkeletonList rows={4} height={90} />
      ) : isError && !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="👥" title={t('members.empty')} />
      ) : (
        items.map((m) => (
          <Card key={m.member_id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text size={14} weight={800}>{m.customer_name}</Text>
              <Badge label={m.status} bg="successBg" fg="success" />
            </View>
            {m.phone_masked ? <Text size={11} color="textMuted" mono>{m.phone_masked}</Text> : null}
            <Text size={12} color="textMuted" style={{ marginTop: 4 }}>{m.scheme_name} · {t('schemes.paid')} {formatRs(m.contributions_paid)}</Text>
            {m.won_cycle_no ? <Text size={11} weight={700} color="goldText">🎉 {t('schemes.won', { cycle: m.won_cycle_no })}</Text> : null}
            {__DEV__ ? <Button label={t('members.collect')} variant="secondarySm" style={{ marginTop: 8 }} onPress={() => showToast(t('soon.badge'))} /> : null}
          </Card>
        ))
      )}
      {!__DEV__ ? <Text size={11} color="textMuted" align="center">{t('members.collectSoon')}</Text> : null}
    </Screen>
  );
}
