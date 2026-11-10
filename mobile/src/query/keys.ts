/**
 * Query keys. Only keys whose first segment is in PERSISTED_ROOTS are written to the MMKV cache
 * (offline-cache skill). Never persist tokens or the checkout quote.
 */
export const qk = {
  status: ['status'] as const,
  watermark: ['status', 'watermark'] as const,
  company: ['status', 'company'] as const,

  catalog: {
    all: ['catalog'] as const,
    categories: ['catalog', 'categories'] as const,
    products: ['catalog', 'products', 'snapshot'] as const,
    product: (id: string) => ['catalog', 'product', id] as const,
    banners: ['catalog', 'banners'] as const,
    branches: ['catalog', 'branches'] as const,
  },

  me: {
    profile: ['me', 'profile'] as const,
    orders: ['me', 'orders'] as const,
    order: (id: string) => ['me', 'orders', id] as const,
    tracking: (id: string) => ['me', 'orders', id, 'tracking'] as const,
    addresses: ['me', 'addresses'] as const,
    wishlist: ['me', 'wishlist'] as const,
    notifications: ['me', 'notifications'] as const,
    notificationSettings: ['me', 'notification-settings'] as const,
  },

  /** Checkout quote: never persisted. */
  quote: (hash: string) => ['quote', hash] as const,

  smartbuy: {
    all: ['smartbuy'] as const,
    schemes: ['smartbuy', 'schemes'] as const,
    open: ['smartbuy', 'open'] as const,
    statement: (id: string) => ['smartbuy', 'statement', id] as const,
    draws: (id: string) => ['smartbuy', 'draws', id] as const,
  },
  wallet: {
    balance: ['wallet', 'balance'] as const,
    transactions: ['wallet', 'transactions'] as const,
  },

  agent: {
    all: ['agent'] as const,
    dashboard: ['agent', 'dashboard'] as const,
    deliveries: ['agent', 'deliveries'] as const,
    members: ['agent', 'members'] as const,
    commission: (month: string) => ['agent', 'commission', month] as const,
    bill: (id: string) => ['agent', 'bill', id] as const,
  },
};

export const PERSISTED_ROOTS = ['catalog', 'me', 'smartbuy', 'wallet', 'agent', 'status'];

/** Keys containing user data that must be wiped on logout. */
export const USER_ROOTS = ['me', 'smartbuy', 'wallet', 'agent', 'quote'];

export function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  return typeof root === 'string' && PERSISTED_ROOTS.includes(root);
}
