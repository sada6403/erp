import fs from 'fs';
import path from 'path';
import type { ProductListItemDto } from '@contracts/catalog';
import { activeDeals } from '@/features/shop/deals';

const I18N = path.resolve(__dirname, '../src/i18n');

function leaves(o: unknown, prefix = '', out: [string, string][] = []): [string, string][] {
  if (typeof o === 'string') out.push([prefix, o]);
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

/** Hard rule: no hard-coded offers, prices, delivery promises or product claims in any build. Content comes from the POS. */
describe('no hard-coded marketing text in the strings files', () => {
  const banned: [RegExp, string][] = [
    [/\bRs\.?\s?\d/i, 'a hard-coded price/amount'],
    [/\d\s?-?\s?hour (branch )?(delivery|dispatch)/i, 'a delivery-time promise'],
    [/guarantee/i, 'a guarantee'],
    [/\b20\d\d\b/, 'a campaign year'],
    [/\b(certified|organic)\b/i, 'a product claim'],
    [/\b\d+\s?%\s?(fee|off)/i, 'a fee/discount claim'],
  ];
  for (const lang of ['en', 'ta', 'si']) {
    it(`${lang}.json has none`, () => {
      const json = JSON.parse(fs.readFileSync(path.join(I18N, `${lang}.json`), 'utf8'));
      const hits = leaves(json).flatMap(([k, v]) => banned.filter(([re]) => re.test(v)).map(([, why]) => `${k}: ${why}`));
      expect(hits).toEqual([]);
    });
  }
});

describe('activeDeals', () => {
  const p = (id: string, pct: number, end: string | null): ProductListItemDto =>
    ({ id, discount_pct: pct, deal_ends_at: end } as unknown as ProductListItemDto);
  const now = Date.parse('2026-11-12T10:00:00Z');
  it('is empty without an end date, with an expired one, or without a discount', () => {
    const r = activeDeals([p('a', 10, null), p('b', 10, '2026-11-12T09:00:00Z'), p('c', 0, '2026-11-13T00:00:00Z')], now);
    expect(r.deals).toEqual([]);
    expect(r.endsAt).toBeNull();
  });
  it('counts down to the earliest real end date and sorts by saving', () => {
    const r = activeDeals([p('a', 10, '2026-11-14T00:00:00Z'), p('b', 30, '2026-11-13T00:00:00Z')], now);
    expect(r.deals.map((d) => d.id)).toEqual(['b', 'a']);
    expect(r.endsAt).toBe(Date.parse('2026-11-13T00:00:00Z'));
  });
});
