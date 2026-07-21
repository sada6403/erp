import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import { mkdir, stat } from 'fs/promises'
import path from 'path'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { pool, getConfig } from './db'
import { getTenantSchema, withTenant } from './tenant'

const ROW_LIMIT = 50000

// Same override as backup.ts — environments where mysqldump isn't on PATH
// (e.g. local Windows dev) can point this at the full binary path.
const MYSQLDUMP_BIN = process.env.MYSQLDUMP_BIN || 'mysqldump'

export type Entity =
  | 'products' | 'customers' | 'suppliers' | 'users' | 'invoices' | 'purchase_orders' | 'expenses'
  | 'audit_logs' | 'license_info' | 'full_database'
export type Format = 'csv' | 'json' | 'xlsx' | 'pdf' | 'sql'

export const ENTITY_LABELS: Record<Entity, string> = {
  products: 'Products', customers: 'Customers', suppliers: 'Suppliers', users: 'Employees',
  invoices: 'Sales (Invoices)', purchase_orders: 'Purchases (Purchase Orders)', expenses: 'Expenses',
  audit_logs: 'Audit Logs', license_info: 'License Information', full_database: 'Full Database',
}

export const ALL_ENTITIES = Object.keys(ENTITY_LABELS) as Entity[]
export const ALL_FORMATS: Format[] = ['csv', 'json', 'xlsx', 'pdf', 'sql']

// Which (entity, format) combinations are actually offered — mirrors the
// scope decision in the plan: PDF only for license_info, SQL only for
// full_database, tabular entities get csv/json/xlsx.
export function isValidCombination(entity: Entity, format: Format): boolean {
  if (entity === 'full_database') return format === 'sql'
  if (format === 'sql') return false
  if (entity === 'license_info') return format === 'pdf'
  if (format === 'pdf') return false
  return true
}

function storageDir(): string {
  return process.env.EXPORT_STORAGE_DIR || path.join(process.cwd(), 'tenant-exports')
}

function exportFilePath(companyId: string, exportId: string, format: Format): string {
  const ext = format === 'xlsx' ? 'xlsx' : format
  return path.join(storageDir(), companyId, `${exportId}.${ext}`)
}

function mysqlCliEnv(): NodeJS.ProcessEnv {
  const cfg = getConfig()
  return { ...process.env, MYSQL_PWD: String(cfg.password ?? '') }
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = value instanceof Date ? value.toISOString() : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

async function writeCsv(rows: Record<string, unknown>[], destPath: string): Promise<void> {
  const headers = rows.length ? Object.keys(rows[0]) : []
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map(h => csvEscape(row[h])).join(','))
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(destPath)
    out.on('finish', resolve)
    out.on('error', reject)
    out.write(lines.join('\n'))
    out.end()
  })
}

async function writeJson(rows: Record<string, unknown>[], destPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(destPath)
    out.on('finish', resolve)
    out.on('error', reject)
    out.write(JSON.stringify(rows, null, 2))
    out.end()
  })
}

async function writeXlsx(rows: Record<string, unknown>[], destPath: string, sheetName: string): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31))
  const headers = rows.length ? Object.keys(rows[0]) : []
  sheet.columns = headers.map(h => ({ header: h, key: h, width: Math.min(40, Math.max(12, h.length + 4)) }))
  for (const row of rows) sheet.addRow(row)
  await workbook.xlsx.writeFile(destPath)
}

async function writePdfLicenseSummary(company: Record<string, unknown>, destPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 })
    const out = createWriteStream(destPath)
    doc.pipe(out)
    out.on('finish', resolve)
    out.on('error', reject)
    doc.on('error', reject)

    doc.fontSize(20).text('License Information', { underline: true })
    doc.moveDown()
    doc.fontSize(14).text(String(company.name ?? ''))
    doc.moveDown()

    const line = (label: string, value: unknown) => {
      doc.fontSize(11).fillColor('#555555').text(label, { continued: true })
      doc.fillColor('#000000').text(`  ${value ?? '—'}`)
    }

    line('Status', company.status)
    line('Package', company.package_name)
    line('Billing Cycle', company.billing_cycle)
    line('Subscription Ends', company.sub_ends_at ? new Date(company.sub_ends_at as string).toLocaleDateString() : '—')
    doc.moveDown(0.5)
    line('Max Branches', company.max_branches)
    line('Max Users', company.max_users)
    line('Max POS Devices', company.max_pos_devices)
    line('Max Storage (GB)', company.max_storage_gb)
    line('Active Devices', company.device_count)
    doc.moveDown(0.5)
    line('Company Email', company.email)
    line('Company Phone', company.phone)
    line('Company Address', company.address)
    doc.moveDown(1)
    doc.fontSize(9).fillColor('#888888').text(`Generated ${new Date().toISOString()}`)

    doc.end()
  })
}

