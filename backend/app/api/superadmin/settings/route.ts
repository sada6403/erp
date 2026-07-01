import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'

async function ensureSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      \`key\`     VARCHAR(64) NOT NULL PRIMARY KEY,
      value       JSON        NOT NULL,
      updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `)
}

export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error
  try {
    await ensureSettingsTable()
    const { rows } = await pool.query(`SELECT \`key\`, value FROM system_settings ORDER BY \`key\``)
    return NextResponse.json(Object.fromEntries(
      rows.map((r: Record<string, unknown>) => [r.key, typeof r.value === 'string' ? JSON.parse(r.value as string) : r.value])
    ))
  } catch (err) {
    console.error('[settings] GET error:', err)
    return NextResponse.json({})
  }
}

export async function PATCH(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  try {
    await ensureSettingsTable()

    const body: Record<string, unknown> = await req.json()
    const validKeys = ['branding','smtp','sms','payment','storage','defaults']

    for (const [key, value] of Object.entries(body)) {
      if (!validKeys.includes(key)) continue
      await pool.query(
        `INSERT INTO system_settings (\`key\`, value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [key, JSON.stringify(value)]
      )
    }

    await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
      actorName: auth.payload.name, action: 'settings.update', newValues: Object.keys(body) })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[settings] PATCH error:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
