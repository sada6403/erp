import type { ProductListItemDto } from './catalog'

export interface WishlistResponse {
  items: ProductListItemDto[]
}
export interface WishlistAddRequest {
  product_id: string
}
