import React, { useState } from 'react';
import { Image } from 'expo-image';
import { TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, radii } from '@/theme';
import { Text, useBodyFont } from '@/components/Text';
import { Button } from '@/components/Button';
import { EmptyState, QtyStepper, StepIndicator } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { cartSubtotal, rulesFor, useCartStore } from '@/store/cartStore';
import { selectIsLoggedIn, useSessionStore } from '@/store/sessionStore';
import { formatPricePerUnit, formatRs, lineTotal } from '@/lib/money';
import { useServerActionGuard } from '@/features/common/hooks';
import { DEV_COUPON, couponAvailable } from '@/features/shop/coupon';

/** Checkout step 1: review items + promo code. Prices here are last-seen; the server quote in step 3 is final. */
export default function CartScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const font = useBodyFont();
  const router = useRouter();
  const lines = useCartStore((s) => s.lines);
  const setQty = useCartStore((s) => s.setQty);
  const couponCode = useCartStore((s) => s.couponCode);
  const setCoupon = useCartStore((s) => s.setCoupon);
  const loggedIn = useSessionStore(selectIsLoggedIn);
  const setPending = useSessionStore((s) => s.setPendingRoute);
  const guard = useServerActionGuard();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<'ok' | 'bad' | null>(couponCode ? 'ok' : null);

  const proceed = () =>
    guard(() => {
      if (!loggedIn) {
        setPending('/checkout');
        router.push('/login');
      } else router.push('/checkout');
    });

  const apply = () => {
    if (code.trim().toUpperCase() === DEV_COUPON.code) {
      setCoupon(DEV_COUPON.code);
      setMsg('ok');
    } else {
      setCoupon(null);
      setMsg('bad');
    }
  };

  return (
    <Screen gap={0}>
      <StepIndicator step={1} labels={[t('checkout.stepCart'), t('checkout.stepAddress'), t('checkout.stepPayment')]} />
      <Text size={15} weight={800} style={{ marginBottom: 12 }}>
        {t('cart.review')}
      </Text>

      <View style={{ gap: 10, marginBottom: 14 }}>
        {lines.length === 0 ? (
          <EmptyState icon="🛒" title={t('cart.empty')} body={t('cart.emptyBody')} />
        ) : (
          lines.map((l) => (
            <View
              key={l.key}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: theme.colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: theme.colors.surfaceBorder }}
            >
              <View style={{ width: 50, height: 50, borderRadius: radii.chip, backgroundColor: theme.colors.fill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {l.thumbnail ? <Image source={{ uri: l.thumbnail }} style={{ width: 50, height: 50 }} cachePolicy="disk" /> : <Text size={24}>{l.emoji ?? '🌿'}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text size={12} weight={700} numberOfLines={2}>
                  {l.name}
                  {l.variantName ? ` · ${l.variantName}` : ''}
                </Text>
                <Text size={12} weight={800} color="primary" style={{ marginTop: 2 }}>
                  {l.saleBy === 'weight' ? formatPricePerUnit(l.unitPrice, l.unit) : formatRs(l.unitPrice)}
                </Text>
                {l.saleBy === 'weight' ? (
                  <Text size={10} color="textMuted">
                    {formatRs(lineTotal(l.unitPrice, l.qty))}
                  </Text>
                ) : null}
              </View>
              <QtyStepper qty={l.qty} unit={l.unit} rules={rulesFor(l)} onChange={(n) => setQty(l.key, n)} />
            </View>
          ))
        )}
      </View>

      {lines.length > 0 ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
          <Text size={12} color="textMuted">
            {t('cart.subtotalApprox')}
          </Text>
          <Text size={13} weight={800}>
            {formatRs(cartSubtotal(lines))}
          </Text>
        </View>
      ) : null}

      <View style={{ backgroundColor: theme.colors.surface, borderRadius: radii.control, borderWidth: 1, borderColor: theme.colors.surfaceBorder, padding: 12, marginBottom: 16, opacity: couponAvailable ? 1 : 0.55 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            accessibilityLabel={t('cart.couponPlaceholder')}
            editable={couponAvailable}
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            placeholder={t('cart.couponPlaceholder')}
            placeholderTextColor={theme.colors.textSubtle}
            style={{ flex: 1, borderWidth: 1, borderColor: theme.colors.surfaceBorder, padding: 10, borderRadius: radii.chip, fontSize: 12, fontFamily: font, color: theme.colors.textMain }}
          />
          <Button label={t('cart.apply')} variant="apply" disabled={!couponAvailable} onPress={apply} />
        </View>
        {couponAvailable && msg ? (
          <Text size={11} weight={600} color={msg === 'ok' ? 'success' : 'error'} style={{ marginTop: 6 }}>
            {msg === 'ok' ? t('cart.couponOk') : t('cart.couponBad')}
          </Text>
        ) : null}
        {!couponAvailable ? (
          <Text size={11} weight={600} color="textMuted" style={{ marginTop: 6 }}>
            {t('soon.badge')}
          </Text>
        ) : null}
      </View>

      <Button label={`${t('cart.proceed')} ➔`} variant="checkout" fullWidth disabled={lines.length === 0} onPress={proceed} />
      {lines.length > 0 ? (
        <Text size={10} color="textMuted" style={{ marginTop: 8 }}>
          {t('cart.priceNote')}
        </Text>
      ) : null}
    </Screen>
  );
}
