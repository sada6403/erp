import http from 'http'
import { timingSafeEqual, randomUUID } from 'crypto'
import { mkdirSync, renameSync } from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { WebSocketServer, WebSocket } from 'ws'
import { BranchHubStore, HubError, businessDay } from './store'

export interface HubConfig {
  branchId: string
  database: string
  timezone?: string
  host?: string
  port?: number
  terminals: Record<string, string>
  backupDirectory?: string
}

export function createBranchHub(config: HubConfig) {
  if (!Object.entries(config.terminals).length || Object.entries(config.terminals).some(([id, token]) => !/^[A-Za-z0-9_-]{1,40}$/.test(id) || typeof token !== 'string' || token.length < 24)) throw new Error('Configure terminal IDs with unique credentials of at least 24 characters')
  if (new Set(Object.values(config.terminals)).size !== Object.values(config.terminals).length) throw new Error('Each terminal requires a different credential')
  const store = new BranchHubStore(config.database, config.branchId, config.timezone)
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
  const live = new Set<WebSocket>()
  let closed = false
  let lastBackupDay = ''
  let backingUp = false
  const authenticate = (req: http.IncomingMessage) => {
    const terminal = String(req.headers['x-pos-terminal'] || '')
    const branch = String(req.headers['x-pos-branch'] || '')
    const supplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''))
    const expected = Buffer.from(config.terminals[terminal] || '')
    if (branch !== config.branchId || !expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HubError('Unauthorized terminal', 401)
    return terminal
  }
  const notify = () => {
    const packet = JSON.stringify({ type: 'hub.changed', branch_id: config.branchId })
    for (const socket of live) if (socket.readyState === WebSocket.OPEN) socket.send(packet)
  }
  const respond = (res: http.ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(data))
  }
  const server = http.createServer(async (req, res) => {
    try {
      const terminal = authenticate(req)
      const url = new URL(req.url || '/', 'http://hub.local')
      if (req.method === 'GET' && url.pathname === '/v1/status') {
        respond(res, 200, { branch_id: config.branchId, hub: 'online', cloud: 'not_configured', pending_cloud: store.pendingCloud(), business_day: businessDay(new Date(), store.timezone) })
        return
      }
      if (req.method === 'GET' && url.pathname === '/v1/holds') { respond(res, 200, { holds: store.listHolds() }); return }
      if (req.method === 'GET' && url.pathname === '/v1/holds/resolve') { respond(res, 200, { id: store.resolveHold(url.searchParams.get('number') || '') }); return }
      if (req.method === 'GET' && url.pathname === '/v1/changes') { respond(res, 200, store.changes(Number(url.searchParams.get('after') || 0))); return }
      if (req.method !== 'POST' || !['/v1/holds', '/v1/holds/consume', '/v1/events'].includes(url.pathname)) throw new HubError('Endpoint not found', 404)
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HubError('JSON body required', 415)
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > 2 * 1024 * 1024) throw new HubError('Request exceeds 2 MiB', 413)
        chunks.push(Buffer.from(chunk))
      }
      let body: Record<string, any>
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new HubError('Invalid JSON') }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HubError('JSON object required')
      let data: unknown
      if (url.pathname === '/v1/holds') data = { hold: store.createHold(terminal, body.id, body.payload || {}, body.local_number) }
      else if (url.pathname === '/v1/holds/consume') data = { hold: store.consumeHold(terminal, body.request_id, body.hold) }
      else data = { acknowledged: store.appendEvents(terminal, body.events) }
      respond(res, 200, data)
      notify()
    } catch (err) {
      if (!res.headersSent) respond(res, err instanceof HubError ? err.status : 500, { error: err instanceof HubError ? err.message : 'Hub storage or service error' })
      else res.end()
    }
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  server.on('upgrade', (req, socket, head) => {
    try {
      authenticate(req)
      if (req.url !== '/v1/ws') throw new HubError('Endpoint not found', 404)
      sockets.handleUpgrade(req, socket, head, ws => {
        live.add(ws)
        let alive = true
        ws.on('pong', () => { alive = true })
        const heartbeat = setInterval(() => { if (!alive) ws.terminate(); else { alive = false; ws.ping() } }, 10_000)
        heartbeat.unref()
        ws.on('error', () => ws.terminate())
        ws.on('close', () => { clearInterval(heartbeat); live.delete(ws) })
        ws.send(JSON.stringify({ type: 'hub.ready', branch_id: config.branchId }))
      })
    } catch {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    }
  })

  const backup = async () => {
    if (!config.backupDirectory || backingUp || closed) return undefined
    backingUp = true
    try {
      mkdirSync(config.backupDirectory, { recursive: true })
      const filename = path.join(config.backupDirectory, `hub-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.db`)
      const partial = `${filename}.partial`
      await store.db.backup(partial)
      const verification = new Database(partial, { readonly: true, fileMustExist: true })
      try {
        if (verification.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup integrity check failed')
      } finally { verification.close() }
      renameSync(partial, filename)
      lastBackupDay = businessDay(new Date(), store.timezone)
      return filename
    } finally { backingUp = false }
  }
  const timer = setInterval(() => {
    if (lastBackupDay !== businessDay(new Date(), store.timezone)) void backup().catch(err => console.error('[Hub] Daily backup failed:', (err as Error).message))
  }, 60_000)
  timer.unref()
  return {
    store, server, backup,
    listen: (port = config.port ?? 4781, host = config.host || '127.0.0.1') => new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        server.removeListener('error', reject)
        const address = server.address()
        resolve(typeof address === 'object' && address ? address.port : port)
      })
    }),
    close: async () => {
      if (closed) return
      closed = true
      clearInterval(timer)
      for (const socket of live) socket.terminate()
      sockets.close()
      await new Promise<void>((resolve, reject) => server.listening ? server.close(error => error ? reject(error) : resolve()) : resolve())
      // backup() is only scheduled in the CLI and serialized against shutdown.
      while (backingUp) await new Promise(resolve => setTimeout(resolve, 10))
      store.close()
    },
  }
}
