import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { FEATURE_DEFINITIONS } from '@/lib/catalog'

export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  try {
    const { rows } = await pool.query(
      `SELECT feature_key, feature_name, module_key, description, sort_order, is_active
       FROM features
       ORDER BY sort_order, feature_name`
    )
    if (rows.length) return NextResponse.json(rows)
  } catch {
    // ignore and fall back to built-in catalog
  }

  return NextResponse.json(FEATURE_DEFINITIONS.map(feature => ({
    feature_key: feature.key,
    feature_name: feature.name,
    module_key: feature.moduleKey,
    description: feature.description,
    sort_order: feature.sort,
    is_active: 1,
    group: feature.group,
  })))
}
