import { resolveBannerLink } from '../src/features/banners/bannerLink';
import { featuredItems, newArrivals } from '../src/features/shop/railItems';
import type { ProductListItemDto } from '@contracts/catalog';

describe('banner link resolution', () => {
  it('maps the supported link types', () => {
    expect(resolveBannerLink({ type: 'product', target: 'p 1' })).toEqual({ kind: 'route', href: '/product/p%201' });
    expect(resolveBannerLink({ type: 'category', target: 'c1' })).toEqual({ kind: 'route', href: '/catalog?category=c1' });
    expect(resolveBannerLink({ type: 'flash', target: null })).toEqual({ kind: 'route', href: '/flash-deals' });
    expect(resolveBannerLink({ type: 'smartbuy', target: null })).toEqual({ kind: 'route', href: '/smartbuy-promo' });
    expect(resolveBannerLink({ type: 'url', target: 'https://example.com/a' })).toEqual({ kind: 'browser', url: 'https://example.com/a' });
  });
  it('refuses every other scheme and empty targets', () => {
    for (const u of ['http://x.com', 'javascript:alert(1)', 'tel:123', 'intent://x', 'naturalplantation://product/1', 'https://a b']) {
      expect(resolveBannerLink({ type: 'url', target: u })).toEqual({ kind: 'none' });
    }
    expect(resolveBannerLink({ type: 'product', target: '' })).toEqual({ kind: 'none' });
    expect(resolveBannerLink(null)).toEqual({ kind: 'none' });
  });
});

describe('home rails', () => {
  const p = (id: string, featured: boolean, created: string | null) => ({ id, featured, created_at: created }) as unknown as ProductListItemDto;
  it('new arrivals are newest first, featured only flagged', () => {
    const items = [p('a', false, '2026-01-01T00:00:00Z'), p('b', true, '2026-03-01T00:00:00Z'), p('c', false, null)];
    expect(newArrivals(items).map((x) => x.id)).toEqual(['b', 'a']);
    expect(featuredItems(items).map((x) => x.id)).toEqual(['b']);
  });
});
