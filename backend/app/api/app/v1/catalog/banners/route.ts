import { appRoute } from '@/lib/app/context'
import { imageVariantUrl } from '@/lib/app/catalogLib'
import type { BannersResponse } from '@/lib/app/contracts/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'none' }, async ({ company, origin }): Promise<BannersResponse> => {
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT * FROM app_banners WHERE is_active = 1 AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW())
      ORDER BY sort_order, created_at DESC LIMIT 20`)
  return {
    items: rows.map(b => ({
      id: String(b.id), title: String(b.title), subtitle: b.subtitle ? String(b.subtitle) : null,
      image_url: imageVariantUrl(origin, b.image_url, 800), link_url: b.link_url ? String(b.link_url) : null,
      sort_order: Number(b.sort_order) || 0,
    })),
  }
})
