import React from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Badge, Card, EmptyState, ErrorState, ScreenHeading, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { selectIsLoggedIn, useSessionStore } from '@/store/sessionStore';
import { formatRs } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { useOrders } from '@/features/shop/hooks';
import { stageTone } from '@/features/shop/stageTone';

/** My Orders: server list (cached for offline). */
export default function OrdersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const loggedIn = useSessionStore(selectIsLoggedIn);
  const { data, isLoading, isError, refetch, isRefetching } = useOrders();
  if (!loggedIn) return <Redirect href="/login" />;
  return (
    <Screen onRefresh={refetch} refreshing={isRefetching}>
      <ScreenHeading title={t('orders.title')} sub={t('orders.sub')} />
      {isLoading ? (
        <SkeletonList rows={4} />
      ) : isError && !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (data?.items ?? []).length === 0 ? (
        <EmptyState icon="📦" title={t('orders.empty')} actionLabel={t('cart.startShopping')} onAction={() => router.navigate('/')} />
      ) : (
        data!.items.map((o) => {
          const tone = stageTone(o.stage);
          return (
            <Card key={o.id} onPress={() => router.push({ pathname: '/orders/[id]', params: { id: o.id } })} accessibilityLabel={`${t('orders.order')} ${o.order_number}`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text size={13} weight={800} mono>{o.order_number}</Text>
                <Badge label={t(`orders.stage.${o.stage}`)} bg={tone.bg} fg={tone.fg} />
              </View>
              <Text size={11} color="textMuted" style={{ marginTop: 4 }}>{formatDate(o.created_at)} · {t('orders.items', { count: o.item_count })}</Text>
              <Text size={14} weight={800} color="primary" style={{ marginTop: 4 }}>{formatRs(o.total_amount)}</Text>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
