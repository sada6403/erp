import { appRoute } from '@/lib/app/context'
import { parseHomeLayout } from '@/lib/app/bannerLib'
import type { HomeLayoutResponse } from '@/lib/app/contracts/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'none' }, async ({ company }): Promise<HomeLayoutResponse> => {
  const { rows } = await company.tp.query<{ value: string | null }>(`SELECT value FROM app_settings WHERE setting_key = 'home_layout' LIMIT 1`)
  return { sections: parseHomeLayout(rows[0]?.value) }
})
