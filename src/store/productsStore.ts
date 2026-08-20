import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { Product, Category, Supplier } from '@/types'

// Shared cache for the Products admin page's data (products/categories/
// suppliers) — same Zustand-store pattern already used by authStore/
// cartStore, not a new data-fetching library. Fixes the Products tab
// re-fetching (and showing a loading spinner) on every single navigation to
// it: React Router fully unmounts/remounts the page component on route
// change, but this store lives outside that component tree, so `loaded`
// survives the unmount and a revisit is instant unless a real mutation
// (create/update/delete/import) explicitly invalidates it.
interface ProductsState {
  products: Product[]
  categories: Category[]
  suppliers: Supplier[]
  loaded: boolean
  loading: boolean
  load: (force?: boolean) => Promise<void>
}

export const useProductsStore = create<ProductsState>((set, get) => ({
  products: [],
  categories: [],
  suppliers: [],
  loaded: false,
  loading: false,

  load: async (force = false) => {
    if (get().loaded && !force) return
    if (get().loading) return
    set({ loading: true })
    try {
      const [p, c, s] = await Promise.all([
        window.api.products.list({}),
        window.api.admin.categories.list(),
        window.api.admin.suppliers.list(),
      ]) as [
        { success: boolean; data?: Product[]; error?: string },
        { success: boolean; data?: Category[]; error?: string },
        { success: boolean; data?: Supplier[]; error?: string },
      ]
      if (p.success) set({ products: p.data || [] })
      else toast.error(p.error || 'Failed to load products')
      if (c.success) set({ categories: c.data || [] })
      else toast.error(c.error || 'Failed to load categories')
      if (s.success) set({ suppliers: s.data || [] })
      else toast.error(s.error || 'Failed to load suppliers')
      set({ loaded: true })
    } catch (err) {
      toast.error('Failed to load product data: ' + String(err))
    } finally {
      set({ loading: false })
    }
  },
}))
