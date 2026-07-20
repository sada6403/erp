import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import { spawn } from 'child_process'
import { createGzip, createGunzip } from 'zlib'
import { createWriteStream, createReadStream } from 'fs'
import { mkdir, stat, rm } from 'fs/promises'
import path from 'path'
import { pool, getConfig } from './db'
import { getTenantSchema } from './tenant'

const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function storageDir(): string {
  return process.env.BACKUP_STORAGE_DIR || path.join(process.cwd(), 'tenant-backups')
}

function encryptionKey(): Buffer {
  const hex = process.env.BACKUP_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)')
  }
  return Buffer.from(hex, 'hex')
}

function backupFilePath(companyId: string, backupId: string): string {
  return path.join(storageDir(), companyId, `${backupId}.sql.gz.enc`)
}

// Override for environments where the CLI isn't on PATH (e.g. local Windows
// dev) — defaults to plain 'mysqldump'/'mysql', which already works on the
// VPS as-is.
const MYSQLDUMP_BIN = process.env.MYSQLDUMP_BIN || 'mysqldump'
const MYSQL_BIN = process.env.MYSQL_BIN || 'mysql'

function mysqlCliEnv(): NodeJS.ProcessEnv {
  const cfg = getConfig()
  return { ...process.env, MYSQL_PWD: String(cfg.password ?? '') }
}

// ─── Dump a tenant schema, gzip it, and encrypt it to disk ────────────────────
async function dumpToEncryptedFile(dbSchema: string, destPath: string): Promise<number> {
  const cfg = getConfig()
  await mkdir(path.dirname(destPath), { recursive: true })

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)

  const dump = spawn(MYSQLDUMP_BIN, [
    `-h${cfg.host}`, `-P${cfg.port}`, `-u${cfg.user}`,
    '--single-transaction', '--routines', '--triggers', '--quick',
    String(dbSchema),
  ], { env: mysqlCliEnv() })

  let stderr = ''
  dump.stderr.on('data', (chunk) => { stderr += String(chunk) })

  const gzip = createGzip()
  const out = createWriteStream(destPath)

  await new Promise<void>((resolve, reject) => {
    out.write(iv)
    dump.stdout.pipe(gzip).pipe(cipher)
    cipher.on('data', (chunk) => out.write(chunk))
    cipher.on('end', () => {
      out.write(cipher.getAuthTag())
      out.end()
    })
    out.on('finish', resolve)
    out.on('error', reject)
    dump.on('error', reject)
    dump.on('close', (code) => {
      if (code !== 0) reject(new Error(`mysqldump exited with code ${code}: ${stderr.slice(0, 500)}`))
    })
  })

  const { size } = await stat(destPath)
  return size
}

// ─── Decrypt+decompress a backup file back into a plain SQL file ──────────────
async function decryptToSqlFile(encFilePath: string, destSqlPath: string): Promise<void> {
  const { size } = await stat(encFilePath)
  const ivBuf = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    createReadStream(encFilePath, { start: 0, end: IV_LENGTH - 1 })
      .on('data', (c) => chunks.push(c as Buffer))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject)
  })
  const tagBuf = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    createReadStream(encFilePath, { start: size - AUTH_TAG_LENGTH, end: size - 1 })
      .on('data', (c) => chunks.push(c as Buffer))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject)
  })

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), ivBuf)
  decipher.setAuthTag(tagBuf)

  const cipherStream = createReadStream(encFilePath, { start: IV_LENGTH, end: size - AUTH_TAG_LENGTH - 1 })
  const gunzip = createGunzip()
  const out = createWriteStream(destSqlPath)

  await new Promise<void>((resolve, reject) => {
    cipherStream.pipe(decipher).pipe(gunzip).pipe(out)
    out.on('finish', resolve)
    out.on('error', reject)
    decipher.on('error', reject)
    gunzip.on('error', reject)
  })
}

