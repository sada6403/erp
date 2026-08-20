import { randomUUID } from 'crypto'
import { BrowserWindow, app } from 'electron'
import type { WebContentsPrintOptions } from 'electron'
import Store from 'electron-store'
import path from 'path'
import fs from 'fs'
import { getDb } from '../database'
import { getOrCreateDeviceId } from '../ipc/activation'

const store = new Store()

export type AssignedModule = 'receipt' | 'invoice' | 'label' | 'kitchen'
export type ConnectionType = 'windows_driver' | 'network_escpos'

export interface PrinterConfigRow {
  id: string
  branch_id: string
  device_id: string
  printer_name: string
  printer_type: string
  connection_type: ConnectionType
  ip_address: string | null
  port: number | null
  paper_size: string | null
  assigned_module: AssignedModule
  copies: number
  is_active: number
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── Identity helpers — thin wrappers over primitives that already exist elsewhere ───

export function getCurrentDeviceId(): string {
  return getOrCreateDeviceId()
}

export function getCurrentBranchId(): string | null {
  const user = store.get('auth_user') as Record<string, unknown> | undefined
  return (user?.branch_id as string) || null
}

// ─── Detection — replaces the printer:listDevices stub ────────────────────

export async function listSystemPrinters(): Promise<Electron.PrinterInfo[]> {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  if (!win) return []
  return win.webContents.getPrintersAsync()
}

// ─── CRUD ──────────────────────────────────────────────────────────────────

export function listPrinterConfigs(branchId: string): PrinterConfigRow[] {
  const db = getDb()
  return db.prepare(`
    SELECT * FROM printers WHERE branch_id = ? ORDER BY assigned_module, device_id
  `).all(branchId) as PrinterConfigRow[]
}

export function upsertPrinterConfig(input: {
  id?: string
  branchId: string
  deviceId?: string
  printerName: string
  printerType: string
  connectionType: ConnectionType
  ipAddress?: string | null
  port?: number | null
  paperSize?: string | null
  assignedModule: AssignedModule
  copies?: number
  createdBy?: string | null
}): PrinterConfigRow {
  const db = getDb()
  const id = input.id || randomUUID()
  const deviceId = input.deviceId || ''
  const copies = Math.max(1, Math.trunc(Number(input.copies) || 1))

  db.prepare(`
    INSERT INTO printers (
      id, branch_id, device_id, printer_name, printer_type, connection_type,
      ip_address, port, paper_size, assigned_module, copies, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(branch_id, device_id, assigned_module) DO UPDATE SET
      printer_name    = excluded.printer_name,
      printer_type    = excluded.printer_type,
      connection_type = excluded.connection_type,
      ip_address      = excluded.ip_address,
      port            = excluded.port,
      paper_size      = excluded.paper_size,
      copies          = excluded.copies,
      is_active       = 1,
      updated_at      = datetime('now')
  `).run(
    id, input.branchId, deviceId, input.printerName, input.printerType, input.connectionType,
    input.ipAddress ?? null, input.port ?? null, input.paperSize ?? null, input.assignedModule,
    copies, input.createdBy ?? null
  )

  const row = db.prepare(`
    SELECT * FROM printers WHERE branch_id = ? AND device_id = ? AND assigned_module = ?
  `).get(input.branchId, deviceId, input.assignedModule) as PrinterConfigRow
  return row
}

export function deletePrinterConfig(id: string): void {
  getDb().prepare(`DELETE FROM printers WHERE id = ?`).run(id)
}

export function getPrinterConfigById(id: string): PrinterConfigRow | null {
  return (getDb().prepare(`SELECT * FROM printers WHERE id = ?`).get(id) as PrinterConfigRow | undefined) || null
}

// ─── Resolution: device-specific override → branch-level default → null ──────

export function resolvePrinterForModule(
  module: AssignedModule,
  opts: { branchId: string; deviceId: string }
): PrinterConfigRow | null {
  const db = getDb()
  const deviceRow = db.prepare(`
    SELECT * FROM printers
    WHERE branch_id = ? AND device_id = ? AND assigned_module = ? AND is_active = 1
  `).get(opts.branchId, opts.deviceId, module) as PrinterConfigRow | undefined
  if (deviceRow) return deviceRow

  const branchDefault = db.prepare(`
    SELECT * FROM printers
    WHERE branch_id = ? AND device_id = '' AND assigned_module = ? AND is_active = 1
  `).get(opts.branchId, module) as PrinterConfigRow | undefined
  return branchDefault || null
}

// ─── Execution — relocated from ipc/printer.ts. `opts` is additive: every
// existing 3-arg call site behaves byte-identically (silent defaults to
// false, no deviceName means "OS default printer", copies defaults to 1). ───

export type PrintDesign = 'dot' | 'thermal' | 'a4' | 'b5' | 'label'

export async function printHtml(
  html: string,
  design: PrintDesign = 'thermal',
  paperType = '80mm',
  opts: { deviceName?: string; silent?: boolean; copies?: number } = {}
): Promise<void> {
  const tmpPath = path.join(app.getPath('temp'), `invoice-${Date.now()}.html`)
  fs.writeFileSync(tmpPath, html, 'utf-8')
  const windowSize = design === 'thermal'
    ? { width: paperType === '58mm' ? 320 : 420, height: 900 }
    : design === 'dot'
      ? { width: 1000, height: 720 }
      : { width: 860, height: 1200 }

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: windowSize.width, height: windowSize.height,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    })

    win.loadFile(tmpPath)

    win.webContents.on('did-finish-load', () => {
      win.webContents.print(printOptionsForDesign(design, paperType, opts), (success, errorType) => {
        win.close()
        try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
        if (success) resolve()
        else reject(new Error(errorType || 'Print cancelled'))
      })
    })

    win.on('closed', () => {
      try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
      resolve()
    })
  })
}

