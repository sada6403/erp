import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { randomUUID } from 'crypto'

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const e = err as Error
    console.error(`[activate POST] step failed: ${name}`, e.message)
    throw err
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { device_id, device_name, os_info, app_version } = body

    // Support both: company_key (new) and license_key (legacy per-device)
    const company_key = body.company_key?.trim()
    const license_key = body.license_key?.trim()
    const branch_id   = body.branch_id ?? null

    if (!device_id || !device_name) {
      return NextResponse.json({ error: 'device_id and device_name are required' }, { status: 400 })
    }
    if (!company_key && !license_key) {
      return NextResponse.json({ error: 'company_key or license_key is required' }, { status: 400 })
    }

    // ── Company Key Flow (new) ─────────────────────────────────────────────
    if (company_key) {
      const { rows } = await step('find company by company_key', () =>
        pool.query(
          `SELECT c.id as company_id, c.name as company_name, c.status as company_status,
                  c.api_key, c.max_pos_devices, c.brand_color, c.brand_logo_url,
                  s.ends_at as sub_ends_at, s.status as sub_status, p.grace_period_days
           FROM companies c
           LEFT JOIN company_subscriptions s ON s.company_id = c.id AND s.status IN ('active','trial','grace')
           LEFT JOIN packages p ON p.id = s.package_id
           WHERE c.company_key = ?`,
          [company_key]
        )
      )

      if (!rows.length) {
        return NextResponse.json({ error: 'Invalid company key. Please contact your administrator.' }, { status: 404 })
      }

      const co = rows[0] as Record<string, unknown>

      if (co.company_status === 'suspended') {
        return NextResponse.json({ error: 'Your company account is suspended.' }, { status: 403 })
      }
      if (co.company_status === 'cancelled') {
        return NextResponse.json({ error: 'Your company account has been cancelled.' }, { status: 403 })
      }

      // Check if this device is already registered (re-activation)
      let existingDevice: Record<string, unknown> | null = null
      let deviceRegisteredElsewhere: Record<string, unknown> | null = null
      try {
        const { rows: ed } = await step('find existing device', () =>
          pool.query(
            `SELECT pd.*, c.name as company_name, c.id as registered_company_id
             FROM pos_devices pd
             JOIN companies c ON c.id = pd.company_id
             WHERE pd.device_id = ?
             LIMIT 1`,
            [device_id]
          )
        )
        if (ed.length) {
          const device = ed[0] as Record<string, unknown>
          if (String(device.registered_company_id) === String(co.company_id)) {
            existingDevice = device
          } else {
            deviceRegisteredElsewhere = device
          }
        }
      } catch { /* table may not exist */ }

      if (!existingDevice) {
        if (deviceRegisteredElsewhere) {
          return NextResponse.json({
            error: `This device is already registered under ${deviceRegisteredElsewhere.company_name || 'another company'}. Reset or deactivate that device in SuperAdmin before activating it for this company.`,
          }, { status: 409 })
        }

        // Check device limit
        const maxDevices = Number(co.max_pos_devices ?? 2)
        let activeCount = 0
        try {
          const { rows: [dc] } = await step('count active devices', () =>
            pool.query(
              `SELECT COUNT(*) as cnt FROM pos_devices WHERE company_id = ? AND status = 'active'`,
              [co.company_id]
            )
          )
          activeCount = Number((dc as Record<string, unknown>).cnt ?? 0)
        } catch { /* treat as 0 */ }

        if (activeCount >= maxDevices) {
          return NextResponse.json(
            { error: `Device limit reached (${activeCount}/${maxDevices}). Please upgrade your subscription.` },
            { status: 400 }
          )
        }

        // Auto-register new device
        const newDeviceId = randomUUID()
        const newLicenseKey = randomUUID()
        try {
          await step('insert new device', () =>
            pool.query(
              `INSERT INTO pos_devices
                 (id, company_id, branch_id, device_name, device_id, license_key, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'active', NOW())`,
              [newDeviceId, co.company_id, branch_id, device_name, device_id, newLicenseKey]
            )
          )
        } catch (e) {
          return NextResponse.json({ error: 'Failed to register device. ' + (e as Error).message }, { status: 500 })
        }
      } else {
        // Update existing device
        await step('update existing device', () =>
          pool.query(
            `UPDATE pos_devices SET device_name=?, branch_id=COALESCE(?,branch_id), status='active' WHERE device_id=? AND company_id=?`,
            [device_name, branch_id, device_id, co.company_id]
          )
        )
      }

      // Optional tracking columns
      try {
        await step('update device tracking columns', () =>
          pool.query(
            `UPDATE pos_devices SET activated_at=COALESCE(activated_at,NOW()), os_info=?, app_version=?, last_seen_at=NOW()
             WHERE device_id=? AND company_id=?`,
            [os_info ?? null, app_version ?? null, device_id, co.company_id]
          )
        )
      } catch { /* columns not yet migrated */ }

      return NextResponse.json({
        success:        true,
        activation_type: 'company_key',
        api_key:        co.api_key,
        company_id:     co.company_id,
        company_name:   co.company_name,
        brand_color:    co.brand_color    ?? null,
        brand_logo_url: co.brand_logo_url ?? null,
        sub_status:     co.sub_status     ?? 'active',
        sub_ends_at:    co.sub_ends_at    ?? null,
      })
    }

    // ── Legacy Per-Device License Key Flow ─────────────────────────────────
    const { rows } = await pool.query(
      `SELECT pd.id, pd.device_id, pd.device_name, pd.branch_id, pd.status as device_status,
              c.id as company_id, c.name as company_name,
              c.status as company_status, c.api_key,
              c.brand_color, c.brand_logo_url
       FROM pos_devices pd
       JOIN companies c ON c.id = pd.company_id
       WHERE pd.license_key = ?`,
      [license_key]
    )

    if (!rows.length) {
      return NextResponse.json({ error: 'Invalid license key. Please contact your administrator.' }, { status: 404 })
    }

    const dev = rows[0] as Record<string, unknown>

    if (dev.company_status === 'suspended') {
      return NextResponse.json({ error: 'Your company account is suspended.' }, { status: 403 })
    }
    if (dev.company_status === 'cancelled') {
      return NextResponse.json({ error: 'Your company account has been cancelled.' }, { status: 403 })
    }
    if (dev.device_status === 'deactivated') {
      return NextResponse.json({ error: 'This device has been deactivated.' }, { status: 403 })
    }
    if (dev.device_id && dev.device_id !== device_id) {
      return NextResponse.json({ error: 'License key already activated on another device.' }, { status: 409 })
    }

    await pool.query(
      `UPDATE pos_devices SET device_id=?, device_name=?, status='active' WHERE license_key=?`,
      [device_id, device_name, license_key]
    )
    try {
      await pool.query(
        `UPDATE pos_devices SET activated_at=COALESCE(activated_at,NOW()), os_info=?, app_version=?, last_seen_at=NOW() WHERE license_key=?`,
        [os_info ?? null, app_version ?? null, license_key]
      )
    } catch { /* columns not yet migrated */ }

    return NextResponse.json({
      success:        true,
      activation_type: 'license_key',
      api_key:        dev.api_key,
      company_id:     dev.company_id,
      company_name:   dev.company_name,
      brand_color:    dev.brand_color    ?? null,
      brand_logo_url: dev.brand_logo_url ?? null,
    })
  } catch (err) {
    const e = err as Error
    console.error('[activate POST] MSG:', e.message)
    console.error('[activate POST] STACK:', e.stack)
    return NextResponse.json({
      error: e.message,
      _stack: e.stack?.split('\n').slice(0, 8),
    }, { status: 500 })
  }
}
