import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { randomUUID } from 'crypto'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(_req)
  if ('error' in auth) return auth.error

  try {
    const { rows } = await pool.query(
      `SELECT id, device_name, device_id, license_key, branch_id,
              os_info, app_version, status, last_seen_at, activated_at,
              deactivated_at, notes, created_at
       FROM pos_devices
       WHERE company_id = ?
       ORDER BY created_at DESC`,
      [companyId]
    )
    return NextResponse.json(rows)
  } catch {
    // Table not yet created — return empty list
    return NextResponse.json([])
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { device_name, branch_id, notes } = await req.json()
  if (!device_name) {
    return NextResponse.json({ error: 'device_name required' }, { status: 400 })
  }

  // Check device limit (graceful if columns/tables not yet migrated)
  let maxDevices = 2
  let currentCount = 0
  try {
    const { rows: [company] } = await pool.query(
      `SELECT max_pos_devices FROM companies WHERE id = ?`, [companyId]
    )
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    maxDevices = Number((company as Record<string, number>).max_pos_devices ?? 2)
  } catch { /* column not yet added — use default 2 */ }

  try {
    const { rows: [row] } = await pool.query(
      `SELECT COUNT(*) as count FROM pos_devices WHERE company_id = ? AND status != 'deactivated'`,
      [companyId]
    )
    currentCount = Number((row as Record<string, number>).count ?? 0)
  } catch { /* table not yet created — treat as 0 */ }

  if (currentCount >= maxDevices) {
    return NextResponse.json(
      { error: `Device limit reached (${maxDevices} max). Deactivate an existing device or upgrade the plan.` },
      { status: 400 }
    )
  }

  const id          = randomUUID()
  const license_key = randomUUID()

  try {
    await pool.query(
      `INSERT INTO pos_devices (id, company_id, branch_id, device_name, license_key, status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, NOW())`,
      [id, companyId, branch_id ?? null, device_name, license_key, notes ?? null]
    )
  } catch (e) {
    return NextResponse.json(
      { error: 'Database not ready. Please restart the backend server to apply migrations.' },
      { status: 503 }
    )
  }

  await auditLog({
    portal: 'superadmin', actorType: 'superadmin',
    actorId: auth.payload.sub, actorName: auth.payload.name,
    action: 'device.create', resource: 'pos_devices', resourceId: id, companyId,
    newValues: { device_name, company_id: companyId, license_key },
  })

  return NextResponse.json({ id, device_name, license_key, status: 'pending' }, { status: 201 })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { device_id: deviceRowId, action, notes } = await req.json()
  if (!action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 })
  }

  if (action === 'deactivateAll') {
    const { rows } = await pool.query(
      `UPDATE pos_devices SET status = 'deactivated', deactivated_at = NOW()
       WHERE company_id = ? AND status != 'deactivated'`,
      [companyId]
    )
    const affected = (rows as unknown as { affectedRows?: number }).affectedRows ?? 0
    await auditLog({
      portal: 'superadmin', actorType: 'superadmin',
      actorId: auth.payload.sub, actorName: auth.payload.name,
      action: 'device.deactivateAll', resource: 'pos_devices', resourceId: companyId,
      companyId, newValues: { affected },
    })
    return NextResponse.json({ ok: true, affected })
  }

  if (action === 'reactivateAll') {
    const { rows } = await pool.query(
      `UPDATE pos_devices SET status = 'active', deactivated_at = NULL
       WHERE company_id = ? AND status = 'deactivated' AND device_id IS NOT NULL`,
      [companyId]
    )
    const affected = (rows as unknown as { affectedRows?: number }).affectedRows ?? 0
    await auditLog({
      portal: 'superadmin', actorType: 'superadmin',
      actorId: auth.payload.sub, actorName: auth.payload.name,
      action: 'device.reactivateAll', resource: 'pos_devices', resourceId: companyId,
      companyId, newValues: { affected },
    })
    return NextResponse.json({ ok: true, affected })
  }

  if (!deviceRowId) {
    return NextResponse.json({ error: 'device_id required' }, { status: 400 })
  }

  if (action === 'deactivate') {
    await pool.query(
      `UPDATE pos_devices SET status = 'deactivated', deactivated_at = NOW(), notes = COALESCE(?, notes)
       WHERE id = ? AND company_id = ?`,
      [notes ?? null, deviceRowId, companyId]
    )
    await auditLog({
      portal: 'superadmin', actorType: 'superadmin',
      actorId: auth.payload.sub, actorName: auth.payload.name,
      action: 'device.deactivate', resource: 'pos_devices', resourceId: deviceRowId, companyId,
    })
  } else if (action === 'reset') {
    // Reset device_id so the license can be activated on a new machine
    await pool.query(
      `UPDATE pos_devices SET device_id = NULL, status = 'pending', activated_at = NULL, deactivated_at = NULL
       WHERE id = ? AND company_id = ?`,
      [deviceRowId, companyId]
    )
    await auditLog({
      portal: 'superadmin', actorType: 'superadmin',
      actorId: auth.payload.sub, actorName: auth.payload.name,
      action: 'device.reset', resource: 'pos_devices', resourceId: deviceRowId, companyId,
    })
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
