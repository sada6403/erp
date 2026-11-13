import React from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ProductListItemDto } from '@contracts/catalog';
import { Text } from '@/components/Text';
import { ProductCard } from '@/components/ProductCard';
import { useProductActions } from './ShopParts';
import { featuredItems, newArrivals } from './railItems';

/** Horizontal product rail; renders nothing when there is nothing to show. */
export function ProductRail({ title, items, testID }: { title: string; items: ProductListItemDto[]; testID?: string }) {
  const { ids, addToCart, like, open } = useProductActions();
  if (items.length === 0) return null;
  return (
    <View testID={testID} style={{ marginTop: 12 }}>
      <Text size={16} weight={800} style={{ paddingHorizontal: 16, marginBottom: 8 }}>
        {title}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 10, gap: 4 }}>
        {items.map((p) => (
          <View key={p.id} style={{ width: 170 }}>
            <ProductCard product={p} liked={ids.has(p.id)} onOpen={() => open(p)} onAdd={() => addToCart(p)} onToggleLike={() => like(p)} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function NewArrivalsRail({ items }: { items: ProductListItemDto[] }) {
  const { t } = useTranslation();
  return <ProductRail testID="home-new-arrivals" title={t('home.newArrivals')} items={newArrivals(items)} />;
}

export function FeaturedRail({ items }: { items: ProductListItemDto[] }) {
  const { t } = useTranslation();
  return <ProductRail testID="home-featured" title={t('home.featured')} items={featuredItems(items)} />;
}
