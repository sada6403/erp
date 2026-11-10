import { NextRequest, NextResponse } from 'next/server'
import { loadCompanyProfileForLegal } from '@/lib/companyProfile'
import { privacyPolicyHtml } from '@/lib/legalPages'
import { originOf } from '@/lib/app/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public page (no key). ?c=<company slug>, or the single active company of this deployment.
export async function GET(req: NextRequest) {
  const p = await loadCompanyProfileForLegal(req.nextUrl.searchParams.get('c'), originOf(req))
  if (!p) return new NextResponse('Page not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  return new NextResponse(privacyPolicyHtml(p), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } })
}
