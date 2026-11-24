// app_versions rows (cloud-only) + legacy app_settings fallback for GET /status and the admin routes.
import { createHash, randomUUID } from 'crypto'
import type { AppCompany } from './context'
import { fail, only, toIso } from './http'
import { getSettings, flag } from './settings'
import type { AppVersionDto } from './contracts/admin'
import {
  CHANNELS, PLATFORMS, SHA256_RE, allowedUpdateHosts, compareVersions, isValidVersion, parseNotes, safeUpdateUrl,
  type VChannel, type VPlatform,
} from './versionCore'

export const MAX_APK_BYTES = 120 * 1024 * 1024
export const updateHosts = () => allowedUpdateHosts(process.env)

type Row = Record<string, unknown>

async function getVersionRow(company: AppCompany, platform: VPlatform, channel: VChannel): Promise<Row | null> {
  const { rows } = await company.tp.query<Row>(`SELECT * FROM app_versions WHERE platform = ? AND channel = ? LIMIT 1`, [platform, channel])
  return rows[0] ?? null
}

function dto(r: Row, platform: VPlatform, channel: VChannel): AppVersionDto {
  return {
    platform, channel, configured: true,
    latest_version: String(r.latest_version), min_version: String(r.min_version), critical: Number(r.critical) === 1,
    release_notes: parseNotes(r.release_notes),
    update_url: channel === 'test' && r.update_url ? String(r.update_url) : null,
    apk_sha256: r.apk_sha256 ? String(r.apk_sha256) : null,
    apk_size_bytes: r.apk_size_bytes == null ? null : Number(r.apk_size_bytes),
    updated_at: toIso(r.updated_at), updated_by: r.updated_by ? String(r.updated_by) : null,
  }
}

/** Row for (platform, channel), or the legacy app_settings values when none was saved. */
export async function resolveVersion(company: AppCompany, platform: VPlatform, channel: VChannel): Promise<AppVersionDto> {
  const r = await getVersionRow(company, platform, channel)
  if (r) return dto(r, platform, channel)
  const s = await getSettings(company)
  return {
    platform, channel, configured: false, latest_version: s.latest_version, min_version: s.min_app_version, critical: flag(s.latest_version_critical),
    release_notes: { en: '', ta: '', si: '' }, update_url: null, apk_sha256: null, apk_size_bytes: null, updated_at: null, updated_by: null,
  }
}

export function parsePlatform(v: unknown): VPlatform {
  if (v == null || v === '') return 'android'
  if (typeof v !== 'string' || !(PLATFORMS as readonly string[]).includes(v)) fail(400, 'VALIDATION', 'platform must be android or ios')
  return v as VPlatform
}
export function parseChannel(v: unknown): VChannel {
  if (v == null || v === '') return 'production'
  if (typeof v !== 'string' || !(CHANNELS as readonly string[]).includes(v)) fail(400, 'VALIDATION', 'channel must be test or production')
  return v as VChannel
}

export async function listVersions(company: AppCompany): Promise<AppVersionDto[]> {
  const out: AppVersionDto[] = []
  for (const channel of CHANNELS) out.push(await resolveVersion(company, 'android', channel))
  return out
}

const strip = (d: AppVersionDto) => ({
  latest_version: d.latest_version, min_version: d.min_version, critical: d.critical, update_url: d.update_url,
  apk_sha256: d.apk_sha256, apk_size_bytes: d.apk_size_bytes, release_notes: d.release_notes,
})

async function audit(company: AppCompany, actor: string | null, id: string, oldV: AppVersionDto, newV: AppVersionDto) {
  await company.tp.query(
    `INSERT INTO audit_logs (id, user_id, action, table_name, record_id, old_values, new_values) VALUES (?,?,?,?,?,?,?)`,
    [randomUUID(), null, 'APP_VERSION_SAVED', 'app_versions', id, JSON.stringify({ ...strip(oldV), actor }), JSON.stringify({ ...strip(newV), actor })])
}

