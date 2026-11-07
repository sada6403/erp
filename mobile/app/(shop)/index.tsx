import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { SectionHeader } from '@/components/ui';
import { CategoryPills, HeroBanner, ProductGrid, SearchBox, SmartBuyPromo } from '@/features/shop/ShopParts';
import { useProducts } from '@/features/shop/hooks';
import { useWatermark } from '@/features/common/hooks';
import { qk } from '@/query/keys';

export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const { items, isLoading, isError, refetch } = useProducts({ q, categoryId: cat });
  useWatermark({ catalog: [qk.catalog.products], categories: [qk.catalog.categories], banners: [qk.catalog.banners] });

  const header = (
    <View>
      <View style={{ backgroundColor: theme.colors.surface, padding: 12, paddingHorizontal: 16, marginHorizontal: -10 }}>
        <SearchBox value={q} onChange={setQ} />
        <CategoryPills selected={cat} onSelect={setCat} />
      </View>
      {q.trim() ? null : (
        <View style={{ paddingVertical: 12, paddingHorizontal: 6 }}>
          <HeroBanner onExplore={() => router.push('/flash-deals')} />
        </View>
      )}
      <View style={{ paddingHorizontal: 6, paddingTop: 10 }}>
        <SectionHeader icon="🌿" title={t('home.products')} />
      </View>
    </View>
  );
  return <ProductGrid items={items} loading={isLoading} error={isError} onRetry={refetch} header={header} footer={q.trim() ? null : <SmartBuyPromo />} />;
}
