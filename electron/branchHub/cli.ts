import fs from 'fs'
import path from 'path'
import { createBranchHub, type HubConfig } from './server'

async function main() {
  const configPath = process.env.POS_HUB_CONFIG
  if (!configPath) throw new Error('Set POS_HUB_CONFIG to the absolute Hub JSON configuration path')
  const absolute = path.resolve(configPath)
  const config = JSON.parse(fs.readFileSync(absolute, 'utf8')) as HubConfig
  const base = path.dirname(absolute)
  config.database = path.resolve(base, config.database || 'branch-hub.db')
  config.backupDirectory = path.resolve(base, config.backupDirectory || 'backups')
  fs.mkdirSync(path.dirname(config.database), { recursive: true })
  const hub = createBranchHub(config)
  const port = await hub.listen()
  console.log(`[Hub] Branch ${config.branchId} listening on ${config.host || '127.0.0.1'}:${port}`)
  void hub.backup().catch(err => console.error('[Hub] Initial backup failed:', (err as Error).message))
  let stopping = false
  const stop = async () => { if (!stopping) { stopping = true; await hub.close() } }
  process.on('SIGINT', () => { void stop() })
  process.on('SIGTERM', () => { void stop() })
}
if (require.main === module) void main().catch(err => { console.error('[Hub]', (err as Error).message); process.exitCode = 1 })
