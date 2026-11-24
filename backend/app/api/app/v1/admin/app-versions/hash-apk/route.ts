import { NextRequest, NextResponse } from 'next/server'
import { resolveAdminCompany } from '@/lib/app/adminLib'
import { handleError, readJson } from '@/lib/app/http'
import { fetchAndHashApk } from '@/lib/app/versionLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const company = await resolveAdminCompany(req)
    return NextResponse.json(await fetchAndHashApk(company, await readJson(req)), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