async function dumpFullDatabaseSql(dbSchema: string, destPath: string): Promise<void> {
  const cfg = getConfig()
  await mkdir(path.dirname(destPath), { recursive: true })

  const dump = spawn(MYSQLDUMP_BIN, [
    `-h${cfg.host}`, `-P${cfg.port}`, `-u${cfg.user}`,
    '--single-transaction', '--routines', '--triggers', '--quick',
    String(dbSchema),
  ], { env: mysqlCliEnv() })

  let stderr = ''
  dump.stderr.on('data', (chunk) => { stderr += String(chunk) })

  const out = createWriteStream(destPath)
  await new Promise<void>((resolve, reject) => {
    dump.stdout.pipe(out)
    out.on('finish', resolve)
    out.on('error', reject)
    dump.on('error', reject)
    dump.on('close', (code) => {
      if (code !== 0) reject(new Error(`mysqldump exited with code ${code}: ${stderr.slice(0, 500)}`))
    })
  })
}

async function fetchTenantRows(companyId: string, table: string): Promise<Record<string, unknown>[]> {
  return withTenant(companyId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM ${table} ORDER BY created_at DESC LIMIT ${ROW_LIMIT}`
    )
    return rows
  })
}

async function fetchAuditLogRows(companyId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT created_at, portal, actor_type, actor_name, action, resource, resource_id, old_values, new_values
     FROM saas_audit_logs WHERE company_id = ? ORDER BY created_at DESC LIMIT ${ROW_LIMIT}`,
    [companyId]
  )
  return rows as Record<string, unknown>[]
}

async function fetchLicenseInfo(companyId: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query(
    `SELECT c.*, s.package_id, p.name as package_name, s.billing_cycle,
            s.status as sub_status, s.ends_at as sub_ends_at
     FROM companies c
     LEFT JOIN company_subscriptions s ON s.company_id = c.id AND s.status IN ('active','trial')
     LEFT JOIN packages p ON p.id = s.package_id
     WHERE c.id = ?`,
    [companyId]
  )
  const company = (rows[0] as Record<string, unknown>) ?? {}
  const { rows: deviceRows } = await pool.query(
    `SELECT COUNT(*) as cnt FROM pos_devices WHERE company_id = ? AND status = 'active'`,
    [companyId]
  )
  company.device_count = Number((deviceRows[0] as Record<string, number>)?.cnt ?? 0)
  return company
}

export async function createExport(params: {
  companyId: string; entity: Entity; format: Format; createdBy: string
}): Promise<string> {
  const { companyId, entity, format, createdBy } = params
  const exportId = randomUUID()

  await pool.query(
    `INSERT INTO company_exports (id, company_id, entity, format, status, created_by)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [exportId, companyId, entity, format, createdBy]
  )

  void runExportJob(exportId, companyId, entity, format).catch(() => { /* failure already recorded inside */ })

  return exportId
}

async function runExportJob(exportId: string, companyId: string, entity: Entity, format: Format): Promise<void> {
  try {
    const destPath = exportFilePath(companyId, exportId, format)
    await mkdir(path.dirname(destPath), { recursive: true })
    let rowCount: number | null = null

    if (entity === 'full_database') {
      const dbSchema = await getTenantSchema(companyId)
      if (!dbSchema) throw new Error('Company not found or has no tenant database')
      await dumpFullDatabaseSql(dbSchema, destPath)
    } else if (entity === 'license_info') {
      const info = await fetchLicenseInfo(companyId)
      await writePdfLicenseSummary(info, destPath)
    } else {
      const rows = entity === 'audit_logs'
        ? await fetchAuditLogRows(companyId)
        : await fetchTenantRows(companyId, entity)
      rowCount = rows.length
      if (format === 'csv') await writeCsv(rows, destPath)
      else if (format === 'json') await writeJson(rows, destPath)
      else if (format === 'xlsx') await writeXlsx(rows, destPath, ENTITY_LABELS[entity])
      else throw new Error(`Unsupported format ${format} for entity ${entity}`)
    }

    const { size } = await stat(destPath)
    await pool.query(
      `UPDATE company_exports SET status = 'completed', file_name = ?, file_size_bytes = ?, row_count = ?, completed_at = NOW() WHERE id = ?`,
      [path.basename(destPath), size, rowCount, exportId]
    )
  } catch (err) {
    await pool.query(
      `UPDATE company_exports SET status = 'failed', error_message = ?, completed_at = NOW() WHERE id = ?`,
      [(err as Error).message.slice(0, 2000), exportId]
    )
    throw err
  }
}

export function exportFilePathFor(companyId: string, fileName: string): string {
  return path.join(storageDir(), companyId, fileName)
}

export function contentTypeFor(format: Format): string {
  switch (format) {
    case 'csv': return 'text/csv'
    case 'json': return 'application/json'
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'pdf': return 'application/pdf'
    case 'sql': return 'application/sql'
  }
}
