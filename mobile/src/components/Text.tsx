import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { fontFamily, monoFamily, useTheme, type FontWeight, type ThemeColors } from '@/theme';
import { useThemeStore } from '@/store/themeStore';

export interface TextProps extends RNTextProps {
  weight?: FontWeight;
  size?: number;
  /** Theme colour token name. Defaults to textMain. */
  color?: keyof ThemeColors;
  /** JetBrains Mono for numbers, OTP and receipts. */
  mono?: boolean;
  align?: TextStyle['textAlign'];
  lineHeightRatio?: number;
}

/** App text: theme colour tokens + the right font face for the current language. */
export function Text({
  weight = 400,
  size = 13,
  color = 'textMain',
  mono = false,
  align,
  lineHeightRatio,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();
  const lang = useThemeStore((s) => s.language);
  const family = mono ? monoFamily(weight) : fontFamily(weight, lang);
  return (
    <RNText
      {...rest}
      style={[
        {
          fontFamily: family,
          fontSize: size,
          color: theme.colors[color],
          textAlign: align,
          lineHeight: lineHeightRatio ? Math.round(size * lineHeightRatio) : undefined,
          // Android adds font padding that makes Tamil/Sinhala glyphs clip.
          includeFontPadding: false,
        },
        style,
      ]}
    />
  );
}
