import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProductListItemDto } from '@contracts/catalog';
import type { CreateOrderRequest, QuoteRequest } from '@contracts/orders';
import type { AddressInput } from '@contracts/addresses';
import { addressApi, catalogApi, orderApi, wishlistApi } from '@/api/endpoints';
import { qk } from '@/query/keys';
import { useUiStore , selectIsOffline } from '@/store/uiStore';
import { selectIsLoggedIn, useSessionStore } from '@/store/sessionStore';
import { useOutboxStore } from '@/store/outboxStore';

export interface ProductSnapshot {
  items: ProductListItemDto[];
  /** server_time of the last sync; next call sends it as updated_since */
  syncedAt: string;
}

/** Merge a delta page set into the cached snapshot (pure, unit-tested). */
export function mergeSnapshot(prev: ProductSnapshot | undefined, changed: ProductListItemDto[], removed: string[], syncedAt: string): ProductSnapshot {
  const map = new Map<string, ProductListItemDto>();
  for (const p of prev?.items ?? []) map.set(p.id, p);
  for (const id of removed) map.delete(id);
  for (const p of changed) map.set(p.id, p);
  return { items: Array.from(map.values()), syncedAt };
}

/** Loads every page of /catalog/products (full snapshot first run, deltas via updated_since afterwards). */
export async function loadSnapshot(prev: ProductSnapshot | undefined): Promise<ProductSnapshot> {
  const changed: ProductListItemDto[] = [];
  const removed: string[] = [];
  let cursor: string | undefined;
  let serverTime = prev?.syncedAt ?? '';
  do {
    const page = await catalogApi.products({ updated_since: prev?.syncedAt, cursor, limit: 500 });
    changed.push(...page.items);
    removed.push(...page.removed_ids);
    serverTime = page.server_time;
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return mergeSnapshot(prev, changed, removed, serverTime);
}

export function useProductSnapshot() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.catalog.products,
    queryFn: async () => {
      const next = await loadSnapshot(qc.getQueryData<ProductSnapshot>(qk.catalog.products));
      useUiStore.getState().setCatalogUpdatedAt(Date.now());
      return next;
    },
  });
}

export type ProductSort = 'newest' | 'priceLow' | 'priceHigh' | 'popular';

export interface ProductFilter {
  q?: string;
  categoryId?: string | null;
  /** Extra category ids that also match (sub-categories of categoryId) */
  childIds?: string[];
  inStockOnly?: boolean;
  minPrice?: number | null;
  maxPrice?: number | null;
  sort?: ProductSort;
}

/** Client-side search, category, stock and price filter + sort over the cached snapshot, so it works offline. */
export function filterProducts(items: ProductListItemDto[], f: ProductFilter): ProductListItemDto[] {
  const q = f.q?.trim().toLowerCase();
  const cats = f.categoryId ? new Set([f.categoryId, ...(f.childIds ?? [])]) : null;
  const out = items.filter((p) => {
    if (cats && (!p.category_id || !cats.has(p.category_id))) return false;
    if (f.inStockOnly && !p.in_stock) return false;
    if (f.minPrice != null && p.price < f.minPrice) return false;
    if (f.maxPrice != null && p.price > f.maxPrice) return false;
    if (!q) return true;
    return [p.name, p.category_name, p.sku, p.brand, p.short_description].some((v) => v?.toLowerCase().includes(q));
  });
  if (f.sort === 'priceLow') out.sort((a, b) => a.price - b.price);
  else if (f.sort === 'priceHigh') out.sort((a, b) => b.price - a.price);
  else if (f.sort === 'popular') out.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0) || a.name.localeCompare(b.name));
  else if (f.sort === 'newest') out.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  return out;
}

export function useProducts(filter: ProductFilter) {
  const query = useProductSnapshot();
  const { q, categoryId, childIds, inStockOnly, minPrice, maxPrice, sort } = filter;
  const items = useMemo(
    () => filterProducts(query.data?.items ?? [], { q, categoryId, childIds, inStockOnly, minPrice, maxPrice, sort }),
    [query.data, q, categoryId, childIds, inStockOnly, minPrice, maxPrice, sort],
  );
  return { ...query, items };
}

export function useCategories() {
  return useQuery({ queryKey: qk.catalog.categories, queryFn: () => catalogApi.categories() });
}

export function useBanners() {
  return useQuery({ queryKey: qk.catalog.banners, queryFn: catalogApi.banners });
}

