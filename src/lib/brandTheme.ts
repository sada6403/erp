type Rgb = readonly [number, number, number]

const DEFAULT_BRAND = '#2563eb'

const SHADE_MIX: Record<number, { target: Rgb; amount: number }> = {
  50: { target: [255, 255, 255], amount: 0.94 },
  100: { target: [255, 255, 255], amount: 0.86 },
  200: { target: [255, 255, 255], amount: 0.70 },
  300: { target: [255, 255, 255], amount: 0.50 },
  400: { target: [255, 255, 255], amount: 0.25 },
  500: { target: [255, 255, 255], amount: 0.10 },
  600: { target: [0, 0, 0], amount: 0 },
  700: { target: [0, 0, 0], amount: 0.16 },
  800: { target: [0, 0, 0], amount: 0.32 },
  900: { target: [0, 0, 0], amount: 0.48 },
  950: { target: [0, 0, 0], amount: 0.64 },
}

export function normalizeBrandColor(value: unknown): string {
  const color = String(value || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color.slice(1).split('').map(char => char + char).join('')}`.toLowerCase()
  }
  return DEFAULT_BRAND
}

function hexToRgb(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

function mixRgb(base: Rgb, target: Rgb, amount: number): Rgb {
  return base.map((channel, index) => Math.round(channel + (target[index] - channel) * amount)) as unknown as Rgb
}

function rgbToHex([red, green, blue]: Rgb): string {
  return `#${[red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

export function applyBrandTheme(value: unknown, root: HTMLElement = document.documentElement): string {
  const color = normalizeBrandColor(value)
  const base = hexToRgb(color)

  root.style.setProperty('--brand-primary', color)
  root.style.setProperty('--brand-rgb', base.join(' '))

  Object.entries(SHADE_MIX).forEach(([shade, mix]) => {
    const rgb = mixRgb(base, mix.target, mix.amount)
    root.style.setProperty(`--brand-${shade}-rgb`, rgb.join(' '))
    root.style.setProperty(`--brand-${shade}`, rgbToHex(rgb))
  })

  root.style.setProperty('--brand-primary-hover', rgbToHex(mixRgb(base, [0, 0, 0], 0.16)))
  if (root === document.documentElement) window.dispatchEvent(new Event('brandchange'))
  return color
}
