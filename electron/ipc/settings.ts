import type { IpcMain } from 'electron'
import Store from 'electron-store'

const store = new Store()

const DEFAULTS = {
  // Company
  company_name: 'Nature Plantation',
  company_address: '',
  company_phone: '',
  company_email: '',
  company_website: '',
  company_tin: '',
  invoice_note: 'Goods once sold will not be taken back or exchanged.',
  // Branch
  branch_id: 'b1111111-1111-4111-8111-111111111111',
  branch_name: 'Main Branch',
  // Currency & Tax
  currency: 'LKR',
  currency_symbol: 'Rs.',
  tax_label: 'VAT',
  // Receipt
  receipt_header: 'Nature Plantation',
  receipt_footer: 'Thank you for shopping with us!',
  low_stock_threshold: 5,
  // Sync
  cloud_api_url: '',
  cloud_api_key: '',
  theme: 'dark'
}

export function ensureSettingsDefaults() {
  const saved = store.get('app_settings') as Record<string, unknown> || {}
  const merged: Record<string, unknown> = { ...DEFAULTS }
  for (const [k, v] of Object.entries(saved)) {
    if (v !== '' && v !== null && v !== undefined) merged[k] = v
  }
  store.set('app_settings', merged)
}

export function registerSettingsHandlers(ipcMain: IpcMain) {
  ipcMain.handle('settings:get', () => {
    try {
      const saved = store.get('app_settings') as Record<string, unknown> || {}
      const merged = { ...DEFAULTS }
      for (const [k, v] of Object.entries(saved)) {
        if (v !== '' && v !== null && v !== undefined)
          (merged as Record<string, unknown>)[k] = v
      }
      return { success: true, data: merged }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('settings:update', (_e, payload) => {
    try {
      const current = store.get('app_settings') as Record<string, unknown> || {}
      store.set('app_settings', { ...current, ...payload })
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
}
