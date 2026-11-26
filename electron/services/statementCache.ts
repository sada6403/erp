import type Database from 'better-sqlite3'

const ACTIVE = Symbol('statementCache')

/**
 * Reuses compiled statements for the duration of one synchronous operation.
 * Large receipts run the same few dozen SQL strings for every line; compiling
 * them once instead of per line removes most of the save time. The cache is
 * removed again before returning, so no statement outlives the operation.
 */
export function withStatementCache<T>(db: Database.Database, fn: () => T): T {
  const target = db as unknown as Record<PropertyKey, unknown>
  if (target[ACTIVE]) return fn()
  const hadOwn = Object.prototype.hasOwnProperty.call(target, 'prepare')
  const original = db.prepare
  const cache = new Map<string, Database.Statement>()
  target[ACTIVE] = true
  target.prepare = (sql: string) => {
    let statement = cache.get(sql)
    if (!statement) { statement = original.call(db, sql) as Database.Statement; cache.set(sql, statement) }
    return statement
  }
  try { return fn() } finally {
    if (hadOwn) target.prepare = original
    else delete target.prepare
    delete target[ACTIVE]
  }
}