function printOptionsForDesign(
  design: PrintDesign,
  paperType = '80mm',
  opts: { deviceName?: string; silent?: boolean; copies?: number } = {}
): WebContentsPrintOptions {
  const base = {
    silent: opts.silent ?? false,
    printBackground: true,
    landscape: false,
    scaleFactor: 100,
    copies: opts.copies ?? 1,
    ...(opts.deviceName ? { deviceName: opts.deviceName } : {}),
  }

  if (design === 'thermal') {
    return {
      ...base,
      margins: { marginType: 'none' },
      pageSize: { width: paperType === '58mm' ? 58000 : 80000, height: 297000 },
    }
  }
  if (design === 'dot') {
    return {
      ...base,
      margins: { marginType: 'none' },
      pageSize: { width: 241000, height: 279000 },
    }
  }
  if (design === 'label') {
    return {
      ...base,
      margins: { marginType: 'none' },
      pageSize: LABEL_SIZES[paperType] ?? LABEL_SIZES.default,
    }
  }
  if (paperType === 'B5') {
    return {
      ...base,
      margins: { marginType: 'none' },
      // Electron's named pageSize enum has no 'B5' entry — use the ISO B5
      // dimensions (176mm x 250mm) in microns instead.
      pageSize: { width: 176000, height: 250000 },
    }
  }
  return {
    ...base,
    margins: { marginType: 'none' },
    pageSize: paperType === 'A5' ? 'A5' : 'A4',
  }
}

// Common thermal label roll sizes, in microns (width x height).
const LABEL_SIZES: Record<string, { width: number; height: number }> = {
  default:  { width: 50000, height: 30000 },
  '40x30':  { width: 40000, height: 30000 },
  '50x30':  { width: 50000, height: 30000 },
  '58mm':   { width: 58000, height: 40000 },
}

// ─── Convenience wrapper: resolve the assignment, then print through it.
// Falls back to today's unconfigured dialog-print behavior when nothing is
// assigned for this branch/device/module — so an un-configured install
// behaves byte-identically to before this service existed. ──────────────────

export async function printHtmlForModule(
  html: string,
  module: AssignedModule,
  opts: { design: PrintDesign; paperType: string; branchId: string; deviceId: string }
): Promise<void> {
  const row = resolvePrinterForModule(module, { branchId: opts.branchId, deviceId: opts.deviceId })
  if (row && row.connection_type === 'windows_driver' && row.printer_name) {
    return printHtml(html, opts.design, opts.paperType, {
      deviceName: row.printer_name, silent: true, copies: row.copies,
    })
  }
  return printHtml(html, opts.design, opts.paperType)
}

// ─── ESC/POS target resolution only — never touches buildEscPos/sendRawToPrinter.
// 'receipt'/'kitchen' are the only two purposes that make sense over raw
// ESC/POS; legacyFallback preserves today's flat-settings thermal_printer_ip
// behavior for 'receipt' when nothing has been assigned in the new table. ──

export function resolveEscPosTarget(
  module: 'receipt' | 'kitchen',
  opts: { branchId: string; deviceId: string },
  legacyFallback?: { host: string; port: number }
): { host: string; port: number; copies: number } | null {
  const row = resolvePrinterForModule(module, opts)
  if (row && row.connection_type === 'network_escpos' && row.ip_address) {
    return { host: row.ip_address, port: row.port ?? 9100, copies: row.copies }
  }
  if (legacyFallback?.host) return { ...legacyFallback, copies: 1 }
  return null
}
