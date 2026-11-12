// Vitest globalSetup for the integration project. Test workers are forked and can end while SQLite still holds the
// temp DB open (Windows then refuses the delete), so the main process, which always outlives them, removes what they
// left: every NEW folder in the OS temp dir that a test created (smartbuy-qa-*, np-pos-*, app-order-qa-*, ...).
// Runs on success and on failure. Folders that existed before the run are never touched.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PREFIXES = ['smartbuy-qa-', 'smartbuy-e2e-', 'np-pos-', 'app-order-qa-', 'online-delete-sync-qa-', 'sync-overlap-', 'colombo-day-', 'product-spreadsheet-', 'security-qa-', 'delete-qa-']
const root = os.tmpdir()
let before = new Set<string>()

const list = (): string[] => { try { return fs.readdirSync(root).filter(n => PREFIXES.some(p => n.startsWith(p))) } catch { return [] } }

export function setup(): void {
  before = new Set(list())
}

export async function teardown(): Promise<void> {
  for (const name of list()) {
    if (before.has(name)) continue
    const dir = path.join(root, name)
    for (let i = 0; i < 10; i++) {
      try { fs.rmSync(dir, { recursive: true, force: true }); break } catch { await new Promise(r => setTimeout(r, 500)) }
    }
  }
}
