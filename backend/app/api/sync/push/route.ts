import { NextRequest, NextResponse } from 'next/server'
import { resolveCompany, AccountStatusError } from '@/lib/auth'
import type { QueryClient } from '@/lib/db'
import { applySyncOperation } from '@/lib/sync'
import { syncLimiter } from '@/lib/rateLimit'
import { assertFeature, resolveEntitlements } from '@/lib/entitlements'
import { TABLE_MODULE_MAP, ADMIN_LOCK_TABLES } from '@/lib/catalog'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const limited = syncLimiter(request)
  if (limited) return limited

  let company
  try {
    company = await resolveCompany(request)
  } catch (err) {
    if (err instanceof AccountStatusError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 403 })
    }
    throw err
  }
  if (!company) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const entitlements = await resolveEntitlements({ companyId: company.id })
  if (!assertFeature({ company_id: company.id, portal: 'admin', permissions: {} }, 'sync.cloud', entitlements)) {
    return NextResponse.json({ error: 'Feature disabled: sync.cloud' }, { status: 403 })
  }

  try {
    const body = await request.json() as {
      table?: unknown; operation?: unknown; recordId?: unknown; record?: unknown
    }
    if (
      typeof body.table !== 'string' || typeof body.operation !== 'string' ||
      typeof body.recordId !== 'string' || !body.record ||
      typeof body.record !== 'object' || Array.isArray(body.record)
    ) {
      return NextResponse.json({ error: 'Invalid sync payload' }, { status: 400 })
    }

    const requiredModule = TABLE_MODULE_MAP[body.table]
    if (requiredModule && !entitlements.enabledModules.includes(requiredModule)) {
      return NextResponse.json({ error: `Feature disabled: ${requiredModule}` }, { status: 403 })
    }

    if (company.adminLocked && ADMIN_LOCK_TABLES.includes(body.table)) {
      return NextResponse.json({ error: 'Company is locked: staff/permission changes are frozen' }, { status: 403 })
    }

    // Use a connection from the company's tenant pool
    const conn = await company.tp.connect() as QueryClient
    try {
      await applySyncOperation(conn, {
        table:     body.table as string,
        operation: body.operation as string,
        recordId:  body.recordId as string,
        record:    body.record as Record<string, unknown>,
      })
    } finally {
      conn.release()
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync push failed'
    console.error('[sync/push]', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
