import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { radii, useTheme } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { formatRs } from '@/lib/money';
import { useDeliveries } from '@/features/agent/hooks';

/** Print Bill: pick a delivery to preview its thermal receipt. */
export default function BillListScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { items, isLoading, isError, refetch } = useDeliveries();
  return (
    <Screen onRefresh={refetch}>
      <View>
        <Text size={18} weight={800}>{t('bill.title')}</Text>
        <Text size={12} color="textMuted" style={{ marginTop: 3 }}>{t('bill.sub')}</Text>
      </View>
      {isLoading ? (
        <SkeletonList rows={3} />
      ) : isError && items.length === 0 ? (
        <ErrorState onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={'🖨️'} title={t('agent.noDeliveries')} />
      ) : (
        <View style={{ gap: 12 }}>
          {items.map((i) => (
            <View key={i.id} style={{ backgroundColor: theme.colors.surface, borderRadius: radii.card, borderWidth: 1, borderColor: theme.colors.surfaceBorder, padding: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <View style={{ backgroundColor: theme.colors.fill, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radii.sm }}>
                  <Text size={11} weight={800}>{t('agent.orderNo', { id: i.order_number })}</Text>
                </View>
                <Text size={11} weight={800} color="error">{i.collect_cash ? formatRs(i.amount_due) : t('agent.prepaid')}</Text>
              </View>
              <Text size={13} weight={700} style={{ marginBottom: 10 }}>{i.customer_name}</Text>
              <Button label={t('agent.escBill')} icon={'📄'} variant="printBill" fullWidth onPress={() => router.push({ pathname: '/bill/[id]', params: { id: i.id } })} />
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
