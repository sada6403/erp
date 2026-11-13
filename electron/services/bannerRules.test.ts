import { describe, expect, it } from 'vitest'
import { buildBannerRow, normalizeWallTime, parseHomeLayout, requireHttpsUrl, validateHomeLayout } from './bannerRules'

const exists = () => true

describe('banner rules', () => {
  it('accepts only https links', () => {
    expect(requireHttpsUrl('https://example.com/a')).toBe('https://example.com/a')
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'intent://x', 'lankahome://product/1', 'data:text/html,hi', '/relative', '']) {
      expect(() => requireHttpsUrl(bad)).toThrow()
    }
  })
  it('keeps Colombo wall time digits and defaults edges', () => {
    expect(normalizeWallTime('2026-11-13T09:30', 'start')).toBe('2026-11-13 09:30:00')
    expect(normalizeWallTime('2026-11-13', 'start')).toBe('2026-11-13 00:00:00')
    expect(normalizeWallTime('2026-11-13', 'end')).toBe('2026-11-13 23:59:59')
    expect(normalizeWallTime('2026-11-13T09:30:00.000Z', 'start')).toBe('2026-11-13 09:30:00')
    expect(normalizeWallTime('', 'end')).toBeNull()
    expect(() => normalizeWallTime('2026-02-31', 'start')).toThrow()
  })
  it('builds a banner row and keeps link_url in step', () => {
    const r = buildBannerRow({ image_url: 'a.png', link_type: 'url', link_target: 'https://x.lk/y', audience: 'guests' }, exists)
    expect(r.link_url).toBe('https://x.lk/y')
    expect(r.title).toBe('')
    expect(buildBannerRow({ image_url: 'a.png', link_type: 'flash' }, exists).link_target).toBeNull()
  })
  it('rejects bad input', () => {
    expect(() => buildBannerRow({ image_url: '' }, exists)).toThrow(/image/)
    expect(() => buildBannerRow({ image_url: 'a', link_type: 'url', link_target: 'http://x.lk' }, exists)).toThrow(/https/)
    expect(() => buildBannerRow({ image_url: 'a', link_type: 'product', link_target: 'p1' }, () => false)).toThrow(/no longer exists/)
    expect(() => buildBannerRow({ image_url: 'a', audience: 'vip' }, exists)).toThrow(/audience/)
    expect(() => buildBannerRow({ image_url: 'a', starts_at: '2026-11-13T10:00', ends_at: '2026-11-13T09:00' }, exists)).toThrow(/End/)
  })
  it('home layout defaults and validation', () => {
    expect(parseHomeLayout('').map(s => s.key)).toEqual(['banners', 'categories', 'flash_deals', 'smartbuy_promo', 'new_arrivals', 'featured'])
    expect(parseHomeLayout('[{"key":"featured","enabled":false}]')[0]).toEqual({ key: 'featured', enabled: false })
    expect(() => validateHomeLayout([{ key: 'banners', enabled: true }])).toThrow()
  })
})
