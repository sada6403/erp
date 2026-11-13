import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Shell';
import { Text } from '@/components/Text';
import { Badge, Card, EmptyState, ErrorState, Field, SectionHeader, SkeletonList } from '@/components/ui';
import { LEVEL_KEY, useSetTarget, useStaffDetail, useTeam } from '@/features/staff/hooks';
import { PerformanceBar } from '@/features/staff/ManagerParts';
import { thisMonth } from '@/features/agent/month';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatTime } from '@/lib/format';
import { formatRs } from '@/lib/money';
import { useUiStore } from '@/store/uiStore';
import { useTheme } from '@/theme';

/** One person inside my scope: this month's figures, then their sales, Smart Buy collections and visits. The server answers 404 for anyone outside my team. */
export default function ManagerPerson() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const period = thisMonth();
  const showToast = useUiStore((s) => s.showToast);
  const detail = useStaffDetail(String(id ?? ''), period);
  const team = useTeam(period);
  const setTarget = useSetTarget();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [regs, setRegs] = useState('');

  const p = detail.data?.performance;
  const isMe = team.data?.me === id;

  const save = async () => {
    const n = Number(amount);
    if (!amount.trim() || !Number.isFinite(n) || n < 0) return showToast(t('sf.team.badAmount'));
    try {
      await setTarget.mutateAsync({ staffId: String(id), body: { period, amount: n, ...(regs.trim() ? { registrations_target: Math.round(Number(regs)) } : {}) } });
      showToast(t('sf.team.saved'));
      setEditing(false);
    } catch (e) {
      showToast(errorMessage(e, t));
    }
  };

  if (detail.isError) {
    return (
      <Screen>
        <ErrorState message={t('mgr.person.notFound')} onRetry={() => detail.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={() => void detail.refetch()} refreshing={detail.isRefetching}>
      {!p ? <SkeletonList rows={3} height={110} /> : (
        <>
          <View>
            <Text size={18} weight={800}>{p.name}</Text>
            <Text size={12} color="textMuted" style={{ marginTop: 3 }}>{`${t(LEVEL_KEY[p.level])}${p.code ? ` • ${p.code}` : ''} • ${t('sf.team.members', { n: p.team_size })}`}</Text>
          </View>
          <Card radius={16} padding={16}>
            <Text size={11} weight={600} color="textMuted">{t('mgr.person.thisMonth')}</Text>
            <Text size={24} weight={800} color="primary" style={{ marginTop: 3 }}>{formatRs(p.achieved, { decimals: 2 })}</Text>
            <Text size={11} color="textMuted" style={{ marginTop: 4 }}>{`${t('mgr.person.sales')} ${formatRs(p.sales_net, { decimals: 2 })} • ${t('mgr.person.collected')} ${formatRs(p.contributions, { decimals: 2 })}`}</Text>
            <PerformanceBar p={p} />
            {!isMe ? (
              editing ? (
                <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.surfaceBorder, paddingTop: 10 }}>
                  <Field label={t('sf.team.amount')} value={amount} onChangeText={setAmount} keyboardType="numeric" maxLength={12} />
                  <Field label={t('sf.team.regsOptional')} value={regs} onChangeText={setRegs} keyboardType="numeric" maxLength={6} />
                  <View style={{ gap: 8 }}>
                    <Button label={t('sf.team.save')} variant="primaryBlock" fullWidth loading={setTarget.isPending} onPress={save} />
                    <Button label={t('common.cancel')} variant="secondaryBlock" fullWidth onPress={() => setEditing(false)} />
                  </View>
                </View>
              ) : (
                <View style={{ marginTop: 10 }}>
                  <Button
                    label={t('sf.team.setTarget')}
                    variant="secondaryBlock"
                    fullWidth
                    onPress={() => {
                      setEditing(true);
                      setAmount(p.target_source === 'own' ? String(p.target) : '');
                      setRegs(p.registrations_target != null ? String(p.registrations_target) : '');
                    }}
                  />
                </View>
              )
            ) : null}
          </Card>

          <SectionHeader icon={'🧾'} title={t('mgr.person.salesTitle')} />
          {detail.data!.sales.length === 0 ? <EmptyState icon={'🧾'} title={t('mgr.person.noSales')} /> : (
            <View style={{ gap: 6 }}>
              {detail.data!.sales.map((s) => (
                <Card key={s.invoice_number} radius={12} padding={10}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text size={12} weight={700}>{s.invoice_number}</Text>
                      <Text size={11} color="textMuted">{`${s.customer_name ?? t('mgr.person.walkIn')} • ${formatDate(s.created_at)}`}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text size={12} weight={700}>{formatRs(s.total, { decimals: 2 })}</Text>
                      {s.wallet_part > 0 ? <Text size={10} color="textMuted">{t('mgr.person.wallet', { amount: formatRs(s.wallet_part, { decimals: 2 }) })}</Text> : null}
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          )}

          <SectionHeader icon={'💰'} title={t('mgr.person.collectionsTitle')} />
          {detail.data!.collections.length === 0 ? <EmptyState icon={'💰'} title={t('mgr.person.noCollections')} /> : (
            <View style={{ gap: 6 }}>
              {detail.data!.collections.map((c) => (
                <Card key={c.id} radius={12} padding={10}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text size={12} weight={700}>{c.member_name ?? '-'}</Text>
                      <Text size={11} color="textMuted">{`${c.receipt_number ? `${c.receipt_number} • ` : ''}${formatDate(c.paid_at)}`}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text size={12} weight={700}>{formatRs(c.amount, { decimals: 2 })}</Text>
                      <Badge
                        label={t(`collect.status.${c.status}`, { defaultValue: c.status })}
                        bg={c.status === 'rejected' ? 'errorBg' : c.status === 'pending_verification' ? 'warningBg' : 'successBg'}
                        fg={c.status === 'rejected' ? 'error' : c.status === 'pending_verification' ? 'warning' : 'success'}
                      />
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          )}

          <SectionHeader icon={'📍'} title={t('mgr.person.visitsTitle')} />
          {detail.data!.visits.length === 0 ? <EmptyState icon={'📍'} title={t('mgr.person.noVisits')} /> : (
            <View style={{ gap: 6 }}>
              {detail.data!.visits.map((v) => (
                <Card key={v.id} radius={12} padding={10}>
                  <Text size={12} weight={700}>{v.prospect_name ?? t('mgr.person.customerVisit')}</Text>
                  <Text size={11} color="textMuted">{`${t(`sf.outcome.${v.outcome}`)} • ${formatDate(v.visited_at)} ${formatTime(v.visited_at)}${v.gps_missing ? ` • ${t('sf.visits.gpsMissing')}` : ''}`}</Text>
                </Card>
              ))}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
