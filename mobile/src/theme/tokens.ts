/**
 * Design tokens taken from the approved web demo (styles.css :root).
 * Components never use hex values: they read everything from useTheme().
 */

/** Colours that are identical in every theme (status colours are fixed, see ARCHITECTURE section 11). */
export const baseColors = {
  white: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceSubtle: '#F8FAFC',
  surfaceBorder: '#E2E8F0',
  /** neutral fill for chips, search box and image boxes (#F1F5F9 in the demo) */
  fill: '#F1F5F9',
  divider: '#F1F5F9',
  textMain: '#0F172A',
  textMuted: '#64748B',
  textSubtle: '#94A3B8',
  slate300: '#CBD5E1',
  slate200: '#E2E8F0',

  success: '#16A34A',
  successBg: '#DCFCE7',
  successText: '#14532D',
  warning: '#D97706',
  warningBg: '#FEF3C7',
  warningText: '#92400E',
  error: '#DC2626',
  errorBg: '#FEE2E2',
  errorBorder: '#FCA5A5',

  /** dark cards (Smart Buy promo, achievement card, video) */
  ink: '#0F172A',
  inkSoft: '#1E293B',
  inkDeep: '#020617',

  /** gold family (draw winner card, rank banner, thermal receipt) */
  goldBg: '#FFFBEB',
  goldBg2: '#FEF3C7',
  goldBorder: '#FDE68A',
  goldText: '#B45309',
  goldDark: '#78350F',
  goldMid: '#92400E',

  whatsapp: '#10B981',
  whatsappBg: '#DCFCE7',
  whatsappText: '#15803D',
  green: '#10B981',
  amber: '#F59E0B',
  blue: '#3B82F6',
  yellowText: '#FEF08A',

  overlay: 'rgba(15, 23, 42, 0.75)',
  scrim: 'rgba(0, 0, 0, 0.5)',
  glass: 'rgba(255, 255, 255, 0.2)',
  glassSoft: 'rgba(255, 255, 255, 0.1)',
  glassBorder: 'rgba(255, 255, 255, 0.2)',
  glassText: 'rgba(255, 255, 255, 0.9)',
  accentGlow: 'rgba(242, 194, 48, 0.25)',
  goldGlass: 'rgba(242, 194, 48, 0.15)',
  goldGlassBorder: 'rgba(242, 194, 48, 0.35)',
  shadow: '#000000',
  transparent: 'transparent',
  watermark: 'rgba(255, 255, 255, 0.35)',
  liveBadge: 'rgba(220, 38, 38, 0.85)',
  secureToast: 'rgba(220, 38, 38, 0.9)',
  wishlistBg: 'rgba(255, 255, 255, 0.92)',
  dividerDashed: 'rgba(180, 83, 9, 0.3)',
  warningBorder: 'rgba(217, 119, 6, 0.2)',

  /* --- additions for 1:1 demo parity (styles.css :root + literal colours) --- */
  /** --bg-page: page backdrop behind the phone frame in the demo */
  bgPage: '#0B1120',
  /** body background in the demo (also --surface-subtle family) */
  pageFill: '#F1F5F9',
  /** online/offline status dots */
  online: '#10B981',
  offline: '#EF4444',
  red500: '#EF4444',
  errorBorderSoft: 'rgba(220, 38, 38, 0.2)',
  goldGlass20: 'rgba(242, 194, 48, 0.2)',
  glass08: 'rgba(255, 255, 255, 0.08)',
  glass14: 'rgba(255, 255, 255, 0.14)',
  glass15: 'rgba(255, 255, 255, 0.15)',
  glass18: 'rgba(255, 255, 255, 0.18)',
  glass25: 'rgba(255, 255, 255, 0.25)',
  glass30: 'rgba(255, 255, 255, 0.3)',
  /** rgba(30,41,59,.96) push-notification banner */
  pushBanner: 'rgba(30, 41, 59, 0.96)',
  /** black alpha ramp used by shadows and scrims */
  black06: 'rgba(0, 0, 0, 0.06)',
  black08: 'rgba(0, 0, 0, 0.08)',
  black12: 'rgba(0, 0, 0, 0.12)',
  black15: 'rgba(0, 0, 0, 0.15)',
  black30: 'rgba(0, 0, 0, 0.3)',
  black35: 'rgba(0, 0, 0, 0.35)',
  black40: 'rgba(0, 0, 0, 0.4)',
} as const;

export const radii = {
  /** 2px: progress bars, hairline bars */
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  chip: 10,
  input: 12,
  control: 14,
  /** 16px (demo: 5 uses) */
  lg: 16,
  card: 18,
  hero: 20,
  sheet: 26,
  /** true pill (demo 999px / large radius on short controls) */
  pill: 999,
  /** circle (demo border-radius: 50%); use on square boxes */
  round: 999,
  circle: 999,
  /** phone frame radius, only for reference */
  phone: 46,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  gutter: 16,
} as const;

/** Minimum touch target in dp (AGENTS.md accessibility rule). */
export const TOUCH_TARGET = 48;
export const BOTTOM_NAV_HEIGHT = 64;

export type FontWeight = 400 | 500 | 600 | 700 | 800 | 900;

