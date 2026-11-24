import React, { useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Badge, ErrorState, QtyStepper, Skeleton } from '@/components/ui';
import { BottomSheet } from '@/components/Overlays';
import { emojiFor } from '@/components/ProductCard';
import { useUiStore, selectIsOffline } from '@/store/uiStore';
import { useCartStore } from '@/store/cartStore';
import { defaultQtyRules, formatPricePerUnit, formatRs, lineTotal, snapQty } from '@/lib/money';
import { fewLeftQty } from '@/lib/stock';
import { useProductDetail } from './hooks';

/** Mounted once in the root layout: shows the product detail bottom sheet over whatever screen is open. */
export function ProductSheetHost() {
  const id = useUiStore((s) => s.productSheetId);
  const close = useUiStore((s) => s.closeProduct);
  return (
    <BottomSheet visible={id != null} onClose={close} showClose>
      {id ? <ProductSheetBody key={id} id={id} onClose={close} /> : null}
    </BottomSheet>
  );
}

/** Product detail (#productModal): emoji/image box, category, name, price row, description, package sizes, add button. */
function ProductSheetBody({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { detail, listItem } = useProductDetail(id);
  const add = useCartStore((s) => s.add);
  const showToast = useUiStore((s) => s.showToast);
  const offline = useUiStore(selectIsOffline);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qtyState, setQty] = useState<number | null>(null);

  const p = detail.data ?? listItem;
  const variants = useMemo(() => detail.data?.variants ?? [], [detail.data]);
  const variant = useMemo(() => variants.find((v) => v.id === (variantId ?? variants.find((x) => x.in_stock)?.id)) ?? null, [variants, variantId]);

  if (!p) {
    return detail.isError ? <ErrorState onRetry={() => detail.refetch()} /> : <Skeleton height={220} radius={radii.hero} />;
  }

  const weight = p.sale_by === 'weight';
  const rules = defaultQtyRules(p.sale_by, p.qty_step, p.min_qty);
  const qty = qtyState ?? rules.min;
  const unitPrice = variant?.price ?? p.price;
  const orig = variant?.original_price ?? p.original_price;
  const inStock = variant ? variant.in_stock : p.in_stock;
  const few = fewLeftQty(inStock, variant ? variant.available_qty : p.available_qty);
  const image = variant?.image_url ?? detail.data?.gallery?.[0]?.medium ?? p.thumbnail_url;
  const desc = detail.data?.description ?? p.short_description;

  const onAdd = () => {
    add(
      { productId: p.id, variantId: variant?.id ?? null, name: p.name, variantName: variant?.name ?? null, unitPrice, unit: p.unit, saleBy: p.sale_by, step: p.qty_step, minQty: p.min_qty, thumbnail: image, emoji: emojiFor(p.category_name ?? p.name) },
      snapQty(qty, rules),
    );
    showToast(t('cart.added', { name: p.name.length > 24 ? `${p.name.slice(0, 22)}...` : p.name }));
    onClose();
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={{ alignItems: 'center', marginBottom: 12 }}>
        <View style={{ minWidth: 120, minHeight: 130, borderRadius: radii.hero, backgroundColor: theme.colors.fill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: image ? 0 : 22 }}>
          {image ? (
            <Image source={{ uri: image }} style={{ width: 130, height: 130 }} contentFit="cover" cachePolicy="disk" accessibilityLabel={p.name} />
          ) : (
            <Text size={68}>{emojiFor(p.category_name ?? p.name)}</Text>
          )}
        </View>
      </View>
      {p.category_name ? (
        <Text size={10} weight={700} color="primary" letterSpacing={0.3} style={{ textTransform: 'uppercase' }}>
          {p.category_name}
        </Text>
      ) : null}
      <Text size={18} weight={800} style={{ marginVertical: 4 }}>
        {p.name}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Text size={19} weight={800} color="primary">
          {weight ? formatPricePerUnit(unitPrice, p.unit) : formatRs(unitPrice)}
        </Text>
        {orig && orig > unitPrice ? (
          <Text size={11} color="textSubtle" style={{ marginLeft: 4, textDecorationLine: 'line-through' }}>
            {formatRs(orig)}
          </Text>
        ) : null}
        <Badge
          label={!inStock ? t('product.outOfStock') : few != null ? t('product.fewLeft', { n: few }) : t('product.inStock')}
          bg={!inStock ? 'errorBg' : few != null ? 'warningBg' : 'successBg'}
          fg={!inStock ? 'error' : few != null ? 'warning' : 'success'}
          size={11}
          style={{ paddingHorizontal: 8, paddingVertical: 3 }}
        />
      </View>
      {offline || detail.data?.price_note ? (
        <Text size={11} color="warning" weight={600} style={{ marginBottom: 8 }}>
          {detail.data?.price_note ?? t('product.priceMayChange')}
        </Text>
      ) : null}
      {desc ? (
        <Text size={12} color="textMuted" lineHeightRatio={1.45} style={{ marginBottom: 14 }}>
          {desc}
        </Text>
      ) : null}

      {variants.length > 0 ? (
        <View style={{ marginBottom: 16 }}>
          <Text size={11} weight={700} color="textMuted" style={{ marginBottom: 6 }}>
            {t('product.packageSizes')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {variants.map((v) => {
              const active = v.id === variant?.id;
              return (
                <Pressable
                  key={v.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, disabled: !v.in_stock }}
                  hitSlop={{ top: 6, bottom: 6 }}
                  onPress={() => setVariantId(v.id)}
                  style={{
                    minHeight: 36,
                    justifyContent: 'center',
                    paddingHorizontal: 14,
                    paddingVertical: 6,
                    borderRadius: radii.hero,
                    borderWidth: 1,
                    opacity: v.in_stock ? 1 : 0.5,
                    borderColor: theme.colors.surfaceBorder,
                    backgroundColor: active ? theme.colors.container : theme.colors.surface,
                  }}
                >
                  <Text size={12} weight={600}>
                    {v.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {weight ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text size={11} weight={700} color="textMuted">
            {t('product.weight')}
          </Text>
          <QtyStepper qty={qty} unit={p.unit} rules={{ ...rules, min: rules.step }} onChange={(n) => setQty(n <= 0 ? rules.min : n)} />
        </View>
      ) : null}

      <Button label={`${t('product.addToHarvestCart')} • ${formatRs(lineTotal(unitPrice, qty))}`} disabled={!inStock} onPress={onAdd} fullWidth />
      <Text size={11} color="textMuted" align="center" style={{ marginTop: 8 }}>
        {t('checkout.pricesIncludeTax')}
      </Text>
    </ScrollView>
  );
}
