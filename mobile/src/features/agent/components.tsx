import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { makeStyles, monoFamily, radii, shadows, useTheme } from '@/theme';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { BottomSheet } from '@/components/Overlays';
import { errorMessage } from '@/lib/errors';
import { formatRs } from '@/lib/money';
import { useUiStore } from '@/store/uiStore';
import { useCompleteDelivery, type DeliveryItem } from './hooks';
import { MOCK_FEATURES } from './devFeatures';
import { textToHtml } from './receipt';

/** Small muted "Coming in the next update" note used under disabled no-backend features. */
export function SoonNote() {
  const { t } = useTranslation();
  return (
    <Text size={11} color="textMuted" align="center">
      {t('soon.badge')}
    </Text>
  );
}

/** Square checkbox (the demo's native checkbox), 48 dp touch row. */
export function CheckRow({ checked, onChange, children, label }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; label: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: radii.xs,
          borderWidth: 2,
          borderColor: checked ? theme.colors.primary : theme.colors.slate300,
          backgroundColor: checked ? theme.colors.primary : theme.colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? (
          <Text size={12} weight={800} color="white">
            {'✓'}
          </Text>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

const DIGITS = 4;
const emptyDigits = () => Array<string>(DIGITS).fill('');

/** Demo agentOtpModal: bottom sheet with 4 OTP boxes, cash confirmation and "Verify OTP & Finish Handover". */
function OtpBody({ onClose, delivery }: { onClose: () => void; delivery: DeliveryItem }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const showToast = useUiStore((s) => s.showToast);
  const complete = useCompleteDelivery();
  const [digits, setDigits] = useState<string[]>(emptyDigits);
  const [focus, setFocus] = useState(0);
  const [cashOk, setCashOk] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const refs = useRef<(React.ElementRef<typeof TextInput> | null)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    const id = setTimeout(() => refs.current[0]?.focus(), 100);
    return () => clearTimeout(id);
  }, []);

  const onChange = (i: number, raw: string) => {
    const v = raw.replace(/\D/g, '');
    setFeedback(null);
    if (v.length > 1) {
      const next = emptyDigits();
      v.slice(0, DIGITS).split('').forEach((c, k) => {
        next[k] = c;
      });
      setDigits(next);
      refs.current[Math.min(DIGITS - 1, v.length)]?.focus();
      return;
    }
    setDigits((d) => d.map((c, k) => (k === i ? v : c)));
    if (v && i < DIGITS - 1) refs.current[i + 1]?.focus();
  };
  const onKey = (i: number, key: string) => {
    if (key === 'Backspace' && !digits[i] && i > 0) {
      setDigits((d) => d.map((c, k) => (k === i - 1 ? '' : c)));
      refs.current[i - 1]?.focus();
    }
  };

  const submit = async () => {
    const otp = digits.join('');
    if (otp.length < DIGITS) return setFeedback({ kind: 'error', text: t('agent.otpIncomplete') });
    if (delivery.collect_cash && !cashOk) return setFeedback({ kind: 'error', text: t('agent.cashRequired') });
    try {
      const r = await complete.mutateAsync({ delivery, otp });
      if (r === 'wrong_otp') {
        setFeedback({ kind: 'error', text: t('agent.otpWrong') });
        setDigits(emptyDigits());
        refs.current[0]?.focus();
        return;
      }
      setFeedback({ kind: 'success', text: r === 'queued' ? t('agent.queued') : t('agent.otpOk') });
      timer.current = setTimeout(() => {
        onClose();
        showToast(r === 'queued' ? t('agent.queued') : t('agent.completedToast', { id: delivery.order_number }));
        router.replace('/deliveries');
      }, 850);
    } catch (e) {
      setFeedback({ kind: 'error', text: errorMessage(e, t) });
      setDigits(emptyDigits());
    }
  };

  return (
    <>
      <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
        <Text size={10} weight={800} color="primary" letterSpacing={0.5} style={{ marginBottom: 4 }}>
          {`🛵 ${t('agent.otpBadge')}`}
        </Text>
        <Text size={15} weight={800} style={{ marginBottom: 4 }}>
          {t('agent.completeTitle', { id: delivery.order_number, name: delivery.customer_name })}
        </Text>
        <Text size={12} color="textMuted" lineHeightRatio={1.4} style={{ marginBottom: 14 }}>
          {t('agent.otpDesc')}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 14 }}>
          {digits.map((c, i) => (
            <TextInput
              key={i}
              ref={(r) => {
                refs.current[i] = r;
              }}
              value={c}
              onChangeText={(v) => onChange(i, v)}
              onKeyPress={(e) => onKey(i, e.nativeEvent.key)}
              onFocus={() => setFocus(i)}
              keyboardType="number-pad"
              maxLength={DIGITS}
              selectTextOnFocus
              accessibilityLabel={`${t('agent.enterOtp')} ${i + 1}`}
              style={{
                width: 50,
                height: 56,
                padding: 0,
                borderWidth: 2,
                borderRadius: radii.input,
                borderColor: focus === i ? theme.colors.primary : theme.colors.surfaceBorder,
                backgroundColor: focus === i ? theme.colors.surface : theme.colors.surfaceSubtle,
                color: theme.colors.textMain,
                textAlign: 'center',
                fontSize: 24,
                fontFamily: monoFamily(800),
                includeFontPadding: false,
              }}
            />
          ))}
        </View>
        <View style={{ minHeight: 18, marginBottom: 10 }}>
          {feedback ? (
            <Text size={12} weight={700} color={feedback.kind === 'error' ? 'error' : 'success'} align="center">
              {feedback.kind === 'error' ? `✕ ${feedback.text}` : `✓ ${feedback.text}`}
            </Text>
          ) : null}
        </View>
        {delivery.collect_cash ? (
          <View style={{ backgroundColor: theme.colors.surfaceSubtle, paddingHorizontal: 10, borderRadius: radii.chip, marginBottom: 16 }}>
            <CheckRow checked={cashOk} onChange={setCashOk} label={t('agent.cashCollectedShort')}>
              <Text size={12}>
                {t('agent.cashPre')}{' '}
                <Text size={12} weight={700}>
                  {formatRs(delivery.amount_due)}
                </Text>{' '}
                {t('agent.cashPost')}
              </Text>
            </CheckRow>
          </View>
        ) : null}
        <Button label={`✓ ${t('agent.verifyFinish')}`} variant="primaryBlock" loading={complete.isPending} onPress={submit} />
      </ScrollView>
    </>
  );
}

