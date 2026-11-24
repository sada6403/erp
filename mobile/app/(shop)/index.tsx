import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';
import type { ProductListItemDto } from '@contracts/catalog';
import { useTheme } from '@/theme';
import { CategoryPills, FlashDealsHeader, ProductGrid, SearchBox, SmartBuyPromo } from '@/features/shop/ShopParts';
import { FeaturedRail, NewArrivalsRail } from '@/features/shop/HomeRails';
import { BannerCarousel } from '@/features/banners/BannerCarousel';
import { useHomeLayout, useProducts } from '@/features/shop/hooks';
import { activeDeals } from '@/features/shop/deals';
import { useWatermark } from '@/features/common/hooks';
import { qk } from '@/query/keys';

/**
 * Shop home. The search box is always first; the other sections follow the order and on/off switches the shop owner sets
 * in the POS (App Control > Home page). Sections before "flash deals" sit above the product grid, the rest below it.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const listRef = useRef<FlashListRef<ProductListItemDto>>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const sections = useHomeLayout();
  const { items, isLoading, isError, refetch } = useProducts({ q, categoryId: cat });
  const { endsAt } = activeDeals(items);
  useWatermark({
    catalog: [qk.catalog.products],
    categories: [qk.catalog.categories],
    banners: [qk.catalog.banners],
    company: [qk.company],
  });

  const render = (key: string): React.ReactNode => {
    switch (key) {
      case 'banners':
        return <BannerCarousel key={key} />;
      case 'categories':
        return (
          <View key={key} style={{ backgroundColor: theme.colors.surface, marginHorizontal: -10, paddingHorizontal: 16, paddingBottom: 12 }}>
            <CategoryPills selected={cat} onSelect={setCat} />
          </View>
        );
      case 'flash_deals':
        return endsAt ? <FlashDealsHeader key={key} endsAt={endsAt} /> : null;
      case 'smartbuy_promo':
        return <SmartBuyPromo key={key} />;
      case 'new_arrivals':
        return <NewArrivalsRail key={key} items={items} />;
      case 'featured':
        return <FeaturedRail key={key} items={items} />;
      default:
        return null;
    }
  };
  const enabled = sections.filter((s) => s.enabled);
  const split = enabled.findIndex((s) => s.key === 'flash_deals');
  const above = split === -1 ? enabled : enabled.slice(0, split + 1);
  const below = split === -1 ? [] : enabled.slice(split + 1);

  const header = (
    <View>
      <View>
        <View style={{ backgroundColor: theme.colors.surface, marginHorizontal: -10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
          <SearchBox value={q} onChange={setQ} />
        </View>
        {above.filter((s) => s.key !== 'flash_deals').map((s) => render(s.key))}
      </View>
      {above.some((s) => s.key === 'flash_deals') ? render('flash_deals') : null}
    </View>
  );
  const footer = <View>{below.map((s) => render(s.key))}</View>;
  return <ProductGrid listRef={listRef} items={items} loading={isLoading} error={isError} onRetry={refetch} header={header} footer={footer} />;
}
