import React, { useCallback } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { ProductListItemDto } from '@contracts/catalog';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Gradient } from '@/components/Gradient';
import { Pill, EmptyState, SkeletonList, ErrorState } from '@/components/ui';
import { ProductCard, emojiFor } from '@/components/ProductCard';
import { useCartStore } from '@/store/cartStore';
import { useUiStore } from '@/store/uiStore';
import { useBanners, useCategories, useWishlist } from './hooks';
import { useModules } from '@/features/common/hooks';

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.fill, borderRadius: radii.control, paddingHorizontal: 14, gap: 10, minHeight: 48 }}>
      <Text size={15} color="textMuted">🔍</Text>
      <TextInput
        accessibilityLabel={t('home.search')}
        value={value}
        onChangeText={onChange}
        placeholder={t('home.searchPlaceholder')}
        placeholderTextColor={theme.colors.textSubtle}
        style={{ flex: 1, fontSize: 13, color: theme.colors.textMain, paddingVertical: 10 }}
        returnKeyType="search"
      />
    </View>
  );
}

export function CategoryPills({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const { t } = useTranslation();
  const { data } = useCategories();
  const cats = (data?.items ?? []).filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 6 }}>
      <Pill label={t('home.allItems')} active={selected == null} onPress={() => onSelect(null)} />
      {cats.map((c) => (
        <Pill key={c.id} label={`${emojiFor(c.name)} ${c.name}`} active={selected === c.id} onPress={() => onSelect(c.id)} />
      ))}
    </ScrollView>
  );
}

/** Hero banner: the server's first banner when there is one, else the brand banner copy. */
export function HeroBanner({ onExplore }: { onExplore: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { data } = useBanners();
  const b = data?.items?.[0];
  return (
    <Gradient from={theme.colors.primary} to={theme.colors.primaryDark} style={{ borderRadius: radii.hero, padding: 20, elevation: 4 }}>
      <View style={{ alignSelf: 'flex-start', backgroundColor: theme.colors.accent, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.sm, marginBottom: 8 }}>
        <Text size={10} weight={800} color="accentText" style={{ letterSpacing: 0.5 }}>
          {t('home.bannerBadge')}
        </Text>
      </View>
      <Text size={19} weight={800} color="white" lineHeightRatio={1.25} style={{ marginBottom: 6 }}>
        {b?.title ?? t('home.bannerTitle')}
      </Text>
      <Text size={12} color="glassText" lineHeightRatio={1.4} style={{ marginBottom: 14 }}>
        {b?.subtitle ?? t('home.bannerBody')}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Button label={t('home.exploreDeals')} variant="primarySm" onPress={onExplore} />
        <View style={{ backgroundColor: theme.colors.glass, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.md }}>
          <Text size={11} weight={700} color="white">⚡ {t('home.fastDelivery')}</Text>
        </View>
      </View>
    </Gradient>
  );
}

/** Smart Buy promo card (hidden when the company's modules disable Smart Buy). */
export function SmartBuyPromo() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const modules = useModules();
  if (!modules.smartbuy) return null;
  return (
    <Gradient from={theme.colors.inkSoft} to={theme.colors.ink} style={{ borderRadius: radii.hero, padding: 18, margin: 16 }}>
      <Text size={10} weight={800} color="accent" style={{ letterSpacing: 0.5 }}>💰 {t('promo.tag')}</Text>
      <Text size={16} weight={800} color="white" style={{ marginVertical: 4 }}>{t('promo.title')}</Text>
      <Text size={11} color="textSubtle" lineHeightRatio={1.45} style={{ marginBottom: 14 }}>{t('promo.body')}</Text>
      <Button label={`${t('promo.cta')} ➔`} variant="accentSm" onPress={() => router.push('/smartbuy-promo')} style={{ alignSelf: 'flex-start' }} />
    </Gradient>
  );
}

/** Two-column FlashList of products (cached snapshot, works offline). */
export function ProductGrid({
  items,
  loading,
  error,
  onRetry,
  header,
  footer,
}: {
  items: ProductListItemDto[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  header?: React.ReactElement | null;
  footer?: React.ReactElement | null;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const add = useCartStore((s) => s.add);
  const showToast = useUiStore((s) => s.showToast);
  const { ids, toggle } = useWishlist();
  const theme = useTheme();

  const addToCart = useCallback(
    (p: ProductListItemDto) => {
      if (p.has_variants) {
        router.push({ pathname: '/product/[id]', params: { id: p.id } });
        return;
      }
      add({ productId: p.id, name: p.name, unitPrice: p.price, unit: p.unit, saleBy: p.sale_by, step: p.qty_step, minQty: p.min_qty, thumbnail: p.thumbnail_url, emoji: emojiFor(p.category_name ?? p.name) });
      showToast(t('cart.added', { name: p.name.length > 24 ? `${p.name.slice(0, 22)}...` : p.name }));
    },
    [add, router, showToast, t],
  );
  const like = useCallback(
    (p: ProductListItemDto) => {
      const nowLiked = toggle(p);
      showToast(nowLiked ? t('product.savedWishlist') : t('product.removedWishlist'));
    },
    [toggle, showToast, t],
  );

  return (
    <FlashList
      data={items}
      numColumns={2}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 24, backgroundColor: theme.colors.surfaceSubtle }}
      style={{ backgroundColor: theme.colors.surfaceSubtle }}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={
        loading ? (
          <View style={{ padding: 6 }}><SkeletonList rows={3} height={220} /></View>
        ) : error ? (
          <ErrorState onRetry={onRetry} />
        ) : (
          <EmptyState icon="🔍" title={t('home.noResults')} body={t('home.noResultsBody')} />
        )
      }
      renderItem={({ item }) => (
        <ProductCard
          product={item}
          liked={ids.has(item.id)}
          onOpen={() => router.push({ pathname: '/product/[id]', params: { id: item.id } })}
          onAdd={() => addToCart(item)}
          onToggleLike={() => like(item)}
        />
      )}
    />
  );
}
