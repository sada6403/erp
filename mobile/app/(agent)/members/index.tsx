import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { radii, useTheme } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Card, EmptyState, ErrorState, Field, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatRs } from '@/lib/money';
import { formatDate, formatTime } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useUiStore } from '@/store/uiStore';
import { useOutboxStore } from '@/store/outboxStore';
import { useCollectionStore, type LocalReceipt } from '@/store/collectionStore';
import { useAgentMembers } from '@/features/agent/hooks';
import { ReceiptModal } from '@/features/agent/components';
import { buildCollectionText } from '@/features/agent/receipt';
import { useCollectionsToday, useLogCollection } from '@/features/collections/hooks';
import { useCompany } from '@/features/common/hooks';
import type { MemberView } from '@/features/agent/types';

const cleanName = (n: string) => n.replace(/\s*\(Member[^)]*\)\s*$/i, '');
const money2 = (n: number) => Math.round(n * 100) / 100;

/** Assigned Scheme Members with this cycle's due, and cash collection (works offline; the branch verifies it in the POS). */
export default function MembersScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const showToast = useUiStore((s) => s.showToast);
  const company = useCompany();
  const { data, isLoading, isError, refetch, isRefetching } = useAgentMembers();
  const today = useCollectionsToday();
  const log = useLogCollection();
  const receipts = useCollectionStore((s) => s.receipts);
  const waiting = useOutboxStore((s) => s.items.filter((i) => i.type === 'collection').length);
  const [open, setOpen] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<LocalReceipt | null>(null);
  const items = data?.items ?? [];

  // Receipts taken on this phone today that the server list does not hold yet (offline) are shown too.
  const serverIds = useMemo(() => new Set((today.data?.items ?? []).map((i) => i.id)), [today.data]);
  const localOnly = useMemo(() => receipts.filter((r) => !serverIds.has(r.id) && r.status === 'queued'), [receipts, serverIds]);
  const summary = today.data?.summary;

  const tag = (m: MemberView) => {
    const c = m.collection;
    if (!c) return { label: m.status, ok: !/due|overdue|pending/i.test(m.status) };
    if (c.pending_amount > 0 && c.collectable <= 0) return { label: t('collect.tagPending'), ok: false };
    if (c.balance_due <= 0.009) return { label: t('collect.tagPaid'), ok: true };
    return { label: t('collect.tagDue', { n: c.cycle_no }), ok: false };
  };

  const start = (m: MemberView) => {
    setOpen(m.member_id);
    setAmount(m.collection ? String(m.collection.collectable) : '');
  };

  const save = async (m: MemberView) => {
    const c = m.collection;
    if (!c) return;
    const n = money2(Number(amount));
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) return showToast(t('collect.badAmount'));
    if (n > c.collectable + 0.009) return showToast(t('collect.tooMuch', { max: formatRs(c.collectable, { decimals: 2 }) }));
    setBusy(true);
    try {
      const out = await log({ memberId: m.member_id, customerName: cleanName(m.customer_name), schemeName: m.scheme_name, due: c, amount: n });
      setOpen(null);
      setAmount('');
      setShown(out.receipt);
      showToast(out.result === 'queued' ? t('collect.queuedToast', { no: out.receipt.receipt_number }) : t('collect.savedToast', { no: out.receipt.receipt_number }));
    } catch (e) {
      showToast(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const row = (label: string, value: string, warn = false) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
      <Text size={11} color="textMuted">{label}</Text>
      <Text size={11} weight={700} color={warn ? 'warning' : undefined}>{value}</Text>
    </View>
  );

  return (
    <Screen onRefresh={() => { void refetch(); void today.refetch(); }} refreshing={isRefetching}>
      <View>
        <Text size={18} weight={800}>{t('members.title')}</Text>
        <Text size={12} color="textMuted" style={{ marginTop: 3, marginBottom: 2 }}>{t('members.sub')}</Text>
      </View>
      <Button label={t('joinReq.add')} icon={'➕'} variant="primaryBlock" fullWidth onPress={() => router.push('/add-member')} />

      <Card radius={16} padding={14}>
        <Text size={11} weight={700} color="textMuted">{t('collect.todayTitle')}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
          <View><Text size={20} weight={800} color="primary">{formatRs(summary?.total ?? 0, { decimals: 2 })}</Text><Text size={10} color="textMuted">{t('collect.receiptsN', { n: summary?.count ?? 0 })}</Text></View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text size={12} weight={700}>{`${t('collect.cashInHand')}: ${formatRs(summary?.cash_in_hand ?? 0, { decimals: 2 })}`}</Text>
            <Text size={11} color="textMuted">{`${t('collect.waitingBranch')}: ${formatRs(summary?.pending_remittance ?? 0, { decimals: 2 })}`}</Text>
          </View>
        </View>
        {waiting > 0 ? <Text size={11} weight={700} color="warning" style={{ marginTop: 6 }}>{t('collect.unsent', { n: waiting })}</Text> : null}
        {(today.data?.items.length ?? 0) + localOnly.length > 0 ? (
          <View style={{ marginTop: 8, gap: 6 }}>
            {localOnly.map((r) => (
              <Text key={r.id} size={11} color="textMuted" onPress={() => setShown(r)}>{`${formatTime(r.collected_at)} • ${r.customer_name} • ${formatRs(r.amount, { decimals: 2 })} • ${t('collect.tagQueued')}`}</Text>
            ))}
            {(today.data?.items ?? []).slice(0, 8).map((i) => (
              <Text key={i.id} size={11} color="textMuted" onPress={() => setShown({ ...i, scheme_number: null, agent_code: i.agent_code ?? '', agent_name: i.agent_name ?? '', company_name: company?.name ?? '', branch_name: null, status: i.status })}>
                {`${formatTime(i.collected_at)} • ${i.customer_name} • ${formatRs(i.amount, { decimals: 2 })} • ${t(`collect.status.${i.status}`)}`}
              </Text>
            ))}
          </View>
        ) : null}
      </Card>

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
            const c = m.collection;
            const phone = m.phone_masked?.replace(' - ', ' • ');
            return (
              <View key={m.member_id} style={{ backgroundColor: theme.colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: theme.colors.surfaceBorder, padding: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <Text size={13} weight={700} style={{ flex: 1 }}>{m.customer_name}</Text>
                  <View style={{ backgroundColor: tg.ok ? theme.colors.successBg : theme.colors.warningBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.sm }}>
                    <Text size={10} weight={800} color={tg.ok ? 'success' : 'warning'}>{tg.label}</Text>
                  </View>
                </View>
                <Text size={11} color="textMuted" style={{ marginVertical: 2 }}>{`${m.scheme_name} • ${t('schemes.paid')} ${formatRs(m.contributions_paid)}`}</Text>
                {phone ? <Text size={11} weight={600} color="primary">{`📞 ${phone}`}</Text> : null}
                {m.won_cycle_no ? <Text size={11} weight={700} color="goldText">{`🎉 ${t('schemes.won', { cycle: m.won_cycle_no })}`}</Text> : null}
                {c ? (
                  <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: theme.colors.surfaceBorder }}>
                    {row(t('collect.cycleDue', { n: c.cycle_no }), `${formatRs(c.installment_amount)} • ${formatDate(c.due_date)}`)}
                    {row(t('collect.balance'), formatRs(c.balance_due, { decimals: 2 }))}
                    {c.pending_amount > 0 ? row(t('collect.pendingVerify'), formatRs(c.pending_amount, { decimals: 2 })) : null}
                    {c.late_fee > 0 ? row(t('collect.lateFee'), formatRs(c.late_fee, { decimals: 2 }), true) : null}
                    {c.arrears > 0 ? row(t('collect.arrears'), formatRs(c.arrears, { decimals: 2 }), true) : null}
                    {row(t('collect.lastPayment'), c.last_payment_at ? `${formatRs(c.last_payment_amount ?? 0, { decimals: 2 })} • ${formatDate(c.last_payment_at)}` : t('collect.none'))}
                  </View>
                ) : null}
                {c && c.collectable > 0 && open !== m.member_id ? (
                  <Button label={t('collect.collect')} icon={'💵'} variant="primarySm" fullWidth onPress={() => start(m)} style={{ marginTop: 8 }} />
                ) : null}
                {c && open === m.member_id ? (
                  <View style={{ marginTop: 10 }}>
                    <Field label={`${t('collect.amount')} (${t('collect.upTo', { max: formatRs(c.collectable, { decimals: 2 }) })})`} value={amount} onChangeText={setAmount} keyboardType="numeric" maxLength={10} />
                    <View style={{ gap: 8 }}>
                      <Button label={t('collect.saveShow')} variant="primaryBlock" fullWidth loading={busy} onPress={() => save(m)} />
                      <Button label={t('common.cancel')} variant="secondaryBlock" fullWidth onPress={() => setOpen(null)} />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      <ReceiptModal visible={!!shown} text={shown ? buildCollectionText(shown, company) : ''} onClose={() => setShown(null)} />
    </Screen>
  );
}
