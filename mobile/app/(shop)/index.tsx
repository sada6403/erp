import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';
import type { ProductListItemDto } from '@contracts/catalog';
import { useTheme } from '@/theme';
import { FlashDealsHeader, HeroBanner, ProductGrid, SearchSection, SmartBuyPromo } from '@/features/shop/ShopParts';
import { useProducts } from '@/features/shop/hooks';
import { useWatermark } from '@/features/common/hooks';
import { qk } from '@/query/keys';

/** Shop home: search + category pills, hero banner, flash deals (always-on countdown), Smart Buy promo. */
export default function HomeScreen() {
  const theme = useTheme();
  const listRef = useRef<FlashListRef<ProductListItemDto>>(null);
  const [aboveDeals, setAboveDeals] = useState(0);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const { items, isLoading, isError, refetch } = useProducts({ q, categoryId: cat });
  useWatermark({ catalog: [qk.catalog.products], categories: [qk.catalog.categories], banners: [qk.catalog.banners], company: [qk.company] });

  const header = (
    <View>
      <View onLayout={(e) => setAboveDeals(e.nativeEvent.layout.height)}>
        <View style={{ backgroundColor: theme.colors.surface, marginHorizontal: -10 }}>
          <SearchSection value={q} onChange={setQ} selected={cat} onSelect={setCat} />
        </View>
        <HeroBanner onExplore={() => listRef.current?.scrollToOffset({ offset: aboveDeals, animated: true })} />
      </View>
      <FlashDealsHeader />
    </View>
  );
  return <ProductGrid listRef={listRef} items={items} loading={isLoading} error={isError} onRetry={refetch} header={header} footer={<SmartBuyPromo />} />;
}
