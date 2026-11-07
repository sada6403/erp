import React, { useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Badge, ErrorState, QtyStepper, SkeletonList } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { emojiFor } from '@/components/ProductCard';
import { useProductDetail } from '@/features/shop/hooks';
import { useCartStore } from '@/store/cartStore';
import { useUiStore, selectIsOffline } from '@/store/uiStore';
import { defaultQtyRules, formatPricePerUnit, formatRs, lineTotal, snapQty } from '@/lib/money';

/** Product detail: gallery image, price, stock, variants, quantity (0.25 kg steps for weight items). */
export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { detail, listItem } = useProductDetail(id);
  const add = useCartStore((s) => s.add);
  const showToast = useUiStore((s) => s.showToast);
  const offline = useUiStore(selectIsOffline);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qtyState, setQty] = useState<number | null>(null);

  const p = detail.data ?? listItem;
  const variants = detail.data?.variants ?? [];
  const variant = useMemo(() => variants.find((v) => v.id === (variantId ?? variants.find((x) => x.in_stock)?.id)) ?? null, [variants, variantId]);

  if (!p) return detail.isError ? <Screen><ErrorState onRetry={() => detail.refetch()} /></Screen> : <Screen><SkeletonList rows={3} height={140} /></Screen>;

  const weight = p.sale_by === 'weight';
  const rules = defaultQtyRules(p.sale_by, p.qty_step, p.min_qty);
  const qty = qtyState ?? rules.min;
  const unitPrice = variant?.price ?? p.price;
  const orig = variant?.original_price ?? p.original_price;
  const inStock = variant ? variant.in_stock : p.in_stock;
  const image = variant?.image_url ?? detail.data?.gallery?.[0]?.medium ?? p.thumbnail_url;

  const onAdd = () => {
    add(
      { productId: p.id, variantId: variant?.id ?? null, name: p.name, variantName: variant?.name ?? null, unitPrice, unit: p.unit, saleBy: p.sale_by, step: p.qty_step, minQty: p.min_qty, thumbnail: image, emoji: emojiFor(p.category_name ?? p.name) },
      snapQty(qty, rules),
    );
    showToast(t('cart.added', { name: p.name.length > 24 ? `${p.name.slice(0, 22)}...` : p.name }));
    router.back();
  };

  return (
    <Screen padded={false} contentStyle={{ padding: 20, paddingBottom: 32 }}>
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 200, height: 200, borderRadius: radii.hero, backgroundColor: theme.colors.fill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {image ? <Image source={{ uri: image }} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="disk" accessibilityLabel={p.name} /> : <Text size={68}>{emojiFor(p.category_name ?? p.name)}</Text>}
        </View>
      </View>
      {p.category_name ? <Text size={10} weight={700} color="primary" style={{ textTransform: 'uppercase' }}>{p.category_name}</Text> : null}
      <Text size={18} weight={800}>{p.name}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text size={19} weight={800} color="primary">{weight ? formatPricePerUnit(unitPrice, p.unit) : formatRs(unitPrice)}</Text>
        {orig && orig > unitPrice ? <Text size={11} color="textSubtle" style={{ textDecorationLine: 'line-through' }}>{formatRs(orig)}</Text> : null}
        <Badge label={inStock ? t('product.inStock') : t('product.outOfStock')} bg={inStock ? 'successBg' : 'errorBg'} fg={inStock ? 'success' : 'error'} size={11} style={{ paddingHorizontal: 8, paddingVertical: 3 }} />
      </View>
      {offline || detail.data?.price_note ? (
        <Text size={11} color="warning" weight={600}>{detail.data?.price_note ?? t('product.priceMayChange')}</Text>
      ) : null}
      <Text size={11} color="textMuted">{t('checkout.pricesIncludeTax')}</Text>
      {p.emi_available ? <Text size={11} color="textMuted" weight={600}>{t('product.emi')}</Text> : null}
      {detail.data?.description || p.short_description ? (
        <Text size={12} color="textMuted" lineHeightRatio={1.45}>{detail.data?.description ?? p.short_description}</Text>
      ) : null}

      {variants.length > 0 ? (
        <View>
          <Text size={11} weight={700} color="textMuted" style={{ marginBottom: 6 }}>{t('product.packageSizes')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {variants.map((v) => {
              const active = v.id === variant?.id;
              return (
                <Pressable
                  key={v.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled: !v.in_stock }}
                  onPress={() => setVariantId(v.id)}
                  style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, opacity: v.in_stock ? 1 : 0.5, borderColor: active ? theme.colors.primary : theme.colors.surfaceBorder, backgroundColor: active ? theme.colors.container : theme.colors.surface }}
                >
                  <Text size={12} weight={600}>{v.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text size={12} weight={700} color="textMuted">{weight ? t('product.weight') : t('product.quantity')}</Text>
        <QtyStepper qty={qty} unit={p.unit} rules={{ ...rules, min: rules.step }} onChange={(n) => setQty(n <= 0 ? rules.min : n)} />
      </View>
      <Button
        label={`${t('product.addToHarvestCart')} • ${formatRs(lineTotal(unitPrice, qty))}`}
        disabled={!inStock}
        onPress={onAdd}
      />
    </Screen>
  );
}
