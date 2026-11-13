import { NextRequest, NextResponse } from 'next/server'
import { resolveAdminCompany } from '@/lib/app/adminLib'
import { handleError, readJson } from '@/lib/app/http'
import { listVersions, saveVersion, updateHosts } from '@/lib/app/versionLib'
import type { AppVersionsResponse } from '@/lib/app/contracts/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const company = await resolveAdminCompany(req)
    const out: AppVersionsResponse = { items: await listVersions(company), allowed_hosts: updateHosts() }
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleError(err)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const company = await resolveAdminCompany(req)
    const saved = await saveVersion(company, await readJson(req))
    return NextResponse.json(saved, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
