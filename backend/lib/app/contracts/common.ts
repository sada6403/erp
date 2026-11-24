// App API contracts: shared, TYPE-ONLY (no runtime code, no imports from other backend files).
// Mobile imports these via `import type { ... } from '@contracts/common'`.
// Conventions: money = LKR number with max 2 decimals; quantities = number (up to 2 decimals,
// decimals only for weight items); timestamps = ISO-8601 UTC strings; ids = strings.

export type AppRole = 'customer' | 'smartbuy' | 'agent'

export type AppErrorCode =
  | 'APP_KEY_INVALID'
  | 'COMPANY_SUSPENDED'
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'FORBIDDEN'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_DISABLED'
  | 'TEMP_PASSWORD_EXPIRED'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'ORDERING_DISABLED'
  | 'OUT_OF_STOCK'
  | 'PRICE_CHANGED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'ORDER_NOT_CANCELLABLE'
  | 'OTP_INVALID'
  | 'CODE_INVALID'
  | 'CODE_EXPIRED'
  | 'MODULE_DISABLED'
  | 'NOT_IMPLEMENTED'
  | 'ALREADY_MEMBER'
  | 'SCHEME_FULL'
  | 'INTERNAL'

/** Every non-2xx response has exactly this body. */
export interface AppErrorBody {
  error: { code: AppErrorCode; message: string; details?: Record<string, unknown> }
}

/** Cursor pagination. `next_cursor` is null on the last page. */
export interface ListResponse<T> {
  items: T[]
  next_cursor: string | null
}

export interface OkResponse {
  ok: true
}

/** Request headers every call carries. */
export interface AppRequestHeaders {
  'x-app-key': string
  /** `Bearer <access_token>` on protected routes */
  Authorization?: string
  /** Required on POST /orders */
  'Idempotency-Key'?: string
}

export type PaymentMethod = 'cod' | 'bank_transfer'
export type SaleBy = 'normal' | 'weight'
