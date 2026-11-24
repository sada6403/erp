import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { PaymentMethod } from '@contracts/common';
import type { QuoteRequest } from '@contracts/orders';
import { useTheme, radii } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Card, ErrorState, Field, Loading, StepIndicator } from '@/components/ui';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Shell';
import { toQuoteItems, useCartStore } from '@/store/cartStore';
import { selectIsLoggedIn, useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import { uuid } from '@/store/outboxStore';
import { formatPhone } from '@/lib/format';
import { formatQty, formatRs } from '@/lib/money';
import { zodResolver } from '@/lib/zodResolver';
import { errorMessage } from '@/lib/errors';
import { toAppError } from '@/api/client';
import { addressSchema, type AddressForm } from '@/features/auth/schemas';
import { useAddresses, useBranches, useCreateAddress, useCreateOrder, useQuote } from '@/features/shop/hooks';
import { useModules, useServerActionGuard, useServerStatus } from '@/features/common/hooks';
import { DEV_COUPON, couponAvailable } from '@/features/shop/coupon';

/** Checkout steps 2 (address + branch) and 3 (payment + server quote + place order). */
export default function CheckoutScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const loggedIn = useSessionStore(selectIsLoggedIn);
  const lines = useCartStore((s) => s.lines);
  const clearCart = useCartStore((s) => s.clear);
  const couponCode = useCartStore((s) => s.couponCode);
  const setBranchName = useSessionStore((s) => s.setBranchName);
  const showToast = useUiStore((s) => s.showToast);
  const guard = useServerActionGuard();
  const modules = useModules();
  const { data: status } = useServerStatus();

  const [step, setStep] = useState<2 | 3>(2);
  const [pickedAddress, setAddressId] = useState<string | null>(null);
  const [pickedBranch, setBranchId] = useState<string | undefined>();
  const [method, setMethod] = useState<PaymentMethod>('cod');
  const [reference, setReference] = useState('');
  const [adding, setAdding] = useState(false);
  const idemKey = useRef(uuid());

  const addresses = useAddresses();
  const branches = useBranches();
  const createAddress = useCreateAddress();
  const createOrder = useCreateOrder();
  const form = useForm<AddressForm>({ resolver: zodResolver(addressSchema), defaultValues: { label: '', recipient_name: '', phone: '', line1: '', city: '' } });

  const list = addresses.data?.items ?? [];
  const addressId = pickedAddress ?? (list.find((a) => a.is_default) ?? list[0])?.id ?? null;
  const branchList = branches.data?.items;
  const branchId = pickedBranch ?? branchList?.[0]?.id;
  const firstBranchName = branchList?.[0]?.name;
  useEffect(() => {
    if (!pickedBranch && firstBranchName) setBranchName(firstBranchName);
  }, [pickedBranch, firstBranchName, setBranchName]);

  const req: QuoteRequest | null =
    step === 3 && lines.length ? { items: toQuoteItems(lines), branch_id: branchId, address_id: addressId ?? undefined, payment_method: method } : null;
  const quote = useQuote(req, JSON.stringify(req));

  if (!loggedIn) return <Redirect href="/login" />;
  if (lines.length === 0) return <Redirect href="/cart" />;

  const bankEnabled = status?.bank_transfer.enabled ?? false;
  const selectedBranch = branches.data?.items.find((b) => b.id === branchId);

  const saveAddress = form.handleSubmit(async (v) => {
    try {
      const a = await createAddress.mutateAsync({ ...v, line2: null, district: null, postal_code: null, latitude: null, longitude: null, is_default: list.length === 0 });
      setAddressId(a.id);
      setAdding(false);
      form.reset();
    } catch (e) {
      showToast(errorMessage(e, t));
    }
  });

  const place = () =>
    guard(async () => {
      if (!quote.data || !addressId) return;
      try {
        const order = await createOrder.mutateAsync({
          key: idemKey.current,
          body: { items: toQuoteItems(lines), branch_id: branchId, address_id: addressId, payment_method: method, payment_reference: method === 'bank_transfer' ? reference || undefined : undefined, expected_total: quote.data.total },
        });
        clearCart();
        idemKey.current = uuid();
        showToast(t('track.placed', { n: order.order_number }));
        router.replace({ pathname: '/order-confirmed', params: { id: order.id } });
      } catch (e) {
        const err = toAppError(e);
        if (err.code === 'PRICE_CHANGED' || err.code === 'OUT_OF_STOCK') quote.refetch();
        showToast(errorMessage(e, t));
      }
    });

  const radio = (active: boolean) => (
    <View style={{ width: 20, height: 20, borderRadius: radii.circle, borderWidth: 2, borderColor: active ? theme.colors.primary : theme.colors.slate300, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
      {active ? <View style={{ width: 10, height: 10, borderRadius: radii.circle, backgroundColor: theme.colors.primary }} /> : null}
    </View>
  );
  const optionStyle = (active: boolean) => ({
    flexDirection: 'row' as const,
    gap: 10,
    padding: 12,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: active ? theme.colors.primary : theme.colors.surfaceBorder,
    backgroundColor: active ? theme.colors.container : theme.colors.surface,
  });
  const row = (label: string, value: string, opts?: { success?: boolean; error?: boolean }) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
      <Text size={12} weight={opts?.success ? 700 : 400} color={opts?.success ? 'success' : opts?.error ? 'error' : 'textMuted'} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <Text size={12} weight={opts?.success ? 700 : 400} color={opts?.success ? 'success' : 'textMuted'}>
        {value}
      </Text>
    </View>
  );
  // Dev mocks only: the demo's PLANT2026 line is display-only, the quote total stays the server's number.
  const devDiscount = couponAvailable && couponCode === DEV_COUPON.code ? DEV_COUPON.amount : 0;

  return (
    <Screen gap={0}>
      <StepIndicator step={step} labels={[t('checkout.stepCart'), t('checkout.stepAddress'), t('checkout.stepPayment')]} />

      {step === 2 ? (
        <>
          <Text size={15} weight={800} style={{ marginBottom: 12 }}>
            {t('checkout.addressTitle')}
          </Text>
          {addresses.isLoading ? <Loading /> : addresses.isError ? <ErrorState onRetry={() => addresses.refetch()} /> : null}
          <View style={{ gap: 10, marginBottom: 14 }}>
            {list.map((a) => (
              <Pressable key={a.id} accessibilityRole="radio" accessibilityState={{ selected: addressId === a.id }} onPress={() => setAddressId(a.id)} style={optionStyle(addressId === a.id)}>
                {radio(addressId === a.id)}
                <View style={{ flex: 1 }}>
                  <Text size={13} weight={700}>
                    {a.label} — {a.recipient_name}
                  </Text>
                  <Text size={11} color="textMuted" style={{ marginVertical: 2 }}>
                    {[a.line1, a.line2, a.city].filter(Boolean).join(', ')}
                  </Text>
                  <Text size={10} weight={700} color="primary">
                    📞 {formatPhone(a.phone)}
                    {selectedBranch ? ` • ${t('checkout.servicedBy', { branch: selectedBranch.name })}` : ''}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>

          {adding ? (
            <Card style={{ marginBottom: 14 }}>
              <FormField control={form.control} name="label" label={t('checkout.addrLabel')} />
              <FormField control={form.control} name="recipient_name" label={t('checkout.addrName')} />
              <FormField control={form.control} name="phone" label={t('auth.mobile')} keyboardType="phone-pad" />
              <FormField control={form.control} name="line1" label={t('checkout.addrLine')} />
              <FormField control={form.control} name="city" label={t('checkout.addrCity')} />
              <Button label={t('checkout.saveAddress')} loading={createAddress.isPending} onPress={saveAddress} fullWidth />
              <Button label={t('common.cancel')} variant="link" onPress={() => setAdding(false)} style={{ marginTop: 12 }} />
            </Card>
          ) : (
            <Button label={`+ ${t('checkout.addAddress')}`} variant="secondaryBlock" fullWidth onPress={() => setAdding(true)} style={{ marginBottom: 14 }} />
          )}

          {(branches.data?.items.length ?? 0) > 1 ? (
            <View style={{ marginBottom: 14 }}>
              <Text size={11} weight={700} color="textMuted" style={{ marginBottom: 6 }}>
                {t('checkout.branch')}
              </Text>
              <View style={{ gap: 10 }}>
                {branches.data!.items.map((b) => (
                  <Pressable
                    key={b.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: branchId === b.id }}
                    onPress={() => {
                      setBranchId(b.id);
                      setBranchName(b.name);
                    }}
                    style={optionStyle(branchId === b.id)}
                  >
                    {radio(branchId === b.id)}
                    <View style={{ flex: 1 }}>
                      <Text size={13} weight={700}>
                        {b.name}
                      </Text>
                      {b.address ? (
                        <Text size={11} color="textMuted" style={{ marginTop: 2 }}>
                          {b.address}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: radii.control, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.primary, backgroundColor: theme.colors.surface, marginBottom: 16 }}>
            <Text size={24}>🛵</Text>
            <View style={{ flex: 1 }}>
              <Text size={12} weight={700}>
                {t('checkout.speedTitle')}
              </Text>
              <Text size={11} color="textMuted" style={{ marginTop: 2 }}>
                {t('checkout.speedBody')}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label={`← ${t('checkout.backToCart')}`} variant="secondarySm" onPress={() => router.back()} />
            <Button label={`${t('checkout.choosePayment')} ➔`} variant="primarySm" disabled={!addressId} onPress={() => setStep(3)} style={{ flex: 1 }} />
          </View>
        </>
      ) : (
        <>
          <Text size={15} weight={800} style={{ marginBottom: 12 }}>
            {t('checkout.paymentTitle')}
          </Text>
          <View style={{ gap: 10, marginBottom: 16 }}>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: method === 'cod' }} onPress={() => setMethod('cod')} style={optionStyle(method === 'cod')}>
              {radio(method === 'cod')}
              <View style={{ flex: 1 }}>
                <Text size={13} weight={700}>
                  {t('checkout.cod')}
                </Text>
                <Text size={11} color="textMuted" style={{ marginTop: 2 }}>
                  {t('checkout.codBody')}
                </Text>
              </View>
            </Pressable>
            {/* Wallet payment has no backend yet: drawn like the demo, disabled. */}
            {modules.smartbuy ? (
              <View style={[optionStyle(false), { opacity: 0.55 }]} accessibilityState={{ disabled: true }}>
                {radio(false)}
                <View style={{ flex: 1 }}>
                  <Text size={13} weight={700}>
                    {t('checkout.wallet')}
                  </Text>
                  <Text size={11} color="textMuted" style={{ marginTop: 2 }}>
                    {t('checkout.walletBody')}
                  </Text>
                  <Text size={10} weight={700} color="primary" style={{ marginTop: 4 }}>
                    {t('soon.badge')}
                  </Text>
                </View>
              </View>
            ) : null}
            {/* Bank slip: selectable only when the company enabled bank transfer, otherwise drawn but disabled. */}
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: method === 'bank_transfer', disabled: !bankEnabled }}
              disabled={!bankEnabled}
              onPress={() => setMethod('bank_transfer')}
              style={[optionStyle(method === 'bank_transfer'), { opacity: bankEnabled ? 1 : 0.55 }]}
            >
              {radio(method === 'bank_transfer')}
              <View style={{ flex: 1 }}>
                <Text size={13} weight={700}>
                  {t('checkout.bank')}
                </Text>
                <Text size={11} color="textMuted" style={{ marginTop: 2 }}>
                  {bankEnabled && status?.bank_transfer.instructions ? status.bank_transfer.instructions : t('checkout.bankBody')}
                </Text>
                {!bankEnabled ? (
                  <Text size={10} weight={700} color="primary" style={{ marginTop: 4 }}>
                    {t('soon.badge')}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          </View>
          {method === 'bank_transfer' ? <Field label={t('checkout.bankRef')} value={reference} onChangeText={setReference} /> : null}

          <Card padding={14} radius={radii.lg} style={{ marginBottom: 16 }}>
            {quote.isLoading ? (
              <Loading />
            ) : quote.isError || !quote.data ? (
              <ErrorState onRetry={() => quote.refetch()} />
            ) : (
              <>
                {quote.data.lines
                  .filter((l) => l.issue)
                  .map((l) => (
                    <View key={`${l.product_id}:${l.variant_id}`}>{row(`${l.name} × ${formatQty(l.quantity, l.unit)} — ${t(`checkout.issue.${l.issue}`)}`, formatRs(l.line_total), { error: true })}</View>
                  ))}
                {row(t('checkout.sumSubtotal'), formatRs(quote.data.subtotal))}
                {row(selectedBranch ? t('checkout.sumDeliveryBranch', { branch: selectedBranch.name }) : t('checkout.sumDelivery'), formatRs(quote.data.delivery_fee))}
                {devDiscount > 0 ? row(t('checkout.sumCoupon', { code: DEV_COUPON.code }), `-${formatRs(devDiscount)}`, { success: true }) : null}
                <Text size={11} color="textSubtle">
                  {t('checkout.pricesIncludeTax')}
                </Text>
                <View style={{ height: 1, backgroundColor: theme.colors.surfaceBorder, marginVertical: 8 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text size={15} weight={700}>
                    {t('checkout.sumTotal')}
                  </Text>
                  <Text size={15} weight={700}>
                    {formatRs(Math.max(0, quote.data.total - devDiscount))}
                  </Text>
                </View>
              </>
            )}
          </Card>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label={`← ${t('common.back')}`} variant="secondarySm" onPress={() => setStep(2)} />
            <Button
              label={`${t('checkout.placeOrder')} ➔`}
              variant="checkout"
              loading={createOrder.isPending}
              disabled={!quote.data || !quote.data.can_order}
              onPress={place}
              style={{ flex: 1 }}
            />
          </View>
        </>
      )}
    </Screen>
  );
}
