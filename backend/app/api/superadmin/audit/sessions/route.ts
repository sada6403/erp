import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, getClientMeta, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'

async function ensureTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS saas_active_sessions (
        id VARCHAR(64) PRIMARY KEY,
        portal VARCHAR(32) NOT NULL,
        user_id VARCHAR(64) NOT NULL,
        user_name VARCHAR(100),
        user_email VARCHAR(150),
        pc_name VARCHAR(100) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        logged_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_action VARCHAR(255) DEFAULT 'Logged in',
        current_path VARCHAR(255) DEFAULT '/',
        is_online TINYINT(1) DEFAULT 1,
        INDEX idx_sessions_user (user_id),
        INDEX idx_sessions_last_seen (last_seen_at),
        INDEX idx_sessions_pc (pc_name)
      )
    `)
  } catch (e) {
    console.warn('[sessions] ensureTable skipped:', (e as Error).message?.slice(0, 80))
  }
}

// ─── GET: List active PC sessions ───────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  await ensureTable()

  try {
    // Select sessions active within the last 7 days, ordered by most recent activity
    const { rows } = await pool.query(
      `SELECT 
         id, portal, user_id, user_name, user_email, pc_name, ip_address, user_agent,
         logged_in_at, last_seen_at, last_action, current_path,
         TIMESTAMPDIFF(SECOND, last_seen_at, NOW()) AS seconds_ago,
         CASE WHEN TIMESTAMPDIFF(SECOND, last_seen_at, NOW()) <= 120 THEN 1 ELSE 0 END AS is_online
       FROM saas_active_sessions
       WHERE portal = 'superadmin' AND last_seen_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       ORDER BY last_seen_at DESC
       LIMIT 100`
    )

    return NextResponse.json({ sessions: rows })
  } catch (err) {
    const msg = (err as Error).message ?? ''
    console.error('[sessions] query error:', msg)
    if (msg.includes("doesn't exist") || msg.includes('No such table')) {
      return NextResponse.json({ sessions: [] })
    }
    return NextResponse.json({ error: msg || 'Internal Server Error' }, { status: 500 })
  }
}

// ─── POST: Heartbeat / Update active activity ────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  await ensureTable()

  try {
    const body = await req.json().catch(() => ({}))
    const clientMeta = getClientMeta(req)
    const sessionId = (body.sessionId || clientMeta.sessionId || '').trim().slice(0, 64)
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    const pcName = (body.pcName || clientMeta.pcName || 'Office PC').trim().slice(0, 100)
    const lastAction = (body.action || 'Viewing Dashboard').trim().slice(0, 255)
    const currentPath = (body.path || '/').trim().slice(0, 255)
    const user = auth.payload

    await pool.query(
      `INSERT INTO saas_active_sessions
         (id, portal, user_id, user_name, user_email, pc_name, ip_address, user_agent, logged_in_at, last_seen_at, last_action, current_path, is_online)
       VALUES (?, 'superadmin', ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         pc_name = VALUES(pc_name),
         last_seen_at = NOW(),
         last_action = VALUES(last_action),
         current_path = VALUES(current_path),
         ip_address = COALESCE(VALUES(ip_address), ip_address),
         user_agent = COALESCE(VALUES(user_agent), user_agent),
         is_online = 1`,
      [
        sessionId,
        user.sub,
        user.name ?? 'Administrator',
        user.email ?? 'admin',
        pcName,
        clientMeta.ip ?? null,
        clientMeta.userAgent ?? null,
        lastAction,
        currentPath,
      ]
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[sessions] heartbeat error:', err)
    return NextResponse.json({ error: 'Heartbeat failed' }, { status: 500 })
  }
}

// ─── DELETE: Force disconnect / Revoke session ───────────────────────────────
export async function DELETE(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  await ensureTable()

  try {
    const sp = req.nextUrl.searchParams
    const sessionId = sp.get('id')?.trim()
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
    }

    const clientMeta = getClientMeta(req)

    // Find the session to get PC name for audit log
    const { rows } = await pool.query(`SELECT pc_name, user_name FROM saas_active_sessions WHERE id = ?`, [sessionId])
    const pcName = rows[0]?.pc_name ?? 'Unknown PC'

    await pool.query(`DELETE FROM saas_active_sessions WHERE id = ?`, [sessionId])

    await auditLog({
      portal: 'superadmin',
      actorType: 'superadmin',
      actorId: auth.payload.sub,
      actorName: auth.payload.name,
      action: 'session.terminate',
      resource: 'session',
      resourceId: sessionId,
      ip: clientMeta.ip,
      userAgent: clientMeta.userAgent,
      pcName: clientMeta.pcName,
      newValues: { terminatedSessionId: sessionId, terminatedPcName: pcName },
    })

    return NextResponse.json({ ok: true, message: `Session for ${pcName} terminated` })
  } catch (err) {
    console.error('[sessions] delete error:', err)
    return NextResponse.json({ error: 'Failed to terminate session' }, { status: 500 })
  }
}
