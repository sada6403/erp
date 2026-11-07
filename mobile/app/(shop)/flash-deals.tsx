import React, { useMemo } from 'react';
import { FlashDealsHeader, ProductGrid } from '@/features/shop/ShopParts';
import { useProducts } from '@/features/shop/hooks';

/** Flash deals = products with a discount, sorted by the biggest saving. */
export default function FlashDealsScreen() {
  const { items, isLoading, isError, refetch } = useProducts({});
  const deals = useMemo(() => items.filter((p) => p.discount_pct > 0).sort((a, b) => b.discount_pct - a.discount_pct), [items]);
  return <ProductGrid items={deals} loading={isLoading} error={isError} onRetry={refetch} header={<FlashDealsHeader />} />;
}
