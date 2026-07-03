import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { pool, tenantPool } from './db'

export type CompanyContext = {
  id:       string
  dbSchema: string
  name:     string
  slug:     string
  tp:       ReturnType<typeof tenantPool>
}

declare global { var _posErpTenantCompatibility: Set<string> | undefined }

const migratedTenantSchemas = global._posErpTenantCompatibility ?? new Set<string>()
global._posErpTenantCompatibility = migratedTenantSchemas

async function ensureTenantCompatibility(dbSchema: string) {
  if (migratedTenantSchemas.has(dbSchema)) return

  const tp = tenantPool(dbSchema)
  const statements = [
    `ALTER TABLE categories ADD COLUMN description TEXT NULL`,
    `ALTER TABLE categories ADD COLUMN sort_order INT NOT NULL DEFAULT 0`,
    `ALTER TABLE categories ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1`,
    `ALTER TABLE categories ADD COLUMN updated_at DATETIME NOT NULL DEFAULT NOW() ON UPDATE NOW()`,
    `ALTER TABLE invoices ADD COLUMN agent_code TEXT NULL`,
    `ALTER TABLE invoices ADD COLUMN agent_name TEXT NULL`,
    `ALTER TABLE invoices ADD COLUMN agent_commission_pct DECIMAL(6,2) NOT NULL DEFAULT 0`,
    `ALTER TABLE invoices ADD COLUMN agent_commission_amount DECIMAL(14,2) NOT NULL DEFAULT 0`,
  ]

  for (const sql of statements) {
    try {
      await tp.query(sql)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/Duplicate column name/i.test(message)) throw error
    }
  }

  migratedTenantSchemas.add(dbSchema)
}

// ─── Account status error (thrown when company is suspended or cancelled) ─────
export class AccountStatusError extends Error {
  constructor(
    public readonly code: 'ACCOUNT_SUSPENDED' | 'ACCOUNT_CANCELLED',
    message: string
  ) {
    super(message)
    this.name = 'AccountStatusError'
  }
}

// ─── Resolve company from x-api-key header ────────────────────────────────────
// Used by Electron POS sync. Each company has a unique api_key.
// Throws AccountStatusError for suspended/cancelled companies so callers can
// return a 403 with a meaningful code instead of a generic 401.
export async function resolveCompany(req: NextRequest): Promise<CompanyContext | null> {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) return null

  const { rows } = await pool.query(
    `SELECT id, db_schema, name, slug, status FROM companies WHERE api_key = ?`,
    [apiKey]
  )
  if (!rows.length) return null

  const c = rows[0] as Record<string, string>

  if (c.status === 'suspended') {
    throw new AccountStatusError('ACCOUNT_SUSPENDED', 'Account suspended. Contact your administrator.')
  }
  if (c.status === 'cancelled') {
    throw new AccountStatusError('ACCOUNT_CANCELLED', 'Account cancelled. Contact your service provider.')
  }
  if (!['active', 'trial'].includes(c.status)) return null

  await ensureTenantCompatibility(c.db_schema)

  return {
    id:       c.id,
    dbSchema: c.db_schema,
    name:     c.name,
    slug:     c.slug,
    tp:       tenantPool(c.db_schema),
  }
}

// ─── Legacy single-tenant API key check (kept for backward compat) ────────────
export function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CLOUD_API_KEY
  const received = request.headers.get('x-api-key')
  if (!expected || !received) return false
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  return expectedBuffer.length === receivedBuffer.length
    && timingSafeEqual(expectedBuffer, receivedBuffer)
}
