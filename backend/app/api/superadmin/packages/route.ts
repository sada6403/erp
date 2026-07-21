import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { randomUUID } from 'crypto'
import { FEATURE_DEFINITIONS, MODULE_DEFINITIONS } from '@/lib/catalog'

async function syncPlanFeatures(packageId: string, features: Record<string, unknown> | undefined) {
  const enabledMap = new Map<string, boolean>()
  for (const def of FEATURE_DEFINITIONS) {
    const raw = features?.[def.key]
    enabledMap.set(def.key, raw === undefined ? true : Boolean(raw))
  }

  await pool.query(`DELETE FROM plan_features WHERE plan_id = ?`, [packageId])
  for (const def of FEATURE_DEFINITIONS) {
    await pool.query(
      `INSERT INTO plan_features (id, plan_id, feature_key, is_enabled, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [randomUUID(), packageId, def.key, enabledMap.get(def.key) ? 1 : 0]
    )
  }
}

// Mirrors syncPlanFeatures above, but for package_modules — this is the table
// resolveEntitlements() actually uses for real module-level enforcement
// (sync/push gating, Feature Management tab), so a package that doesn't set
// this grants full module access by default regardless of tier.
async function syncPackageModules(packageId: string, modules: Record<string, unknown> | undefined) {
  const enabledMap = new Map<string, boolean>()
  for (const def of MODULE_DEFINITIONS) {
    const raw = modules?.[def.key]
    enabledMap.set(def.key, raw === undefined ? true : Boolean(raw))
  }

  await pool.query(`DELETE FROM package_modules WHERE package_id = ?`, [packageId])
  for (const def of MODULE_DEFINITIONS) {
    await pool.query(
      `INSERT INTO package_modules (id, package_id, module_key, module_name, is_enabled, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [randomUUID(), packageId, def.key, def.name, enabledMap.get(def.key) ? 1 : 0, def.sort]
    )
  }
}

export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error
  const { rows } = await pool.query(`SELECT * FROM packages ORDER BY sort_order, monthly_price`)

  // Attach each package's module state (package_modules is a separate table,
  // not inline JSON like `features` is) so the portal can show current
  // per-package module toggles without a second round-trip per package.
  const packages = rows as Record<string, unknown>[]
  for (const pkg of packages) {
    const { rows: modRows } = await pool.query(
      `SELECT module_key, is_enabled FROM package_modules WHERE package_id = ?`,
      [pkg.id]
    )
    const modules: Record<string, boolean> = {}
    for (const m of modRows as { module_key: string; is_enabled: number }[]) {
      modules[m.module_key] = Boolean(m.is_enabled)
    }
    pkg.modules = modules
  }

  return NextResponse.json(packages)
}

export async function POST(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { name, description, max_branches, max_users, max_products,
          features, modules, monthly_price, annual_price, trial_days, sort_order } = await req.json()

  const id = randomUUID()
  await pool.query(
    `INSERT INTO packages (id,name,description,max_branches,max_users,max_products,features,monthly_price,annual_price,trial_days,sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, name, description, max_branches??1, max_users??5, max_products??500,
     JSON.stringify(features??{}), monthly_price??0, annual_price??0, trial_days??14, sort_order??99]
  )
  await syncPlanFeatures(id, features as Record<string, unknown> | undefined)
  await syncPackageModules(id, modules as Record<string, unknown> | undefined)

  await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
    action: 'package.create', resource: 'packages', resourceId: id, newValues: { name } })

  return NextResponse.json({ id }, { status: 201 })
}
