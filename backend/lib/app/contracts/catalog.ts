import type { SaleBy } from './common'

export interface CategoryDto {
  id: string
  name: string
  parent_id: string | null
  image_url: string | null
  sort_order: number
  product_count: number
  updated_at: string
}
export interface CategoriesResponse {
  items: CategoryDto[]
  /** Category ids removed/hidden since `updated_since` */
  removed_ids: string[]
  server_time: string
}

export interface VariantDto {
  id: string
  name: string
  sku: string
  price: number
  original_price: number | null
  attributes: Record<string, string>
  image_url: string | null
  in_stock: boolean
  /** Available quantity (null when stock is not managed => always available) */
  available_qty: number | null
}

export interface ProductListItemDto {
  id: string
  slug: string | null
  sku: string
  name: string
  category_id: string | null
  category_name: string | null
  brand: string | null
  short_description: string | null
  unit: string
  /** 'weight' => decimal quantities; `price` is per `unit` (kg) */
  sale_by: SaleBy
  /** Quantity stepper step: 1 for normal items, 0.25 for weight items */
  qty_step: number
  min_qty: number
  price: number
  original_price: number | null
  discount_pct: number
  /** End of the active dated POS discount (ISO UTC); set only for flash deals. Absent/null = not a flash deal. */
  deal_ends_at?: string | null
  thumbnail_url: string | null
  in_stock: boolean
  available_qty: number | null
  has_variants: boolean
  /** Average of visible, verified reviews (1-5, one decimal) or null when there are none */
  rating_avg?: number | null
  rating_count?: number
  /** Units ordered in the last 90 days on non-cancelled orders (0 when none); for the "popular" sort */
  popularity?: number
  /** Only true when the product has enable_emi = 1 */
  emi_available: boolean
  updated_at: string
}

export interface ProductDetailDto extends ProductListItemDto {
  description: string | null
  gallery: Array<{ thumb: string; medium: string }>
  variants: VariantDto[]
  /** Offline prices are labelled "Price may change"; final price comes from /checkout/quote */
  price_note: string | null
  /** From the POS (branch delivery time). null/absent = the app hides the line. Never a hard-coded claim. */
  estimated_delivery?: EstimatedDeliveryDto | null
}

export interface EstimatedDeliveryDto {
  min_days: number
  max_days: number
  /** Optional free text set in the POS (e.g. "Colombo 1-2 days"); shown instead of the numbers when present */
  text: string | null
}

export interface ReviewDto {
  id: string
  rating: number
  comment: string | null
  /** First name + initial only, never phone/email */
  author_name: string
  /** Always true: only customers with a DELIVERED order for the product can review */
  verified_purchase: boolean
  created_at: string
}
export interface ReviewsResponse {
  items: ReviewDto[]
  average: number | null
  count: number
  next_cursor: string | null
  /** Only filled for a signed-in customer: a delivered order item that has no review yet */
  can_review: { eligible: boolean; order_item_id: string | null }
}
export interface ReviewCreateBody {
  order_item_id: string
  rating: number
  comment?: string
}

export interface ProductsQuery {
  /** ISO timestamp; delta sync */
  updated_since?: string
  category_id?: string
  q?: string
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'name'
  in_stock?: '1'
  min_price?: number
  max_price?: number
  branch_id?: string
  cursor?: string
  /** default 100, max 500 */
  limit?: number
}
export interface ProductsResponse {
  items: ProductListItemDto[]
  /** Products hidden/deleted/not_for_sale since `updated_since`: remove from cache */
  removed_ids: string[]
  next_cursor: string | null
  server_time: string
}

export interface BannerDto {
  id: string
  title: string
  subtitle: string | null
  image_url: string | null
  /** Deep link such as lankahome://product/<id>, or null */
  link_url: string | null
  sort_order: number
}
export interface BannersResponse {
  items: BannerDto[]
}

export interface SearchResponse {
  items: ProductListItemDto[]
  total: number
}
export interface SuggestResponse {
  suggestions: string[]
  products: Array<{ id: string; name: string; thumbnail_url: string | null; price: number }>
}

export interface BranchDto {
  id: string
  name: string
  code: string
  address: string | null
  phone: string | null
  latitude: number | null
  longitude: number | null
  distance_km?: number | null
}
export interface BranchesResponse {
  items: BranchDto[]
}
