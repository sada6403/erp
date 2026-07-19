import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { setCompanyStatus, deleteTenant } from '@/lib/tenant'
import { pool } from '@/lib/db'
import { randomUUID } from 'crypto'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { rows } = await pool.query(
    `SELECT c.*, s.package_id, p.name as package_name, p.features as package_features,
            s.billing_cycle, s.status as sub_status, s.ends_at as sub_ends_at, s.amount as sub_amount
     FROM companies c
     LEFT JOIN company_subscriptions s ON s.company_id = c.id AND s.status IN ('active','trial')
     LEFT JOIN packages p ON p.id = s.package_id
     WHERE c.id = ?`,
    [companyId]
  )
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const body = await req.json()
  const { status, suspensionReason, name, email, phone, address, notes, regenerate_api_key,
          regenerate_company_key,
          maxBranches, maxUsers, maxPosDevices, maxStorageGb,
          brandColor, brandLogoUrl,
          subscriptionEndsAt, newPackageId, extendTrialDays } = body

  const { rows: [old] } = await pool.query(`SELECT * FROM companies WHERE id = ?`, [companyId])
  if (!old) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (status === 'suspended' && !String(suspensionReason ?? '').trim()) {
    return NextResponse.json({ error: 'A reason is required to suspend a company' }, { status: 400 })
  }

  if (status) await setCompanyStatus(companyId, status, { reason: suspensionReason, actorId: auth.payload.sub })

  const setClauses: string[] = []
  const vals: unknown[] = []
  if (name)                    { setClauses.push('name = ?')             ; vals.push(name) }
  if (email)                   { setClauses.push('email = ?')            ; vals.push(email) }
  if (phone)                   { setClauses.push('phone = ?')            ; vals.push(phone) }
  if (address)                 { setClauses.push('address = ?')          ; vals.push(address) }
  if (notes !== undefined)     { setClauses.push('notes = ?')            ; vals.push(notes) }
  if (regenerate_api_key)      { setClauses.push('api_key = ?')          ; vals.push(randomUUID()) }
  if (regenerate_company_key)  { setClauses.push('company_key = ?')      ; vals.push(randomUUID()) }
  if (maxBranches   != null)   { setClauses.push('max_branches = ?')     ; vals.push(Number(maxBranches)) }
  if (maxUsers      != null)   { setClauses.push('max_users = ?')        ; vals.push(Number(maxUsers)) }
  if (maxPosDevices != null)   { setClauses.push('max_pos_devices = ?')  ; vals.push(Number(maxPosDevices)) }
  if (maxStorageGb  != null)   { setClauses.push('max_storage_gb = ?')   ; vals.push(Number(maxStorageGb)) }
  if (brandColor    !== undefined) { setClauses.push('brand_color = ?')    ; vals.push(brandColor || null) }
  if (brandLogoUrl  !== undefined) { setClauses.push('brand_logo_url = ?') ; vals.push(brandLogoUrl || null) }

  if (setClauses.length) {
    vals.push(companyId)
    await pool.query(`UPDATE companies SET ${setClauses.join(', ')} WHERE id = ?`, vals)
  }

  // Subscription management
  if (subscriptionEndsAt || newPackageId || extendTrialDays) {
    const { rows: subs } = await pool.query(
      `SELECT id, ends_at, package_id FROM company_subscriptions WHERE company_id = ? AND status IN ('active','trial') ORDER BY created_at DESC LIMIT 1`,
      [companyId]
    )
    if (subs.length) {
      const sub = subs[0] as Record<string, unknown>
      const subUpdates: string[] = []
      const subVals: unknown[] = []
      if (subscriptionEndsAt) {
        subUpdates.push('ends_at = ?')
        subVals.push(subscriptionEndsAt)
      }
      if (extendTrialDays) {
        const current = sub.ends_at ? new Date(sub.ends_at as string) : new Date()
        if (current < new Date()) current.setTime(Date.now())
        current.setDate(current.getDate() + Number(extendTrialDays))
        subUpdates.push('ends_at = ?')
        subVals.push(current.toISOString().slice(0, 10))
      }
      if (newPackageId) {
        subUpdates.push('package_id = ?')
        subVals.push(newPackageId)
      }
      if (subUpdates.length) {
        subVals.push(sub.id)
        await pool.query(`UPDATE company_subscriptions SET ${subUpdates.join(', ')} WHERE id = ?`, subVals)
      }
    } else if (subscriptionEndsAt || newPackageId) {
      // Create a new subscription row if none exists
      await pool.query(
        `INSERT INTO company_subscriptions (id, company_id, package_id, status, billing_cycle, amount, starts_at, ends_at)
         VALUES (?, ?, ?, 'trial', 'monthly', 0, NOW(), ?)`,
        [randomUUID(), companyId, newPackageId || null, subscriptionEndsAt || null]
      )
    }
  }

  await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
    actorName: auth.payload.name, action: 'company.update',
    resource: 'companies', resourceId: companyId,
    oldValues: { status: (old as Record<string,string>).status }, newValues: body })

  // Return updated row (including new api_key if regenerated)
  const { rows: [updated] } = await pool.query(`SELECT * FROM companies WHERE id = ?`, [companyId])
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => ({})) as { permanent?: boolean }

  if (body.permanent) {
    try {
      await deleteTenant(companyId)
      await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
        actorName: auth.payload.name, action: 'company.permanentDelete',
        resource: 'companies', resourceId: companyId })
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 })
    }
  } else {
    await setCompanyStatus(companyId, 'cancelled')
    await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
      actorName: auth.payload.name, action: 'company.cancel',
      resource: 'companies', resourceId: companyId })
  }

  return NextResponse.json({ ok: true })
}
