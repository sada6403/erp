import type { ProductListItemDto } from '@contracts/catalog';

/**
 * Flash deals are products the server marks with a real end date (active dated POS discount). Nothing is invented:
 * no deal with a future end date => no deals section, no countdown.
 */
export function activeDeals(items: ProductListItemDto[], now = Date.now()): { deals: ProductListItemDto[]; endsAt: number | null } {
  const deals = items
    .filter((p) => p.discount_pct > 0 && p.deal_ends_at && Date.parse(p.deal_ends_at) > now)
    .sort((a, b) => b.discount_pct - a.discount_pct);
  if (!deals.length) return { deals, endsAt: null };
  return { deals, endsAt: Math.min(...deals.map((p) => Date.parse(p.deal_ends_at as string))) };
}
