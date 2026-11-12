/* eslint-disable no-console */
// STAGING ONLY. After 07-copy-test-company.sh: upgrade the copied tenant schema to the current app schema and add one
// customer login + one agent login (password Test@1234) so the phone can sign in. Touches only the staging copy.
import { randomUUID } from 'crypto'
import { writeFile } from 'fs/promises'
import path from 'path'
import { pool, tenantPool } from '../lib/db'
import { ensureTenantCompatibility } from '../lib/auth'
import { hashPassword } from '../lib/app/security'

const host = String(process.env.MYSQL_HOST || '127.0.0.1')
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) { console.error(`Refusing: MYSQL_HOST=${host} is not local.`); process.exit(1) }
if (!/^pos_stg/.test(String(process.env.MYSQL_DATABASE || ''))) { console.error('Refusing: MYSQL_DATABASE is not a staging database.'); process.exit(1) }

type Row = Record<string, unknown>
async function main() {
  const { rows } = await pool.query(`SELECT id, db_schema, api_key, app_key FROM companies WHERE slug = 'test-1' LIMIT 1`)
  const c = rows[0] as Row | undefined
  if (!c || !String(c.db_schema).startsWith('pos_erp_app_test_company_')) throw new Error('staging copy of "test" not found')
  const schema = String(c.db_schema)
  await ensureTenantCompatibility(schema)
  const tp = tenantPool(schema)
  const { rows: br } = await tp.query<Row>(`SELECT id FROM branches ORDER BY created_at, id LIMIT 1`)
  if (!br[0]) throw new Error('copied tenant has no branch')
  const branchId = String(br[0].id)
  const cols = async (table: string) => new Set(((await pool.query(`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [schema, table])).rows as Array<{ c: string }>).map(r => r.c))
  const ins = async (table: string, row: Row) => {
    const have = await cols(table); const keys = Object.keys(row).filter(k => have.has(k))
    await tp.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(k => row[k]))
  }
  const pw = await hashPassword('Test@1234')
  const custId = randomUUID(); const agentId = randomUUID()
  await ins('customers', { id: custId, name: 'Copy Customer', phone: '0771110011', branch_id: branchId })
  await ins('agents', { id: agentId, code: 'AG001', name: 'Copy Agent', phone: '0779990011', branch_id: branchId, status: 'active' })
  await ins('app_users', { id: randomUUID(), phone: '0771110011', name: 'Copy Customer', password_hash: pw, must_change_password: 0, customer_id: custId, roles: JSON.stringify(['customer']), status: 'active', created_by_source: 'seed' })
  await ins('app_users', { id: randomUUID(), phone: '0779990011', name: 'Copy Agent', password_hash: pw, must_change_password: 0, agent_id: agentId, roles: JSON.stringify(['agent']), status: 'active', created_by_source: 'seed' })
  const { rows: pc } = await tp.query<Row>(`SELECT COUNT(*) AS n FROM products`)
  const out = { company_id: c.id, db_schema: schema, pos_api_key: c.api_key, app_key: c.app_key, password: 'Test@1234', branch_id: branchId,
    products: Number(pc[0].n), logins: { customer: '0771110011', agent: 'AG001' } }
  await writeFile(path.join(process.cwd(), '.seed-output-testcopy.json'), JSON.stringify(out, null, 2))
  console.log(`Staging copy ready: ${out.products} products in ${schema}`)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
