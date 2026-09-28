import { describe, expect, it } from 'vitest'
import { applyBrandTheme, normalizeBrandColor } from './brandTheme'

describe('brand theme', () => {
  it('normalizes short colors and rejects unsafe values', () => {
    expect(normalizeBrandColor('#1aB')).toBe('#11aabb')
    expect(normalizeBrandColor('not-a-color')).toBe('#2563eb')
  })

  it('creates the complete palette from the administrator color', () => {
    const root = document.createElement('div')
    applyBrandTheme('#16a34a', root)

    expect(root.style.getPropertyValue('--brand-primary')).toBe('#16a34a')
    expect(root.style.getPropertyValue('--brand-rgb')).toBe('22 163 74')
    expect(root.style.getPropertyValue('--brand-600-rgb')).toBe('22 163 74')
    expect(root.style.getPropertyValue('--brand-primary-hover')).toBe('#12893e')
    expect(root.style.getPropertyValue('--brand-400-rgb')).toBe('80 186 119')
  })
})
