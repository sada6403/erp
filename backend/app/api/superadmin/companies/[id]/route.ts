import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { setCompanyStatus, deleteTenant, withTenant } from '@/lib/tenant'
import { pool } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { encryptSecret } from '@/lib/secretCrypto'

type Params = { params: Promise<{ id: string }> }

// Never send decrypted secrets back to the browser — same masking
// convention as the local app's electron/ipc/settings.ts (MASKED_SECRET).
// On save, a field left as this exact sentinel means "unchanged", so its
// stored (encrypted) value is preserved rather than being overwritten.
const MASKED_SECRET = '********'

function maskBrandingSecrets(brandingJson: unknown): string | null {
  if (!brandingJson) return brandingJson as null
  try {
    const branding = JSON.parse(String(brandingJson)) as Record<string, unknown>
    const smtp = branding.smtp as Record<string, unknown> | undefined
    if (smtp?.pass) smtp.pass = MASKED_SECRET
    const sms = branding.sms as Record<string, unknown> | undefined
    if (sms?.api_key) sms.api_key = MASKED_SECRET
    return JSON.stringify(branding)
  } catch {
    return brandingJson as string
  }
}

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
  const row = rows[0] as Record<string, unknown>
  return NextResponse.json({ ...row, branding_json: maskBrandingSecrets(row.branding_json) })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const body = await req.json()
  const { status, suspensionReason, name, email, phone, address, notes, regenerate_api_key,
          regenerate_company_key, revoke_previous_api_key, revoke_previous_company_key,
          maxBranches, maxUsers, maxPosDevices, maxStorageGb,
          brandColor, brandLogoUrl, loginLogoUrl, smtp, sms,
          subscriptionEndsAt, newPackageId, extendTrialDays,
          adminEmail, adminName, adminPassword,
          lock, lockReason } = body

  const { rows: [old] } = await pool.query(`SELECT * FROM companies WHERE id = ?`, [companyId])
  if (!old) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (status === 'suspended' && !String(suspensionReason ?? '').trim()) {
    return NextResponse.json({ error: 'A reason is required to suspend a company' }, { status: 400 })
  }

  if (status) await setCompanyStatus(companyId, status, { reason: suspensionReason, actorId: auth.payload.sub })

  if (lock === true) {
    if (!String(lockReason ?? '').trim()) {
      return NextResponse.json({ error: 'A reason is required to lock a company' }, { status: 400 })
    }
    await pool.query(
      `UPDATE companies SET admin_locked = 1, lock_reason = ?, locked_at = NOW(), locked_by = ? WHERE id = ?`,
      [lockReason.trim(), auth.payload.sub, companyId]
    )
    await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
      actorName: auth.payload.name, action: 'company.lock',
      resource: 'companies', resourceId: companyId, companyId, newValues: { lockReason } })
  } else if (lock === false) {
    await pool.query(
      `UPDATE companies SET admin_locked = 0, lock_reason = NULL, locked_at = NULL, locked_by = NULL WHERE id = ?`,
      [companyId]
    )
    await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
      actorName: auth.payload.name, action: 'company.unlock',
      resource: 'companies', resourceId: companyId, companyId })
  }

  // Every branding_json-touching field (logo, SMTP, SMS) is merged into ONE
  // read-merge-write here — doing separate independent read-merge-writes per
  // field would let a later one silently clobber an earlier one's change,
  // since each would parse the same pre-patch `old` snapshot.
  if (loginLogoUrl !== undefined || smtp !== undefined || sms !== undefined) {
    let branding: Record<string, unknown> = {}
    const existing = (old as Record<string, unknown>).branding_json
    if (existing) {
      try { branding = JSON.parse(String(existing)) as Record<string, unknown> } catch { /* ignore */ }
    }
    if (loginLogoUrl !== undefined) {
      branding.login_logo_url = loginLogoUrl || null
    }
    if (smtp !== undefined) {
      const prevSmtp = (branding.smtp as Record<string, unknown>) || {}
      const passIn = String(smtp.pass ?? '')
      branding.smtp = {
        host:       smtp.host ?? prevSmtp.host ?? '',
        port:       smtp.port ?? prevSmtp.port ?? 587,
        secure:     smtp.secure ?? prevSmtp.secure ?? false,
        user:       smtp.user ?? prevSmtp.user ?? '',
        // Blank means "clear it"; the masked sentinel means "leave it as-is";
        // anything else is a real new password, encrypted before storage.
        pass:       passIn === MASKED_SECRET ? (prevSmtp.pass ?? '') : (passIn ? encryptSecret(passIn) : ''),
        from_name:  smtp.from_name ?? prevSmtp.from_name ?? '',
        from_email: smtp.from_email ?? prevSmtp.from_email ?? '',
      }
    }
    if (sms !== undefined) {
      const prevSms = (branding.sms as Record<string, unknown>) || {}
      const keyIn = String(sms.api_key ?? '')
      branding.sms = {
        base_url:      sms.base_url ?? prevSms.base_url ?? '',
        method:        sms.method ?? prevSms.method ?? 'POST',
        content_type:  sms.content_type ?? prevSms.content_type ?? 'application/json',
        headers:       sms.headers ?? prevSms.headers ?? '',
        body_template: sms.body_template ?? prevSms.body_template ?? '{"mobile":"{phone}","message":"{message}"}',
        api_key:       keyIn === MASKED_SECRET ? (prevSms.api_key ?? '') : (keyIn ? encryptSecret(keyIn) : ''),
        sender_id:     sms.sender_id ?? prevSms.sender_id ?? '',
      }
    }
    await pool.query(`UPDATE companies SET branding_json = ? WHERE id = ?`, [JSON.stringify(branding), companyId])
  }

  const setClauses: string[] = []
  const vals: unknown[] = []
  if (name)                    { setClauses.push('name = ?')             ; vals.push(name) }
  if (email)                   { setClauses.push('email = ?')            ; vals.push(email) }
  if (phone)                   { setClauses.push('phone = ?')            ; vals.push(phone) }
  if (address)                 { setClauses.push('address = ?')          ; vals.push(address) }
  if (notes !== undefined)     { setClauses.push('notes = ?')            ; vals.push(notes) }
  const KEY_GRACE_HOURS = 48
  if (regenerate_api_key) {
    setClauses.push('previous_api_key = ?', 'previous_api_key_expires_at = DATE_ADD(NOW(), INTERVAL ? HOUR)', 'api_key = ?')
    vals.push((old as Record<string, string>).api_key, KEY_GRACE_HOURS, randomUUID())
  }
  if (regenerate_company_key) {
    setClauses.push('previous_company_key = ?', 'previous_company_key_expires_at = DATE_ADD(NOW(), INTERVAL ? HOUR)', 'company_key = ?')
    vals.push((old as Record<string, string>).company_key, KEY_GRACE_HOURS, randomUUID())
  }
  if (revoke_previous_api_key)     { setClauses.push('previous_api_key = NULL, previous_api_key_expires_at = NULL') }
  if (revoke_previous_company_key) { setClauses.push('previous_company_key = NULL, previous_company_key_expires_at = NULL') }
  if (maxBranches   != null)   { setClauses.push('max_branches = ?')     ; vals.push(Number(maxBranches)) }
  if (maxUsers      != null)   { setClauses.push('max_users = ?')        ; vals.push(Number(maxUsers)) }
  if (maxPosDevices != null)   { setClauses.push('max_pos_devices = ?')  ; vals.push(Number(maxPosDevices)) }
  if (maxStorageGb  != null)   { setClauses.push('max_storage_gb = ?')   ; vals.push(Number(maxStorageGb)) }
  if (brandColor    !== undefined) { setClauses.push('brand_color = ?')    ; vals.push(brandColor || null) }
  if (brandLogoUrl  !== undefined) { setClauses.push('brand_logo_url = ?') ; vals.push(brandLogoUrl || null) }
  if (adminEmail    !== undefined) { setClauses.push('admin_email = ?')    ; vals.push(adminEmail ? String(adminEmail).toLowerCase().trim() : null) }
  if (adminName     !== undefined) { setClauses.push('admin_name = ?')     ; vals.push(adminName ? String(adminName).trim() : null) }

  if (setClauses.length) {
    vals.push(companyId)
    await pool.query(`UPDATE companies SET ${setClauses.join(', ')} WHERE id = ?`, vals)
  }

  // Admin User update in isolated tenant database
  if (adminEmail || adminName || adminPassword) {
    try {
      await withTenant(companyId, async (client) => {
        // Find existing Company Admin or user matching old admin_email
        const { rows: adminRows } = await client.query(
          `SELECT u.id, u.name, u.email
           FROM users u
           JOIN roles r ON r.id = u.role_id
           WHERE u.is_active = 1
             AND (
               r.name = 'Company Admin'
               OR LOWER(u.email) = ?
               OR JSON_UNQUOTE(JSON_EXTRACT(r.permissions, '$.all')) = 'true'
             )
           ORDER BY r.name = 'Company Admin' DESC
           LIMIT 1`,
          [(old as Record<string, string>).admin_email?.toLowerCase() || '']
        )

        if (adminRows.length) {
          const targetAdmin = adminRows[0] as { id: string; name: string; email: string }
          const uClauses: string[] = ['updated_at = NOW()']
          const uVals: unknown[] = []

          if (adminEmail) {
            uClauses.push('email = ?')
            uVals.push(String(adminEmail).toLowerCase().trim())
          }
          if (adminName) {
            uClauses.push('name = ?')
            uVals.push(String(adminName).trim())
          }
          if (adminPassword) {
            const hash = await bcrypt.hash(String(adminPassword), 10)
            uClauses.push('password_hash = ?')
            uVals.push(hash)
          }

          uVals.push(targetAdmin.id)
          await client.query(`UPDATE users SET ${uClauses.join(', ')} WHERE id = ?`, uVals)
        } else {
          // Provision Company Admin user if missing
          const { rows: roleRows } = await client.query(`SELECT id FROM roles WHERE name = 'Company Admin' LIMIT 1`)
          const adminRoleId = (roleRows[0] as Record<string, string>)?.id
          const { rows: branchRows } = await client.query(`SELECT id FROM branches ORDER BY created_at ASC LIMIT 1`)
          const branchId = (branchRows[0] as Record<string, string>)?.id

          if (adminRoleId && branchId) {
            const hash = await bcrypt.hash(String(adminPassword || 'Admin@1234'), 10)
            await client.query(
              `INSERT INTO users (id, branch_id, role_id, name, email, password_hash, is_active)
               VALUES (?, ?, ?, ?, ?, ?, 1)`,
              [
                randomUUID(),
                branchId,
                adminRoleId,
                String(adminName || (old as Record<string, string>).admin_name || 'Company Admin').trim(),
                String(adminEmail || (old as Record<string, string>).admin_email || 'admin@demo.com').toLowerCase().trim(),
                hash,
              ]
            )
          }
        }
      })
    } catch (err) {
      console.error('[company.update] Failed to update tenant admin user:', err)
    }
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
    resource: 'companies', resourceId: companyId, companyId,
    oldValues: { status: (old as Record<string,string>).status }, newValues: body })

  // Return updated row (including new api_key if regenerated)
  const { rows: [updated] } = await pool.query(`SELECT * FROM companies WHERE id = ?`, [companyId])
  const updatedRow = updated as Record<string, unknown>
  return NextResponse.json({ ...updatedRow, branding_json: maskBrandingSecrets(updatedRow.branding_json) })
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
        resource: 'companies', resourceId: companyId, companyId })
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 })
    }
  } else {
    await setCompanyStatus(companyId, 'cancelled')
    await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
      actorName: auth.payload.name, action: 'company.cancel',
      resource: 'companies', resourceId: companyId, companyId })
  }

  return NextResponse.json({ ok: true })
}