export async function saveVersion(company: AppCompany, b: Record<string, unknown>): Promise<AppVersionDto> {
  only(b, ['platform', 'channel', 'latest_version', 'min_version', 'critical', 'release_notes', 'update_url', 'apk_sha256', 'apk_size_bytes', 'updated_by'])
  const platform = parsePlatform(b.platform)
  if (typeof b.channel !== 'string') fail(400, 'VALIDATION', 'channel is required')
  const channel = parseChannel(b.channel)
  if (!isValidVersion(b.latest_version)) fail(400, 'VALIDATION', 'latest_version must look like 1.2.3 or 1.2.3-test.4')
  if (!isValidVersion(b.min_version)) fail(400, 'VALIDATION', 'min_version must look like 1.2.3 or 1.2.3-test.4')
  const latest = String(b.latest_version).trim()
  const min = String(b.min_version).trim()
  if (compareVersions(min, latest) > 0) fail(400, 'VALIDATION', 'min_version cannot be higher than latest_version')
  if (b.release_notes !== undefined && (typeof b.release_notes !== 'object' || b.release_notes === null)) fail(400, 'VALIDATION', 'release_notes must be an object with en, ta, si')
  const notes = parseNotes(b.release_notes ?? {})

  const before = await resolveVersion(company, platform, channel)
  let url: string | null = null
  let sha: string | null = null
  let size: number | null = null
  if (channel === 'test') {
    const raw = b.update_url === undefined ? before.update_url : b.update_url
    if (raw) {
      url = safeUpdateUrl(raw, updateHosts())
      if (!url) fail(400, 'VALIDATION', 'update_url must be https on an allowed host (APP_UPDATE_HOSTS or this server)')
    }
    if (b.apk_sha256 !== undefined && b.apk_sha256 !== null && b.apk_sha256 !== '') {
      const h = String(b.apk_sha256).trim().toLowerCase()
      if (!SHA256_RE.test(h)) fail(400, 'VALIDATION', 'apk_sha256 must be 64 hex characters')
      sha = h
      size = b.apk_size_bytes == null ? null : Number(b.apk_size_bytes)
      if (size !== null && (!Number.isInteger(size) || size < 0 || size > MAX_APK_BYTES)) fail(400, 'VALIDATION', 'apk_size_bytes is invalid')
    } else if (b.apk_sha256 === undefined && url && url === before.update_url) {
      sha = before.apk_sha256 // an unchanged URL keeps its hash; a new URL clears it
      size = before.apk_size_bytes
    }
  } else if (b.update_url) {
    fail(400, 'VALIDATION', 'update_url is only used for the test channel (Play handles production updates)')
  }
  const id = `${platform}:${channel}`
  const actor = typeof b.updated_by === 'string' ? b.updated_by.slice(0, 120) : null
  await company.tp.query(
    `INSERT INTO app_versions (id, platform, channel, latest_version, min_version, critical, release_notes, update_url, apk_sha256, apk_size_bytes, updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE latest_version = VALUES(latest_version), min_version = VALUES(min_version), critical = VALUES(critical),
       release_notes = VALUES(release_notes), update_url = VALUES(update_url), apk_sha256 = VALUES(apk_sha256),
       apk_size_bytes = VALUES(apk_size_bytes), updated_by = VALUES(updated_by)`,
    [id, platform, channel, latest, min, b.critical ? 1 : 0, JSON.stringify(notes), url, sha, size, actor])
  const after = await resolveVersion(company, platform, channel)
  await audit(company, actor, id, before, after)
  return after
}

/** Download the stored test APK server-side (https, allow-listed host, no redirects, <= 120 MB); store sha256 + size. */
export async function fetchAndHashApk(company: AppCompany, body: Record<string, unknown>): Promise<AppVersionDto> {
  only(body, ['platform', 'channel', 'updated_by'])
  const platform = parsePlatform(body.platform)
  if (body.channel !== 'test') fail(400, 'VALIDATION', 'Only the test channel has an APK URL')
  const row = await getVersionRow(company, platform, 'test')
  if (!row) fail(404, 'NOT_FOUND', 'Save the test version and APK URL first')
  const url = safeUpdateUrl(row.update_url, updateHosts())
  if (!url) fail(400, 'VALIDATION', 'The saved APK URL is missing or not allowed')
  let res: Response
  try {
    res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(110_000) })
  } catch {
    fail(502, 'INTERNAL', 'Could not download the APK')
  }
  if (res.status !== 200 || !res.body) fail(502, 'INTERNAL', `The APK URL answered HTTP ${res.status}`)
  if (Number(res.headers.get('content-length') || 0) > MAX_APK_BYTES) fail(400, 'VALIDATION', 'APK is larger than 120 MB')
  const hash = createHash('sha256')
  let total = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_APK_BYTES) { await reader.cancel(); fail(400, 'VALIDATION', 'APK is larger than 120 MB') }
    hash.update(value)
  }
  if (total === 0) fail(502, 'INTERNAL', 'The APK URL returned an empty file')
  const before = await resolveVersion(company, platform, 'test')
  const actor = typeof body.updated_by === 'string' ? body.updated_by.slice(0, 120) : null
  await company.tp.query(`UPDATE app_versions SET apk_sha256 = ?, apk_size_bytes = ?, updated_by = ? WHERE platform = ? AND channel = 'test'`,
    [hash.digest('hex'), total, actor, platform])
  const after = await resolveVersion(company, platform, 'test')
  await audit(company, actor, `${platform}:test`, before, after)
  return after
}
