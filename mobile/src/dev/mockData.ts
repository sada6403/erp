/** DEV ONLY catalog fixtures for the mock adapter. */
import type { BannerDto, BranchDto, CategoryDto, ProductDetailDto, ProductListItemDto } from '@contracts/catalog';

const T = '2026-11-01T00:00:00.000Z';

export const CATEGORIES: CategoryDto[] = [
  { id: 'c-veg', name: 'Vegetables', parent_id: null, image_url: null, sort_order: 1, product_count: 4, updated_at: T },
  { id: 'c-fruit', name: 'Fruits', parent_id: null, image_url: null, sort_order: 2, product_count: 2, updated_at: T },
  { id: 'c-rice', name: 'Rice & Grains', parent_id: null, image_url: null, sort_order: 3, product_count: 2, updated_at: T },
  { id: 'c-spice', name: 'Spices', parent_id: null, image_url: null, sort_order: 4, product_count: 1, updated_at: T },
];

function p(id: string, name: string, cat: string, catName: string, price: number, opts: Partial<ProductListItemDto> = {}): ProductListItemDto {
  return {
    id, slug: id, sku: id.toUpperCase(), name, category_id: cat, category_name: catName, brand: null, short_description: `Fresh ${name.toLowerCase()} from our farms`,
    unit: 'pcs', sale_by: 'normal', qty_step: 1, min_qty: 1, price, original_price: null, discount_pct: 0, thumbnail_url: null, in_stock: true,
    available_qty: 50, has_variants: false, emi_available: false, updated_at: T, ...opts,
  };
}

const kg = { unit: 'kg', sale_by: 'weight' as const, qty_step: 0.25, min_qty: 0.25 };

export const PRODUCTS: ProductListItemDto[] = [
  p('p-tomato', 'Tomato', 'c-veg', 'Vegetables', 480, { ...kg, original_price: 560, discount_pct: 14 }),
  p('p-carrot', 'Carrot', 'c-veg', 'Vegetables', 420, kg),
  p('p-beans', 'Green Beans', 'c-veg', 'Vegetables', 650, kg),
  p('p-pumpkin', 'Pumpkin', 'c-veg', 'Vegetables', 260, kg),
  p('p-banana', 'Ambul Banana', 'c-fruit', 'Fruits', 380, kg),
  p('p-papaya', 'Papaya', 'c-fruit', 'Fruits', 300, { ...kg, in_stock: false, available_qty: 0 }),
  p('p-nadu', 'Nadu Rice', 'c-rice', 'Rice & Grains', 230, { ...kg, has_variants: true }),
  p('p-dhal', 'Red Dhal', 'c-rice', 'Rice & Grains', 360, kg),
  p('p-pepper', 'Black Pepper 100g', 'c-spice', 'Spices', 450, { original_price: 520, discount_pct: 13 }),
];

export function productDetail(id: string): ProductDetailDto | null {
  const base = PRODUCTS.find((x) => x.id === id);
  if (!base) return null;
  return {
    ...base,
    description: `${base.name}, carefully picked and packed by Natural Plantation.`,
    gallery: [],
    variants: base.has_variants
      ? [
          { id: 'v-1', name: '1 kg', sku: 'NADU-1', price: 230, original_price: null, attributes: {}, image_url: null, in_stock: true, available_qty: 40 },
          { id: 'v-5', name: '5 kg', sku: 'NADU-5', price: 1100, original_price: 1150, attributes: {}, image_url: null, in_stock: true, available_qty: 12 },
        ]
      : [],
    price_note: null,
  };
}

export const BANNERS: BannerDto[] = [{ id: 'bn1', title: 'Farm fresh this week', subtitle: 'Hand picked vegetables', image_url: null, link_url: null, sort_order: 1 }];

export const BRANCHES: BranchDto[] = [
  { id: 'b1', name: 'Kandy Branch', code: 'KDY', address: '45 Peradeniya Road, Kandy', phone: '0812223344', latitude: null, longitude: null },
  { id: 'b2', name: 'Colombo Branch', code: 'CMB', address: '10 Galle Road, Colombo 3', phone: '0112223344', latitude: null, longitude: null },
];
