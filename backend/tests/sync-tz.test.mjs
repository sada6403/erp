// Mixed old-local / new-UTC timestamps: proves SYNC_PULL_OVERLAP_MINUTES prevents missed changes.
// Uses a throw-away table in the LOCAL test database. Run: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { pullSinceSql, pullOverlapMinutes } from '../lib/syncCursor.ts'

const seed = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.seed-output.json'), 'utf8'))
const LOCAL_OFFSET_MIN = 330 // a +05:30 MySQL server before the UTC switch
const ts = (ms) => new Date(ms).toISOString().slice(0, 23).replace('T', ' ')

test('overlap helper: off by default, clamps, moves the cursor back', () => {
  assert.equal(pullOverlapMinutes({}), 0)
  assert.equal(pullOverlapMinutes({ SYNC_PULL_OVERLAP_MINUTES: 'abc' }), 0)
  assert.equal(pullOverlapMinutes({ SYNC_PULL_OVERLAP_MINUTES: '99999' }), 1440)
  assert.equal(pullSinceSql('2026-11-10T12:00:00.000Z', 0), '2026-11-10 12:00:00.000')
  assert.equal(pullSinceSql('2026-11-10T12:00:00.000Z', 330), '2026-11-10 06:30:00.000')
})

test('mixed old-local and new-UTC rows: without overlap a change is missed, with overlap none is', async () => {
  assert.ok(['127.0.0.1', 'localhost'].includes(process.env.MYSQL_HOST), 'local database only')
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: seed.db_schema })
  try {
    await db.query('DROP TABLE IF EXISTS tz_sim')
    await db.query('CREATE TABLE tz_sim (id VARCHAR(20) PRIMARY KEY, updated_at DATETIME(3) NOT NULL)')
    const nowUtc = Date.now()
    // Before the switch: stamped in server-local time, so 5h30 ahead of true UTC.
    const oldRows = [['old-1', nowUtc - 3600_000], ['old-2', nowUtc - 60_000]].map(([id, t]) => [id, ts(t + LOCAL_OFFSET_MIN * 60_000)])
    await db.query('INSERT INTO tz_sim (id, updated_at) VALUES ?', [oldRows])
    // The device pulled everything: its cursor is the newest old stamp (5h29 in the "future").
    const cursor = new Date(oldRows[1][1].replace(' ', 'T') + 'Z').toISOString()
    // After the switch: a true-UTC stamp, i.e. 5h30 earlier than the cursor.
    await db.query('INSERT INTO tz_sim (id, updated_at) VALUES (?, ?)', ['new-1', ts(nowUtc)])

    const pull = async (overlap) => (await db.query('SELECT id FROM tz_sim WHERE updated_at > ? ORDER BY updated_at', [pullSinceSql(cursor, overlap)]))[0].map((r) => r.id)
    const without = await pull(0)
    assert.ok(!without.includes('new-1'), 'sanity: the plain cursor query misses the new row (this is the bug the overlap fixes)')
    const withOverlap = await pull(330)
    assert.ok(withOverlap.includes('new-1'), 'with a 330 min overlap the new row is delivered')
    // Re-sent old rows are fine (idempotent upsert); what matters is that no new change is lost.
    assert.deepEqual(withOverlap, ['new-1', 'old-1', 'old-2'].filter((id) => withOverlap.includes(id)).sort((x, y) => withOverlap.indexOf(x) - withOverlap.indexOf(y)))
  } finally {
    await db.query('DROP TABLE IF EXISTS tz_sim')
    await db.end()
  }
})
