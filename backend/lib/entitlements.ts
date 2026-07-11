import { pool } from './db'
import type { TokenPayload } from './jwt'
import { FEATURE_DEFINITIONS, MODULE_DEFINITIONS } from './catalog'

export const MODULE_KEYS = MODULE_DEFINITIONS.map(m => m.key) as readonly string[]
export const FEATURE_KEYS = FEATURE_DEFINITIONS.map(f => f.key) as readonly string[]

export type EntitlementResult = {
  enabledModules: string[]
  enabledFeatures: string[]
  limits: Record<string, number>
  licenseId: string | null
  deviceId: string | null
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, unknown> } catch { return {} }
  }
  if (typeof value === 'object') return value as Record<string, unknown>
  return {}
}

async function safeQuery<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
  try {
    return (await pool.query<T>(sql, values)).rows
  } catch {
    return []
  }
}

export async function resolveEntitlements(ctx: {
  companyId: string | null
  roleName?: string
  branchId?: string | null
  deviceId?: string | null
  payload?: TokenPayload
}): Promise<EntitlementResult> {
  const companyId = ctx.companyId
  const payload = ctx.payload
  const isSuperAdmin = payload?.portal === 'superadmin'

  if (!companyId || isSuperAdmin) {
    return {
      enabledModules: [...MODULE_KEYS],
      enabledFeatures: [...FEATURE_KEYS],
      limits: {},
      licenseId: null,
      deviceId: ctx.deviceId ?? null,
    }
  }

  const companyRows = await safeQuery<{
    package_id?: string | null
    max_users?: number | null
    max_branches?: number | null
    company_key?: string | null
  }>(
    `SELECT c.max_users, c.max_branches, c.company_key, s.package_id
     FROM companies c
     LEFT JOIN company_subscriptions s ON s.company_id = c.id AND s.status IN ('active','trial','grace')
     WHERE c.id = ?
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [companyId]
  )
  const company = companyRows[0] ?? null
  const packageId = company?.package_id ?? null

  const enabledMap: Record<string, boolean> = {}
  const enabledFeatureMap: Record<string, boolean> = {}

  if (packageId) {
    const pkgModules = await safeQuery<{ module_key: string; is_enabled: number }>(
      `SELECT module_key, is_enabled FROM package_modules WHERE package_id = ?`,
      [packageId]
    )
    for (const row of pkgModules) enabledMap[row.module_key] = Boolean(row.is_enabled)

    const pkgFeatures = await safeQuery<{ feature_key: string; is_enabled: number }>(
      `SELECT feature_key, is_enabled FROM plan_features WHERE plan_id = ?`,
      [packageId]
    )
    for (const row of pkgFeatures) enabledFeatureMap[row.feature_key] = Boolean(row.is_enabled)
  }

  const companyModules = await safeQuery<{ module_key: string; is_enabled: number }>(
    `SELECT module_key, is_enabled FROM company_modules WHERE company_id = ?`,
    [companyId]
  )
  for (const row of companyModules) enabledMap[row.module_key] = Boolean(row.is_enabled)

  const companyModuleOverrides = await safeQuery<{ module_key: string; is_enabled: number }>(
    `SELECT module_key, is_enabled FROM company_module_overrides WHERE company_id = ?`,
    [companyId]
  )
  for (const row of companyModuleOverrides) enabledMap[row.module_key] = Boolean(row.is_enabled)

  const companyFeatureOverrides = await safeQuery<{ feature_key: string; is_enabled: number }>(
    `SELECT feature_key, is_enabled FROM company_feature_overrides WHERE company_id = ?`,
    [companyId]
  )
  for (const row of companyFeatureOverrides) enabledFeatureMap[row.feature_key] = Boolean(row.is_enabled)

  const modules = MODULE_KEYS.filter(key => enabledMap[key] !== false)
  const features = FEATURE_KEYS.filter(key => enabledFeatureMap[key] !== false)

  const limitsRow = (await safeQuery<Record<string, unknown>>(
    `SELECT * FROM company_limits WHERE company_id = ? LIMIT 1`,
    [companyId]
  ))[0] ?? {}

  return {
    enabledModules: modules,
    enabledFeatures: features,
    limits: {
      maxUsers: Number(limitsRow.max_users ?? company?.max_users ?? 0),
      maxBranches: Number(limitsRow.max_branches ?? company?.max_branches ?? 0),
      maxPosDevices: Number(limitsRow.max_pos_devices ?? 0),
      maxStorageGb: Number(limitsRow.max_storage_gb ?? 0),
    },
    licenseId: (await safeQuery<{ license_key?: string }>(
      `SELECT license_key FROM licenses WHERE company_id = ? AND status IN ('active','trial','grace') ORDER BY created_at DESC LIMIT 1`,
      [companyId]
    ))[0]?.license_key ?? (company?.company_key ?? null),
    deviceId: ctx.deviceId ?? null,
  }
}

export function assertFeature(
  payload: TokenPayload | { company_id?: string | null; portal?: string; role?: string; permissions?: Record<string, unknown>; branch_id?: string | null; deviceId?: string | null },
  key: string,
  resolved?: EntitlementResult
): boolean {
  if ((payload as TokenPayload).portal === 'superadmin') return true
  const perms = parseJsonObject((payload as TokenPayload).permissions)
  if (Boolean(perms.all)) return true
  const entitlements = resolved ?? { enabledFeatures: [], enabledModules: [], limits: {}, licenseId: null, deviceId: null }
  return entitlements.enabledFeatures.includes(key)
}
