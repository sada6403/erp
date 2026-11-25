import Database from 'better-sqlite3'
import http from 'http'
import https from 'https'
import { randomUUID } from 'crypto'
import WebSocket from 'ws'
import type { HubHold } from './store'
import { manualHoldNumber } from '../lib/holdNumber'

export interface TerminalHubConfig { url: string; branchId: string; terminalId: string; token: string }
export class HubTransportError extends Error {
  constructor(message: string, readonly status = 0) { super(message) }
}

export class TerminalHubClient {
  readonly db: Database.Database
  private timer?: ReturnType<typeof setTimeout>
  private socket?: WebSocket
  private stopped = true
  private running = false
  private failures = 0
  private online = false
  private cloud = 'unknown'
  private hubHolds: (HubHold & { overdue?: boolean })[] = []
  private lastError = ''
  private lastHeartbeat = 0
  private activeRecalls = 0
  private billingSync?: () => Promise<void>
  private postgres: Record<string, unknown> = { configured: false }
  setBillingSync(sync: () => Promise<void>) { this.billingSync = sync }
  async sendBillingSnapshot(event: { event_id: string; kind: 'invoice.snapshot'; payload: unknown }): Promise<boolean> {
    const response = await this.request<{ acknowledged: string[] }>('/v1/events', { events: [event] })
    return response.acknowledged?.includes(event.event_id) === true
  }

