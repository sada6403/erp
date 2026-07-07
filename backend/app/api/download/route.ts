import { NextRequest, NextResponse } from 'next/server'
import { readdir, stat } from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UPDATES_DIR = process.env.UPDATES_DIR || path.join('C:', 'pos-erp-release')

/**
 * GET /api/download
 * Returns info about the latest installer, or streams the file if ?file=true
 */
export async function GET(request: NextRequest) {
  try {
    const files = await readdir(UPDATES_DIR)
    const installer = files
      .filter(f => f.endsWith('.exe') && !f.includes('blockmap'))
      .sort()
      .at(-1)

    if (!installer) {
      return NextResponse.json({ error: 'No installer found on server' }, { status: 404 })
    }

    const filePath = path.join(UPDATES_DIR, installer)
    const info     = await stat(filePath)

    // ?direct=1  → stream the file
    if (request.nextUrl.searchParams.get('direct') === '1') {
      const { createReadStream } = await import('node:fs')
      const { Readable } = await import('node:stream')
      const stream = createReadStream(filePath)
      const webStream = Readable.toWeb(stream) as ReadableStream

      return new NextResponse(webStream, {
        headers: {
          'content-type':        'application/octet-stream',
          'content-disposition': `attachment; filename="${installer}"`,
          'content-length':      String(info.size),
          'cache-control':       'no-store',
        },
      })
    }

    // Otherwise return metadata
    const base     = process.env.PUBLIC_BASE_URL || 'http://72.61.115.222'
    return NextResponse.json({
      fileName:    installer,
      size:        info.size,
      sizeFormatted: `${(info.size / 1024 / 1024).toFixed(1)} MB`,
      modifiedAt:  info.mtime,
      downloadUrl: `${base}/api/download?direct=1`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read installer'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
