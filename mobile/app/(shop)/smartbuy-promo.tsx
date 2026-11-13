import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Card, EmptyState, ScreenHeading, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { useOpenSchemes } from '@/features/smartbuy/hooks';
import { formatRs } from '@/lib/money';
import { useModules } from '@/features/common/hooks';

/** Smart Buy promo: open schemes (public, read-only). Joining arrives in the next update. */
export default function SmartBuyPromoScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const modules = useModules();
  const { data, isLoading } = useOpenSchemes();
  return (
    <Screen>
      <ScreenHeading title={t('promo.title')} sub={t('promo.body')} />
      {modules.smartbuy ? <Button label={t('joinReq.myRequestsTitle')} variant="link" onPress={() => router.push('/join-requests')} /> : null}
      {!modules.smartbuy ? (
        <EmptyState icon="💎" title={t('promo.unavailable')} />
      ) : isLoading ? (
        <SkeletonList />
      ) : (data?.items ?? []).length === 0 ? (
        <EmptyState icon="💎" title={t('promo.noSchemes')} />
      ) : (
        data!.items.map((s) => (
          <Card key={s.id}>
            <Text size={15} weight={800}>{s.name}</Text>
            <Text size={12} color="textMuted" style={{ marginTop: 4 }}>
              {t(`frequency.${s.frequency}`)} · {formatRs(s.contribution_amount)} · {t('promo.cycles', { count: s.cycle_count })}
            </Text>
            <View style={{ marginTop: 10 }}>
              <Button label={t('join.title')} variant="secondaryBlock" onPress={() => router.push('/join')} />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
