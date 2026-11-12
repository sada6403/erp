import { NextRequest, NextResponse } from 'next/server'
import { resolveAdminCompany } from '@/lib/app/adminLib'
import { fail, handleError } from '@/lib/app/http'
import { readPrivateImage } from '@/lib/app/privateFiles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POS only (x-api-key). ?side=front|back. Private: no caching.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const company = await resolveAdminCompany(req)
    const { id } = await ctx.params
    const side = req.nextUrl.searchParams.get('side') === 'back' ? 'nic_back_ref' : 'nic_front_ref'
    const { rows } = await company.tp.query<Record<string, unknown>>(`SELECT ${side} AS ref FROM smartbuy_join_requests WHERE id = ?`, [id])
    const img = rows[0]?.ref ? await readPrivateImage(String(rows[0].ref)) : null
    if (!img) fail(404, 'NOT_FOUND', 'Photo not found')
    return new NextResponse(new Uint8Array(img), { headers: { 'content-type': 'image/webp', 'cache-control': 'private, no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
