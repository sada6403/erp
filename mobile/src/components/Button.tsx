import React from 'react';
import { ActivityIndicator, Pressable, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { makeStyles, radii, shadows, useTheme, type FontWeight } from '@/theme';
import { Text } from './Text';

export type ButtonVariant =
  | 'primaryBlock'
  | 'loginBlock'
  | 'secondaryBlock'
  | 'primarySm' // accent coloured, as in the demo
  | 'secondarySm'
  | 'accentSm'
  | 'checkout'
  | 'link'
  | 'addCart'
  | 'logout'
  | 'drawVideo'
  | 'whatsapp'
  | 'verify'
  | 'printBill'
  | 'apply'
  | 'pdf';

interface Spec {
  minHeight: number;
  radius: number;
  size: number;
  weight: FontWeight;
  padH: number;
  padV: number;
  bg: 'primary' | 'container' | 'accent' | 'surfaceSubtle' | 'errorBg' | 'goldDark' | 'whatsapp' | 'transparent';
  fg: 'white' | 'primary' | 'accentText' | 'textMain' | 'error' | 'textMuted';
  border?: 'primary' | 'surfaceBorder' | 'errorBorder' | 'errorBorderSoft';
  gap?: number;
  shadow?: boolean;
}

const SPECS: Record<ButtonVariant, Spec> = {
  primaryBlock: { minHeight: 48, radius: radii.input, size: 13, weight: 800, padH: 12, padV: 12, bg: 'primary', fg: 'white' },
  loginBlock: { minHeight: 48, radius: radii.input, size: 14, weight: 800, padH: 12, padV: 12, bg: 'primary', fg: 'white' },
  secondaryBlock: { minHeight: 44, radius: radii.input, size: 12, weight: 800, padH: 10, padV: 10, bg: 'container', fg: 'primary', border: 'primary' },
  primarySm: { minHeight: 38, radius: radii.chip, size: 12, weight: 800, padH: 16, padV: 8, bg: 'accent', fg: 'accentText' },
  secondarySm: { minHeight: 38, radius: radii.chip, size: 12, weight: 700, padH: 14, padV: 8, bg: 'surfaceSubtle', fg: 'textMain', border: 'surfaceBorder' },
  accentSm: { minHeight: 40, radius: radii.chip, size: 12, weight: 800, padH: 16, padV: 10, bg: 'accent', fg: 'accentText' },
  checkout: { minHeight: 48, radius: radii.control, size: 14, weight: 800, padH: 18, padV: 12, bg: 'primary', fg: 'white', shadow: true, gap: 8 },
  link: { minHeight: 0, radius: 0, size: 12, weight: 600, padH: 0, padV: 0, bg: 'transparent', fg: 'textMuted' },
  addCart: { minHeight: 38, radius: radii.chip, size: 12, weight: 700, padH: 8, padV: 8, bg: 'container', fg: 'primary', border: 'primary', gap: 4 },
  logout: { minHeight: 44, radius: radii.input, size: 13, weight: 700, padH: 12, padV: 0, bg: 'errorBg', fg: 'error', border: 'errorBorderSoft' },
  drawVideo: { minHeight: 44, radius: radii.input, size: 13, weight: 800, padH: 10, padV: 10, bg: 'goldDark', fg: 'white' },
  whatsapp: { minHeight: 40, radius: radii.chip, size: 12, weight: 700, padH: 8, padV: 8, bg: 'whatsapp', fg: 'white' },
  verify: { minHeight: 42, radius: radii.chip, size: 12, weight: 700, padH: 8, padV: 8, bg: 'primary', fg: 'white', gap: 4 },
  printBill: { minHeight: 42, radius: radii.chip, size: 12, weight: 700, padH: 12, padV: 8, bg: 'surfaceSubtle', fg: 'textMain', border: 'surfaceBorder' },
  apply: { minHeight: 42, radius: radii.chip, size: 12, weight: 700, padH: 16, padV: 0, bg: 'primary', fg: 'white' },
  pdf: { minHeight: 36, radius: radii.chip, size: 11, weight: 700, padH: 12, padV: 6, bg: 'surfaceSubtle', fg: 'textMain', border: 'surfaceBorder' },
};

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  /** Optional leading emoji/icon text. */
  icon?: string;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

const useStyles = makeStyles((t) => ({
  shadow: {
    ...shadows.floatSm,
  },
}));

export function Button({
  label,
  onPress,
  variant = 'primaryBlock',
  disabled,
  loading,
  icon,
  fullWidth,
  style,
  labelStyle,
  accessibilityLabel,
  testID,
}: ButtonProps) {
  const theme = useTheme();
  const styles = useStyles();
  const spec = SPECS[variant];
  const bg = spec.bg === 'transparent' ? theme.colors.transparent : theme.colors[spec.bg];
  const off = disabled || loading;
  const slop = Math.max(0, (48 - spec.minHeight) / 2);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      hitSlop={{ top: slop, bottom: slop }}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: spec.minHeight,
          borderRadius: spec.radius,
          paddingHorizontal: spec.padH,
          paddingVertical: spec.padV,
          backgroundColor: bg,
          borderWidth: spec.border ? 1 : 0,
          borderColor: spec.border ? theme.colors[spec.border] : undefined,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spec.gap ?? 4,
          opacity: off ? 0.55 : 1,
          alignSelf: fullWidth ? 'stretch' : undefined,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        spec.shadow ? styles.shadow : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors[spec.fg]} size="small" />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spec.gap ?? 4 }}>
          {icon ? <Text size={spec.size}>{icon}</Text> : null}
          <Text
            weight={spec.weight}
            size={spec.size}
            color={spec.fg}
            style={[spec.fg === 'textMuted' ? { textDecorationLine: 'none' } : null, labelStyle]}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
