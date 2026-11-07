import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { radii, useTheme } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatRs } from '@/lib/money';
import { errorMessage } from '@/lib/errors';
import { useUiStore } from '@/store/uiStore';
import { useAgentMembers } from '@/features/agent/hooks';
import { useRecordCollection } from '@/features/agent/devApi';
import { MOCK_FEATURES } from '@/features/agent/devFeatures';
import { SoonNote } from '@/features/agent/components';
import type { MemberView } from '@/features/agent/types';

const cleanName = (n: string) => n.replace(/\s*\(Member[^)]*\)\s*$/i, '');

/** Assigned Scheme Members (demo view-agent-members). Cash collection has no backend yet: dev mock only. */
export default function MembersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const showToast = useUiStore((s) => s.showToast);
  const { data, isLoading, isError, refetch, isRefetching } = useAgentMembers();
  const record = useRecordCollection();
  const items = data?.items ?? [];

  const tag = (m: MemberView) => {
    const x = /^(paid|due)_cycle_(\d+)$/.exec(m.status);
    if (x) return { label: t(x[1] === 'paid' ? 'members.paidCycle' : 'members.dueCycle', { n: x[2] }), paid: x[1] === 'paid' };
    return { label: m.status, paid: !/due|overdue|pending/i.test(m.status) };
  };
  const collect = async (m: MemberView) => {
    const amount = m.weekly_amount ?? 0;
    try {
      await record.mutateAsync({ memberId: m.member_id, amount });
      showToast(`💵 ${t('members.recorded', { amount: formatRs(amount), name: cleanName(m.customer_name) })}`);
    } catch (e) {
      showToast(errorMessage(e, t));
    }
  };

  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      <View>
        <Text size={18} weight={800}>{t('members.title')}</Text>
        <Text size={12} color="textMuted" style={{ marginTop: 3, marginBottom: 2 }}>{t('members.sub')}</Text>
      </View>
      {isLoading ? (
        <SkeletonList rows={4} height={90} />
      ) : isError && !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={'👥'} title={t('members.empty')} />
      ) : (
        <View style={{ gap: 10 }}>
          {items.map((m) => {
            const tg = tag(m);
            const phone = m.phone_masked?.replace(' - ', ' • ');
            return (
              <View key={m.member_id} style={{ backgroundColor: theme.colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: theme.colors.surfaceBorder, padding: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Text size={13} weight={700} style={{ flex: 1 }}>{m.customer_name}</Text>
                  <View style={{ backgroundColor: tg.paid ? theme.colors.successBg : theme.colors.warningBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.sm }}>
                    <Text size={10} weight={800} color={tg.paid ? 'success' : 'warning'}>{tg.label}</Text>
                  </View>
                </View>
                <Text size={11} color="textMuted" style={{ marginVertical: 2 }}>
                  {m.weekly_amount ? `${m.scheme_name} • ${formatRs(m.weekly_amount)}${t('members.perWeek')}` : `${m.scheme_name} • ${t('schemes.paid')} ${formatRs(m.contributions_paid)}`}
                </Text>
                {phone ? <Text size={11} weight={600} color="primary">{`📞 ${phone}`}</Text> : null}
                {m.won_cycle_no ? <Text size={11} weight={700} color="goldText">{`🎉 ${t('schemes.won', { cycle: m.won_cycle_no })}`}</Text> : null}
                {!tg.paid ? (
                  <Button
                    label={m.weekly_amount ? t('members.recordCash', { amount: formatRs(m.weekly_amount) }) : t('members.recordCashPlain')}
                    icon={'💵'}
                    variant="primarySm"
                    fullWidth
                    disabled={!MOCK_FEATURES}
                    loading={record.isPending && record.variables?.memberId === m.member_id}
                    onPress={() => collect(m)}
                    style={{ marginTop: 8 }}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      {!MOCK_FEATURES && items.some((m) => !tag(m).paid) ? <SoonNote /> : null}
    </Screen>
  );
}
