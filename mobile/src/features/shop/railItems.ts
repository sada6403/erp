import type { ProductListItemDto } from '@contracts/catalog';

const RAIL_MAX = 10;

/** Newest products first (created_at), at most RAIL_MAX. */
export function newArrivals(items: ProductListItemDto[]): ProductListItemDto[] {
  return items
    .filter((p) => p.created_at)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, RAIL_MAX);
}

/** Products the POS marked Featured, at most RAIL_MAX. */
export function featuredItems(items: ProductListItemDto[]): ProductListItemDto[] {
  return items.filter((p) => p.featured).slice(0, RAIL_MAX);
}

