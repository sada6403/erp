/** DEV ONLY catalog fixtures for the mock adapter. Backed by the web-demo seed in ./demoData. */
import type { BannerDto, BranchDto, CategoryDto, ProductDetailDto, ProductListItemDto } from '@contracts/catalog';
import { DEMO_BRANCHES, DEMO_PRODUCTS, bannersDto, categoriesDto, productId, toProductDetailDto, toProductDto } from './demoData';

export const CATEGORIES: CategoryDto[] = categoriesDto();
export const PRODUCTS: ProductListItemDto[] = DEMO_PRODUCTS.map(toProductDto);

export function productDetail(id: string): ProductDetailDto | null {
  const p = DEMO_PRODUCTS.find((x) => productId(x.id) === id);
  return p ? toProductDetailDto(p) : null;
}

export const BANNERS: BannerDto[] = bannersDto();
export const BRANCHES: BranchDto[] = DEMO_BRANCHES;
