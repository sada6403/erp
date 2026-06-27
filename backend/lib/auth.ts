import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

export function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CLOUD_API_KEY
  const received = request.headers.get('x-api-key')
  if (!expected || !received) return false

  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  return expectedBuffer.length === receivedBuffer.length
    && timingSafeEqual(expectedBuffer, receivedBuffer)
}