export function useBranches() {
  return useQuery({ queryKey: qk.catalog.branches, queryFn: () => catalogApi.branchesNearby() });
}

export function useProductDetail(id: string) {
  const snapshot = useProductSnapshot();
  const listItem = snapshot.data?.items.find((p) => p.id === id);
  const detail = useQuery({ queryKey: qk.catalog.product(id), queryFn: () => catalogApi.product(id) });
  return { detail, listItem };
}

/** Wishlist: local optimistic toggle + outbox so it works offline. */
export function useWishlist() {
  const loggedIn = useSessionStore(selectIsLoggedIn);
  const qc = useQueryClient();
  const offline = useUiStore(selectIsOffline);
  const query = useQuery({ queryKey: qk.me.wishlist, queryFn: wishlistApi.list, enabled: loggedIn });
  const ids = useMemo(() => new Set((query.data?.items ?? []).map((p) => p.id)), [query.data]);

  const toggle = (product: ProductListItemDto): boolean => {
    const has = ids.has(product.id);
    qc.setQueryData(qk.me.wishlist, (old: { items: ProductListItemDto[] } | undefined) => ({
      items: has ? (old?.items ?? []).filter((p) => p.id !== product.id) : [...(old?.items ?? []), product],
    }));
    const outbox = useOutboxStore.getState();
    if (offline) outbox.enqueue({ type: has ? 'wishlist_remove' : 'wishlist_add', payload: { productId: product.id } });
    else (has ? wishlistApi.remove(product.id) : wishlistApi.add({ product_id: product.id })).catch(() => outbox.enqueue({ type: has ? 'wishlist_remove' : 'wishlist_add', payload: { productId: product.id } }));
    return !has;
  };
  return { ids, toggle, loggedIn };
}

export function useAddresses() {
  const loggedIn = useSessionStore(selectIsLoggedIn);
  return useQuery({ queryKey: qk.me.addresses, queryFn: addressApi.list, enabled: loggedIn });
}

export function useCreateAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddressInput) => addressApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me.addresses }),
  });
}

/** Server quote: authoritative prices, fees and stock. Never persisted. */
export function useQuote(req: QuoteRequest | null, hash: string) {
  const offline = useUiStore(selectIsOffline);
  return useQuery({
    queryKey: qk.quote(hash),
    queryFn: () => orderApi.quote(req as QuoteRequest),
    enabled: !!req && req.items.length > 0 && !offline,
    networkMode: 'online',
    gcTime: 0,
    staleTime: 15_000,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, key }: { body: CreateOrderRequest; key: string }) => orderApi.create(body, key),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me.orders }),
  });
}

export function useOrders() {
  const loggedIn = useSessionStore(selectIsLoggedIn);
  return useQuery({ queryKey: qk.me.orders, queryFn: () => orderApi.list(), enabled: loggedIn });
}

export function useOrder(id: string) {
  return useQuery({ queryKey: qk.me.order(id), queryFn: () => orderApi.get(id) });
}

export function useTracking(id: string) {
  return useQuery({ queryKey: qk.me.tracking(id), queryFn: () => orderApi.tracking(id), refetchInterval: 20_000 });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => orderApi.cancel(id, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me.orders }),
  });
}

/** Reviews of one product + the signed-in customer's "can review" state. Hidden offline (the page just omits the section). */
export function useReviews(productId: string) {
  return useQuery({ queryKey: qk.catalog.reviews(productId), queryFn: () => catalogApi.reviews(productId), retry: 1 });
}

export function useSubmitReview(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { order_item_id: string; rating: number; comment?: string }) => catalogApi.addReview(productId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.catalog.reviews(productId) });
      qc.invalidateQueries({ queryKey: qk.catalog.product(productId) });
      qc.invalidateQueries({ queryKey: qk.catalog.products });
    },
  });
}

/** Pure: same-category products from the cached list, never the product itself (works offline). */
export function similarProducts(items: ProductListItemDto[], product: { id: string; category_id: string | null } | undefined, limit = 8): ProductListItemDto[] {
  if (!product?.category_id) return [];
  return items.filter((p) => p.id !== product.id && p.category_id === product.category_id && p.in_stock).slice(0, limit);
}

export function useSimilarProducts(product: { id: string; category_id: string | null } | undefined) {
  const snapshot = useProductSnapshot();
  return useMemo(() => similarProducts(snapshot.data?.items ?? [], product), [snapshot.data, product]);
}
