import React, { useCallback } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import type { ProductListItemDto } from '@contracts/catalog';
import { useTheme, radii, shadows } from '@/theme';
import { Text, useBodyFont } from '@/components/Text';
import { Button } from '@/components/Button';
import { Gradient } from '@/components/Gradient';
import { Pill, EmptyState, SkeletonList, ErrorState } from '@/components/ui';
import { Countdown, flashDealsEnd } from '@/components/Extras';
import { ProductCard, emojiFor } from '@/components/ProductCard';
import { useCartStore } from '@/store/cartStore';
import { useUiStore } from '@/store/uiStore';
import { useRouter } from 'expo-router';
import { useBanners, useCategories, useWishlist } from './hooks';
import { useModules } from '@/features/common/hooks';

/** .search-section: white strip with the search box (+ barcode button) and the category pills. */
export function SearchSection({
  value,
  onChange,
  selected,
  onSelect,
  scan = true,
}: {
  value: string;
  onChange: (v: string) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  scan?: boolean;
}) {
  return (
    <View style={{ paddingVertical: 12, paddingHorizontal: 16 }}>
      <SearchBox value={value} onChange={onChange} scan={scan} />
      <CategoryPills selected={selected} onSelect={onSelect} />
    </View>
  );
}

export function SearchBox({ value, onChange, scan = true }: { value: string; onChange: (v: string) => void; scan?: boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const font = useBodyFont();
  const showToast = useUiStore((s) => s.showToast);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.fill, borderRadius: radii.control, paddingVertical: 10, paddingHorizontal: 14, gap: 10, minHeight: 48 }}>
      <Text size={15} color="textMuted">🔍</Text>
      <TextInput
        accessibilityLabel={t('home.search')}
        value={value}
        onChangeText={onChange}
        placeholder={t('home.searchPlaceholder')}
        placeholderTextColor={theme.colors.textSubtle}
        style={{ flex: 1, fontSize: 13, fontFamily: font, color: theme.colors.textMain, padding: 0 }}
        returnKeyType="search"
      />
      {scan ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.scanLabel')}
          hitSlop={6}
          // No barcode lookup endpoint yet: the button is drawn like the demo and answers "coming soon".
          onPress={() => showToast(t('soon.badge'))}
          style={{ minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center', opacity: 0.55 }}
        >
          <Text size={18}>📷</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CategoryPills({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const { t } = useTranslation();
  const { data } = useCategories();
  const cats = (data?.items ?? []).filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
      <Pill label={t('home.allItems')} active={selected == null} onPress={() => onSelect(null)} />
      {cats.map((c) => (
        <Pill key={c.id} label={`${emojiFor(c.name)} ${c.name}`} active={selected === c.id} onPress={() => onSelect(c.id)} />
      ))}
    </ScrollView>
  );
}

/** Hero banner (.banner-slide): the server's first banner when there is one, else the brand banner copy. */
export function HeroBanner({ onExplore }: { onExplore: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { data } = useBanners();
  const b = data?.items?.[0];
  return (
    <View style={{ paddingVertical: 12, paddingHorizontal: 16 }}>
      <View style={[{ borderRadius: radii.hero, backgroundColor: theme.colors.primary }, shadows.banner]}>
        <Gradient from={theme.colors.primary} to={theme.colors.primaryDark} style={{ borderRadius: radii.hero, padding: 20 }}>
          <View style={{ alignSelf: 'flex-start', backgroundColor: theme.colors.accent, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.sm, marginBottom: 8 }}>
            <Text size={10} weight={800} color="accentText" letterSpacing={0.5}>
              {t('home.bannerBadge')}
            </Text>
          </View>
          <Text size={19} weight={800} color="white" lineHeightRatio={1.25} style={{ marginBottom: 6 }}>
            {b?.title ?? t('home.bannerTitle')}
          </Text>
          <Text size={12} color="glassText" lineHeightRatio={1.4} style={{ marginBottom: 14 }}>
            {b?.subtitle ?? t('home.bannerBody')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Button label={t('home.exploreDeals')} variant="primarySm" onPress={onExplore} />
            <View style={{ backgroundColor: theme.colors.glass, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radii.md }}>
              <Text size={11} weight={700} color="white">
                ⚡ {t('home.fastDelivery')}
              </Text>
            </View>
          </View>
        </Gradient>
      </View>
    </View>
  );
}

/** .section-header of the flash deals block: ⚡ title + always-on countdown. */
export function FlashDealsHeader() {
  const { t } = useTranslation();
  return (
    <View style={{ paddingTop: 10, paddingHorizontal: 6 }}>
      {/* 6 dp less than the demo's 12: every product cell already has 6 dp of its own padding */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
          <Text size={18}>⚡</Text>
          <Text size={16} weight={800} numberOfLines={1} style={{ flexShrink: 1 }}>
            {t('home.flashDeals')}
          </Text>
        </View>
        <Countdown endsAt={flashDealsEnd()} />
      </View>
    </View>
  );
}

/** Smart Buy promo card (.smartbuy-cta-card); hidden when the company's modules disable Smart Buy. */
export function SmartBuyPromo() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const modules = useModules();
  if (!modules.smartbuy) return null;
  return (
    <View style={{ marginTop: 20, marginBottom: 16, marginHorizontal: 6 }}>
      <Gradient from={theme.colors.inkSoft} to={theme.colors.ink} style={{ borderRadius: radii.hero, padding: 18 }}>
        <Text size={10} weight={800} color="accent" letterSpacing={0.5}>
          💰 {t('home.ctaTag')}
        </Text>
        <Text size={16} weight={800} color="white" style={{ marginVertical: 4 }}>
          {t('home.ctaTitle')}
        </Text>
        <Text size={11} color="textSubtle" lineHeightRatio={1.45} style={{ marginBottom: 14 }}>
          {t('home.ctaBody')}
        </Text>
        <Button label={`${t('home.ctaButton')} ➔`} variant="accentSm" onPress={() => router.push('/smartbuy-promo')} style={{ alignSelf: 'flex-start' }} />
      </Gradient>
    </View>
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
  listRef,
}: {
  items: ProductListItemDto[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  header?: React.ReactElement | null;
  footer?: React.ReactElement | null;
  listRef?: React.Ref<FlashListRef<ProductListItemDto>>;
}) {
  const { t } = useTranslation();
  const add = useCartStore((s) => s.add);
  const showToast = useUiStore((s) => s.showToast);
  const openProduct = useUiStore((s) => s.openProduct);
  const { ids, toggle, loggedIn } = useWishlist();
  const router = useRouter();
  const theme = useTheme();

  const addToCart = useCallback(
    (p: ProductListItemDto) => {
      if (p.has_variants) {
        openProduct(p.id);
        return;
      }
      add({ productId: p.id, name: p.name, unitPrice: p.price, unit: p.unit, saleBy: p.sale_by, step: p.qty_step, minQty: p.min_qty, thumbnail: p.thumbnail_url, emoji: emojiFor(p.category_name ?? p.name) });
      showToast(t('cart.added', { name: p.name.length > 24 ? `${p.name.slice(0, 22)}...` : p.name }));
    },
    [add, openProduct, showToast, t],
  );
  const like = useCallback(
    (p: ProductListItemDto) => {
      // A guest has no wishlist: never queue the item (it would later land in whoever signs in next).
      if (!loggedIn) {
        showToast(t('product.loginToSave'));
        router.push('/login' as never);
        return;
      }
      const nowLiked = toggle(p);
      showToast(nowLiked ? t('product.savedWishlist') : t('product.removedWishlist'));
    },
    [toggle, loggedIn, router, showToast, t],
  );

  return (
    <FlashList
      ref={listRef}
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
        <ProductCard product={item} liked={ids.has(item.id)} onOpen={() => openProduct(item.id)} onAdd={() => addToCart(item)} onToggleLike={() => like(item)} />
      )}
    />
  );
}
