// Generic reversible-encryption helper for per-company secrets (SMTP
// password, SMS API key/secret) stored in companies.branding_json. Reuses
// the exact same AES-256-GCM key derivation as backup.ts (BACKUP_ENCRYPTION_KEY)
// rather than introducing a second secret/key-rotation surface.
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import { encryptionKey } from './backup'

const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

export function encryptSecret(plain: string): string {
  if (!plain) return ''
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

export function decryptSecret(encoded: string): string {
  if (!encoded) return ''
  try {
    const buf = Buffer.from(encoded, 'base64')
    const iv = buf.subarray(0, IV_LENGTH)
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
    const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    return ''
  }
}