  constructor(readonly config: TerminalHubConfig, filename: string, private changed = () => {}) {
    const url = new URL(config.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Hub URL must be an HTTP(S) origin')
    if (!config.branchId || !/^[A-Za-z0-9_-]{1,40}$/.test(config.terminalId) || config.token.length < 24) throw new Error('Invalid branch Hub terminal configuration')
    this.db = new Database(filename)
    const existingTables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    if (existingTables.length && !existingTables.some(table => table.name === 'terminal_hub_identity')) { this.db.close(); throw new Error('Refusing to initialize Hub state in an existing POS database') }
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = FULL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS terminal_hub_identity (id INTEGER PRIMARY KEY CHECK(id=1), branch_id TEXT NOT NULL, terminal_id TEXT NOT NULL, hub_url TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS terminal_hub_sequence (id INTEGER PRIMARY KEY CHECK(id=1), next_value INTEGER NOT NULL);
      INSERT OR IGNORE INTO terminal_hub_sequence VALUES (1,1);
      CREATE TABLE IF NOT EXISTS terminal_hub_holds (
        id TEXT PRIMARY KEY, hold_number TEXT NOT NULL, payload TEXT NOT NULL,
        state TEXT NOT NULL, created_at TEXT NOT NULL, remote_number TEXT, error TEXT);
      CREATE INDEX IF NOT EXISTS terminal_hub_holds_state ON terminal_hub_holds(state,created_at);
      CREATE TABLE IF NOT EXISTS terminal_hub_recalls (
        request_id TEXT PRIMARY KEY, hold_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
        payload TEXT, error TEXT, created_at TEXT NOT NULL);
    `)
    const identity = this.db.prepare('SELECT * FROM terminal_hub_identity WHERE id=1').get() as Record<string, string> | undefined
    if (identity && (identity.branch_id !== config.branchId || identity.terminal_id !== config.terminalId)) {
      this.db.close(); throw new Error('Terminal Hub database identity cannot be reassigned; recover pending holds first')
    }
    this.db.prepare('INSERT OR IGNORE INTO terminal_hub_identity VALUES (1,?,?,?)').run(config.branchId, config.terminalId, config.url)
    // Address changes retain all pending work; branch/terminal identity stays fixed.
    this.db.prepare('UPDATE terminal_hub_identity SET hub_url=? WHERE id=1').run(config.url)
  }

  private headers() { return { authorization: `Bearer ${this.config.token}`, 'x-pos-terminal': this.config.terminalId, 'x-pos-branch': this.config.branchId } }
  private request<T>(route: string, payload?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(route, this.config.url)
      const data = payload === undefined ? undefined : JSON.stringify(payload)
      const request = (url.protocol === 'https:' ? https : http).request(url, {
        method: data ? 'POST' : 'GET', headers: { ...this.headers(), ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) },
      }, response => {
        let bytes = 0
        const chunks: Buffer[] = []
        response.on('data', chunk => {
          bytes += chunk.length
          if (bytes > 4 * 1024 * 1024) { response.destroy(new Error('Hub response too large')); return }
          chunks.push(Buffer.from(chunk))
        })
        response.on('error', reject)
        response.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if ((response.statusCode || 500) >= 400) reject(new HubTransportError(body.error || 'Hub request rejected', response.statusCode))
            else resolve(body as T)
          } catch { reject(new HubTransportError('Invalid Hub response')) }
        })
      })
      const deadline = setTimeout(() => request.destroy(new HubTransportError('Hub request timed out')), 1500)
      request.on('error', reject)
      request.on('close', () => clearTimeout(deadline))
      request.end(data)
    })
  }

  status() {
    const pending = (this.db.prepare("SELECT (SELECT count(*) FROM terminal_hub_holds WHERE state IN ('local','publishing')) + (SELECT count(*) FROM terminal_hub_recalls WHERE state='pending') AS n").get() as { n: number }).n
    const recoverable = (this.db.prepare("SELECT count(*) AS n FROM terminal_hub_recalls WHERE state='ready'").get() as { n: number }).n
    const blocked = (this.db.prepare("SELECT count(*) AS n FROM terminal_hub_holds WHERE state='blocked'").get() as { n: number }).n
    const last = this.db.prepare("SELECT coalesce(remote_number,hold_number) AS number FROM terminal_hub_holds WHERE state!='consumed' ORDER BY created_at DESC,rowid DESC LIMIT 1").get() as { number: string } | undefined
    return { configured: true, hub_online: this.online, cloud: this.cloud, postgres: this.postgres, pending, recoverable, blocked, last_hold_number: last?.number || '', terminal_id: this.config.terminalId, error: this.lastError }
  }

  createHold(payload: Record<string, unknown>) {
    if (!Array.isArray(payload.items) || !payload.items.length) throw new Error('Cannot hold an empty cart')
    const result = this.db.transaction(() => {
      const { next_value: sequence } = this.db.prepare('SELECT next_value FROM terminal_hub_sequence WHERE id=1').get() as { next_value: number }
      this.db.prepare('UPDATE terminal_hub_sequence SET next_value=next_value+1 WHERE id=1').run()
      const id = randomUUID()
      const hold_number = payload.hold_number == null ? `H-${this.config.terminalId}-${String(sequence).padStart(4, '0')}` : manualHoldNumber(payload.hold_number)
      const duplicate = this.db.prepare("SELECT id FROM terminal_hub_holds WHERE hold_number=? AND state IN ('local','publishing','blocked')").get(hold_number)
      const recovering = this.db.prepare("SELECT request_id FROM terminal_hub_recalls WHERE state='ready' AND json_extract(payload,'$.hold_number')=?").get(hold_number)
      if (duplicate || recovering || this.hubHolds.some(hold => hold.hold_number === hold_number)) throw new Error('Hold number is already in use; choose another number')
      this.db.prepare("INSERT INTO terminal_hub_holds(id,hold_number,payload,state,created_at) VALUES (?,?,?,'local',?)").run(id, hold_number, JSON.stringify(payload), new Date().toISOString())
      return { id, hold_number, source: 'local' }
    }).immediate()
    this.changed()
    this.wake()
    return result
  }

  listHolds(): Record<string, unknown>[] {
    const local = this.db.prepare("SELECT * FROM terminal_hub_holds WHERE state IN ('local','publishing','blocked') ORDER BY created_at DESC").all() as Record<string, unknown>[]
    const ownIds = new Set(local.map(row => String(row.id)))
    const recovered = this.db.prepare("SELECT * FROM terminal_hub_recalls WHERE state='ready' ORDER BY created_at DESC").all() as Record<string, unknown>[]
    return [
      ...recovered.map(row => { const hold = JSON.parse(String(row.payload)) as HubHold; return { ...hold.payload, id: `recovery:${row.request_id}`, hold_number: hold.hold_number, item_count: (hold.payload.items as unknown[])?.length, source: 'recovery', created_at: row.created_at } }),
      ...local.map(row => { const payload = JSON.parse(String(row.payload)); return { ...payload, id: row.id, hold_number: row.hold_number, item_count: payload.items.length, created_at: row.created_at, source: row.state, error: row.error } }),
      ...this.hubHolds.filter(hold => !ownIds.has(hold.id)).map(hold => ({ ...hold.payload, ...hold, payload: undefined, source: 'hub' })),
    ]
  }

  private finishRecall(requestId: string, hold: HubHold) {
    this.db.transaction(() => {
      // A background replay may finish after the renderer acknowledged a
      // parallel response. Never resurrect an already delivered recall.
      this.db.prepare("UPDATE terminal_hub_recalls SET state='ready',payload=?,error=NULL WHERE request_id=? AND state!='delivered'").run(JSON.stringify(hold), requestId)
      this.db.prepare("UPDATE terminal_hub_holds SET state='consumed' WHERE id=?").run(hold.id)
    }).immediate()
    this.hubHolds = this.hubHolds.filter(row => row.id !== hold.id)
    this.changed()
    return { ...hold.payload, recall_token: requestId, hold_number: hold.hold_number }
  }

  async recallHold(key: string): Promise<Record<string, unknown>> {
    this.activeRecalls++
    try { return await this.doRecallHold(key) } finally { this.activeRecalls-- }
  }

  private async doRecallHold(key: string): Promise<Record<string, unknown>> {
    if (/^\d{1,12}$/.test(key)) {
      const recovered = this.db.prepare("SELECT request_id FROM terminal_hub_recalls WHERE state='ready' AND json_extract(payload,'$.hold_number')=?").get(key) as { request_id: string } | undefined
      if (recovered) return this.recallHold(`recovery:${recovered.request_id}`)
    }
    if (key.startsWith('recovery:')) {
      const row = this.db.prepare("SELECT * FROM terminal_hub_recalls WHERE request_id=? AND state='ready'").get(key.slice(9)) as Record<string, unknown> | undefined
      if (!row) throw new Error('Recovered hold no longer available')
      const hold = JSON.parse(String(row.payload)) as HubHold
      return { ...hold.payload, recall_token: row.request_id, hold_number: hold.hold_number }
    }
    const local = this.db.prepare("SELECT * FROM terminal_hub_holds WHERE id=? OR (hold_number=? AND state IN ('local','publishing','blocked')) ORDER BY created_at DESC,rowid DESC LIMIT 1").get(key, key.toUpperCase()) as Record<string, unknown> | undefined
    const holdKey = local ? String(local.id) : /^\d{1,12}$/.test(key) ? (await this.request<{ id: string }>(`/v1/holds/resolve?number=${encodeURIComponent(key)}`)).id : key
    let intent = this.db.prepare('SELECT * FROM terminal_hub_recalls WHERE hold_key=?').get(holdKey) as Record<string, unknown> | undefined
    if (intent?.state === 'delivered') throw new Error('This terminal already restored this hold')
    if (intent?.state === 'ready') return this.recallHold(`recovery:${intent.request_id}`)
    if (intent?.state === 'failed') throw new Error(String(intent.error))
    const rejectedNumber = local?.state === 'blocked' && String(local.error).startsWith('Hold number is already in use')
    if (local?.state === 'publishing' || (local?.state === 'blocked' && !rejectedNumber)) throw new Error('Hold ownership is awaiting Hub confirmation; reconnect before resuming it')
    if (local?.state === 'local' || rejectedNumber) {
      return this.db.transaction(() => {
        const requestId = randomUUID()
        this.db.prepare("INSERT INTO terminal_hub_recalls VALUES (?,?,'pending',NULL,NULL,?)").run(requestId, holdKey, new Date().toISOString())
        const claimed = this.db.prepare("UPDATE terminal_hub_holds SET state='consumed' WHERE id=? AND state=?").run(local.id, local.state)
        if (claimed.changes !== 1) throw new Error('Hold is no longer available')
        return this.finishRecall(requestId, { id: String(local.id), hold_number: String(local.hold_number), payload: JSON.parse(String(local.payload)), business_day: '', terminal_id: this.config.terminalId, state: 'consumed', created_at: String(local.created_at) })
      }).immediate()
    }
    if (!intent) {
      const requestId = randomUUID()
      this.db.prepare("INSERT INTO terminal_hub_recalls VALUES (?,?,'pending',NULL,NULL,?)").run(requestId, holdKey, new Date().toISOString())
      intent = { request_id: requestId }
    }
    try {
      const response = await this.request<{ hold: HubHold }>('/v1/holds/consume', { request_id: intent.request_id, hold: holdKey })
      return this.finishRecall(String(intent.request_id), response.hold)
    } catch (err) {
      if (err instanceof HubTransportError && [404,409].includes(err.status)) this.db.prepare("UPDATE terminal_hub_recalls SET state='failed',error=? WHERE request_id=?").run(err.message, intent.request_id)
      else { this.online = false; this.lastError = (err as Error).message; this.wake() }
      throw err
    }
  }

  acknowledgeRecall(requestId: string) {
    this.db.prepare("UPDATE terminal_hub_recalls SET state='delivered' WHERE request_id=? AND state='ready'").run(requestId)
    this.changed()
  }

  private connectSocket() {
    if (this.stopped || this.socket) return
    const url = new URL('/v1/ws', this.config.url)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url, { headers: this.headers(), handshakeTimeout: 1500 })
    this.lastHeartbeat = Date.now()
    this.socket = socket
    socket.on('open', () => { this.lastHeartbeat = Date.now() })
    socket.on('ping', () => { this.lastHeartbeat = Date.now() })
    socket.on('message', () => { this.lastHeartbeat = Date.now(); this.wake() })
    socket.on('error', () => socket.terminate())
    socket.on('close', () => { if (this.socket === socket) this.socket = undefined; this.wake() })
  }

  /** Public for deterministic outage/recovery integration tests. */
  async syncOnce() {
    if (this.running) return
    this.running = true
    try {
      const status = await this.request<{ branch_id: string; cloud: string; postgres?: Record<string, unknown> }>('/v1/status')
      if (status.branch_id !== this.config.branchId) throw new Error('Hub branch identity mismatch')
      this.online = true; this.cloud = status.cloud; this.lastError = ''; this.failures = 0
      this.postgres = status.postgres || { configured: false }
      this.connectSocket()
      if (this.socket && Date.now() - this.lastHeartbeat > 30_000) this.socket.terminate()
      const pending = this.db.prepare("SELECT * FROM terminal_hub_recalls WHERE state='pending' LIMIT 20").all() as Record<string, unknown>[]
      for (const intent of pending) {
        try {
          const response = await this.request<{ hold: HubHold }>('/v1/holds/consume', { request_id: intent.request_id, hold: intent.hold_key })
          this.finishRecall(String(intent.request_id), response.hold)
        } catch (err) {
          if (err instanceof HubTransportError && [404,409].includes(err.status)) this.db.prepare("UPDATE terminal_hub_recalls SET state='failed',error=? WHERE request_id=?").run(err.message, intent.request_id)
          else throw err
        }
      }
      const rows = this.db.prepare("SELECT * FROM terminal_hub_holds WHERE state IN ('local','publishing') ORDER BY created_at LIMIT 20").all() as Record<string, unknown>[]
      for (const row of rows) {
        const updated = this.db.prepare("UPDATE terminal_hub_holds SET state='publishing' WHERE id=? AND state IN ('local','publishing')").run(row.id)
        if (!updated.changes) continue
        try {
          const payload = JSON.parse(String(row.payload))
          const response = await this.request<{ hold: HubHold }>('/v1/holds', { id: row.id, local_number: payload.hold_number == null ? row.hold_number : undefined, payload })
          this.db.prepare("UPDATE terminal_hub_holds SET state=?,remote_number=?,error=NULL WHERE id=?").run(response.hold.state === 'consumed' ? 'consumed' : 'shared', response.hold.hold_number, row.id)
        } catch (err) {
          if (err instanceof HubTransportError && err.status >= 400 && err.status < 500) this.db.prepare("UPDATE terminal_hub_holds SET state='blocked',error=? WHERE id=?").run(err.message, row.id)
          else throw err
        }
      }
      // Billing replication has a separate durable outbox and must not block holds.
      if (this.billingSync) await this.billingSync().catch(() => { this.lastError = 'Invoice replication pending; verify branch Hub/PostgreSQL status' })
      const response = await this.request<{ holds: (HubHold & { overdue?: boolean })[] }>('/v1/holds')
      this.hubHolds = response.holds
    } catch (err) {
      this.online = false; this.failures++; this.lastError = (err as Error).message
    } finally { this.running = false; this.changed() }
  }

  private wake() {
    if (this.stopped || this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.loop() }, 0)
  }
  private async loop() {
    if (this.stopped) return
    await this.syncOnce()
    if (!this.stopped) this.timer = setTimeout(() => { void this.loop() }, this.online ? 3000 : Math.min(15000, 1000 * 2 ** Math.min(this.failures, 4)) + Math.floor(Math.random() * 250))
  }
  start() { if (this.stopped) { this.stopped = false; this.wake() } }
  async close() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.socket?.terminate()
    while (this.running || this.activeRecalls) await new Promise(resolve => setTimeout(resolve, 10))
    this.db.close()
  }
}
