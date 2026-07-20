const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

let _access = ''
let _refresh = ''

export function setTokens(access: string, refresh: string) {
  _access  = access
  _refresh = refresh
  localStorage.setItem('sa_access',  access)
  localStorage.setItem('sa_refresh', refresh)
}

export function loadTokens() {
  _access  = localStorage.getItem('sa_access')  ?? ''
  _refresh = localStorage.getItem('sa_refresh') ?? ''
}

export function clearTokens() {
  _access  = ''
  _refresh = ''
  localStorage.removeItem('sa_access')
  localStorage.removeItem('sa_refresh')
}

async function refreshTokens(): Promise<boolean> {
  if (!_refresh) return false
  const res = await fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: _refresh }),
  })
  if (!res.ok) { clearTokens(); return false }
  const d = await res.json()
  setTokens(d.accessToken, d.refreshToken)
  return true
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const go = async (retry = true): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${_access}`,
        ...(opts.headers as Record<string,string> ?? {}),
      },
    })
    if (res.status === 401 && retry) {
      const ok = await refreshTokens()
      if (ok) return go(false)
      throw new Error('SESSION_EXPIRED')
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error ?? 'Request failed')
    }
    return res.json()
  }
  return go()
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const auth = {
  login:  (email: string, password: string) =>
    fetch(`${BASE}/api/auth/superadmin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then(async r => { if (!r.ok) throw new Error((await r.json()).error); return r.json() }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
}

