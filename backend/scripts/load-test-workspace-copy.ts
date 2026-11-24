/* eslint-disable no-console */
// LOCAL ONLY. Loads a read-only export of the desktop "test" company catalog (products, stocks, branches, categories)
// into a NEW local tenant "Test Copy (local)" so the mobile app can be checked against real product data.
// Never touches an existing company other than this copy. Usage:
//   node scripts/run-ts.cjs scripts/load-test-workspace-copy.ts <catalog.json>
import { randomUUID } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { pool, tenantPool } from '../lib/db'
import { createTenant } from '../lib/tenant'
import { ensureTenantCompatibility } from '../lib/auth'
import { hashPassword } from '../lib/app/security'

const NAME = 'Test Copy (local)'
const host = String(process.env.MYSQL_HOST || '127.0.0.1')
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) { console.error(`Refusing: MYSQL_HOST=${host} is not local.`); process.exit(1) }

type Row = Record<string, unknown>
const norm = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.replace('T', ' ').replace(/\.\d+Z$|Z$/, '') : v)

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error('usage: load-test-workspace-copy.ts <catalog.json>')
  const data = JSON.parse(await readFile(file, 'utf8')) as Record<string, Row[]>
  const existing = await pool.query(`SELECT id FROM companies WHERE name = ? LIMIT 1`, [NAME])
  if (existing.rows[0]) { console.error(`"${NAME}" already exists. Delete that company first to reload.`); process.exit(1) }
  const t = await createTenant({
    name: NAME, email: 'testcopy@example.test', adminEmail: 'testcopy-admin@example.test', adminName: 'Test Copy Admin',
    adminPassword: 'Admin@12345', clearDataPassword: 'Clear@12345', trialDays: 365, createdBy: 'load-test-workspace-copy',
  })
  const appKey = 'npk_' + randomUUID().replace(/-/g, '')
  await pool.query(`UPDATE companies SET app_key = ? WHERE id = ?`, [appKey, t.companyId])
  await ensureTenantCompatibility(t.dbSchema)
  const tp = tenantPool(t.dbSchema)
  const colCache = new Map<string, Set<string>>()
  const cols = async (table: string) => {
    let c = colCache.get(table)
    if (!c) {
      const { rows } = await pool.query(`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [t.dbSchema, table])
      c = new Set((rows as Array<{ c: string }>).map(r => r.c)); colCache.set(table, c)
    }
    return c
  }
  const ins = async (table: string, row: Row) => {
    const c = await cols(table)
    const keys = Object.keys(row).filter(k => c.has(k))
    await tp.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(k => norm(row[k])))
  }
  // The tenant ships with one branch; the copied stocks are mapped onto it.
  const { rows: br } = await tp.query<Row>(`SELECT id FROM branches ORDER BY created_at, id LIMIT 1`)
  const branchId = String(br[0].id)
  for (const r of data.categories ?? []) await ins('categories', r)
  for (const r of data.products ?? []) await ins('products', { ...r, branch_id: null })
  for (const r of data.stocks ?? []) await ins('stocks', { ...r, branch_id: branchId, warehouse_id: null })
  // one app customer + one agent login so ordering / delivery can be driven from the phone
  const pw = await hashPassword('Test@1234')
  const custId = randomUUID(); const agentId = randomUUID()
  await ins('customers', { id: custId, name: 'Copy Customer', phone: '0771110011', branch_id: branchId })
  await ins('agents', { id: agentId, code: 'AG001', name: 'Copy Agent', phone: '0779990011', branch_id: branchId, status: 'active' })
  const userId = randomUUID(); const agUser = randomUUID()
  await ins('app_users', { id: userId, phone: '0771110011', name: 'Copy Customer', password_hash: pw, must_change_password: 0, customer_id: custId, roles: JSON.stringify(['customer']), status: 'active', created_by_source: 'seed' })
  await ins('app_users', { id: agUser, phone: '0779990011', name: 'Copy Agent', password_hash: pw, must_change_password: 0, agent_id: agentId, roles: JSON.stringify(['agent']), status: 'active', created_by_source: 'seed' })
  const out = { base_url: process.env.SEED_BASE_URL || 'http://localhost:3000', company_id: t.companyId, db_schema: t.dbSchema, pos_api_key: t.apiKey, app_key: appKey, password: 'Test@1234', branch_id: branchId,
    products: (data.products ?? []).length, logins: { customer: '0771110011', agent: 'AG001' } }
  await writeFile(path.join(process.cwd(), '.seed-output-testcopy.json'), JSON.stringify(out, null, 2))
  console.log(`Loaded ${out.products} products, ${(data.stocks ?? []).length} stocks into ${t.dbSchema}`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
