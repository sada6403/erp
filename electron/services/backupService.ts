import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import crypto from 'crypto'
import { safeStorage } from 'electron'
import Store from 'electron-store'
import { getDb } from '../database'
import { uploadFile, deleteFile, type S3Config } from './s3Service'

const store = new Store()
const FALLBACK_KEY = crypto.createHash('sha256').update('pos-erp-local-settings-key').digest()

export interface BackupInfo {
  filename: string
  filepath: string
  size: number
  sizeFormatted: string
  createdAt: string
  s3Url?: string
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function getBackupDir(): string {
  const dir = path.join(app.getPath('userData'), 'backups')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function decryptSecret(value: unknown): string {
  if (!value || typeof value !== 'string') return ''
  try {
    if (value.startsWith('safe:')) {
      const buf = Buffer.from(value.slice(5), 'base64')
      return safeStorage.decryptString(buf)
    }
    if (value.startsWith('aes:')) {
      const buf = Buffer.from(value.slice(4), 'base64')
      const iv  = buf.slice(0, 12)
      const tag = buf.slice(12, 28)
      const enc = buf.slice(28)
      const dec = crypto.createDecipheriv('aes-256-gcm', FALLBACK_KEY, iv)
      dec.setAuthTag(tag)
      return dec.update(enc) + dec.final('utf8')
    }
  } catch { /* corrupted */ }
  return String(value)
}

function getS3Config(): S3Config | null {
  const s3Enabled = store.get('s3_enabled', false)
  if (!s3Enabled) return null

  const bucket    = String(store.get('s3_bucket',     '') || '')
  const region    = String(store.get('s3_region',     'us-east-1'))
  const accessKey = String(store.get('s3_access_key', '') || '')
  const secretKey = decryptSecret(store.get('s3_secret_key', ''))
  const endpoint  = String(store.get('s3_endpoint',   '') || '') || undefined
  const cdnUrl    = String(store.get('s3_cdn_url',    '') || '') || undefined

  if (!bucket || !accessKey || !secretKey) return null

  return { bucket, region, accessKey, secretKey, endpoint, cdnUrl }
}

const S3_BACKUP_KEYS_STORE_KEY = 's3_backup_keys'
const S3_BACKUP_KEEP = 10

async function uploadBackupToS3(
  localPath: string,
  filename: string,
  config: S3Config
): Promise<{ uploaded: boolean; s3Url?: string; error?: string }> {
  const key = `backups/${filename}`
  const result = await uploadFile(localPath, key, config, 'application/octet-stream')
  if (result.success) {
    console.log(`[Backup] S3 upload OK → ${result.url}`)
    await cleanupOldS3Backups(key, config)
    return { uploaded: true, s3Url: result.url }
  }
  console.error(`[Backup] S3 upload failed: ${result.error}`)
  return { uploaded: false, error: result.error }
}

async function cleanupOldS3Backups(newKey: string, config: S3Config): Promise<void> {
  try {
    const tracked = (store.get(S3_BACKUP_KEYS_STORE_KEY, []) as string[]).slice()
    tracked.push(newKey)

    if (tracked.length > S3_BACKUP_KEEP) {
      const toDelete = tracked.splice(0, tracked.length - S3_BACKUP_KEEP)
      for (const oldKey of toDelete) {
        const res = await deleteFile(oldKey, config)
        if (res.success) {
          console.log(`[Backup] S3 old backup deleted: ${oldKey}`)
        } else {
          console.warn(`[Backup] S3 delete failed for ${oldKey}: ${res.error}`)
        }
      }
    }

    store.set(S3_BACKUP_KEYS_STORE_KEY, tracked)
  } catch (err) {
    console.error('[Backup] S3 cleanup error:', err)
  }
}

export async function runBackup(): Promise<{
  success: boolean
  path?: string
  filename?: string
  size?: number
  s3Url?: string
  s3Error?: string
  error?: string
}> {
  try {
    const db = getDb()
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `pos-erp-backup-${ts}.db`
    const destPath = path.join(getBackupDir(), filename)

    // 1. Create local backup
    await db.backup(destPath)
    const size = fs.statSync(destPath).size
    cleanupOldBackups(10)
    console.log(`[Backup] Local backup created: ${filename} (${fmtSize(size)})`)

    // 2. Upload to S3 if enabled (non-blocking for the result, but we await it)
    let s3Url: string | undefined
    let s3Error: string | undefined

    const s3Config = getS3Config()
    if (s3Config) {
      const s3Result = await uploadBackupToS3(destPath, filename, s3Config)
      if (s3Result.uploaded) {
        s3Url = s3Result.s3Url
      } else {
        s3Error = s3Result.error
      }
    }

    return { success: true, path: destPath, filename, size, s3Url, s3Error }
  } catch (err) {
    const msg = String(err)
    console.error('[Backup] Error:', msg)
    return { success: false, error: msg }
  }
}

export function listBackups(): BackupInfo[] {
  const dir = getBackupDir()
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const fp = path.join(dir, f)
        const stat = fs.statSync(fp)
        return {
          filename: f,
          filepath: fp,
          size: stat.size,
          sizeFormatted: fmtSize(stat.size),
          createdAt: stat.birthtime.toISOString(),
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

function cleanupOldBackups(keep: number): void {
  const list = listBackups()
  if (list.length > keep) {
    list.slice(keep).forEach(b => {
      try { fs.unlinkSync(b.filepath) } catch {}
    })
  }
}

let backupTimer: NodeJS.Timeout | null = null

export function startAutoBackup(intervalHours = 24): void {
  if (backupTimer) clearInterval(backupTimer)
  // Initial backup 3 min after startup
  setTimeout(() => {
    runBackup().catch(e => console.error('[Backup] Auto backup failed:', e))
  }, 3 * 60 * 1000)
  // Then every N hours
  backupTimer = setInterval(() => {
    runBackup().catch(e => console.error('[Backup] Auto backup failed:', e))
  }, intervalHours * 60 * 60 * 1000)
}

export function stopAutoBackup(): void {
  if (backupTimer) { clearInterval(backupTimer); backupTimer = null }
}