// ─── Companies ────────────────────────────────────────────────────────────────
export const companies = {
  list:   (p?: Record<string,string>) => request<{rows: unknown[];total:number}>('/api/superadmin/companies?' + new URLSearchParams(p).toString()),
  get:    (id: string)   => request<unknown>(`/api/superadmin/companies/${id}`),
  create: (body: unknown) => request<unknown>('/api/superadmin/companies', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: unknown) => request<unknown>(`/api/superadmin/companies/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  cancel:             (id: string) => request<unknown>(`/api/superadmin/companies/${id}`, { method: 'DELETE', body: JSON.stringify({}) }),
  hardDelete:         (id: string) => request<unknown>(`/api/superadmin/companies/${id}`, { method: 'DELETE', body: JSON.stringify({ permanent: true }) }),
  resetAdminPassword: (id: string) => request<{ tempPassword: string; adminEmail: string; adminName: string }>(`/api/superadmin/companies/${id}/reset-admin-password`, { method: 'POST' }),
}

// ─── Packages ─────────────────────────────────────────────────────────────────
export const packages = {
  list:       () => request<unknown[]>('/api/superadmin/packages'),
  create:     (body: unknown) => request<unknown>('/api/superadmin/packages', { method: 'POST', body: JSON.stringify(body) }),
  update:     (id: string, body: unknown) => request<unknown>(`/api/superadmin/packages/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deactivate: (id: string) => request<unknown>(`/api/superadmin/packages/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: false }) }),
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export const settings = {
  get:    () => request<Record<string,unknown>>('/api/superadmin/settings'),
  update: (body: unknown) => request<{ok:boolean}>('/api/superadmin/settings', { method: 'PATCH', body: JSON.stringify(body) }),
}

// ─── Company Devices ──────────────────────────────────────────────────────────
export const devices = {
  list:       (companyId: string) => request<unknown[]>(`/api/superadmin/companies/${companyId}/devices`),
  create:     (companyId: string, body: unknown) =>
    request<{ id: string; device_name: string; license_key: string; status: string }>(
      `/api/superadmin/companies/${companyId}/devices`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  deactivate: (companyId: string, deviceRowId: string, notes?: string) =>
    request<{ ok: boolean }>(`/api/superadmin/companies/${companyId}/devices`, {
      method: 'PATCH', body: JSON.stringify({ device_id: deviceRowId, action: 'deactivate', notes }),
    }),
  reset:      (companyId: string, deviceRowId: string) =>
    request<{ ok: boolean }>(`/api/superadmin/companies/${companyId}/devices`, {
      method: 'PATCH', body: JSON.stringify({ device_id: deviceRowId, action: 'reset' }),
    }),
}

// ─── Company Backups ──────────────────────────────────────────────────────────
export type BackupRow = {
  id: string; backup_type: string; status: string
  file_name: string | null; file_size_bytes: number | null; error_message: string | null
  created_by: string | null; download_count: number; last_downloaded_at: string | null
  restored_at: string | null; restored_by: string | null
  created_at: string; completed_at: string | null
}
export type BackupSchedule = { enabled: boolean; frequency: 'daily' | 'weekly'; last_run_at: string | null }

export const backups = {
  list:   (companyId: string) => request<BackupRow[]>(`/api/superadmin/companies/${companyId}/backups`),
  create: (companyId: string) =>
    request<{ ok: boolean; backupId: string }>(`/api/superadmin/companies/${companyId}/backups`, { method: 'POST' }),
  restore: (companyId: string, backupId: string, confirmCompanyName: string) =>
    request<{ ok: boolean }>(`/api/superadmin/companies/${companyId}/backups/${backupId}/restore`, {
      method: 'POST', body: JSON.stringify({ confirmCompanyName }),
    }),
  getSchedule: (companyId: string) => request<BackupSchedule>(`/api/superadmin/companies/${companyId}/backup-schedule`),
  setSchedule: (companyId: string, enabled: boolean, frequency: 'daily' | 'weekly') =>
    request<{ ok: boolean }>(`/api/superadmin/companies/${companyId}/backup-schedule`, {
      method: 'PATCH', body: JSON.stringify({ enabled, frequency }),
    }),
  // Bypasses request() — that helper always does res.json(), but a download is a binary Blob.
  download: async (companyId: string, backupId: string, fileName: string) => {
    const res = await fetch(`${BASE}/api/superadmin/companies/${companyId}/backups/${backupId}/download`, {
      headers: { Authorization: `Bearer ${_access}` },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error ?? 'Download failed')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}

// ─── Company Modules ──────────────────────────────────────────────────────────
export const modules = {
  list:   (companyId: string) => request<unknown[]>(`/api/superadmin/companies/${companyId}/modules`),
  toggle: (companyId: string, module_key: string, is_enabled: boolean) =>
    request<{ ok: boolean; module_key: string; is_enabled: boolean }>(
      `/api/superadmin/companies/${companyId}/modules`,
      { method: 'PATCH', body: JSON.stringify({ module_key, is_enabled }) }
    ),
}

// â”€â”€â”€ Company Features â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const features = {
  catalog: () => request<unknown[]>('/api/superadmin/features'),
  list:    (companyId: string) => request<unknown[]>(`/api/superadmin/companies/${companyId}/features`),
  toggle:   (companyId: string, feature_key: string, is_enabled: boolean) =>
    request<{ ok: boolean; feature_key: string; is_enabled: boolean }>(
      `/api/superadmin/companies/${companyId}/features`,
      { method: 'PATCH', body: JSON.stringify({ feature_key, is_enabled }) }
    ),
}

// â”€â”€â”€ Company Limits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const companyLimits = {
  get:   (companyId: string) => request<Record<string, unknown>>(`/api/superadmin/companies/${companyId}/limits`),
  update:(companyId: string, body: unknown) =>
    request<{ ok: boolean }>(`/api/superadmin/companies/${companyId}/limits`, { method: 'PATCH', body: JSON.stringify(body) }),
}

// ─── Email ────────────────────────────────────────────────────────────────────
export const email = {
  test:         (to: string) => request<{ ok: boolean }>('/api/superadmin/email-test', { method: 'POST', body: JSON.stringify({ to }) }),
  runTrialCron: () => request<{ processed: number; results: unknown[] }>('/api/superadmin/cron/trial-expiry', { method: 'POST' }),
}

// ─── Impersonate ──────────────────────────────────────────────────────────────
export const impersonate = {
  start: (company_id: string, reason?: string) =>
    request<{ accessToken: string; refreshToken: string; company: { id: string; name: string; slug: string } }>(
      '/api/superadmin/impersonate',
      { method: 'POST', body: JSON.stringify({ company_id, reason }) }
    ),
}

// ─── SuperAdmin Self (profile + password) ────────────────────────────────────
export const me = {
  get: () => request<{ id: string; name: string; email: string; last_login_at: string }>('/api/superadmin/me'),
  updateProfile: (body: { name?: string; email?: string }) =>
    request<{ ok: boolean }>('/api/superadmin/me', { method: 'PATCH', body: JSON.stringify(body) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/superadmin/me', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) }),
}

// ─── Danger Zone ─────────────────────────────────────────────────────────────
export const danger = {
  purgeCancelledCompanies: () =>
    request<{ ok: boolean; purged: number; errors: string[] }>('/api/superadmin/danger', {
      method: 'POST', body: JSON.stringify({ action: 'purgeCancelledCompanies' }),
    }),
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
export const stats = {
  get: () => request<{
    companies: { total:number; active:number; trial:number; suspended:number; cancelled:number; newThisMonth:number }
    revenue:   { mrr: number }
    devices:   { total:number; active:number }
    sync:      { last24h:number; success:number; failed:number }
    recentCompanies: unknown[]
    expiringTrials:  unknown[]
  }>('/api/superadmin/stats'),
}

// ─── Database Info ───────────────────────────────────────────────────────────
export const dbInfo = {
  get: () => request<{
    connection: { host: string; database: string; type: string; status: string; ping_ms: number | null }
    stats: { total_companies: number; active: number; trial: number; suspended: number; cancelled: number }
    tenants: { id: string; name: string; slug: string; status: string; db_schema: string; size_mb: number | null }[]
    error?: string
  }>('/api/superadmin/db-info'),
}

// ─── Audit logs ───────────────────────────────────────────────────────────────
export const audit = {
  list: (p?: Record<string,string>) => request<{rows:unknown[];total:number;page:number;limit:number}>('/api/superadmin/audit?' + new URLSearchParams(p).toString()),
}
