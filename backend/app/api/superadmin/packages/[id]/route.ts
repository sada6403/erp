import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'

type Params = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { rows } = await pool.query(`SELECT * FROM packages WHERE id = ?`, [params.id])
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const body = await req.json()
  const {
    name, description, monthly_price, annual_price, trial_days, sort_order,
    max_branches, max_users, max_products, features, is_active,
  } = body

  const setClauses: string[] = []
  const vals: unknown[] = []

  if (name            !== undefined) { setClauses.push('name = ?')            ; vals.push(name) }
  if (description     !== undefined) { setClauses.push('description = ?')     ; vals.push(description) }
  if (monthly_price   !== undefined) { setClauses.push('monthly_price = ?')   ; vals.push(Number(monthly_price)) }
  if (annual_price    !== undefined) { setClauses.push('annual_price = ?')    ; vals.push(Number(annual_price)) }
  if (trial_days      !== undefined) { setClauses.push('trial_days = ?')      ; vals.push(Number(trial_days)) }
  if (sort_order      !== undefined) { setClauses.push('sort_order = ?')      ; vals.push(Number(sort_order)) }
  if (max_branches    !== undefined) { setClauses.push('max_branches = ?')    ; vals.push(Number(max_branches)) }
  if (max_users       !== undefined) { setClauses.push('max_users = ?')       ; vals.push(Number(max_users)) }
  if (max_products    !== undefined) { setClauses.push('max_products = ?')    ; vals.push(Number(max_products)) }
  if (features        !== undefined) { setClauses.push('features = ?')        ; vals.push(JSON.stringify(features)) }
  if (is_active       !== undefined) { setClauses.push('is_active = ?')       ; vals.push(is_active ? 1 : 0) }

  if (!setClauses.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  vals.push(params.id)
  await pool.query(`UPDATE packages SET ${setClauses.join(', ')} WHERE id = ?`, vals)

  await auditLog({
    portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
    actorName: auth.payload.name, action: 'package.update',
    resource: 'packages', resourceId: params.id, newValues: body,
  })

  const { rows } = await pool.query(`SELECT * FROM packages WHERE id = ?`, [params.id])
  return NextResponse.json(rows[0])
}
