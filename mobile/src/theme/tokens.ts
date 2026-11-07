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
} as const;

export const radii = {
  xs: 4,
  sm: 6,
  md: 8,
  chip: 10,
  input: 12,
  control: 14,
  card: 18,
  hero: 20,
  sheet: 26,
  pill: 20,
  round: 999,
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
