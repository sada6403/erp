import { appRoute } from '@/lib/app/context'
import { imageVariantUrl } from '@/lib/app/catalogLib'
import { audienceClass, audienceMatches, bannerLink, colomboNow, langOf, MAX_BANNERS } from '@/lib/app/bannerLib'
import type { BannersResponse } from '@/lib/app/contracts/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public: App Key only. A valid bearer token selects the customer / Smart Buy member audience; no or invalid token = guest.
export const GET = appRoute({ auth: 'optional' }, async ({ req, company, origin, user }): Promise<BannersResponse> => {
  const lang = langOf(req.nextUrl.searchParams.get('lang'), user?.language ?? 'en')
  const cls = await audienceClass(company, user)
  const now = colomboNow() // starts_at / ends_at are Asia/Colombo wall time (cloud MySQL runs UTC)
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT * FROM app_banners WHERE is_active = 1 AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)
      ORDER BY sort_order, created_at DESC LIMIT 50`, [now, now])
  const items: BannersResponse['items'] = []
  for (const b of rows) {
    if (!audienceMatches(b.audience, cls)) continue
    const image = imageVariantUrl(origin, b[`image_${lang}`] || b.image_url, 800)
    if (!image) continue // an image-less banner cannot be shown
    const title = b.title ? String(b.title) : null
    items.push({
      id: String(b.id), ...(title ? { title } : {}), subtitle: b.subtitle ? String(b.subtitle) : null,
      image_url: image, link: bannerLink(b), sort_order: Number(b.sort_order) || 0,
    })
    if (items.length >= MAX_BANNERS) break
  }
  return { items }
})
