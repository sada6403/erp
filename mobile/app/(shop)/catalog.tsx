import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/theme';
import { ProductGrid, SearchSection } from '@/features/shop/ShopParts';
import { useProducts } from '@/features/shop/hooks';

/** Store catalog: search + category filter (Departments links here with ?category=). */
export default function CatalogScreen() {
  const theme = useTheme();
  const { category } = useLocalSearchParams<{ category?: string }>();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(category ?? null);
  const { items, isLoading, isError, refetch } = useProducts({ q, categoryId: cat });
  const header = (
    <View style={{ backgroundColor: theme.colors.surface, marginHorizontal: -10, marginBottom: 6 }}>
      <SearchSection value={q} onChange={setQ} selected={cat} onSelect={setCat} />
    </View>
  );
  return <ProductGrid items={items} loading={isLoading} error={isError} onRetry={refetch} header={header} />;
}
