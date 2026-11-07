import React from 'react';
import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { EmptyState, QtyStepper, StepIndicator } from '@/components/ui';
import { Screen } from '@/components/Shell';
import { cartSubtotal, rulesFor, useCartStore } from '@/store/cartStore';
import { selectIsLoggedIn, useSessionStore } from '@/store/sessionStore';
import { formatPricePerUnit, formatRs, lineTotal } from '@/lib/money';
import { useServerActionGuard } from '@/features/common/hooks';

/** Checkout step 1: review items. Prices here are last-seen; the server quote in step 3 is final. */
export default function CartScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const lines = useCartStore((s) => s.lines);
  const setQty = useCartStore((s) => s.setQty);
  const remove = useCartStore((s) => s.remove);
  const loggedIn = useSessionStore(selectIsLoggedIn);
  const setPending = useSessionStore((s) => s.setPendingRoute);
  const guard = useServerActionGuard();

  const proceed = () =>
    guard(() => {
      if (!loggedIn) {
        setPending('/checkout');
        router.push('/login');
      } else router.push('/checkout');
    });

  return (
    <Screen>
      <StepIndicator step={1} labels={[t('checkout.stepCart'), t('checkout.stepAddress'), t('checkout.stepPayment')]} />
      <Text size={15} weight={800}>{t('cart.review')}</Text>
      {lines.length === 0 ? (
        <EmptyState icon="🛒" title={t('cart.empty')} body={t('cart.emptyBody')} actionLabel={t('cart.startShopping')} onAction={() => router.navigate('/')} />
      ) : (
        <>
          <View style={{ gap: 10 }}>
            {lines.map((l) => (
              <View key={l.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: theme.colors.surface, borderRadius: radii.control + 2, borderWidth: 1, borderColor: theme.colors.surfaceBorder }}>
                <View style={{ width: 50, height: 50, borderRadius: radii.chip, backgroundColor: theme.colors.fill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {l.thumbnail ? <Image source={{ uri: l.thumbnail }} style={{ width: 50, height: 50 }} cachePolicy="disk" /> : <Text size={24}>{l.emoji ?? '🌿'}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text size={12} weight={700} numberOfLines={2}>{l.name}{l.variantName ? ` · ${l.variantName}` : ''}</Text>
                  <Text size={12} weight={800} color="primary" style={{ marginTop: 2 }}>
                    {l.saleBy === 'weight' ? formatPricePerUnit(l.unitPrice, l.unit) : formatRs(l.unitPrice)}
                  </Text>
                  {l.saleBy === 'weight' ? <Text size={10} color="textMuted">{formatRs(lineTotal(l.unitPrice, l.qty))}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <QtyStepper qty={l.qty} unit={l.unit} rules={rulesFor(l)} onChange={(n) => setQty(l.key, n)} />
                  <Pressable accessibilityRole="button" accessibilityLabel={t('cart.remove')} onPress={() => remove(l.key)} style={{ minHeight: 32, justifyContent: 'center' }}>
                    <Text size={10} weight={700} color="error">{t('cart.remove')}</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text size={12} color="textMuted">{t('cart.subtotalApprox')}</Text>
            <Text size={13} weight={800}>{formatRs(cartSubtotal(lines))}</Text>
          </View>
          <Text size={10} color="textMuted">{t('cart.priceNote')}</Text>
          <Button label={t('cart.proceed')} variant="checkout" onPress={proceed} />
        </>
      )}
    </Screen>
  );
}