/** Font sizes used by the demo (px == dp). */
export const fontSizes = {
  micro: 9,
  tiny: 10,
  xs: 11,
  sm: 12,
  base: 13,
  md: 14,
  lg: 15,
  xl: 16,
  h3: 17,
  h2: 18,
  h1: 21,
  display: 24,
  otp: 28,
} as const;

/**
 * Every raw font size the demo CSS uses (px == dp, fractional allowed). Prefer these over magic numbers.
 * Keys are the size with '.' replaced by '_'.
 */
export const fontScale = {
  s9: 9,
  s9_5: 9.5,
  s10: 10,
  s10_5: 10.5,
  s11: 11,
  s11_5: 11.5,
  s12: 12,
  s13: 13,
  s14: 14,
  s15: 15,
  s16: 16,
  s17: 17,
  s18: 18,
  s19: 19,
  s20: 20,
  s21: 21,
  s22: 22,
  s24: 24,
  s26: 26,
  s28: 28,
  s30: 30,
  s32: 32,
  s34: 34,
  s40: 40,
  s44: 44,
  s52: 52,
} as const;

/** Unitless CSS line-height ratios used by the demo (multiply by font size, do not round). */
export const lineHeights = {
  tight: 1.15,
  snug: 1.2,
  heading: 1.25,
  body: 1.3,
  copy: 1.35,
  relaxed: 1.4,
  loose: 1.45,
} as const;

/** letter-spacing values in px used by the demo. */
export const letterSpacings = {
  tightest: -0.3,
  wide3: 0.3,
  wide4: 0.4,
  wide5: 0.5,
  otp: 4,
} as const;

/** Phone frame reference dimensions from :root (--phone-width etc). */
export const demoFrame = { phoneWidth: 416, phoneHeight: 870, radiusPhone: 46, touchTarget: 48 } as const;

export interface ShadowStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  /** Android has no coloured/blurred shadows; this approximates the visual weight. */
  elevation: number;
}

/**
 * Converts CSS `box-shadow: x y blur [spread] color` into RN props.
 * RN shadowRadius ~= CSS blur / 2 (iOS); opacity is carried separately from the colour.
 */
function sh(x: number, y: number, blur: number, opacity: number, elevation: number, color = '#000000'): ShadowStyle {
  return {
    shadowColor: color,
    shadowOffset: { width: x, height: y },
    shadowOpacity: opacity,
    shadowRadius: blur / 2,
    elevation,
  };
}

/** Every distinct box-shadow in styles.css (spread rings are in `rings`). Names describe the demo component. */
export const shadows = {
  /** 0 2px 8px rgba(0,0,0,0.3): active top role pill */
  rolePill: sh(0, 2, 8, 0.3, 3),
  /** 0 2px 6px rgba(0,0,0,0.3): brand logo image */
  brandLogo: sh(0, 2, 6, 0.3, 2),
  /** 0 2px 6px rgba(0,0,0,0.06): header avatar logo */
  avatarLogo: sh(0, 2, 6, 0.06, 1),
  /** 0 0 35px rgba(0,0,0,0.08): phone frame (desktop preview only) */
  phoneFrame: sh(0, 0, 35, 0.08, 2),
  /** 0 12px 30px rgba(0,0,0,0.35): push banner */
  pushBanner: sh(0, 12, 30, 0.35, 12),
  /** 0 8px 24px rgba(0,0,0,0.15): banner slide, dark promo cards */
  banner: sh(0, 8, 24, 0.15, 6),
  /** 0 4px 14px rgba(0,0,0,0.15) */
  floatSm: sh(0, 4, 14, 0.15, 4),
  /** 0 8px 22px rgba(0,0,0,0.12) */
  card: sh(0, 8, 22, 0.12, 5),
  /** 0 6px 18px rgba(0,0,0,0.12) */
  cardSm: sh(0, 6, 18, 0.12, 4),
  /** 0 10px 25px rgba(0,0,0,0.3) */
  popover: sh(0, 10, 25, 0.3, 10),
  /** 0 -10px 30px rgba(0,0,0,0.3): bottom sheet */
  sheet: sh(0, -10, 30, 0.3, 16),
  /** 0 20px 40px rgba(0,0,0,0.4): modal */
  modal: sh(0, 20, 40, 0.4, 20),
  /** 0 0 6px #10B981: online dot glow */
  glowOnline: sh(0, 0, 6, 1, 2, '#10B981'),
  /** 0 0 6px #EF4444: offline dot glow */
  glowOffline: sh(0, 0, 6, 1, 2, '#EF4444'),
  none: { shadowColor: 'transparent', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 } as ShadowStyle,
} as const;

/**
 * Theme-tinted shadows: `0 0 6px var(--primary)` (theme dot) and `0 2px 8px rgba(primary, .25)` (active chip).
 * Pass theme.colors.primary.
 */
export const tintedShadows = {
  themeDot: (primary: string): ShadowStyle => sh(0, 0, 6, 1, 2, primary),
  chipActive: (primary: string): ShadowStyle => sh(0, 2, 8, 0.25, 3, primary),
};

/** CSS spread shadows (`0 0 0 4px colour`) have no RN equivalent: render as an outer ring View/border. */
export const rings = {
  /** 0 0 0 4px rgba(242,194,48,0.25) (accent focus ring) */
  accent4: { width: 4, color: 'rgba(242, 194, 48, 0.25)' },
} as const;
