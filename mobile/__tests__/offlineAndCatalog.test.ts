import i18next from 'i18next';
import type { ProductListItemDto } from '@contracts/catalog';
import en from '@/i18n/en.json';
import { bannerText } from '@/components/Overlays';
import { filterProducts, mergeSnapshot } from '@/features/shop/hooks';

const i18n = i18next.createInstance();
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false }, returnNull: false });
});

describe('offline banner text', () => {
  const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
  it('is empty when online without maintenance', () => {
    expect(bannerText(i18n.t, false, null, null, NOW)).toBeNull();
  });
  it('shows the maintenance message when online', () => {
    expect(bannerText(i18n.t, false, null, 'Back at 6pm', NOW)).toBe('Back at 6pm');
  });
  it('says there is no saved data when offline with an empty cache', () => {
    expect(bannerText(i18n.t, true, null, null, NOW)).toBe(en.offline.bannerNoCache);
  });
  it('shows the cache age when offline', () => {
    expect(bannerText(i18n.t, true, NOW - 5 * 60_000, null, NOW)).toBe('Offline — Showing saved products (cached 5 minutes ago)');
    expect(bannerText(i18n.t, true, NOW - 3 * 3600_000, null, NOW)).toBe('Offline — Showing saved products (cached 3 hours ago)');
    expect(bannerText(i18n.t, true, NOW - 1 * 60_000, null, NOW)).toBe('Offline — Showing saved products (cached 1 minute ago)');
  });
});

const prod = (id: string, name: string, cat = 'c1'): ProductListItemDto => ({
  featured: false, created_at: null,
  id, slug: id, sku: id, name, category_id: cat, category_name: 'Veg', brand: null, short_description: null, unit: 'kg', sale_by: 'weight',
  qty_step: 0.25, min_qty: 0.25, price: 100, original_price: null, discount_pct: 0, thumbnail_url: null, in_stock: true, available_qty: 5,
  has_variants: false, emi_available: false, updated_at: 't',
});

describe('catalog snapshot', () => {
  it('merges deltas: updates, additions and removals', () => {
    const first = mergeSnapshot(undefined, [prod('a', 'Apple'), prod('b', 'Banana')], [], 't1');
    const next = mergeSnapshot(first, [{ ...prod('a', 'Apple'), price: 120 }, prod('c', 'Carrot')], ['b'], 't2');
    expect(next.items.map((p) => p.id).sort()).toEqual(['a', 'c']);
    expect(next.items.find((p) => p.id === 'a')?.price).toBe(120);
    expect(next.syncedAt).toBe('t2');
  });

  it('filters by search and category on the client (works offline)', () => {
    const items = [prod('a', 'Apple', 'c1'), prod('b', 'Banana', 'c2')];
    expect(filterProducts(items, { q: 'ban' }).map((p) => p.id)).toEqual(['b']);
    expect(filterProducts(items, { categoryId: 'c1' }).map((p) => p.id)).toEqual(['a']);
    expect(filterProducts(items, {})).toHaveLength(2);
  });
});
