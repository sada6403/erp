import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { randomUUID } from 'crypto'

type Params = { params: Promise<{ id: string }> }

// All modules the platform supports (source of truth)
const ALL_MODULES = [
  { key: 'pos',            name: 'POS / Billing',                sort: 1  },
  { key: 'inventory',      name: 'Inventory Management',          sort: 2  },
  { key: 'customers',      name: 'Customer Management',           sort: 3  },
  { key: 'reports_basic',  name: 'Basic Reports',                 sort: 4  },
  { key: 'installments',   name: 'Installments & Credit',         sort: 5  },
  { key: 'multi_branch',   name: 'Multi-Branch Management',       sort: 6  },
  { key: 'purchase_orders',name: 'Purchase Orders',               sort: 7  },
  { key: 'deliveries',     name: 'Delivery Management',           sort: 8  },
  { key: 'expenses',       name: 'Expense Tracking',              sort: 9  },
  { key: 'reports_full',   name: 'Advanced Reports & Analytics',  sort: 10 },
  { key: 'stock_transfers',name: 'Inter-Branch Stock Transfers',  sort: 11 },
  { key: 'api_access',     name: 'API Access',                    sort: 12 },
  { key: 'white_label',    name: 'White Label',                   sort: 13 },
]

export async function GET(_req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(_req)
  if ('error' in auth) return auth.error

  // Get company's current package
  const { rows: subRows } = await pool.query(
    `SELECT s.package_id FROM company_subscriptions s
     WHERE s.company_id = ? AND s.status IN ('active','trial')
     ORDER BY s.created_at DESC LIMIT 1`,
    [companyId]
  )
  const packageId = (subRows[0] as Record<string, string> | undefined)?.package_id ?? null

  // Package-level module enablement
  const pkgModuleMap: Record<string, boolean> = {}
  if (packageId) {
    try {
      const { rows: pkgMods } = await pool.query(
        `SELECT module_key, is_enabled FROM package_modules WHERE package_id = ?`,
        [packageId]
      )
      for (const m of pkgMods as { module_key: string; is_enabled: number }[]) {
        pkgModuleMap[m.module_key] = Boolean(m.is_enabled)
      }
    } catch { /* table not yet created — treat as no package defaults */ }
  }

  // Company-level overrides
  const compModuleMap: Record<string, boolean> = {}
  try {
    const { rows: compMods } = await pool.query(
      `SELECT module_key, is_enabled FROM company_modules WHERE company_id = ?`,
      [companyId]
    )
    for (const m of compMods as { module_key: string; is_enabled: number }[]) {
      compModuleMap[m.module_key] = Boolean(m.is_enabled)
    }
  } catch { /* table not yet created — no overrides */ }

  // Merge: company override wins, then package, then false
  const result = ALL_MODULES.map(m => {
    const fromPackage  = pkgModuleMap[m.key] ?? false
    const hasOverride  = m.key in compModuleMap
    const isEnabled    = hasOverride ? compModuleMap[m.key] : fromPackage
    return {
      module_key:  m.key,
      module_name: m.name,
      sort_order:  m.sort,
      from_package: fromPackage,
      has_override: hasOverride,
      is_enabled:   isEnabled,
    }
  })

  return NextResponse.json(result)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { module_key, is_enabled } = await req.json()
  if (!module_key || is_enabled === undefined) {
    return NextResponse.json({ error: 'module_key and is_enabled required' }, { status: 400 })
  }

  const valid = ALL_MODULES.find(m => m.key === module_key)
  if (!valid) return NextResponse.json({ error: 'Unknown module key' }, { status: 400 })

  // Upsert company module override
  try {
    await pool.query(
      `INSERT INTO company_modules (id, company_id, module_key, is_enabled, enabled_by, enabled_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), enabled_by = VALUES(enabled_by), enabled_at = NOW()`,
      [randomUUID(), companyId, module_key, is_enabled ? 1 : 0, auth.payload.sub]
    )
  } catch (e) {
    return NextResponse.json({ error: 'Database migration required: run migrate-001-limits-devices.sql' }, { status: 503 })
  }

  await auditLog({
    portal: 'superadmin', actorType: 'superadmin',
    actorId: auth.payload.sub, actorName: auth.payload.name,
    action: is_enabled ? 'module.enable' : 'module.disable',
    resource: 'company_modules', resourceId: companyId,
    newValues: { module_key, is_enabled },
  })

  return NextResponse.json({ ok: true, module_key, is_enabled })
}
