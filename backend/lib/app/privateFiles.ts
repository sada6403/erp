// Private image store for NIC photos and bank slips. NEVER served publicly: files live outside UPLOAD_DIR
// (which /api/files serves) and are only streamed by admin routes that check the POS key.
import { randomUUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { fail } from './http'

const MAX_BYTES = 6 * 1024 * 1024
const REF_RE = /^[0-9a-f-]{36}\.webp$/

function dir(): string {
  return process.env.PRIVATE_UPLOAD_DIR || path.join(process.cwd(), 'private-uploads')
}

function looksLikeImage(b: Buffer): boolean {
  if (b.length < 12) return false
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true // jpeg
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true // png
  return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
}

/** Validate (magic bytes, size), strip EXIF, cap at 1600 px, store as WebP. Returns the private file ref. */
export async function savePrivateImage(file: unknown, field: string): Promise<string> {
  if (!file || typeof file === 'string' || typeof (file as Blob).arrayBuffer !== 'function') fail(400, 'VALIDATION', `${field} photo is required`)
  const blob = file as Blob
  if (blob.size === 0 || blob.size > MAX_BYTES) fail(400, 'VALIDATION', `${field} photo must be under 6 MB`)
  const buf = Buffer.from(await blob.arrayBuffer())
  if (!looksLikeImage(buf)) fail(400, 'VALIDATION', `${field} must be a JPEG, PNG or WebP image`)
  let out: Buffer
  try {
    out = await sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
  } catch {
    fail(400, 'VALIDATION', `${field} is not a readable image`)
  }
  const ref = `${randomUUID()}.webp`
  await mkdir(dir(), { recursive: true })
  await writeFile(path.join(dir(), ref), out, { flag: 'wx' })
  return ref
}

export async function readPrivateImage(ref: string | null): Promise<Buffer | null> {
  if (!ref || !REF_RE.test(ref)) return null
  try { return await readFile(path.join(dir(), ref)) } catch { return null }
}

/** multipart/form-data -> text fields + file parts. Anything else is a 400. */
export async function readMultipart(req: NextRequest): Promise<{ fields: Record<string, string>; files: Record<string, unknown> }> {
  if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('multipart/form-data')) fail(400, 'VALIDATION', 'Body must be multipart/form-data')
  const len = Number(req.headers.get('content-length') || 0)
  if (len > 3 * MAX_BYTES) fail(413, 'VALIDATION', 'Request body too large')
  let fd: FormData
  try { fd = await req.formData() } catch { fail(400, 'VALIDATION', 'Body must be valid multipart/form-data') }
  const fields: Record<string, string> = {}, files: Record<string, unknown> = {}
  for (const [k, v] of fd.entries()) {
    if (typeof v === 'string') fields[k] = v
    else files[k] = v
  }
  return { fields, files }
}
