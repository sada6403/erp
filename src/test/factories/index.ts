// Reusable test data builders. Keep them simple — no fixtures, no globals.
// All factories are pure: they return a fresh object on each call (with overrides).

import type { Product, Customer, User, CartItem, Category } from '@/types'

let counter = 0
const nextId = (prefix = 'id') => `${prefix}-${++counter}`

export function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: nextId('prod'),
    sku: 'SAM-ELE-001',
    name: 'Sample Product',
    description: 'A test product',
    unit: 'pcs',
    cost_price: 80,
    selling_price: 100,
    tax_rate: 10,
    min_stock_level: 5,
    is_active: true,
    ...overrides,
  }
}

export function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: nextId('cust'),
    name: 'Alice',
    phone: '+94770000000',
    email: 'alice@example.com',
    address: '1 Test St',
    loyalty_points: 0,
    credit_limit: 0,
    outstanding_due: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: nextId('user'),
    role_id: nextId('role'),
    name: 'Test User',
    email: 'user@example.com',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

export function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: nextId('cat'),
    name: 'Test Category',
    sort_order: 0,
    is_active: true,
    ...overrides,
  }
}

export function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  const product = overrides.product ?? makeProduct()
  return {
    product,
    quantity: 1,
    unit_price: product.selling_price,
    discount_pct: 0,
    discount_amount: 0,
    tax_amount: 0,
    line_total: 0,
    ...overrides,
  }
}
