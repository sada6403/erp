import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, radii } from '@/theme';
import { Text, useBodyFont } from '@/components/Text';
import { ProductGrid, SearchSection } from '@/features/shop/ShopParts';
import { useCategories, useProducts, type ProductSort } from '@/features/shop/hooks';

const SORTS: { key: ProductSort; label: string }[] = [
  { key: 'newest', label: 'categories.sortNewest' },
  { key: 'popular', label: 'categories.sortPopular' },
  { key: 'priceLow', label: 'categories.sortPriceLow' },
  { key: 'priceHigh', label: 'categories.sortPriceHigh' },
];

function toNum(v: string): number | null {
  const n = Number(v.replace(/[^0-9.]/g, ''));
  return v.trim() && Number.isFinite(n) ? n : null;
}

/** Store catalog: search + category filter (Departments links here with ?category=), sort, price range, in stock. */
export default function CatalogScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const font = useBodyFont();
  const { category } = useLocalSearchParams<{ category?: string }>();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(category ?? null);
  const [sort, setSort] = useState<ProductSort | undefined>(undefined);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [minTxt, setMinTxt] = useState('');
  const [maxTxt, setMaxTxt] = useState('');
  const cats = useCategories();
  const childIds = useMemo(() => (cat ? (cats.data?.items ?? []).filter((c) => c.parent_id === cat).map((c) => c.id) : []), [cats.data, cat]);
  const minPrice = toNum(minTxt);
  const maxPrice = toNum(maxTxt);
  const { items, isLoading, isError, refetch } = useProducts({ q, categoryId: cat, childIds, inStockOnly, minPrice, maxPrice, sort });
  const filtered = inStockOnly || minPrice != null || maxPrice != null;
  const chip = (active: boolean) => ({
    minHeight: 36,
    paddingHorizontal: 12,
    justifyContent: 'center' as const,
    borderRadius: radii.control,
    backgroundColor: active ? theme.colors.primary : theme.colors.fill,
  });
  const box = { width: 96, minHeight: 36, paddingHorizontal: 10, borderRadius: radii.control, backgroundColor: theme.colors.fill, fontSize: 12, fontFamily: font, color: theme.colors.textMain };
  const header = (
    <View style={{ backgroundColor: theme.colors.surface, marginHorizontal: -10, marginBottom: 6 }}>
      <SearchSection value={q} onChange={setQ} selected={cat} onSelect={setCat} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
        {SORTS.map((s) => (
          <Pressable key={s.key} accessibilityRole="button" accessibilityState={{ selected: sort === s.key }} onPress={() => setSort(sort === s.key ? undefined : s.key)} style={chip(sort === s.key)}>
            <Text size={12} weight={700} color={sort === s.key ? 'white' : 'textMain'}>{t(s.label)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 12, alignItems: 'center' }}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: inStockOnly }} onPress={() => setInStockOnly(!inStockOnly)} style={chip(inStockOnly)}>
          <Text size={12} weight={700} color={inStockOnly ? 'white' : 'textMain'}>{t('categories.inStockOnly')}</Text>
        </Pressable>
        <TextInput accessibilityLabel={t('categories.priceMin')} value={minTxt} onChangeText={setMinTxt} placeholder={t('categories.priceMin')} placeholderTextColor={theme.colors.textSubtle} keyboardType="numeric" style={box} />
        <TextInput accessibilityLabel={t('categories.priceMax')} value={maxTxt} onChangeText={setMaxTxt} placeholder={t('categories.priceMax')} placeholderTextColor={theme.colors.textSubtle} keyboardType="numeric" style={box} />
        {filtered || sort ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setInStockOnly(false);
              setMinTxt('');
              setMaxTxt('');
              setSort(undefined);
            }}
            style={chip(false)}
          >
            <Text size={12} weight={700} color="primary">{t('categories.clearFilters')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
  return <ProductGrid items={items} loading={isLoading} error={isError} onRetry={refetch} header={header} />;
}
