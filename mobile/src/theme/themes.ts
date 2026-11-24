import { baseColors } from './tokens';

export type ThemeKey = 'olive' | 'purple';

export interface ThemeColors extends Record<keyof typeof baseColors, string> {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  container: string;
  accent: string;
  accentHover: string;
  accentText: string;
  /** --card-bg */
  cardBg: string;
  navActive: string;
  navIndicator: string;
  /** primary at 25% alpha for the active chip shadow */
  primaryGlow: string;
}

export interface Theme {
  key: ThemeKey;
  /** i18n key for the display name */
  nameKey: string;
  colors: ThemeColors;
}

/** THEME 1: Olive & Yellow (default). */
export const OliveYellow: Theme = {
  key: 'olive',
  nameKey: 'theme.olive',
  colors: {
    ...baseColors,
    primary: '#5A6B2E',
    primaryDark: '#445222',
    primaryLight: '#71863A',
    container: '#E9EDD8',
    accent: '#F2C230',
    accentHover: '#E2B222',
    accentText: '#1F2937',
    cardBg: '#FFFFFF',
    navActive: '#5A6B2E',
    navIndicator: 'rgba(90, 107, 46, 0.12)',
    primaryGlow: 'rgba(90, 107, 46, 0.25)',
  },
};

/** THEME 2: Purple & Pink. */
export const PurplePink: Theme = {
  key: 'purple',
  nameKey: 'theme.purple',
  colors: {
    ...baseColors,
    primary: '#6B3FA0',
    primaryDark: '#512D7D',
    primaryLight: '#8352C3',
    container: '#EFE6F8',
    accent: '#C93A78',
    accentHover: '#B22E68',
    accentText: '#FFFFFF',
    cardBg: '#FFFFFF',
    navActive: '#6B3FA0',
    navIndicator: 'rgba(107, 63, 160, 0.12)',
    primaryGlow: 'rgba(107, 63, 160, 0.25)',
  },
};

export const themes: Record<ThemeKey, Theme> = { olive: OliveYellow, purple: PurplePink };
export const DEFAULT_THEME: ThemeKey = 'olive';
