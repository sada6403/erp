import type Database from 'better-sqlite3'
import SQLite from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

export function keywordTableExists(db: Database.Database) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_search_keywords'").get())
}
const running = new WeakMap<Database.Database, Promise<string | undefined>>()
export function migrateKeywords(db: Database.Database, backupDirectory: string, sql: string, direction: 'up' | 'down' = 'up'): Promise<string | undefined> {
  if (running.has(db)) return running.get(db)!
  const task = (async () => {
    if (db.inTransaction) throw new Error('Keyword migration cannot run inside a billing transaction')
    const exists = keywordTableExists(db)
    if ((direction === 'up' && exists) || (direction === 'down' && !exists)) return undefined
    if (direction === 'down' && (db.prepare('SELECT count(*) AS n FROM product_search_keywords').get() as { n: number }).n) throw new Error('Disable the feature instead; populated keyword data cannot be dropped')
    fs.mkdirSync(backupDirectory, { recursive: true })
    const backup = path.join(backupDirectory, `pre-keywords-${direction}-${randomUUID()}.db`)
    await db.backup(backup)
    const verify = new SQLite(backup, { readonly: true, fileMustExist: true })
    try { if (verify.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Keyword migration backup verification failed') }
    finally { verify.close() }
    db.transaction(() => db.exec(sql)).immediate()
    return backup
  })()
  running.set(db, task)
  void task.finally(() => running.delete(db)).catch(() => {})
  return task
}
