import fs from 'fs'
import path from 'path'
import { createBranchHub, type HubConfig } from './server'
import { BranchPostgres, type PgPool } from './postgres'

async function main() {
  const configPath = process.env.POS_HUB_CONFIG
  if (!configPath) throw new Error('Set POS_HUB_CONFIG to the absolute Hub JSON configuration path')
  const absolute = path.resolve(configPath)
  const config = JSON.parse(fs.readFileSync(absolute, 'utf8')) as HubConfig
  const base = path.dirname(absolute)
  config.database = path.resolve(base, config.database || 'branch-hub.db')
  config.backupDirectory = path.resolve(base, config.backupDirectory || 'backups')
  fs.mkdirSync(path.dirname(config.database), { recursive: true })
  let postgres: BranchPostgres | undefined
  config.postgresStatus = () => postgres?.status() || { configured: false }
  const hub = createBranchHub(config)
  let postgresTimer: ReturnType<typeof setInterval> | undefined
  if (process.env.POS_BRANCH_POSTGRES_URL) {
    // pg is a standalone Hub dependency; the cashier Electron app never loads it.
    const { Pool } = require('pg') as { Pool: new (options: Record<string, unknown>) => PgPool }
    const pool = new Pool({ connectionString: process.env.POS_BRANCH_POSTGRES_URL, max: 2,
      connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000, query_timeout: 5000, statement_timeout: 5000,
      application_name: 'pos-branch-hub' })
    pool.on?.('error', () => { console.error('[Hub] PostgreSQL connection interrupted; queued invoices are retained') })
    postgres = new BranchPostgres(hub.store, pool)
    void postgres.flush()
    postgresTimer = setInterval(() => { void postgres?.flush() }, 2000)
    postgresTimer.unref()
  }
  const port = await hub.listen()
  console.log(`[Hub] Branch ${config.branchId} listening on ${config.host || '127.0.0.1'}:${port}`)
  void hub.backup().catch(err => console.error('[Hub] Initial backup failed:', (err as Error).message))
  let stopping = false
  const stop = async () => { if (!stopping) { stopping = true; if (postgresTimer) clearInterval(postgresTimer); await postgres?.close(); await hub.close() } }
  process.on('SIGINT', () => { void stop() })
  process.on('SIGTERM', () => { void stop() })
}
if (require.main === module) void main().catch(() => { console.error('[Hub] Startup failed. Verify local configuration and dependencies.'); process.exitCode = 1 })
