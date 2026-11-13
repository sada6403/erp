import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { VisitDto, VisitOutcome } from '@contracts/staff';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Shell';
import { Text } from '@/components/Text';
import { Badge, Card, EmptyState, ErrorState, Field, Pill, SectionHeader, SkeletonList } from '@/components/ui';
import { useIsStaff, useLogVisit, useVisitReport, useVisitsToday } from '@/features/staff/hooks';
import { thisMonth } from '@/features/agent/month';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatTime } from '@/lib/format';
import { useUiStore } from '@/store/uiStore';

const OUTCOMES: VisitOutcome[] = ['purchased', 'not_interested', 'come_back', 'not_at_home', 'already_member'];
const FOLLOW: { days: number; key: string }[] = [{ days: 1, key: 'tomorrow' }, { days: 3, key: 'in3' }, { days: 7, key: 'week' }];
const DAY = 24 * 3600 * 1000;

/** Field visits: log a visit (GPS + outcome, works offline), today's visits and follow-ups due; managers also see their team's visit report. */
export default function VisitsScreen() {
  const { t } = useTranslation();
  const showToast = useUiStore((s) => s.showToast);
  const today = useVisitsToday();
  const isStaff = useIsStaff();
  const report = useVisitReport(thisMonth(), isStaff);
  const log = useLogVisit();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');
  const [phone, setPhone] = useState('');
  const [outcome, setOutcome] = useState<VisitOutcome>('purchased');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setWho(''); setPhone(''); setOutcome('purchased'); setReason(''); setDays(null); setNotes(''); };

  const save = async () => {
    if (who.trim().length < 2) return showToast(t('sf.visits.needWho'));
    if (outcome === 'not_interested' && reason.trim().length < 2) return showToast(t('sf.visits.needReason'));
    if (outcome === 'come_back' && days == null) return showToast(t('sf.visits.needFollow'));
    setBusy(true);
    try {
      const out = await log({
        prospect_name: who.trim(), ...(phone.trim() ? { prospect_phone: phone.trim() } : {}), outcome,
        ...(outcome === 'not_interested' ? { reason: reason.trim() } : {}),
        ...(outcome === 'come_back' && days != null ? { follow_up_at: new Date(Date.now() + days * DAY).toISOString() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      showToast(out.result === 'queued' ? t('sf.visits.queued') : out.gps ? t('sf.visits.saved') : t('sf.visits.savedNoGps'));
      reset();
      setOpen(false);
    } catch (e) {
      showToast(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const row = (v: VisitDto, showFollow = false) => (
    <Card key={v.id} radius={14} padding={12}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text size={13} weight={700} style={{ flex: 1 }}>{v.prospect_name ?? '—'}</Text>
        {v.gps_missing ? <Badge label={t('sf.visits.gpsMissing')} bg="warningBg" fg="warning" /> : null}
      </View>
      <Text size={11} color="textMuted">
        {`${t(`sf.outcome.${v.outcome}`)} • ${showFollow && v.follow_up_at ? `${t('sf.visits.followOn')} ${formatDate(v.follow_up_at)}` : formatTime(v.visited_at)}`}
      </Text>
      {v.notes ? <Text size={11} color="textMuted" style={{ marginTop: 2 }}>{v.notes}</Text> : null}
    </Card>
  );

  return (
    <Screen onRefresh={() => { void today.refetch(); if (isStaff) void report.refetch(); }} refreshing={today.isRefetching}>
      <View>
        <Text size={18} weight={800}>{t('sf.visits.title')}</Text>
        <Text size={12} color="textMuted" style={{ marginTop: 3 }}>{t('sf.visits.gpsNote')}</Text>
      </View>

      {!open ? (
        <Button label={t('sf.visits.log')} variant="primaryBlock" fullWidth onPress={() => setOpen(true)} />
      ) : (
        <Card radius={16} padding={16}>
          <Field label={t('sf.visits.who')} value={who} onChangeText={setWho} maxLength={255} />
          <Field label={t('sf.visits.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} />
          <Text size={11} weight={700} color="textMuted" style={{ marginBottom: 6 }}>{t('sf.visits.outcome')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {OUTCOMES.map((o) => <Pill key={o} label={t(`sf.outcome.${o}`)} active={outcome === o} onPress={() => setOutcome(o)} />)}
          </View>
          {outcome === 'not_interested' ? <Field label={t('sf.visits.reason')} value={reason} onChangeText={setReason} maxLength={300} /> : null}
          {outcome === 'come_back' ? (
            <View style={{ marginBottom: 12 }}>
              <Text size={11} weight={700} color="textMuted" style={{ marginBottom: 6 }}>{t('sf.visits.followUp')}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {FOLLOW.map((f) => <Pill key={f.days} label={t(`sf.visits.${f.key}`)} active={days === f.days} onPress={() => setDays(f.days)} />)}
              </View>
            </View>
          ) : null}
          <Field label={t('sf.visits.notes')} value={notes} onChangeText={setNotes} maxLength={1000} />
          <View style={{ gap: 8 }}>
            <Button label={t('sf.visits.save')} variant="primaryBlock" fullWidth loading={busy} onPress={save} />
            <Button label={t('common.cancel')} variant="secondaryBlock" fullWidth onPress={() => { reset(); setOpen(false); }} />
          </View>
        </Card>
      )}

      {today.isLoading ? <SkeletonList rows={2} height={64} /> : today.isError ? <ErrorState onRetry={() => today.refetch()} /> : (
        <>
          {(today.data?.follow_ups.length ?? 0) > 0 ? (
            <View style={{ gap: 8 }}>
              <SectionHeader icon={'⏰'} title={t('sf.visits.followUps')} />
              {today.data?.follow_ups.map((v) => row(v, true))}
            </View>
          ) : null}
          <SectionHeader icon={'📍'} title={t('sf.visits.today')} />
          {(today.data?.visits.length ?? 0) === 0 ? <EmptyState icon={'📍'} title={t('sf.visits.none')} /> : (
            <View style={{ gap: 8 }}>{today.data?.visits.map((v) => row(v))}</View>
          )}
        </>
      )}

      {isStaff && (report.data?.items.length ?? 0) > 1 ? (
        <View style={{ gap: 8 }}>
          <SectionHeader icon={'👥'} title={t('sf.visits.report')} />
          {report.data?.items.map((r) => (
            <Card key={r.staff_id} radius={14} padding={12}>
              <Text size={13} weight={700}>{r.name}</Text>
              <Text size={11} color="textMuted">{t('sf.visits.reportRow', { total: r.total, bought: r.purchased, gps: r.gps_missing, done: r.follow_ups_done, due: r.follow_ups_due })}</Text>
            </Card>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
