import fs from 'fs'

export interface CloudConfig {
  baseUrl: string
  apiKey: string
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

export class CloudApi {
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(config: CloudConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.apiKey = config.apiKey
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

  async changes(table: string, since: string): Promise<Record<string, unknown>[]> {
    const query = new URLSearchParams({ table, since })
    const result = await this.request<{ data: Record<string, unknown>[] }>(
      `/api/sync/changes?${query.toString()}`
    )
    return result.data
  }

  async related(table: string, foreignKey: string, ids: string[]): Promise<Record<string, unknown>[]> {
    const result = await this.request<{ data: Record<string, unknown>[] }>('/api/sync/related', {
      method: 'POST',
      body: JSON.stringify({ table, foreignKey, ids }),
    })
    return result.data
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
      throw new Error(message)
    }

    return payload as T
  }
}
