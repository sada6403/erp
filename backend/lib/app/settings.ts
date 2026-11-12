// app_settings key/value (synced; edited from POS Online Store / Super Admin) + module flags.
import type { AppCompany } from './context'
import { resolveEntitlements } from '../entitlements'
import { pool } from '../db'

export const SETTING_DEFAULTS: Record<string, string> = {
  ordering_enabled: '1',
  maintenance_message: '',
  min_app_version: '1.0.0',
  latest_version: '1.0.0',
  latest_version_critical: '0',
  apk_url: '',
  delivery_flat_fee: '0',
  delivery_free_over: '',
  bank_transfer_enabled: '1',
  bank_transfer_instructions: '',
  default_branch_id: '',
  download_link: '',
  estimated_delivery_days: '2',
}

export async function getSettings(company: AppCompany): Promise<Record<string, string>> {
  const { rows } = await company.tp.query(`SELECT setting_key, value FROM app_settings`)
  const out = { ...SETTING_DEFAULTS }
  for (const r of rows as Array<{ setting_key: string; value: string | null }>) out[r.setting_key] = r.value ?? ''
  return out
}

export async function setSetting(company: AppCompany, key: string, value: string): Promise<void> {
  await company.tp.query(
    `INSERT INTO app_settings (id, setting_key, value) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [key, key, value]
  )
}

export async function getModules(company: AppCompany): Promise<{ smartbuy: boolean; installments: boolean }> {
  try {
    const e = await resolveEntitlements({ companyId: company.id })
    // Supermarket / Food City companies do not sell on Smart Buy or installments (POS v2.8 business types).
    const { rows } = await pool.query(`SELECT business_type FROM companies WHERE id = ? LIMIT 1`, [company.id])
    const grocery = /^(supermarket|food[\s_-]?city)$/i.test(String((rows[0] as { business_type?: string } | undefined)?.business_type ?? ''))
    return {
      smartbuy: !grocery && e.enabledModules.includes('smartbuy'),
      installments: !grocery && e.enabledModules.includes('installments'),
    }
  } catch {
    return { smartbuy: true, installments: true }
  }
}

export function flag(v: string | undefined): boolean {
  return v === '1' || v === 'true'
}
