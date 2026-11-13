import type { CategoryDto, ProductListItemDto } from '@contracts/catalog';
import { filterProducts } from '../src/features/shop/hooks';
import { buildDepartments } from '../app/(shop)/categories';

const p = (id: string, price: number, extra: Partial<ProductListItemDto> = {}) =>
  ({ id, name: id, price, category_id: 'c1', in_stock: true, popularity: 0, updated_at: '2026-01-01', sku: id, ...extra }) as ProductListItemDto;
const c = (id: string, parent: string | null, count: number, order = 0) => ({ id, name: id, parent_id: parent, image_url: null, sort_order: order, product_count: count, updated_at: '' }) as CategoryDto;

test('filters by stock, price range and children, then sorts', () => {
  const items = [p('a', 50), p('b', 10, { in_stock: false }), p('c', 30, { category_id: 'c2', popularity: 9, updated_at: '2026-05-01' })];
  expect(filterProducts(items, { inStockOnly: true }).map((x) => x.id)).toEqual(['a', 'c']);
  expect(filterProducts(items, { minPrice: 20, maxPrice: 40 }).map((x) => x.id)).toEqual(['c']);
  expect(filterProducts(items, { categoryId: 'c1', childIds: ['c2'], sort: 'priceHigh' }).map((x) => x.id)).toEqual(['a', 'c', 'b']);
  expect(filterProducts(items, { categoryId: 'c1' }).map((x) => x.id)).toEqual(['a', 'b']);
  expect(filterProducts(items, { sort: 'popular' })[0].id).toBe('c');
  expect(filterProducts(items, { sort: 'newest' })[0].id).toBe('c');
});

test('departments hide empty ones and roll child counts into the parent', () => {
  const d = buildDepartments([c('g', null, 0, 1), c('r', 'g', 9), c('e', null, 0, 2), c('x', 'g', 0)]);
  expect(d.map((x) => x.cat.id)).toEqual(['g']);
  expect(d[0].total).toBe(9);
  expect(d[0].children.map((k) => k.id)).toEqual(['r']);
});
