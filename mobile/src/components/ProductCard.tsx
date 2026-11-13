import React from 'react';
import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ProductListItemDto } from '@contracts/catalog';
import { useTheme, radii } from '@/theme';
import { formatPricePerUnit, formatRs } from '@/lib/money';
import { fewLeftQty } from '@/lib/stock';
import { Text } from './Text';
import { Button } from './Button';

/** Decorative emoji from the category/product name (the server sends real images; this is the placeholder). */
export function emojiFor(name?: string | null): string {
  const n = (name ?? '').toLowerCase();
  if (/rice|grain|grocer|flour|dhal|sugar/.test(n)) return '🌾';
  if (/tea|spice|cinnamon|pepper|cardamom/.test(n)) return '☕';
  if (/coconut|oil/.test(n)) return '🥥';
  if (/plant|sapling|seed|nursery/.test(n)) return '🌱';
  if (/teak|furniture|chair|table|wood/.test(n)) return '🪑';
  if (/honey|treacle|jaggery/.test(n)) return '🍯';
  return '🌿';
}

interface Props {
  product: ProductListItemDto;
  liked: boolean;
  onOpen: () => void;
  onAdd: () => void;
  onToggleLike: () => void;
}

function ProductCardBase({ product: p, liked, onOpen, onAdd, onToggleLike }: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const weight = p.sale_by === 'weight';
  const few = fewLeftQty(p.in_stock, p.available_qty);
  return (
    <View style={{ flex: 1, padding: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={p.name}
        onPress={onOpen}
        style={{ flex: 1, backgroundColor: theme.colors.surface, borderRadius: radii.card, borderWidth: 1, borderColor: theme.colors.surfaceBorder, overflow: 'hidden' }}
      >
        <View style={{ height: 130, backgroundColor: theme.colors.fill, alignItems: 'center', justifyContent: 'center' }}>
          {p.thumbnail_url ? (
            <Image source={{ uri: p.thumbnail_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="disk" transition={150} recyclingKey={p.id} accessibilityLabel={p.name} />
          ) : (
            <Text size={52}>{emojiFor(p.category_name ?? p.name)}</Text>
          )}
          {p.discount_pct > 0 ? (
            <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: theme.colors.error, paddingHorizontal: 6, paddingVertical: 3, borderRadius: radii.sm }}>
              <Text size={10} weight={800} color="white">
                {t('product.save', { pct: Math.round(p.discount_pct) })}
              </Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={liked ? t('product.unlike') : t('product.like')}
            onPress={onToggleLike}
            hitSlop={8}
            style={{ position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: radii.circle, backgroundColor: theme.colors.wishlistBg, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text size={14}>{liked ? '❤️' : '🤍'}</Text>
          </Pressable>
        </View>
        <View style={{ padding: 12, flex: 1 }}>
          {p.category_name ? (
            <Text size={10} weight={700} color="primary" numberOfLines={1} letterSpacing={0.3} style={{ textTransform: 'uppercase' }}>
              {p.category_name}
            </Text>
          ) : null}
          <Text size={13} weight={700} numberOfLines={2} style={{ marginVertical: 4 }} lineHeightRatio={1.3}>
            {p.name}
          </Text>
          <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <Text size={14} weight={800} color="primary">
              {weight ? formatPricePerUnit(p.price, p.unit) : formatRs(p.price)}
            </Text>
            {p.original_price && p.original_price > p.price ? (
              <Text size={11} color="textSubtle" style={{ marginLeft: 4, textDecorationLine: 'line-through' }}>
                {formatRs(p.original_price)}
              </Text>
            ) : null}
          </View>
          {few != null ? (
            <Text size={10} weight={700} color="warning" style={{ marginTop: 2 }}>
              {t('product.fewLeft', { n: few })}
            </Text>
          ) : null}
          {p.emi_available ? (
            <Text size={10} weight={600} color="textMuted" style={{ marginTop: 2 }}>
              {t('product.emi')}
            </Text>
          ) : null}
          <Button
            label={p.in_stock ? t('product.addToCart') : t('product.outOfStock')}
            icon={p.in_stock ? '🛒' : undefined}
            variant="addCart"
            disabled={!p.in_stock}
            onPress={onAdd}
            style={{ marginTop: 10 }}
          />
        </View>
      </Pressable>
    </View>
  );
}

export const ProductCard = React.memo(ProductCardBase);
