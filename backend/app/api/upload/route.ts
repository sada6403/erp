import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { resolveCompany, AccountStatusError } from '@/lib/auth'

export const runtime = 'nodejs'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

export async function POST(request: NextRequest) {
  // Was gated by `isAuthorized()`, which only accepts a single global
  // `CLOUD_API_KEY` env var — but electron/services/cloudApi.ts (used by
  // SyncService's uploadOfflineImage) always sends the calling company's own
  // per-tenant key, the same one sync/push and sync/changes validate via
  // resolveCompany(). Those two never match for a real customer, so every
  // product-image upload was permanently rejected with 401 — the sync queue
  // item retried up to MAX_ATTEMPTS and got stuck failed ("Image upload
  // failed; retrying before pushing product record") for a reason no amount
  // of retrying could ever fix. Matches the pattern already used correctly
  // by /api/health and every /api/sync/* route.
  let company
  try {
    company = await resolveCompany(request)
  } catch (err) {
    if (err instanceof AccountStatusError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 403 })
    }
    throw err
  }
  if (!company) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const contentType = request.headers.get('content-type')?.split(';')[0] || ''
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'Unsupported image type' }, { status: 415 })
  }

  const maxBytes = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024)
  const buffer = Buffer.from(await request.arrayBuffer())
  if (buffer.length === 0 || buffer.length > maxBytes) {
    return NextResponse.json({ error: 'Invalid image size' }, { status: 413 })
  }

  const requestedName = request.nextUrl.searchParams.get('filename') || ''
  const requestedBase = path.basename(requestedName, path.extname(requestedName))
    .replace(/[^a-zA-Z0-9_-]/g, '')
  const fileName = `${requestedBase || randomUUID()}${EXTENSIONS[contentType]}`
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')

  await mkdir(uploadDir, { recursive: true })
  await writeFile(path.join(uploadDir, fileName), buffer, { flag: 'w' })

  const baseUrl = (process.env.PUBLIC_BASE_URL || request.nextUrl.origin).replace(/\/+$/, '')
  return NextResponse.json({ url: `${baseUrl}/api/files/${encodeURIComponent(fileName)}` })
}
