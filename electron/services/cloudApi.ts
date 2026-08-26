import fs from 'fs'

export interface CloudConfig {
  baseUrl: string
  apiKey: string
  // Phase 1 device-authorization work — sent as x-device-id on every
  // request so the backend can enforce per-device revocation (see
  // resolveDeviceAuthorization in backend/lib/auth.ts) on top of the
  // existing company-wide x-api-key check. Optional so older call sites
  // that construct a CloudApi without a device id (there are none left
  // after this change, but the type stays permissive) don't break.
  deviceId?: string | null
}

export class CloudRateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterSeconds: number = 60
  ) {
    super(message)
    this.name = 'CloudRateLimitError'
  }
}

// Thrown when the backend reports this specific device as deactivated
// (DEVICE_REVOKED) — distinct from CloudRateLimitError so callers (mainly
// SyncService) can react by locking the device instead of just retrying.
export class DeviceRevokedError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = 'DeviceRevokedError'
  }
}

export class CloudApi {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly deviceId: string | null

  constructor(config: CloudConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.apiKey = config.apiKey
    this.deviceId = config.deviceId ?? null
  }

  async health(): Promise<{ status: string; database: string }> {
    return this.request('/api/health')
  }

  async push(input: {
    table: string
    operation: string
    recordId: string
    record: Record<string, unknown>
  }): Promise<void> {
    await this.request('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  // The server caps each response at PAGE_SIZE rows (see backend/app/api/sync/changes/route.ts)
  // with no cursor of its own. A single one-shot call would silently truncate any table with
  // more changed rows than that since the last pull — most likely on a fresh install's first
  // sync, or a device that's been offline a long time. Page through by re-querying with the
  // last row's own `updated_at` as the next `since`, until a page comes back under the cap.
  private static readonly CHANGES_PAGE_SIZE = 5000
  private static readonly CHANGES_MAX_PAGES = 200

  async changes(table: string, since: string): Promise<Record<string, unknown>[]> {
    const all: Record<string, unknown>[] = []
    let cursor = since
    for (let page = 0; page < CloudApi.CHANGES_MAX_PAGES; page++) {
      const query = new URLSearchParams({ table, since: cursor })
      const result = await this.request<{ data: Record<string, unknown>[] }>(
        `/api/sync/changes?${query.toString()}`
      )
      const data = result.data
      all.push(...data)
      if (data.length < CloudApi.CHANGES_PAGE_SIZE) break
      const lastUpdatedAt = data[data.length - 1]?.updated_at
      if (!lastUpdatedAt || typeof lastUpdatedAt !== 'string') break
      cursor = lastUpdatedAt
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    return all
  }

  // Deletion tombstones (see backend/app/api/sync/deletions/route.ts) — the
  // `changes` endpoint can only ever report rows that still exist, so a
  // device that already pulled a since-deleted row (e.g. a deleted branch)
  // would keep it forever without this. Same paging shape as `changes`,
  // keyed on `deleted_at` instead of `updated_at`.
  async deletions(since: string): Promise<Array<{ table_name: string; record_id: string; deleted_at: string }>> {
    const all: Array<{ table_name: string; record_id: string; deleted_at: string }> = []
    let cursor = since
    for (let page = 0; page < CloudApi.CHANGES_MAX_PAGES; page++) {
      const query = new URLSearchParams({ since: cursor })
      const result = await this.request<{ data: Array<{ table_name: string; record_id: string; deleted_at: string }> }>(
        `/api/sync/deletions?${query.toString()}`
      )
      const data = result.data
      all.push(...data)
      if (data.length < CloudApi.CHANGES_PAGE_SIZE) break
      const lastDeletedAt = data[data.length - 1]?.deleted_at
      if (!lastDeletedAt) break
      cursor = lastDeletedAt
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    return all
  }

  async related(table: string, foreignKey: string, ids: string[]): Promise<Record<string, unknown>[]> {
    const result = await this.request<{ data: Record<string, unknown>[] }>('/api/sync/related', {
      method: 'POST',
      body: JSON.stringify({ table, foreignKey, ids }),
    })
    return result.data
  }

  // Verifies a Clear-All-Data password server-side (Issue 29) — the hash
  // itself never reaches this device. Always resolves (never throws for a
  // normal wrong-password/lockout response, since the backend returns 200
  // with {success:false, error} for those cases); a thrown error here means
  // the device itself couldn't reach/authenticate to the backend at all.
  async verifyClearDataPassword(password: string): Promise<{ success: boolean; error?: string }> {
    return this.request('/api/company/clear-data-password/verify', {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
  }

  // Redeems a single-use emergency support-access token (Issue 33). Requires
  // connectivity by design — there is no offline bypass. Returns the target
  // Company Admin user's identity only, never a password.
  async redeemSupportToken(token: string, deviceId: string | null): Promise<{
    success: boolean; error?: string
    session_id?: string; expires_at?: string
    user?: { id: string; name: string; email: string }
  }> {
    return this.request('/api/companies/support-token/redeem', {
      method: 'POST',
      body: JSON.stringify({ token, device_id: deviceId }),
    })
  }

  async endSupportSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
    return this.request('/api/companies/support-token/end', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    })
  }

  async getSupportSessionStatus(sessionId: string): Promise<{ active: boolean }> {
    const query = new URLSearchParams({ session_id: sessionId })
    return this.request(`/api/companies/support-token/status?${query.toString()}`)
  }

  async getBranding(): Promise<{ branding: Record<string, unknown>; updated_at: string | null }> {
    return this.request('/api/company/branding')
  }

  async putBranding(branding: Record<string, unknown>): Promise<{ success: boolean }> {
    return this.request('/api/company/branding', {
      method: 'PUT',
      body: JSON.stringify(branding),
    })
  }

  async uploadImage(filePath: string, fileName: string, contentType: string): Promise<string> {
    const body = fs.readFileSync(filePath)
    const result = await this.request<{ url: string }>(
      `/api/upload?filename=${encodeURIComponent(fileName)}`,
      {
        method: 'POST',
        headers: { 'content-type': contentType },
        body,
      }
    )
    return result.url
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: init.signal || AbortSignal.timeout(15_000),
      headers: {
        'x-api-key': this.apiKey,
        ...(this.deviceId ? { 'x-device-id': this.deviceId } : {}),
        ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    })

    const text = await response.text()
    let payload: unknown = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = { error: text }
      }
    }

    if (!response.ok) {
      const message = payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Cloud API request failed with HTTP ${response.status}`
      if (response.status === 429) {
        const headerRetry = Number(response.headers.get('Retry-After') || 0)
        const bodyRetry = payload && typeof payload === 'object' && 'retryAfter' in payload
          ? Number((payload as { retryAfter: unknown }).retryAfter)
          : 0
        throw new CloudRateLimitError(message, Math.max(15, headerRetry || bodyRetry || 60))
      }
      const code = payload && typeof payload === 'object' && 'code' in payload
        ? String((payload as { code: unknown }).code)
        : ''
      if (code === 'DEVICE_REVOKED' || code === 'DEVICE_SUSPENDED') {
        throw new DeviceRevokedError(message, code)
      }
      throw new Error(message)
    }

    return payload as T
  }
}
