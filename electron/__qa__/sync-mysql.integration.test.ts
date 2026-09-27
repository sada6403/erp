import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { createRequire } from 'module'
import { ALLOWED_TABLES, applySyncOperation } from '../../backend/lib/sync'
import { ensureSyncSchema } from '../../backend/lib/syncSchema'
import { repairIdenticalStocks } from '../../backend/lib/stockIdentity'
import { repairOrphanedSyncData } from '../../backend/lib/syncDataRepair'

// Explicit opt-in: always uses a disposable database, never a tenant database.
const mysqlSuite = process.env.SYNC_MYSQL_TEST === '1' ? describe : describe.skip
mysqlSuite('Sync contract against disposable MySQL database', () => {
  const schema = `pos_erp_sync_qa_${randomBytes(8).toString('hex')}`
  let connection: any
  let client: any
  beforeAll(async () => {
    const env = Object.fromEntries(fs.readFileSync(path.resolve('backend/.env'), 'utf8').split(/\r?\n/)
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
    const mysql = createRequire(path.resolve('backend/package.json'))('mysql2/promise')
    connection = await mysql.createConnection({ host: env.MYSQL_HOST, port: Number(env.MYSQL_PORT || 3306), user: env.MYSQL_USER, password: env.MYSQL_PASSWORD })
    await connection.query(`CREATE DATABASE \`${schema}\``)
    await connection.query(`USE \`${schema}\``)
    client = { release() {}, async query(sql: string, values?: unknown[]) { const [rows] = await connection.query(sql, values); return { rows } } }
    for (const table of ALLOWED_TABLES) {
      if (table === 'warehouses') continue
      const fields = table === 'stocks'
        ? ',product_id VARCHAR(191),branch_id VARCHAR(191),warehouse_id VARCHAR(191),quantity DECIMAL(12,2),damaged_qty DECIMAL(12,2) DEFAULT 0'
        : table === 'products' ? ',name VARCHAR(255)'
        : table === 'branches' ? ',name VARCHAR(255),code VARCHAR(50) UNIQUE,is_active BOOLEAN DEFAULT 1'
        : table === 'roles' ? ',name VARCHAR(255) UNIQUE,permissions JSON,is_system BOOLEAN DEFAULT 0'
        : table === 'users' ? ',branch_id VARCHAR(191),role_id VARCHAR(191),name VARCHAR(255),email VARCHAR(255) UNIQUE,password_hash VARCHAR(255),is_active BOOLEAN DEFAULT 1'
        : table === 'invoices' ? ',branch_id VARCHAR(191),cashier_id VARCHAR(191),approved_by VARCHAR(191)'
        : table === 'payments' ? ',invoice_id VARCHAR(191),received_by VARCHAR(191)'
        : table === 'audit_logs' ? ',user_id VARCHAR(191),branch_id VARCHAR(191)'
        : ''
      await connection.query(`CREATE TABLE \`${table}\` (id VARCHAR(191) PRIMARY KEY${fields})`)
    }
    await connection.query('CREATE TABLE sync_deletions(id VARCHAR(191) PRIMARY KEY,table_name VARCHAR(191),record_id VARCHAR(191),deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP)')
  })
  afterAll(async () => {
    if (connection) {
      if (!/^pos_erp_sync_qa_[a-f0-9]{16}$/.test(schema)) throw new Error('Unsafe test database cleanup target')
      await connection.query(`DROP DATABASE IF EXISTS \`${schema}\``)
      await connection.end()
    }
  })
  it('migrates all sync tables and is idempotent', async () => {
    await ensureSyncSchema(client)
    await ensureSyncSchema(client)
    const [rows] = await connection.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND COLUMN_NAME='updated_at'", [schema])
    expect(Number(rows[0].n)).toBe(ALLOWED_TABLES.size)
  })
  it('ingests old offline writes with database time and rejects missing UPDATE targets', async () => {
    await applySyncOperation(client, { eventId: 'create-p', table: 'products', operation: 'INSERT', recordId: 'p', record: { id: 'p', name: 'Desk', updated_at: '2001-01-01T00:00:00.000Z' } })
    await applySyncOperation(client, { eventId: 'create-p', table: 'products', operation: 'INSERT', recordId: 'p', record: { id: 'p', name: 'Must not replay' } })
    const [rows] = await connection.query("SELECT name,YEAR(updated_at) AS year FROM products WHERE id='p'")
    expect(rows[0].name).toBe('Desk')
    expect(rows[0].year).toBeGreaterThan(2001)
    await expect(applySyncOperation(client, { table: 'products', operation: 'UPDATE', recordId: 'absent', record: { name: 'Missing' } })).rejects.toThrow('target is missing')
  })
  it('restores missing historical user branches and archives unusable orphan stock', async () => {
    await connection.query("INSERT INTO users(id,branch_id) VALUES ('historical-user','missing-branch')")
    await connection.query("INSERT INTO stocks(id,product_id,branch_id,quantity) VALUES ('orphan-stock','missing-product','missing-stock-branch',12)")
    await repairOrphanedSyncData(client)
    await repairOrphanedSyncData(client)
    const [branch] = await connection.query("SELECT is_active FROM branches WHERE id='missing-branch'")
    const [stock] = await connection.query("SELECT id FROM stocks WHERE id='orphan-stock'")
    const [archive] = await connection.query("SELECT reason FROM sync_orphan_record_archive WHERE record_id='orphan-stock'")
    const [tombstone] = await connection.query("SELECT id FROM sync_deletions WHERE table_name='stocks' AND record_id='orphan-stock'")
    expect(Number(branch[0].is_active)).toBe(0)
    expect(stock).toHaveLength(0)
    expect(archive[0].reason).toContain('product and branch')
    expect(tombstone).toHaveLength(1)
  })
  it('restores inactive historical actors and branches required by financial/audit records', async () => {
    await connection.query("INSERT INTO invoices(id,branch_id,cashier_id) VALUES ('historical-invoice','deleted-branch','deleted-user')")
    await connection.query("INSERT INTO payments(id,invoice_id,received_by) VALUES ('historical-payment','historical-invoice','deleted-user')")
    await connection.query("INSERT INTO audit_logs(id,user_id,branch_id) VALUES ('historical-audit','other-deleted-user','deleted-audit-branch')")
    await repairOrphanedSyncData(client)
    await repairOrphanedSyncData(client)
    const [users] = await connection.query("SELECT id,is_active,password_hash FROM users WHERE id IN ('deleted-user','other-deleted-user') ORDER BY id")
    const [branches] = await connection.query("SELECT id,is_active FROM branches WHERE id IN ('deleted-branch','deleted-audit-branch') ORDER BY id")
    const [role] = await connection.query("SELECT permissions FROM roles WHERE name='Recovered Historical User'")
    expect(users).toHaveLength(2)
    expect(users.every((user: any) => Number(user.is_active) === 0 && user.password_hash === '')).toBe(true)
    expect(branches).toHaveLength(2)
    expect(branches.every((branch: any) => Number(branch.is_active) === 0)).toBe(true)
    expect(role).toHaveLength(1)
  })
  it('archives equal duplicates and enforces uniqueness even for NULL warehouses', async () => {
    await connection.query("INSERT INTO stocks(id,product_id,branch_id,quantity) VALUES ('s1','p','b',10),('s2','p','b',10)")
    await repairIdenticalStocks(client)
    await repairIdenticalStocks(client)
    const [stocks] = await connection.query('SELECT * FROM stocks')
    const [archive] = await connection.query('SELECT * FROM sync_stock_duplicate_archive')
    expect(stocks).toHaveLength(1)
    expect(Number(stocks[0].quantity)).toBe(10)
    expect(archive).toHaveLength(2)
    await expect(connection.query("INSERT INTO stocks(id,product_id,branch_id,quantity) VALUES ('s3','p','b',10)")).rejects.toThrow()
  })
  it('updates the canonical stock row and merges a stale second-device delta', async () => {
    await applySyncOperation(client, { table: 'stocks', operation: 'INSERT', recordId: 'device-stock', record: { id: 'device-stock', product_id: 'p', branch_id: 'b', quantity: 9, _base_stock: { quantity: 10 } } })
    await applySyncOperation(client, { table: 'stocks', operation: 'INSERT', recordId: 'other-device', record: { id: 'other-device', product_id: 'p', branch_id: 'b', quantity: 8, _base_stock: { quantity: 10 } } })
    const [rows] = await connection.query('SELECT id,quantity FROM stocks')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('s1')
    expect(Number(rows[0].quantity)).toBe(7)
  })
  it('does not publish a deletion tombstone for a rolled-back foreign-key failure', async () => {
    const [before] = await connection.query('SELECT id FROM sync_deletions')
    await connection.query('CREATE TABLE qa_reference(id INT PRIMARY KEY,product_id VARCHAR(191),FOREIGN KEY(product_id) REFERENCES products(id))')
    await connection.query("INSERT INTO qa_reference VALUES (1,'p')")
    await expect(applySyncOperation(client, { table: 'products', operation: 'DELETE', recordId: 'p', record: {} })).rejects.toThrow()
    const [rows] = await connection.query('SELECT * FROM sync_deletions')
    expect(rows).toHaveLength(before.length)
  })
})
