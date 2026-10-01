import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { resolveCompany, resolveDeviceAuthorization } from './auth'

const CODE_TTL_MS = 10 * 60 * 1000
const REQUEST_TTL_MS = 30 * 60 * 1000

export class ProductKeyAccessAuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ProductKeyAccessAuthError'
  }
}

export async function requireActivatedDevice(req: NextRequest) {
  const company = await resolveCompany(req)
  if (!company) throw new ProductKeyAccessAuthError(401, 'Unauthorized')
  const device = await resolveDeviceAuthorization(req, company.id)
  if (!device) {
    throw new ProductKeyAccessAuthError(403, 'This action requires a registered active device')
  }
  const deviceId = String(req.headers.get('x-device-id') || '').trim()
  if (!deviceId) throw new ProductKeyAccessAuthError(403, 'Device identity is required')
  return { company, device, deviceId }
}

function signingSecret(): string {
  return process.env.PRODUCT_KEY_ACCESS_SECRET
    || process.env.JWT_SECRET
    || 'local-development-product-key-access-secret'
}

export function createRequestSecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString('base64url')
  return { secret, hash: hashRequestSecret(secret) }
}

export function hashRequestSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function requestExpiry(now = Date.now()): Date {
  return new Date(now + REQUEST_TTL_MS)
}

export function createApprovalCode(now = Date.now()): {
  code: string
  salt: string
  hash: string
  expiresAt: Date
} {
  const code = String(randomInt(1000, 10_000))
  const salt = randomBytes(16).toString('hex')
  return {
    code,
    salt,
    hash: hashApprovalCode(code, salt),
    expiresAt: new Date(now + CODE_TTL_MS),
  }
}

export function hashApprovalCode(code: string, salt: string): string {
  return createHmac('sha256', signingSecret())
    .update(`${salt}:${code}`)
    .digest('hex')
}

export function verifyApprovalCode(code: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashApprovalCode(code, salt), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

