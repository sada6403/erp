import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { DrawDto } from '@contracts/smartbuy';
import { Button } from '@/components/Button';
import { Gradient } from '@/components/Gradient';
import { Text } from '@/components/Text';
import { EmptyState, ErrorState, Pill, SkeletonList } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { formatRs } from '@/lib/money';
import { fontScale, lineHeights, makeStyles, radii, useTheme } from '@/theme';
import { DRAW_AVATARS, SB_DEMO, drawExtras, monthName } from './demo';
import { useDraws, useMySchemes } from './hooks';

const useStyles = makeStyles((t) => ({
  card: { borderRadius: radii.hero, overflow: 'hidden', borderWidth: 1, borderColor: t.colors.goldBorder },
  secondary: { backgroundColor: t.colors.surface, borderColor: t.colors.surfaceBorder },
  inner: { padding: 16 },
  details: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  cta: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderStyle: 'dashed', borderColor: t.colors.dividerDashed },
}));

function DrawCard({ d, index }: { d: DrawDto; index: number }) {
  const { t } = useTranslation();
  const st = useStyles();
  const theme = useTheme();
  const router = useRouter();
  const x = drawExtras(d);
  const latest = index === 0;
  const month = monthName(d.draw_date).toUpperCase();
  const badge = x.badge ?? (latest ? t('draws.badgeLatest', { month, n: d.cycle_no }) : t('draws.badgeOther', { month, n: d.cycle_no }));
  const body = (
    <View style={st.inner}>
      <Text size={fontScale.s10} weight={800} color="goldText" style={{ marginBottom: 8 }}>{badge}</Text>
      <View style={st.details}>
        <Text size={fontScale.s34}>{x.avatar ?? DRAW_AVATARS[index] ?? '🏅'}</Text>
        <View style={{ flex: 1 }}>
          <Text size={fontScale.s14} weight={800} color="goldDark">{t('draws.winner', { name: d.winner_label ?? t('draws.pending') })}</Text>
          {x.prize ? (
            <Text size={fontScale.s12} weight={600} color="goldMid" style={{ marginTop: 2 }}>
              {t('draws.prize', { prize: x.prize, value: formatRs(x.prize_value ?? 0) })}
            </Text>
          ) : null}
          <Text size={fontScale.s10} color="goldText" style={{ marginTop: 4 }}>{x.note ?? t('draws.conducted', { date: formatDate(d.draw_date) })}</Text>
          {d.is_me ? <Text size={fontScale.s12} weight={800} color="goldText" style={{ marginTop: 4 }}>{t('draws.youWon')}</Text> : null}
        </View>
      </View>
      {latest ? (
        <View style={st.cta}>
          <Text size={fontScale.s10} color="goldDark" lineHeightRatio={lineHeights.copy} style={{ marginBottom: 8, fontStyle: 'italic' }}>
            {`🔒 ${t('draws.secureNote')}`}
          </Text>
          <Button
            label={`▶ ${t('draws.watch')}`}
            variant="drawVideo"
            disabled={!SB_DEMO}
            onPress={() => router.push({ pathname: '/draw-video/[id]', params: { id: d.id } })}
          />
          {!SB_DEMO ? <Text size={fontScale.s11} weight={800} color="goldText" align="center" style={{ marginTop: 6 }}>{t('soon.badge')}</Text> : null}
        </View>
      ) : null}
    </View>
  );
  if (!latest) return <View style={[st.card, st.secondary]}>{body}</View>;
  return (
    <View style={st.card}>
      <Gradient direction="diagonal" from={theme.colors.goldBg} to={theme.colors.goldBg2}>
        {body}
      </Gradient>
    </View>
  );
}

/** Monthly draws (demo view-smartbuy-draws). Siblings inside a Screen (gap 14, padding 16). */
export function DrawsView() {
  const { t } = useTranslation();
  const schemes = useMySchemes();
  const [picked, setPicked] = useState<string | null>(null);
  const schemeId = picked ?? schemes.data?.items[0]?.scheme_id;
  const draws = useDraws(schemeId);
  const items = draws.data?.items ?? [];
  return (
    <>
      <Text size={fontScale.s18} weight={800}>{t('draws.title')}</Text>
      <Text size={fontScale.s12} color="textMuted" style={{ marginTop: 3, marginBottom: 16 }}>{t('draws.sub')}</Text>
      {(schemes.data?.items.length ?? 0) > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {schemes.data!.items.map((s) => (
            <Pill key={s.scheme_id} label={s.name} active={s.scheme_id === schemeId} onPress={() => setPicked(s.scheme_id)} />
          ))}
        </View>
      ) : null}
      {schemes.isLoading || draws.isLoading ? (
        <SkeletonList rows={3} height={110} />
      ) : draws.isError ? (
        <ErrorState onRetry={() => draws.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="🏆" title={t('draws.empty')} />
      ) : (
        items.map((d, i) => <DrawCard key={d.id} d={d} index={i} />)
      )}
    </>
  );
}
