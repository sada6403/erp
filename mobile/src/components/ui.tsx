import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeStyles, radii, useTheme, type ThemeColors } from '@/theme';
import { stepQty, formatQty, type QtyRules } from '@/lib/money';
import { Text, useBodyFont } from './Text';
import { Button } from './Button';
import { Gradient } from './Gradient';

/** White rounded card with the demo's 1px border. */
export function Card({
  children,
  style,
  radius = radii.card,
  padding = 14,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  padding?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const base: ViewStyle = {
    backgroundColor: t.colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: t.colors.surfaceBorder,
    padding,
  };
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [base, { opacity: pressed ? 0.92 : 1 }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

/** Small coloured status label (paid/due/out for delivery...). */
export function Badge({
  label,
  bg,
  fg,
  radius = radii.sm,
  size = 10,
  style,
}: {
  label: string;
  bg: keyof ThemeColors;
  fg: keyof ThemeColors;
  radius?: number;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View style={[{ backgroundColor: t.colors[bg], paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius }, style]}>
      <Text size={size} weight={800} color={fg}>
        {label}
      </Text>
    </View>
  );
}

/** Pill chip: category pills, role chips, cycle pill. */
export function Pill({
  label,
  active,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
    >
      <View
        style={{
          minHeight: 36,
          paddingHorizontal: 14,
          paddingVertical: 6,
          borderRadius: radii.hero,
          borderWidth: 1,
          justifyContent: 'center',
          backgroundColor: active ? t.colors.container : t.colors.surface,
          borderColor: active ? t.colors.primary : t.colors.surfaceBorder,
        }}
      >
        <Text size={12} weight={700} color={active ? 'primary' : 'textMuted'}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export function SectionHeader({ icon, title, right }: { icon?: string; title: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
        {icon ? <Text size={18}>{icon}</Text> : null}
        <Text size={16} weight={800} numberOfLines={1} style={{ flexShrink: 1 }}>
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

export function ScreenHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <View>
      <Text size={18} weight={800}>
        {title}
      </Text>
      {sub ? (
        <Text size={12} color="textMuted" style={{ marginTop: 3, marginBottom: 16 }}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/** Progress track with a primary-to-accent gradient fill. */
export function ProgressBar({ pct, from, to }: { pct: number; from?: string; to?: string }) {
  const t = useTheme();
  const width = `${Math.max(0, Math.min(100, pct))}%` as const;
  return (
    <View style={{ height: 8, backgroundColor: t.colors.slate200, borderRadius: radii.sm, overflow: 'hidden' }}>
      <Gradient
        direction="horizontal"
        from={from ?? t.colors.primary}
        to={to ?? t.colors.accent}
        style={{ width, height: '100%' }}
      />
    </View>
  );
}

export function MetricCard({ value, label, highlight }: { value: string; label: string; highlight?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: highlight ? t.colors.container : t.colors.surfaceSubtle,
        borderRadius: radii.input,
        borderWidth: highlight ? 1 : 0,
        borderColor: t.colors.primary,
        paddingVertical: 10,
        paddingHorizontal: 8,
        alignItems: 'center',
      }}
    >
      <Text size={14} weight={800} color={highlight ? 'primary' : 'textMain'} align="center">
        {value}
      </Text>
      <Text size={10} weight={600} color="textMuted" align="center" style={{ marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}

export function EmptyState({ icon = '🛒', title, body, actionLabel, onAction }: { icon?: string; title: string; body?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 12 }}>
      <Text size={40} style={{ marginBottom: 8 }}>
        {icon}
      </Text>
      <Text size={14} weight={800} align="center">
        {title}
      </Text>
      {body ? (
        <Text size={11} color="textMuted" align="center" style={{ marginTop: 4 }}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} variant="secondaryBlock" onPress={onAction} style={{ marginTop: 16, alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return <EmptyState icon="⚠️" title={message ?? t('common.error')} actionLabel={onRetry ? t('common.retry') : undefined} onAction={onRetry} />;
}

export function Skeleton({ height = 16, width, radius = 8, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ height, width: width ?? '100%', borderRadius: radius, backgroundColor: t.colors.fill }, style]} />;
}

export function SkeletonList({ rows = 4, height = 72 }: { rows?: number; height?: number }) {
  return (
    <View style={{ gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} radius={radii.card} />
      ))}
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ padding: 32, alignItems: 'center' }}>
      <ActivityIndicator color={t.colors.primary} />
    </View>
  );
}

/** Labelled text input matching .form-group. */
export function Field({
  label,
  error,
  hint,
  left,
  right,
  ...input
}: TextInputProps & { label: string; error?: string; hint?: string; left?: string; right?: React.ReactNode }) {
  const t = useTheme();
  const [focus, setFocus] = React.useState(false);
  const { t: tr } = useTranslation();
  // .input-with-icon (icon on the left) vs the plain .form-group input.
  const plain = !left;
  const font = useBodyFont();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text size={11} weight={700} color="textMuted" style={{ marginBottom: 4 }}>
        {label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: plain ? 44 : undefined,
          borderRadius: plain ? radii.chip : radii.input,
          borderWidth: plain ? 1 : 1.5,
          paddingHorizontal: 12,
          backgroundColor: plain || focus ? t.colors.surface : t.colors.surfaceSubtle,
          borderColor: error ? t.colors.error : focus ? t.colors.primary : t.colors.surfaceBorder,
        }}
      >
        {left ? <Text size={16} color="textMuted" style={{ marginRight: 8 }}>{left}</Text> : null}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={t.colors.textSubtle}
          {...input}
          onFocus={(e) => {
            setFocus(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            input.onBlur?.(e);
          }}
          style={[{ flex: 1, fontSize: 13, fontFamily: font, color: t.colors.textMain, paddingVertical: 10, minHeight: plain ? undefined : 44 }, input.style]}
        />
        {right}
      </View>
      {error ? (
        <Text size={10} color="error" style={{ marginTop: 4 }}>
          {tr(error, { defaultValue: error })}
        </Text>
      ) : hint ? (
        <Text size={10} color="textMuted" style={{ marginTop: 5 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** 3-step checkout indicator: Cart - Address - Payment. */
export function StepIndicator({ step, labels }: { step: 1 | 2 | 3; labels: [string, string, string] }) {
  const t = useTheme();
  const item = (n: 1 | 2 | 3) => {
    const active = n <= step;
    return (
      <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: active ? t.colors.primary : t.colors.fill,
          }}
        >
          <Text size={10} weight={700} color={active ? 'white' : 'textMuted'}>
            {n}
          </Text>
        </View>
        <Text size={11} weight={700} color={active ? 'primary' : 'textMuted'}>
          {labels[n - 1]}
        </Text>
      </View>
    );
  };
  const line = (k: string) => <View key={k} style={{ flex: 1, height: 2, backgroundColor: t.colors.slate200, marginHorizontal: 8 }} />;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: t.colors.surface,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: radii.control,
        borderWidth: 1,
        borderColor: t.colors.surfaceBorder,
        marginBottom: 16,
      }}
    >
      {item(1)}
      {line('a')}
      {item(2)}
      {line('b')}
      {item(3)}
    </View>
  );
}

const useQtyStyles = makeStyles((t) => ({
  btn: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: t.colors.surfaceBorder,
    backgroundColor: t.colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hit: { alignItems: 'center', justifyContent: 'center' },
}));

/** +/- quantity control. Weight items step by 0.25 kg and show decimals. */
export function QtyStepper({ qty, unit, rules, onChange }: { qty: number; unit?: string; rules: QtyRules; onChange: (next: number) => void }) {
  const s = useQtyStyles();
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('cart.decrease')} hitSlop={8} style={s.hit} onPress={() => onChange(stepQty(qty, -1, rules))}>
        <View style={s.btn}>
          <Text size={14} weight={700}>−</Text>
        </View>
      </Pressable>
      <Text size={13} weight={700} align="center" style={{ minWidth: 18 }}>
        {formatQty(qty, unit)}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('cart.increase')} hitSlop={8} style={s.hit} onPress={() => onChange(stepQty(qty, 1, rules))}>
        <View style={s.btn}>
          <Text size={14} weight={700}>+</Text>
        </View>
      </Pressable>
    </View>
  );
}
