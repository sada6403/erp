import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { randomUUID } from 'crypto'

export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error
  const { rows } = await pool.query(`SELECT * FROM packages ORDER BY sort_order, monthly_price`)
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { name, description, max_branches, max_users, max_products,
          features, monthly_price, annual_price, trial_days, sort_order } = await req.json()

  const id = randomUUID()
  await pool.query(
    `INSERT INTO packages (id,name,description,max_branches,max_users,max_products,features,monthly_price,annual_price,trial_days,sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, name, description, max_branches??1, max_users??5, max_products??500,
     JSON.stringify(features??{}), monthly_price??0, annual_price??0, trial_days??14, sort_order??99]
  )

  await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
    action: 'package.create', resource: 'packages', resourceId: id, newValues: { name } })

  return NextResponse.json({ id }, { status: 201 })
}
