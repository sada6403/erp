import type { FontWeight } from './tokens';

/** Font files bundled in assets/fonts (loaded in app/_layout.tsx). */
export const fontAssets = {
  PlusJakartaSans_400Regular: require('../../assets/fonts/PlusJakartaSans_400Regular.ttf'),
  PlusJakartaSans_500Medium: require('../../assets/fonts/PlusJakartaSans_500Medium.ttf'),
  PlusJakartaSans_600SemiBold: require('../../assets/fonts/PlusJakartaSans_600SemiBold.ttf'),
  PlusJakartaSans_700Bold: require('../../assets/fonts/PlusJakartaSans_700Bold.ttf'),
  PlusJakartaSans_800ExtraBold: require('../../assets/fonts/PlusJakartaSans_800ExtraBold.ttf'),
  NotoSansTamil_400Regular: require('../../assets/fonts/NotoSansTamil_400Regular.ttf'),
  NotoSansTamil_600SemiBold: require('../../assets/fonts/NotoSansTamil_600SemiBold.ttf'),
  NotoSansTamil_700Bold: require('../../assets/fonts/NotoSansTamil_700Bold.ttf'),
  NotoSansSinhala_400Regular: require('../../assets/fonts/NotoSansSinhala_400Regular.ttf'),
  NotoSansSinhala_600SemiBold: require('../../assets/fonts/NotoSansSinhala_600SemiBold.ttf'),
  NotoSansSinhala_700Bold: require('../../assets/fonts/NotoSansSinhala_700Bold.ttf'),
  JetBrainsMono_500Medium: require('../../assets/fonts/JetBrainsMono_500Medium.ttf'),
  JetBrainsMono_700Bold: require('../../assets/fonts/JetBrainsMono_700Bold.ttf'),
} as const;

export type Lang = 'en' | 'ta' | 'si';

const JAKARTA: Record<FontWeight, string> = {
  400: 'PlusJakartaSans_400Regular',
  500: 'PlusJakartaSans_500Medium',
  600: 'PlusJakartaSans_600SemiBold',
  700: 'PlusJakartaSans_700Bold',
  800: 'PlusJakartaSans_800ExtraBold',
  900: 'PlusJakartaSans_800ExtraBold',
};
const TAMIL: Record<FontWeight, string> = {
  400: 'NotoSansTamil_400Regular',
  500: 'NotoSansTamil_400Regular',
  600: 'NotoSansTamil_600SemiBold',
  700: 'NotoSansTamil_700Bold',
  800: 'NotoSansTamil_700Bold',
  900: 'NotoSansTamil_700Bold',
};
const SINHALA: Record<FontWeight, string> = {
  400: 'NotoSansSinhala_400Regular',
  500: 'NotoSansSinhala_400Regular',
  600: 'NotoSansSinhala_600SemiBold',
  700: 'NotoSansSinhala_700Bold',
  800: 'NotoSansSinhala_700Bold',
  900: 'NotoSansSinhala_700Bold',
};

/** Family for body text. Tamil/Sinhala UIs use the Noto face; Latin glyphs fall back per character. */
export function fontFamily(weight: FontWeight, lang: Lang = 'en'): string {
  if (lang === 'ta') return TAMIL[weight];
  if (lang === 'si') return SINHALA[weight];
  return JAKARTA[weight];
}

/** Numbers, OTP boxes, receipts (JetBrains Mono). */
export function monoFamily(weight: FontWeight = 500): string {
  return weight >= 700 ? 'JetBrainsMono_700Bold' : 'JetBrainsMono_500Medium';
}
