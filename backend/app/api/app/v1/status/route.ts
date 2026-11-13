import { appRoute } from '@/lib/app/context'
import { getSettings, getModules, flag } from '@/lib/app/settings'
import { fail } from '@/lib/app/http'
import { parseChannel, parsePlatform, resolveVersion, updateHosts } from '@/lib/app/versionLib'
import { evaluate, isValidVersion, safeUpdateUrl } from '@/lib/app/versionCore'
import type { StatusResponse } from '@/lib/app/contracts/status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ?platform=android|ios (default android) &channel=test|production (default production) &version=<installed app version>
// Without a saved app_versions row the legacy app_settings values answer (old behaviour, old apps keep working).
export const GET = appRoute({ auth: 'none' }, async ({ company, req }): Promise<StatusResponse> => {
  const q = req.nextUrl.searchParams
  const platform = parsePlatform(q.get('platform'))
  const channel = parseChannel(q.get('channel'))
  const installed = q.get('version')
  if (installed && !isValidVersion(installed)) fail(400, 'VALIDATION', 'version must look like 1.2.3 or 1.2.3-test.4')

  const s = await getSettings(company)
  const v = await resolveVersion(company, platform, channel)
  const modules = await getModules(company)
  const freeOver = s.delivery_free_over !== '' ? Number(s.delivery_free_over) : NaN
  // Production never serves an APK URL through update_url (Play handles it); the test URL must be https + allow-listed.
  const updateUrl = channel === 'test' ? safeUpdateUrl(v.update_url, updateHosts()) : null
  let verdict: { update_required?: boolean; update_available?: boolean } = {}
  if (installed) {
    try { verdict = evaluate(installed, { latest_version: v.latest_version, min_version: v.min_version }) } catch { /* stored version unparseable: omit the verdict, never fail /status */ }
  }
  return {
    ordering_enabled: flag(s.ordering_enabled),
    maintenance_message: s.maintenance_message || null,
    min_app_version: v.min_version,
    latest_version: v.latest_version,
    latest_version_critical: v.critical,
    // legacy field: unchanged for old apps; for a saved test row it mirrors update_url
    apk_url: v.configured && channel === 'test' ? updateUrl : (s.apk_url || null),
    server_time: new Date().toISOString(),
    company: { name: company.name, currency: 'LKR' },
    modules,
    delivery: { flat_fee: Number(s.delivery_flat_fee) || 0, free_over: Number.isFinite(freeOver) && freeOver > 0 ? freeOver : null },
    bank_transfer: { enabled: flag(s.bank_transfer_enabled), instructions: s.bank_transfer_instructions || null },
    platform,
    channel,
    release_notes: v.release_notes,
    update_url: updateUrl,
    apk_sha256: updateUrl ? v.apk_sha256 : null,
    apk_size_bytes: updateUrl ? v.apk_size_bytes : null,
    ...verdict,
  }
})