// ─── Public: trigger a backup, fire-and-forget the actual dump work ───────────
export async function createBackup(params: {
  companyId: string
  backupType: 'manual' | 'scheduled' | 'pre-restore-safety'
  createdBy: string | null
}): Promise<string> {
  const { companyId, backupType, createdBy } = params
  const backupId = randomUUID()

  await pool.query(
    `INSERT INTO company_backups (id, company_id, backup_type, status, created_by)
     VALUES (?, ?, ?, 'pending', ?)`,
    [backupId, companyId, backupType, createdBy]
  )

  void runBackupJob(backupId, companyId).catch(() => { /* failure already recorded inside runBackupJob */ })

  return backupId
}

async function runBackupJob(backupId: string, companyId: string): Promise<void> {
  try {
    const dbSchema = await getTenantSchema(companyId)
    if (!dbSchema) throw new Error('Company not found or has no tenant database')

    const destPath = backupFilePath(companyId, backupId)
    const size = await dumpToEncryptedFile(dbSchema, destPath)

    await pool.query(
      `UPDATE company_backups SET status = 'completed', file_name = ?, file_size_bytes = ?, completed_at = NOW() WHERE id = ?`,
      [path.basename(destPath), size, backupId]
    )
  } catch (err) {
    await pool.query(
      `UPDATE company_backups SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
      [(err as Error).message.slice(0, 2000), backupId]
    )
    throw err
  }
}

// ─── Public: wait for a backup that was just created to finish (used by restore's pre-restore safety backup) ───
export async function createBackupAndWait(params: {
  companyId: string
  backupType: 'manual' | 'scheduled' | 'pre-restore-safety'
  createdBy: string | null
}): Promise<{ backupId: string; status: string }> {
  const { companyId, backupType, createdBy } = params
  const backupId = randomUUID()

  await pool.query(
    `INSERT INTO company_backups (id, company_id, backup_type, status, created_by)
     VALUES (?, ?, ?, 'pending', ?)`,
    [backupId, companyId, backupType, createdBy]
  )

  await runBackupJob(backupId, companyId).catch(() => { /* status already recorded */ })

  const { rows } = await pool.query(`SELECT status FROM company_backups WHERE id = ?`, [backupId])
  return { backupId, status: (rows[0] as Record<string, string> | undefined)?.status ?? 'failed' }
}

// ─── Public: stream a backup file's raw (still-encrypted) bytes for download ──
export function backupFilePathFor(companyId: string, fileName: string): string {
  return path.join(storageDir(), companyId, fileName)
}

// ─── Public: decrypt + restore a backup into its tenant schema ────────────────
export async function restoreBackup(params: {
  companyId: string
  backupId: string
  actorId: string
}): Promise<void> {
  const { companyId, backupId, actorId } = params

  const { rows } = await pool.query(
    `SELECT file_name, status FROM company_backups WHERE id = ? AND company_id = ?`,
    [backupId, companyId]
  )
  const backup = rows[0] as Record<string, string> | undefined
  if (!backup || backup.status !== 'completed' || !backup.file_name) {
    throw new Error('Backup not found or not completed')
  }

  const dbSchema = await getTenantSchema(companyId)
  if (!dbSchema) throw new Error('Company not found or has no tenant database')

  // Safety net: always snapshot current state before overwriting it.
  await createBackupAndWait({ companyId, backupType: 'pre-restore-safety', createdBy: actorId })

  const encPath = backupFilePathFor(companyId, backup.file_name)
  const tmpSqlPath = path.join(storageDir(), companyId, `restore-${backupId}-${Date.now()}.sql`)

  try {
    await decryptToSqlFile(encPath, tmpSqlPath)

    const cfg = getConfig()
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(MYSQL_BIN, [
        `-h${cfg.host}`, `-P${cfg.port}`, `-u${cfg.user}`, String(dbSchema),
      ], { env: mysqlCliEnv() })
      let stderr = ''
      proc.stderr.on('data', (c) => { stderr += String(c) })
      createReadStream(tmpSqlPath).pipe(proc.stdin)
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`mysql restore exited with code ${code}: ${stderr.slice(0, 500)}`))
      })
    })

    await pool.query(
      `UPDATE company_backups SET restored_at = NOW(), restored_by = ? WHERE id = ?`,
      [actorId, backupId]
    )
  } finally {
    await rm(tmpSqlPath, { force: true })
  }
}
