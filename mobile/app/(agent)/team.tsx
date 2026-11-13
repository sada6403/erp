import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { StaffTeamMemberDto } from '@contracts/staff';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Shell';
import { Text } from '@/components/Text';
import { Badge, Card, EmptyState, ErrorState, Field, ProgressBar, SectionHeader, SkeletonList } from '@/components/ui';
import { LEVEL_KEY, useSetTarget, useStaffDashboard, useTeam } from '@/features/staff/hooks';
import { thisMonth } from '@/features/agent/month';
import { errorMessage } from '@/lib/errors';
import { formatRs } from '@/lib/money';
import { useUiStore } from '@/store/uiStore';
import { useTheme } from '@/theme';

/** Sales team: my target vs achievement, then everyone below me (the server sends only my subtree). Targets can be set for strict descendants only. */
export default function TeamScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const showToast = useUiStore((s) => s.showToast);
  const period = thisMonth();
  const dash = useStaffDashboard();
  const team = useTeam(period);
  const setTarget = useSetTarget();
  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [regs, setRegs] = useState('');

  const meId = team.data?.me;
  const direct = useMemo(() => (team.data?.items ?? []).filter((m) => m.staff_id !== meId), [team.data, meId]);

  const progress = (m: StaffTeamMemberDto) => (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text size={11} color="textMuted">{`${t('sf.team.achieved')} ${formatRs(m.achieved, { decimals: 2 })}`}</Text>
        <Text size={11} weight={700} color={m.achievement_pct != null && m.achievement_pct >= 50 ? 'success' : 'warning'}>
          {m.achievement_pct == null ? t('sf.team.noTarget') : t('sf.team.pct', { pct: m.achievement_pct.toFixed(1) })}
        </Text>
      </View>
      <ProgressBar pct={m.achievement_pct ?? 0} />
      <Text size={11} color="textMuted" style={{ marginTop: 4 }}>
        {m.target_source === 'none' ? t('sf.team.noTarget') : `${m.target_source === 'rollup' ? t('sf.team.teamTarget') : t('sf.team.target')} ${formatRs(m.target, { decimals: 2 })}`}
        {m.registrations_target != null ? ` • ${t('sf.team.regs')} ${m.registrations}/${m.registrations_target}` : ''}
      </Text>
    </View>
  );

  const save = async (id: string) => {
    const n = Number(amount);
    if (!amount.trim() || !Number.isFinite(n) || n < 0) return showToast(t('sf.team.badAmount'));
    try {
      await setTarget.mutateAsync({ staffId: id, body: { period, amount: n, ...(regs.trim() ? { registrations_target: Math.round(Number(regs)) } : {}) } });
      showToast(t('sf.team.saved'));
      setEditing(null); setAmount(''); setRegs('');
    } catch (e) {
      showToast(errorMessage(e, t));
    }
  };

  return (
    <Screen onRefresh={() => { void dash.refetch(); void team.refetch(); }} refreshing={team.isRefetching}>
      <View>
        <Text size={18} weight={800}>{t('sf.team.title')}</Text>
        {dash.data ? <Text size={12} color="textMuted" style={{ marginTop: 3 }}>{`${t(LEVEL_KEY[dash.data.level])} • ${t('sf.team.members', { n: dash.data.team_size })}`}</Text> : null}
      </View>

      {dash.data ? (
        <Card radius={16} padding={16}>
          <Text size={11} weight={600} color="textMuted">{t('sf.team.me')}</Text>
          <Text size={24} weight={800} color="primary" style={{ marginTop: 3 }}>{formatRs(dash.data.performance.achieved, { decimals: 2 })}</Text>
          {progress({ ...dash.data.performance, reports_to: null })}
          <Text size={11} color="textMuted" style={{ marginTop: 8 }}>{t('sf.team.rule')}</Text>
        </Card>
      ) : null}

      <SectionHeader icon={'👥'} title={t('sf.team.below')} />
      {team.isLoading ? <SkeletonList rows={3} height={96} /> : team.isError ? <ErrorState onRetry={() => team.refetch()} /> : direct.length === 0 ? (
        <EmptyState icon={'👥'} title={t('sf.team.empty')} />
      ) : (
        <View style={{ gap: 8 }}>
          {direct.map((m) => (
            <Card key={m.staff_id} radius={14} padding={12}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text size={13} weight={700}>{m.name}</Text>
                  <Text size={11} color="textMuted">{`${t(LEVEL_KEY[m.level])}${m.code ? ` • ${m.code}` : ''}`}</Text>
                </View>
                <Badge label={t('sf.team.members', { n: m.team_size })} bg="surfaceSubtle" fg="textMuted" />
              </View>
              {progress(m)}
              {editing === m.staff_id ? (
                <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.surfaceBorder, paddingTop: 10 }}>
                  <Field label={t('sf.team.amount')} value={amount} onChangeText={setAmount} keyboardType="numeric" maxLength={12} />
                  <Field label={t('sf.team.regsOptional')} value={regs} onChangeText={setRegs} keyboardType="numeric" maxLength={6} />
                  <View style={{ gap: 8 }}>
                    <Button label={t('sf.team.save')} variant="primaryBlock" fullWidth loading={setTarget.isPending} onPress={() => save(m.staff_id)} />
                    <Button label={t('common.cancel')} variant="secondaryBlock" fullWidth onPress={() => setEditing(null)} />
                  </View>
                </View>
              ) : (
                <View style={{ marginTop: 10 }}>
                  <Button label={t('sf.team.setTarget')} variant="secondaryBlock" fullWidth onPress={() => { setEditing(m.staff_id); setAmount(m.target_source === 'own' ? String(m.target) : ''); setRegs(m.registrations_target != null ? String(m.registrations_target) : ''); }} />
                </View>
              )}
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