/** Bottom sheet wrapper; the body mounts fresh on every open so the boxes start empty. */
export function OtpSheet({ visible, onClose, delivery }: { visible: boolean; onClose: () => void; delivery: DeliveryItem }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} showClose>
      <OtpBody onClose={onClose} delivery={delivery} />
    </BottomSheet>
  );
}

const useStyles = makeStyles((t) => ({
  window: { backgroundColor: t.colors.surface, width: '90%', maxWidth: 380, borderRadius: radii.hero, padding: 18, alignSelf: 'center', ...shadows.modal },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  closeBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginRight: -8, marginVertical: -8 },
  closeDot: { width: 32, height: 32, borderRadius: radii.circle, borderWidth: 1, borderColor: t.colors.surfaceBorder, backgroundColor: t.colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' },
  paper: { backgroundColor: t.colors.goldBg, borderWidth: 1, borderStyle: 'dashed', borderColor: t.colors.warning, borderRadius: radii.sm, padding: 12, maxHeight: 300 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
}));

/** Demo billModal window: 58mm thermal text preview with "Print Receipt" and "WhatsApp PDF". */
export function ReceiptWindow({ text, onClose, onPrinted }: { text: string; onClose: () => void; onPrinted?: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const s = useStyles();
  const showToast = useUiStore((st) => st.showToast);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach(clearTimeout);
  }, []);

  const print = () => {
    // Dev mock only: there is no Bluetooth printing backend yet.
    showToast(`🖨️ ${t('bill.printing', { name: 'ESC-POS-58' })}`);
    timers.current.push(
      setTimeout(() => {
        onPrinted?.();
        showToast(`✓ ${t('bill.printed')}`);
      }, 1000),
    );
  };
  const whatsapp = async () => {
    showToast(`💬 ${t('bill.waOpening')}`);
    try {
      const { uri } = await Print.printToFileAsync({ html: textToHtml(text), width: 226 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch {
      showToast(t('errors.UNKNOWN'));
    }
  };

  return (
    <View style={s.window}>
      <View style={s.head}>
        <Text size={13} weight={800} style={{ flex: 1 }}>
          {t('bill.modalTitle')}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={s.closeBtn}>
          <View style={s.closeDot}>
            <Text size={14}>{'✕'}</Text>
          </View>
        </Pressable>
      </View>
      <ScrollView style={s.paper} nestedScrollEnabled>
        <Text mono size={10.5} lineHeightRatio={1.35} style={{ color: theme.colors.inkSoft }}>
          {text}
        </Text>
      </ScrollView>
      <View style={s.actions}>
        <Button label={t('bill.print')} icon={'🖨️'} variant="primarySm" disabled={!MOCK_FEATURES} onPress={print} style={{ flex: 1 }} />
        <Button label={t('bill.whatsapp')} icon={'💬'} variant="whatsapp" onPress={whatsapp} style={{ flex: 1 }} />
      </View>
      {!MOCK_FEATURES ? (
        <View style={{ marginTop: 8 }}>
          <SoonNote />
        </View>
      ) : null}
    </View>
  );
}

/** Receipt window over the dim overlay as a Modal (commission slip, sample receipt). */
export function ReceiptModal({ visible, text, onClose }: { visible: boolean; text: string; onClose: () => void }) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay, justifyContent: 'center' }]}>
        <ReceiptWindow text={text} onClose={onClose} onPrinted={onClose} />
      </View>
    </Modal>
  );
}
