import React from 'react';
import { ActivityIndicator, Pressable, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { makeStyles, radii, useTheme, type FontWeight } from '@/theme';
import { Text } from './Text';

export type ButtonVariant =
  | 'primaryBlock'
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
  border?: 'primary' | 'surfaceBorder' | 'errorBorder';
  shadow?: boolean;
}

const SPECS: Record<ButtonVariant, Spec> = {
  primaryBlock: { minHeight: 48, radius: radii.input, size: 13, weight: 800, padH: 12, padV: 12, bg: 'primary', fg: 'white' },
  secondaryBlock: { minHeight: 48, radius: radii.input, size: 12, weight: 800, padH: 12, padV: 10, bg: 'container', fg: 'primary', border: 'primary' },
  primarySm: { minHeight: 48, radius: radii.chip, size: 12, weight: 800, padH: 16, padV: 8, bg: 'accent', fg: 'accentText' },
  secondarySm: { minHeight: 48, radius: radii.chip, size: 12, weight: 700, padH: 14, padV: 8, bg: 'surfaceSubtle', fg: 'textMain', border: 'surfaceBorder' },
  accentSm: { minHeight: 48, radius: radii.chip, size: 12, weight: 800, padH: 16, padV: 10, bg: 'accent', fg: 'accentText' },
  checkout: { minHeight: 48, radius: radii.control, size: 14, weight: 800, padH: 18, padV: 12, bg: 'primary', fg: 'white', shadow: true },
  link: { minHeight: 48, radius: radii.input, size: 12, weight: 600, padH: 12, padV: 8, bg: 'transparent', fg: 'textMuted' },
  addCart: { minHeight: 48, radius: radii.chip, size: 12, weight: 700, padH: 8, padV: 8, bg: 'container', fg: 'primary', border: 'primary' },
  logout: { minHeight: 48, radius: radii.input, size: 13, weight: 700, padH: 12, padV: 10, bg: 'errorBg', fg: 'error', border: 'errorBorder' },
  drawVideo: { minHeight: 48, radius: radii.input, size: 13, weight: 800, padH: 10, padV: 10, bg: 'goldDark', fg: 'white' },
  whatsapp: { minHeight: 48, radius: radii.chip, size: 12, weight: 700, padH: 8, padV: 8, bg: 'whatsapp', fg: 'white' },
  verify: { minHeight: 48, radius: radii.chip, size: 12, weight: 700, padH: 8, padV: 8, bg: 'primary', fg: 'white' },
  printBill: { minHeight: 48, radius: radii.chip, size: 12, weight: 700, padH: 12, padV: 8, bg: 'surfaceSubtle', fg: 'textMain', border: 'surfaceBorder' },
  apply: { minHeight: 48, radius: radii.chip, size: 12, weight: 700, padH: 16, padV: 0, bg: 'primary', fg: 'white' },
  pdf: { minHeight: 48, radius: radii.chip, size: 11, weight: 700, padH: 12, padV: 6, bg: 'surfaceSubtle', fg: 'textMain', border: 'surfaceBorder' },
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
    shadowColor: t.colors.shadow,
    shadowOpacity: 0.15,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
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
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
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
          gap: 6,
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {icon ? <Text size={spec.size + 2}>{icon}</Text> : null}
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
