import type { Config } from 'tailwindcss'

const brandPalette = {
  50:  'rgb(var(--brand-50-rgb, 239 246 255) / <alpha-value>)',
  100: 'rgb(var(--brand-100-rgb, 219 234 254) / <alpha-value>)',
  200: 'rgb(var(--brand-200-rgb, 191 219 254) / <alpha-value>)',
  300: 'rgb(var(--brand-300-rgb, 147 197 253) / <alpha-value>)',
  400: 'rgb(var(--brand-400-rgb, 96 165 250) / <alpha-value>)',
  500: 'rgb(var(--brand-500-rgb, 59 130 246) / <alpha-value>)',
  600: 'rgb(var(--brand-600-rgb, 37 99 235) / <alpha-value>)',
  700: 'rgb(var(--brand-700-rgb, 29 78 216) / <alpha-value>)',
  800: 'rgb(var(--brand-800-rgb, 30 64 175) / <alpha-value>)',
  900: 'rgb(var(--brand-900-rgb, 30 58 138) / <alpha-value>)',
  950: 'rgb(var(--brand-950-rgb, 23 37 84) / <alpha-value>)',
}

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Legacy blue/indigo utility classes are brand-aware too, so every
        // existing screen follows the color selected by the administrator.
        blue: brandPalette,
        indigo: brandPalette,
        violet: brandPalette,
        purple: brandPalette,
        brand: brandPalette,
        surface: {
          DEFAULT: 'rgb(var(--s-900) / <alpha-value>)',
          50:  'rgb(var(--s-50)  / <alpha-value>)',
          100: 'rgb(var(--s-100) / <alpha-value>)',
          200: 'rgb(var(--s-200) / <alpha-value>)',
          600: 'rgb(var(--s-600) / <alpha-value>)',
          700: 'rgb(var(--s-700) / <alpha-value>)',
          800: 'rgb(var(--s-800) / <alpha-value>)',
          900: 'rgb(var(--s-900) / <alpha-value>)',
          950: 'rgb(var(--s-950) / <alpha-value>)',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace']
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { transform: 'translateY(10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.7' } }
      }
    }
  },
  plugins: []
} satisfies Config
