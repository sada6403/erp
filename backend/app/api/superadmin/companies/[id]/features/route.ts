import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { FEATURE_DEFINITIONS } from '@/lib/catalog'

type Params = { params: Promise<{ id: string }> }

function getFeatureDefaults() {
  return FEATURE_DEFINITIONS.map(feature => ({
    feature_key: feature.key,
    feature_name: feature.name,
    module_key: feature.moduleKey,
    group: feature.group,
    description: feature.description,
    sort_order: feature.sort,
    from_package: true,
    has_override: false,
    is_enabled: true,
  }))
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const features = getFeatureDefaults()

  try {
    const { rows: subRows } = await pool.query(
      `SELECT s.package_id FROM company_subscriptions s
       WHERE s.company_id = ? AND s.status IN ('active','trial','grace')
       ORDER BY s.created_at DESC LIMIT 1`,
      [companyId]
    )
    const packageId = (subRows[0] as Record<string, string> | undefined)?.package_id ?? null
    const packageMap: Record<string, boolean> = {}
    if (packageId) {
      const { rows: pkgRows } = await pool.query(
        `SELECT feature_key, is_enabled FROM plan_features WHERE plan_id = ?`,
        [packageId]
      )
      for (const row of pkgRows as { feature_key: string; is_enabled: number }[]) {
        packageMap[row.feature_key] = Boolean(row.is_enabled)
      }
    }

    const { rows: overrideRows } = await pool.query(
      `SELECT feature_key, is_enabled FROM company_feature_overrides WHERE company_id = ?`,
      [companyId]
    )
    const overrideMap: Record<string, boolean> = {}
    for (const row of overrideRows as { feature_key: string; is_enabled: number }[]) {
      overrideMap[row.feature_key] = Boolean(row.is_enabled)
    }

    return NextResponse.json(features.map(feature => {
      const pkgValue = packageMap[feature.feature_key]
      const hasOverride = Object.prototype.hasOwnProperty.call(overrideMap, feature.feature_key)
      const isEnabled = hasOverride ? overrideMap[feature.feature_key] : pkgValue ?? true
      return {
        ...feature,
        from_package: pkgValue ?? true,
        has_override: hasOverride,
        is_enabled: isEnabled,
      }
    }))
  } catch {
    return NextResponse.json(features)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { feature_key, is_enabled } = await req.json()
  if (!feature_key || is_enabled === undefined) {
    return NextResponse.json({ error: 'feature_key and is_enabled required' }, { status: 400 })
  }

  if (!FEATURE_DEFINITIONS.find(feature => feature.key === feature_key)) {
    return NextResponse.json({ error: 'Unknown feature key' }, { status: 400 })
  }

  await pool.query(
    `INSERT INTO company_feature_overrides (id, company_id, feature_key, is_enabled, enabled_by, enabled_at)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), enabled_by = VALUES(enabled_by), enabled_at = NOW()`,
    [randomUUID(), companyId, feature_key, is_enabled ? 1 : 0, auth.payload.sub]
  )

  await auditLog({
    portal: 'superadmin',
    actorType: 'superadmin',
    actorId: auth.payload.sub,
    actorName: auth.payload.name,
    action: is_enabled ? 'feature.enable' : 'feature.disable',
    resource: 'company_feature_overrides',
    resourceId: companyId,
    newValues: { feature_key, is_enabled },
  })

  return NextResponse.json({ ok: true, feature_key, is_enabled })
}
