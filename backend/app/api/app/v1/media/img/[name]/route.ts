import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Public product image thumbnails: WebP 300 px / 800 px, cached on disk next to the uploads.
// Only files that already exist in UPLOAD_DIR can be served (no path traversal, no remote fetch).
export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params
  const file = path.basename(decodeURIComponent(name))
  if (!/^[\w.\- ]+\.(jpe?g|png|webp|gif)$/i.test(file)) return new NextResponse('Not found', { status: 404 })
  const w = req.nextUrl.searchParams.get('w') === '800' ? 800 : 300
  const dir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')
  const cacheDir = path.join(dir, 'thumbs')
  const cacheFile = path.join(cacheDir, `${file}.${w}.webp`)
  const headers = { 'content-type': 'image/webp', 'cache-control': 'public, max-age=604800' }
  try {
    const [src, cached] = await Promise.all([stat(path.join(dir, file)), stat(cacheFile).catch(() => null)])
    if (cached && cached.mtimeMs >= src.mtimeMs) {
      return new NextResponse(new Uint8Array(await readFile(cacheFile)), { headers })
    }
    const out = await sharp(path.join(dir, file)).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: w === 300 ? 70 : 78 }).toBuffer()
    await mkdir(cacheDir, { recursive: true })
    await writeFile(cacheFile, out)
    return new NextResponse(new Uint8Array(out), { headers })
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
}
