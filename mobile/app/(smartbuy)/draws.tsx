import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { EmptyState, ErrorState, Pill, ScreenHeading, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatDate } from '@/lib/format';
import { useDraws, useMySchemes } from '@/features/smartbuy/hooks';

/** Monthly draw results. Winner names of other members arrive masked from the server. Video is a later update. */
export default function DrawsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const schemes = useMySchemes();
  const [picked, setPicked] = useState<string | null>(null);
  const schemeId = picked ?? schemes.data?.items[0]?.scheme_id;
  const draws = useDraws(schemeId);
  return (
    <Screen>
      <ScreenHeading title={t('draws.title')} sub={t('draws.sub')} />
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
      ) : (draws.data?.items ?? []).length === 0 ? (
        <EmptyState icon="🏆" title={t('draws.empty')} />
      ) : (
        draws.data!.items.map((d) => (
          <View key={d.id} style={{ padding: 14, borderRadius: radii.card, borderWidth: 1, borderColor: d.is_me ? theme.colors.goldBorder : theme.colors.surfaceBorder, backgroundColor: d.is_me ? theme.colors.goldBg : theme.colors.surface }}>
            <Text size={11} weight={700} color="textMuted">{t('draws.cycle', { n: d.cycle_no })} · {formatDate(d.draw_date)}</Text>
            <Text size={15} weight={800} style={{ marginTop: 4 }}>🏆 {d.winner_label ?? t('draws.pending')}</Text>
            {d.is_me ? <Text size={12} weight={800} color="goldText">{t('draws.youWon')}</Text> : null}
            <Button label={`🎬 ${t('draws.watch')}`} variant="drawVideo" style={{ marginTop: 10 }} onPress={() => router.push({ pathname: '/draw-video/[id]', params: { id: d.id } })} />
          </View>
        ))
      )}
    </Screen>
  );
}
