import React, { useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { FlatList, Pressable, ScrollView, Share, TextInput, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { ReviewDto } from '@contracts/catalog';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Badge, Card, ErrorState, QtyStepper, Skeleton } from '@/components/ui';
import { ImageViewer } from '@/components/ImageViewer';
import { emojiFor } from '@/components/ProductCard';
import { useUiStore, selectIsOffline } from '@/store/uiStore';
import { useCartStore } from '@/store/cartStore';
import { selectIsLoggedIn, useSessionStore } from '@/store/sessionStore';
import { defaultQtyRules, formatPricePerUnit, formatRs, lineTotal, snapQty } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { fewLeftQty } from '@/lib/stock';
import { useProductDetail, useReviews, useSimilarProducts, useSubmitReview, useWishlist } from './hooks';
import { attributeGroups, defaultSelection, optionAvailable, pickVariant, selectOption, type Selection } from './variants';

const SHARE_BASE = 'naturalplantation://product/';

function Stars({ value, size = 14, onPick }: { value: number; size?: number; onPick?: (n: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: onPick ? 6 : 1 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const star = <Text key={n} size={size} color={n <= Math.round(value) ? 'warning' : 'textSubtle'}>{n <= Math.round(value) ? '★' : '☆'}</Text>;
        return onPick ? (
          <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n}`} hitSlop={6} onPress={() => onPick(n)}>
            {star}
          </Pressable>
        ) : (
          star
        );
      })}
    </View>
  );
}

function ReviewRow({ r, t }: { r: ReviewDto; t: (k: string) => string }) {
  return (
    <View style={{ gap: 3, paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Stars value={r.rating} size={13} />
        <Text size={12} weight={700}>{r.author_name}</Text>
        <Text size={10} color="textSubtle">{formatDate(r.created_at)}</Text>
      </View>
      {r.verified_purchase ? <Text size={10} weight={700} color="success">✓ {t('product.verified')}</Text> : null}
      {r.comment ? <Text size={12} color="textMuted" lineHeightRatio={1.4}>{r.comment}</Text> : null}
    </View>
  );
}

/** Product detail as a full page: gallery, price, variants, quantity, delivery, reviews, similar products, sticky buy bar. */
export function ProductPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { detail, listItem } = useProductDetail(id);
  const reviews = useReviews(id);
  const submit = useSubmitReview(id);
  const add = useCartStore((s) => s.add);
  const showToast = useUiStore((s) => s.showToast);
  const offline = useUiStore(selectIsOffline);
  const loggedIn = useSessionStore(selectIsLoggedIn);
  const { ids: liked, toggle } = useWishlist();

  const p = detail.data ?? listItem;
  const variants = useMemo(() => detail.data?.variants ?? [], [detail.data]);
  const groups = useMemo(() => attributeGroups(variants), [variants]);
  const [picked, setSel] = useState<Selection | null>(null);
  // The shopper's choice, or the first in-stock variant until they pick something.
  const sel = useMemo<Selection | null>(() => picked ?? (groups.length ? defaultSelection(variants) : null), [picked, groups, variants]);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qtyState, setQty] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [viewer, setViewer] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const similar = useSimilarProducts(p ? { id: p.id, category_id: p.category_id } : undefined);

  if (!p) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {detail.isError ? <ErrorState message={t('product.notFound')} onRetry={() => detail.refetch()} /> : <Skeleton height={300} radius={radii.hero} />}
      </ScrollView>
    );
  }

  const weight = p.sale_by === 'weight';
  const rules = defaultQtyRules(p.sale_by, p.qty_step, p.min_qty);
  const qty = qtyState ?? rules.min;
  const variant = groups.length ? pickVariant(variants, sel ?? {}) : variants.find((v) => v.id === (variantId ?? variants.find((x) => x.in_stock)?.id)) ?? null;
  const unitPrice = variant?.price ?? p.price;
  const orig = variant?.original_price ?? p.original_price;
  const discount = orig && orig > unitPrice ? Math.round(((orig - unitPrice) / orig) * 100) : 0;
  const inStock = variant ? variant.in_stock : p.in_stock;
  const few = fewLeftQty(inStock, variant ? variant.available_qty : p.available_qty);
  const gallery = detail.data?.gallery?.length ? detail.data.gallery.map((g) => g.medium) : p.thumbnail_url ? [p.thumbnail_url] : [];
  const images = variant?.image_url ? [variant.image_url, ...gallery.filter((g) => g !== variant.image_url)] : gallery;
  const desc = detail.data?.description ?? p.short_description;
  const eta = detail.data?.estimated_delivery;
  const etaText = eta ? eta.text || (eta.min_days === eta.max_days ? t('product.deliverySame', { n: eta.min_days }) : t('product.deliveryRange', { min: eta.min_days, max: eta.max_days })) : null;
  const rd = reviews.data;
  const avg = rd?.average ?? p.rating_avg ?? null;
  const count = rd?.count ?? p.rating_count ?? 0;
  const shownReviews = (rd?.items ?? []).slice(0, showAll ? 50 : 3);
  const isLiked = liked.has(p.id);
  const gap = 14;

  const line = () => ({ productId: p.id, variantId: variant?.id ?? null, name: p.name, variantName: variant?.name ?? null, unitPrice, unit: p.unit, saleBy: p.sale_by, step: p.qty_step, minQty: p.min_qty, thumbnail: images[0] ?? null, emoji: emojiFor(p.category_name ?? p.name) });
  const addToCart = () => {
    add(line(), snapQty(qty, rules));
    showToast(t('cart.added', { name: p.name.length > 24 ? `${p.name.slice(0, 22)}...` : p.name }));
  };
  const buyNow = () => {
    add(line(), snapQty(qty, rules));
    router.push('/cart');
  };
  const onLike = () => {
    if (!loggedIn) {
      showToast(t('product.loginToSave'));
      router.push('/login' as never);
      return;
    }
    showToast(toggle(p) ? t('product.savedWishlist') : t('product.removedWishlist'));
  };
  const onShare = () => {
    Share.share({ message: t('product.shareMessage', { name: p.name, price: weight ? formatPricePerUnit(unitPrice, p.unit) : formatRs(unitPrice), link: `${SHARE_BASE}${p.id}` }) }).catch(() => undefined);
  };
  const sendReview = async () => {
    const itemId = rd?.can_review.order_item_id;
    if (!itemId || stars < 1) return;
    try {
      await submit.mutateAsync({ order_item_id: itemId, rating: stars, comment: comment.trim() || undefined });
      setStars(0);
      setComment('');
      showToast(t('product.reviewThanks'));
    } catch (e) {
      showToast(errorMessage(e, t));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surfaceSubtle }}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Gallery: swipe, tap to open the zoom viewer */}
        <View style={{ backgroundColor: theme.colors.surface }}>
          {images.length ? (
            <FlatList
              data={images}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(u, i) => `${i}-${u}`}
              onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
              renderItem={({ item, index }) => (
                <Pressable accessibilityRole="imagebutton" accessibilityLabel={p.name} onPress={() => setViewer(index)} style={{ width, height: 300, backgroundColor: theme.colors.fill }}>
                  <Image source={{ uri: item }} style={{ width, height: 300 }} contentFit="contain" cachePolicy="disk" transition={150} />
                </Pressable>
              )}
            />
          ) : (
            <View style={{ height: 240, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.fill }}>
              <Text size={80}>{emojiFor(p.category_name ?? p.name)}</Text>
            </View>
          )}
          {images.length > 1 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 8 }}>
              {images.map((_, i) => (
                <View key={i} style={{ width: i === page ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === page ? theme.colors.primary : theme.colors.surfaceBorder }} />
              ))}
            </View>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={8} style={{ position: 'absolute', top: 10, left: 12, width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.wishlistBg, alignItems: 'center', justifyContent: 'center' }}>
            <Text size={18} weight={800}>←</Text>
          </Pressable>
          {discount > 0 ? (
            <View style={{ position: 'absolute', top: 54, left: 12, backgroundColor: theme.colors.error, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.sm }}>
              <Text size={11} weight={800} color="white">{t('product.save', { pct: discount })}</Text>
            </View>
          ) : null}
          <View style={{ position: 'absolute', top: 10, right: 12, gap: 8 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={isLiked ? t('product.unlike') : t('product.like')} onPress={onLike} hitSlop={6} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.wishlistBg, alignItems: 'center', justifyContent: 'center' }}>
              <Text size={16}>{isLiked ? '❤️' : '🤍'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t('product.share')} onPress={onShare} hitSlop={6} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.wishlistBg, alignItems: 'center', justifyContent: 'center' }}>
              <Text size={16}>📤</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ padding: 16, gap }}>
          {/* Title block */}
          <View style={{ gap: 4 }}>
            {p.category_name ? <Text size={10} weight={700} color="primary" letterSpacing={0.3} style={{ textTransform: 'uppercase' }}>{p.category_name}</Text> : null}
            <Text size={20} weight={800} lineHeightRatio={1.25}>{p.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {count > 0 && avg != null ? (
                <>
                  <Stars value={avg} />
                  <Text size={12} weight={700}>{avg.toFixed(1)}</Text>
                  <Text size={12} color="textMuted">({t('product.reviewCount', { count })})</Text>
                </>
              ) : (
                <Text size={12} color="textSubtle">{t('product.noReviews')}</Text>
              )}
            </View>
          </View>

          {/* Price + stock */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text size={24} weight={800} color="primary">{weight ? formatPricePerUnit(unitPrice, p.unit) : formatRs(unitPrice)}</Text>
            {orig && orig > unitPrice ? <Text size={13} color="textSubtle" style={{ textDecorationLine: 'line-through' }}>{formatRs(orig)}</Text> : null}
            <Badge
              label={!inStock ? t('product.outOfStock') : few != null ? t('product.fewLeft', { n: few }) : t('product.inStock')}
              bg={!inStock ? 'errorBg' : few != null ? 'warningBg' : 'successBg'}
              fg={!inStock ? 'error' : few != null ? 'warning' : 'success'}
              size={11}
              style={{ paddingHorizontal: 8, paddingVertical: 3 }}
            />
          </View>
          {weight ? <Text size={12} color="textMuted">{t('product.soldBy', { unit: p.unit })}</Text> : null}
          {offline || detail.data?.price_note ? <Text size={11} color="warning" weight={600}>{detail.data?.price_note ?? t('product.priceMayChange')}</Text> : null}
          {p.emi_available ? <Text size={12} weight={700} color="primary">💳 {t('product.emiLine')}</Text> : null}

          {/* Variant selectors from the POS attributes (colour, size, ...) with the price/stock of each variant */}
          {groups.length ? (
            groups.map((g) => (
              <View key={g.key} style={{ gap: 6 }}>
                <Text size={11} weight={700} color="textMuted">{g.key}: <Text size={11} weight={800}>{sel?.[g.key] ?? ''}</Text></Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {g.values.map((val) => {
                    const active = sel?.[g.key] === val;
                    const ok = optionAvailable(variants, { ...(sel ?? {}), [g.key]: val }, g.key, val) || optionAvailable(variants, {}, g.key, val);
                    return (
                      <Pressable
                        key={val}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${g.key} ${val}`}
                        hitSlop={{ top: 6, bottom: 6 }}
                        onPress={() => setSel(selectOption(variants, sel ?? {}, g.key, val))}
                        style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: radii.hero, borderWidth: active ? 2 : 1, opacity: ok ? 1 : 0.45, borderColor: active ? theme.colors.primary : theme.colors.surfaceBorder, backgroundColor: active ? theme.colors.container : theme.colors.surface }}
                      >
                        <Text size={12} weight={active ? 800 : 600}>{val}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))
          ) : variants.length ? (
            <View style={{ gap: 6 }}>
              <Text size={11} weight={700} color="textMuted">{t('product.packageSizes')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {variants.map((v) => {
                  const active = v.id === variant?.id;
                  return (
                    <Pressable key={v.id} accessibilityRole="button" accessibilityState={{ selected: active, disabled: !v.in_stock }} hitSlop={{ top: 6, bottom: 6 }} onPress={() => setVariantId(v.id)} style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: radii.hero, borderWidth: active ? 2 : 1, opacity: v.in_stock ? 1 : 0.5, borderColor: active ? theme.colors.primary : theme.colors.surfaceBorder, backgroundColor: active ? theme.colors.container : theme.colors.surface }}>
                      <Text size={12} weight={active ? 800 : 600}>{v.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          {groups.length && sel && !variant ? <Text size={11} color="warning" weight={600}>{t('product.notAvailable')}</Text> : null}

          {/* Quantity */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text size={12} weight={700} color="textMuted">{weight ? t('product.weight') : t('product.quantity')}</Text>
            <QtyStepper qty={qty} unit={weight ? p.unit : undefined} rules={{ ...rules, min: rules.step }} onChange={(n) => setQty(n <= 0 ? rules.min : n)} />
          </View>

          {/* Delivery: only from a POS value; hidden otherwise */}
          {etaText ? (
            <Card radius={radii.card} padding={12}>
              <Text size={12} weight={700}>🚚 {t('product.estDelivery')}: <Text size={12} weight={600} color="textMuted">{etaText}</Text></Text>
            </Card>
          ) : null}

          {/* Description + details */}
          {desc ? (
            <View style={{ gap: 4 }}>
              <Text size={13} weight={800}>{t('product.detailsTitle')}</Text>
              <Text size={12} color="textMuted" lineHeightRatio={1.5}>{desc}</Text>
            </View>
          ) : null}
          <Card radius={radii.card} padding={12}>
            <View style={{ gap: 6 }}>
              {p.category_name ? <Text size={12}><Text size={12} color="textMuted">{t('product.categoryLabel')}: </Text>{p.category_name}</Text> : null}
              {p.brand ? <Text size={12}><Text size={12} color="textMuted">{t('product.brandLabel')}: </Text>{p.brand}</Text> : null}
              <Text size={12}><Text size={12} color="textMuted">{t('product.unitLabel')}: </Text>{p.unit}</Text>
            </View>
          </Card>

          {/* Reviews */}
          <View style={{ gap: 6 }}>
            <Text size={13} weight={800}>{t('product.reviewsTitle')}</Text>
            {reviews.isError ? null : count === 0 && !rd?.can_review.eligible ? (
              <Text size={12} color="textMuted">{t('product.noReviews')}</Text>
            ) : null}
            {shownReviews.map((r) => <ReviewRow key={r.id} r={r} t={t} />)}
            {(rd?.items.length ?? 0) > 3 ? (
              <Pressable accessibilityRole="button" onPress={() => setShowAll((v) => !v)} hitSlop={8}>
                <Text size={12} weight={700} color="primary">{showAll ? t('product.showLess') : t('product.seeAllReviews')}</Text>
              </Pressable>
            ) : null}
            {rd?.can_review.eligible ? (
              <Card radius={radii.card} padding={12}>
                <View style={{ gap: 8 }}>
                  <Text size={12} weight={800}>{t('product.writeReview')}</Text>
                  <Text size={11} color="textMuted">{t('product.yourRating')}</Text>
                  <Stars value={stars} size={26} onPick={setStars} />
                  <ReviewInput value={comment} onChange={setComment} placeholder={t('product.commentHint')} />
                  <Button label={t('product.submitReview')} variant="primarySm" disabled={stars < 1 || submit.isPending} onPress={sendReview} />
                </View>
              </Card>
            ) : loggedIn && count >= 0 && !reviews.isError ? (
              <Text size={11} color="textSubtle">{t('product.reviewOnlyAfter')}</Text>
            ) : null}
          </View>

          {/* Similar products (same category, from the offline catalog) */}
          {similar.length ? (
            <View style={{ gap: 8 }}>
              <Text size={13} weight={800}>{t('product.similar')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {similar.map((s) => (
                  <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={s.name} onPress={() => router.push(`/product/${s.id}` as never)} style={{ width: 140, backgroundColor: theme.colors.surface, borderRadius: radii.card, borderWidth: 1, borderColor: theme.colors.surfaceBorder, overflow: 'hidden' }}>
                    <View style={{ height: 100, backgroundColor: theme.colors.fill, alignItems: 'center', justifyContent: 'center' }}>
                      {s.thumbnail_url ? <Image source={{ uri: s.thumbnail_url }} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="disk" recyclingKey={s.id} /> : <Text size={36}>{emojiFor(s.category_name ?? s.name)}</Text>}
                    </View>
                    <View style={{ padding: 8, gap: 2 }}>
                      <Text size={12} weight={700} numberOfLines={2} lineHeightRatio={1.25}>{s.name}</Text>
                      <Text size={12} weight={800} color="primary">{s.sale_by === 'weight' ? formatPricePerUnit(s.price, s.unit) : formatRs(s.price)}</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Sticky buy bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.divider }}>
        <View style={{ minWidth: 76 }}>
          <Text size={10} color="textMuted">{t('product.total')}</Text>
          <Text size={15} weight={800} color="primary">{formatRs(lineTotal(unitPrice, qty))}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Button label={t('product.addToCart')} variant="secondaryBlock" fullWidth disabled={!inStock || (groups.length > 0 && !variant)} onPress={addToCart} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={t('product.buyNow')} variant="primaryBlock" fullWidth disabled={!inStock || (groups.length > 0 && !variant)} onPress={buyNow} />
        </View>
      </View>

      <ImageViewer images={images} index={viewer ?? 0} visible={viewer != null} onClose={() => setViewer(null)} />
    </View>
  );
}

function ReviewInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const theme = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.textSubtle}
      multiline
      maxLength={500}
      style={{ minHeight: 70, borderWidth: 1, borderColor: theme.colors.surfaceBorder, borderRadius: radii.input, padding: 10, color: theme.colors.textMain, backgroundColor: theme.colors.surface, textAlignVertical: 'top' }}
    />
  );
}
