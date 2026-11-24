import { NextRequest, NextResponse } from 'next/server'
import { resolveAdminCompany } from '@/lib/app/adminLib'
import { fail, handleError } from '@/lib/app/http'
import { readPrivateImage } from '@/lib/app/privateFiles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const company = await resolveAdminCompany(req)
    const { id } = await ctx.params
    const { rows } = await company.tp.query<Record<string, unknown>>(`SELECT file_ref FROM order_payment_slips WHERE id = ?`, [id])
    const img = rows[0]?.file_ref ? await readPrivateImage(String(rows[0].file_ref)) : null
    if (!img) fail(404, 'NOT_FOUND', 'Slip image not found')
    return new NextResponse(new Uint8Array(img), { headers: { 'content-type': 'image/webp', 'cache-control': 'private, no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
