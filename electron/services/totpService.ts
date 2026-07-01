import crypto from 'crypto'
import QRCode from 'qrcode'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateSecret(length = 20): string {
  const bytes = crypto.randomBytes(Math.ceil(length * 5 / 8))
  let result = ''
  let bits = 0
  let value = 0
  for (let i = 0; i < bytes.length && result.length < length; i++) {
    value = (value << 8) | bytes[i]
    bits += 8
    while (bits >= 5 && result.length < length) {
      bits -= 5
      result += B32[(value >>> bits) & 31]
    }
  }
  return result
}

function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '')
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const char of clean) {
    const idx = B32.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((value >>> bits) & 0xff)
    }
  }
  return Buffer.from(bytes)
}

export function generateTOTP(secret: string, time = Date.now()): string {
  const counter = Math.floor(time / 1000 / 30)
  const buf = Buffer.alloc(8)
  const hi = Math.floor(counter / 0x100000000)
  const lo = counter >>> 0
  buf.writeUInt32BE(hi, 0)
  buf.writeUInt32BE(lo, 4)
  const key = base32Decode(secret)
  const hmac = crypto.createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1_000_000
  return code.toString().padStart(6, '0')
}

export function verifyTOTP(secret: string, token: string, windowSteps = 1): boolean {
  const now = Date.now()
  for (let i = -windowSteps; i <= windowSteps; i++) {
    if (generateTOTP(secret, now + i * 30_000) === token) return true
  }
  return false
}

export function getOtpAuthUri(secret: string, email: string, issuer = 'Enterprise POS ERP'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

export async function generateQrDataUrl(secret: string, email: string, issuer?: string): Promise<string> {
  const uri = getOtpAuthUri(secret, email, issuer)
  return QRCode.toDataURL(uri, { errorCorrectionLevel: 'H', margin: 2, scale: 6 })
}
