import { readFile } from 'fs/promises'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await context.params
    const fileName = path.basename(name)
    const extension = path.extname(fileName).toLowerCase()
    const contentType = CONTENT_TYPES[extension]
    if (!contentType) return new NextResponse('Not found', { status: 404 })

    const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')
    const data = await readFile(path.join(uploadDir, fileName))
    return new NextResponse(data, {
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
}
