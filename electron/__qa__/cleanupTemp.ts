// Integration setup file: every temp folder a test creates with fs.mkdtempSync inside the OS temp dir
// (smartbuy-qa-*, np-pos-*, app-order-qa-*, ...) is removed when the test file finishes and again when the worker exits,
// whether the run passed or failed. Previously each run left ~150 MB of throwaway POS data behind.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll } from 'vitest'

const created = new Set<string>()
const root = path.resolve(os.tmpdir())
const realMkdtemp = fs.mkdtempSync.bind(fs) as typeof fs.mkdtempSync

;(fs as { mkdtempSync: unknown }).mkdtempSync = ((prefix: string, options?: unknown) => {
  const dir = (realMkdtemp as (p: string, o?: unknown) => string)(prefix, options)
  if (typeof dir === 'string' && path.resolve(dir).startsWith(root + path.sep)) created.add(dir)
  return dir
}) as typeof fs.mkdtempSync

function cleanup(): void {
  for (const dir of created) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); created.delete(dir) } catch { /* retried on exit */ }
  }
}

afterAll(cleanup)
process.once('exit', cleanup)
