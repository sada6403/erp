import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { MySchemeDto } from '@contracts/smartbuy';
import { Gradient } from '@/components/Gradient';
import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui';
import { formatRs } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { fontScale, lineHeights, makeStyles, radii, useTheme } from '@/theme';
import { useMySchemes, useWallet } from './hooks';

const useStyles = makeStyles((t) => ({
  hero: { backgroundColor: t.colors.surface, borderRadius: radii.hero, padding: 18, borderWidth: 1, borderColor: t.colors.surfaceBorder },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  badge: { backgroundColor: t.colors.successBg, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  cyclePill: { backgroundColor: t.colors.container, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
  progressWrap: { marginTop: 14, marginBottom: 10 },
  progressInfo: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, gap: 8 },
  track: { height: 8, backgroundColor: t.colors.slate200, borderRadius: radii.sm, overflow: 'hidden' },
  dates: { flexDirection: 'row', backgroundColor: t.colors.surfaceSubtle, borderRadius: radii.input, padding: 12, gap: 8 },
  dateItem: { flex: 1 },
  quick: { flexDirection: 'row', gap: 12 },
  box: { flex: 1, backgroundColor: t.colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: t.colors.surfaceBorder, padding: 14 },
}));

function HeroCard({ s }: { s: MySchemeDto }) {
  const { t } = useTranslation();
  const st = useStyles();
  const theme = useTheme();
  const pct = s.cycle_count ? Math.max(0, Math.min(100, (s.cycles_paid / s.cycle_count) * 100)) : 0;
  return (
    <View style={st.hero}>
      <View style={st.top}>
        <View style={st.badge}>
          <Text size={fontScale.s11} weight={800} color="success">{`● ${s.badge.toUpperCase()}`}</Text>
        </View>
        <View style={st.cyclePill}>
          <Text size={fontScale.s11} weight={700} color="primary">{t('schemes.cycleOf', { paid: s.cycles_paid, total: s.cycle_count })}</Text>
        </View>
      </View>
      <Text size={fontScale.s16} weight={800} lineHeightRatio={lineHeights.body}>{s.name}</Text>
      <Text size={fontScale.s12} color="textMuted" style={{ marginTop: 4 }}>
        {s.scheme_number ? t('schemes.idPrefix', { id: s.scheme_number }) : ''}
        {t('schemes.contributionLabel', { freq: t(`frequency.${s.frequency}`) })}
        <Text size={fontScale.s12} weight={700} color="textMain">{formatRs(s.contribution_amount)}</Text>
      </Text>
      <View style={st.progressWrap}>
        <View style={st.progressInfo}>
          <Text size={fontScale.s11} weight={700} color="textMuted" style={{ flexShrink: 1 }}>
            {t('schemes.contributionsPaid', { n: s.cycles_paid, amount: formatRs(s.contributions_paid) })}
          </Text>
          <Text size={fontScale.s11} weight={700} color="textMuted">{t('schemes.target', { amount: formatRs(s.chit_value) })}</Text>
        </View>
        <View style={st.track}>
          <Gradient direction="horizontal" from={theme.colors.primary} to={theme.colors.accent} style={{ width: `${pct}%`, height: '100%' }} />
        </View>
      </View>
      <View style={st.dates}>
        <View style={st.dateItem}>
          <Text size={fontScale.s11} color="textMuted" style={{ marginBottom: 2 }}>{t('schemes.lastContribution')}</Text>
          <Text size={fontScale.s11} weight={700}>
            {s.cycles_paid > 0 ? t('schemes.paidTick', { amount: formatRs(s.contribution_amount) }) : '—'}
          </Text>
        </View>
        <View style={st.dateItem}>
          <Text size={fontScale.s11} color="textMuted" style={{ marginBottom: 2 }}>{t('schemes.nextDrawLabel')}</Text>
          <Text size={fontScale.s11} weight={700} color="primary">{s.next_draw_date ? formatDate(s.next_draw_date) : '—'}</Text>
        </View>
      </View>
    </View>
  );
}

function ActionBox({ icon, title, sub, onPress }: { icon: string; title: string; sub: string; onPress: () => void }) {
  const st = useStyles();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`} onPress={onPress} style={st.box}>
      <Text size={fontScale.s26} style={{ marginBottom: 6 }}>{icon}</Text>
      <Text size={fontScale.s13} weight={800}>{title}</Text>
      <Text size={fontScale.s11} color="textMuted" style={{ marginTop: 2 }}>{sub}</Text>
    </Pressable>
  );
}

/** My Schemes hub (demo view-smartbuy-schemes). Children are siblings inside a Screen (gap 14, padding 16). */
export function SchemesView() {
  const { t } = useTranslation();
  const router = useRouter();
  const st = useStyles();
  const { data, isLoading, isError, refetch } = useMySchemes();
  const wallet = useWallet();
  const items = data?.items ?? [];
  if (isLoading) return <SkeletonList rows={3} height={150} />;
  if (isError && !data) return <ErrorState onRetry={() => refetch()} />;
  if (items.length === 0) {
    return <EmptyState icon="💎" title={t('schemes.empty')} body={t('schemes.emptyBody')} actionLabel={t('schemes.apply')} onAction={() => router.push('/join')} />;
  }
  return (
    <>
      {items.map((s) => (
        <HeroCard key={s.member_id} s={s} />
      ))}
      <View style={st.quick}>
        <ActionBox icon="🏆" title={t('schemes.tileDraws')} sub={t('schemes.tileDrawsSub')} onPress={() => router.navigate('/draws')} />
        <ActionBox
          icon="💰"
          title={t('schemes.tileWallet')}
          sub={wallet.data ? t('schemes.tileWalletSub', { amount: formatRs(wallet.data.balance) }) : t('schemes.tileWalletFallback')}
          onPress={() => router.navigate('/wallet')}
        />
      </View>
      <Button label={t('schemes.apply')} variant="secondaryBlock" onPress={() => router.push('/join')} />
      {items.length > 0 ? (
        <Button label={t('schemes.statement')} variant="link" onPress={() => router.push({ pathname: '/statement', params: { id: items[0].scheme_id } })} />
      ) : null}
    </>
  );
}
