import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SectionHeader } from '@/components/ui';
import { Countdown } from '@/components/Extras';
import { ProductGrid } from '@/features/shop/ShopParts';
import { useProducts } from '@/features/shop/hooks';

const DEV_ENDS_AT = Date.now() + (5 * 3600 + 42 * 60 + 18) * 1000;

/** Flash deals = products with a discount. The countdown only renders in dev (no server end time yet). */
export default function FlashDealsScreen() {
  const { t } = useTranslation();
  const { items, isLoading, isError, refetch } = useProducts({});
  const deals = useMemo(() => items.filter((p) => p.discount_pct > 0).sort((a, b) => b.discount_pct - a.discount_pct), [items]);
  const header = (
    <View style={{ padding: 16, paddingHorizontal: 6 }}>
      <SectionHeader icon="⚡" title={t('home.flashDeals')} right={__DEV__ ? <Countdown endsAt={DEV_ENDS_AT} /> : undefined} />
    </View>
  );
  return <ProductGrid items={deals} loading={isLoading} error={isError} onRetry={refetch} header={header} />;
}
