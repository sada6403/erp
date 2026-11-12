import React, { useMemo } from 'react';
import { FlashDealsHeader, ProductGrid } from '@/features/shop/ShopParts';
import { useProducts } from '@/features/shop/hooks';
import { activeDeals } from '@/features/shop/deals';

/** Flash deals = discounted products with an active dated POS discount; the countdown is the earliest real end date. */
export default function FlashDealsScreen() {
  const { items, isLoading, isError, refetch } = useProducts({});
  const { deals, endsAt } = useMemo(() => activeDeals(items), [items]);
  return <ProductGrid items={deals} loading={isLoading} error={isError} onRetry={refetch} header={endsAt ? <FlashDealsHeader endsAt={endsAt} /> : undefined} />;
}
