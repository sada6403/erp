import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { pool } from '@/lib/db'
import { signAccessToken, issueRefreshToken } from '@/lib/jwt'
import { auditLog, getClientMeta } from '@/lib/rbac'
import { randomUUID } from 'crypto'

async function ensureActiveSessionsTable() {
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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { email, password } = body
  if (!email || !password) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `SELECT * FROM superadmins WHERE email = ? AND is_active = 1`,
    [email.toLowerCase().trim()]
  )
  if (!rows.length) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })

  const sa = rows[0] as Record<string, string>
  if (!await bcrypt.compare(password, sa.password_hash)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  await pool.query(`UPDATE superadmins SET last_login_at = NOW() WHERE id = ?`, [sa.id])

  const payload = { sub: sa.id, portal: 'superadmin' as const, company_id: null, name: sa.name, email: sa.email }
  const clientMeta = getClientMeta(req)
  const pcName = (body.pcName || clientMeta.pcName || 'Office PC').trim().slice(0, 100)
  const sessionId = (body.sessionId || clientMeta.sessionId || randomUUID()).trim().slice(0, 64)

  const accessToken  = signAccessToken(payload)
  const refreshToken = await issueRefreshToken(payload, { ip: clientMeta.ip, userAgent: clientMeta.userAgent })

  // Log to audit log with PC name
  await auditLog({
    portal: 'superadmin',
    actorType: 'superadmin',
    actorId: sa.id,
    actorName: sa.name,
    action: 'auth.login',
    ip: clientMeta.ip,
    userAgent: clientMeta.userAgent,
    pcName,
    newValues: { pcName, sessionId, email: sa.email },
  })

  // Upsert active device session
  await ensureActiveSessionsTable()
  try {
    await pool.query(
      `INSERT INTO saas_active_sessions
         (id, portal, user_id, user_name, user_email, pc_name, ip_address, user_agent, logged_in_at, last_seen_at, last_action, current_path, is_online)
       VALUES (?, 'superadmin', ?, ?, ?, ?, ?, ?, NOW(), NOW(), 'Logged in', '/', 1)
       ON DUPLICATE KEY UPDATE
         pc_name = VALUES(pc_name),
         ip_address = VALUES(ip_address),
         user_agent = VALUES(user_agent),
         last_seen_at = NOW(),
         last_action = 'Logged in',
         is_online = 1`,
      [sessionId, sa.id, sa.name, sa.email, pcName, clientMeta.ip ?? null, clientMeta.userAgent ?? null]
    )
  } catch (err) {
    console.warn('[sessions] upsert session failed:', (err as Error).message?.slice(0, 80))
  }

  return NextResponse.json({
    accessToken, refreshToken,
    user: { id: sa.id, name: sa.name, email: sa.email, portal: 'superadmin' },
    session: { id: sessionId, pcName },
  })
}

