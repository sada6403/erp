/* eslint-disable no-console */
// Seeds a LOCAL test company for the Natural Plantation mobile app. Local MySQL only. Never run against production.
//   npm run seed:app            (dev server on BASE_URL, default http://localhost:3000, must be running for the invite step)
import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { pool } from '../lib/db'
import { createTenant, deleteTenant } from '../lib/tenant'
import { ensureTenantCompatibility } from '../lib/auth'
import { hashPassword } from '../lib/app/security'

const BASE = process.env.SEED_BASE_URL || 'http://localhost:3000'
// SEED_FRESH=1: an isolated, uniquely named tenant (used by `npm test`, deleted afterwards with --cleanup).
// SEED_OUTPUT: where to write the details (default backend/.seed-output.json).
const FRESH = process.env.SEED_FRESH === '1'
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
const COMPANY_NAME = FRESH ? `App Test ${RUN}` : 'App Test Company'
const OUTPUT = process.env.SEED_OUTPUT || path.join(process.cwd(), '.seed-output.json')
const PASSWORD = 'Test@1234'

const host = String(process.env.MYSQL_HOST || '127.0.0.1')
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`Refusing to seed: MYSQL_HOST=${host} is not local.`)
  process.exit(1)
}

type Row = Record<string, unknown>
const colCache = new Map<string, Set<string>>()

async function ins(tp: Awaited<ReturnType<typeof ctx>>['tp'], schema: string, table: string, row: Row) {
  let cols = colCache.get(table)
  if (!cols) {
    const { rows } = await pool.query(`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [schema, table])
    cols = new Set((rows as Array<{ c: string }>).map(r => r.c))
    colCache.set(table, cols)
  }
  const keys = Object.keys(row).filter(k => cols!.has(k))
  await tp.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(k => row[k]))
}

async function ctx(schema: string) {
  const { tenantPool } = await import('../lib/db')
  return { tp: tenantPool(schema) }
}

async function cleanup() {
  const { readFile, rm } = await import('fs/promises')
  const out = JSON.parse(await readFile(OUTPUT, 'utf8')) as { company_id: string }
  const { rows } = await pool.query(`SELECT name FROM companies WHERE id = ?`, [out.company_id])
  const name = String((rows[0] as Row | undefined)?.name ?? '')
  if (!name.startsWith('App Test ') || name === 'App Test Company') { console.error(`Refusing to delete company "${name}": not a fresh test tenant.`); process.exit(1) }
  await deleteTenant(out.company_id)
  await rm(OUTPUT, { force: true })
  console.log(`Deleted test tenant ${name}`)
  process.exit(0)
}

async function main() {
  if (process.argv.includes('--cleanup')) return cleanup()
  const existing = FRESH ? { rows: [] } : await pool.query(`SELECT id, db_schema, api_key, app_key FROM companies WHERE name = ? LIMIT 1`, [COMPANY_NAME])
  if (existing.rows[0]) {
    console.log('Test company already exists. Re-using .seed-output.json from the earlier run (delete the company to reseed).')
    process.exit(0)
  }

  const t = await createTenant({
    name: COMPANY_NAME, email: `apptest-${RUN}@example.test`, adminEmail: `apptest-admin-${RUN}@example.test`, adminName: 'App Test Admin',
    adminPassword: 'Admin@12345', clearDataPassword: 'Clear@12345', trialDays: 365, createdBy: 'seed-app-test-company',
  })
  const appKey = 'npk_' + randomUUID().replace(/-/g, '')
  await pool.query(`UPDATE companies SET app_key = ? WHERE id = ?`, [appKey, t.companyId])
  await ensureTenantCompatibility(t.dbSchema)
  const { tp } = await ctx(t.dbSchema)
  const I = (table: string, row: Row) => ins(tp, t.dbSchema, table, row)

  // ── branches ──
  const br = await tp.query<Row>(`SELECT id FROM branches ORDER BY created_at, id LIMIT 1`)
  let b1 = br.rows[0] ? String(br.rows[0].id) : randomUUID()
  if (br.rows[0]) await tp.query(`UPDATE branches SET name = 'Colombo Main', address = '12 Galle Road, Colombo 03', phone = '0112345678', latitude = 6.9271, longitude = 79.8612 WHERE id = ?`, [b1])
  else await I('branches', { id: b1, name: 'Colombo Main', code: 'CMB', address: '12 Galle Road, Colombo 03', phone: '0112345678', latitude: 6.9271, longitude: 79.8612, is_active: 1 })
  const b2 = randomUUID()
  await I('branches', { id: b2, name: 'Kandy', code: 'KDY', address: '5 Peradeniya Road, Kandy', phone: '0812345678', latitude: 7.2906, longitude: 80.6337, is_active: 1 })

  // ── categories ──
  const cats = [['Groceries', 1], ['Plants & Seeds', 2], ['Garden Tools', 3]].map(([n, o]) => ({ id: randomUUID(), name: String(n), sort: Number(o) }))
  for (const c of cats) await I('categories', { id: c.id, name: c.name, sort_order: c.sort, is_active: 1 })

  // ── images ──
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')
  await mkdir(uploadDir, { recursive: true })
  const palette = ['#2e7d32', '#558b2f', '#9e9d24', '#ef6c00', '#6d4c41', '#00796b', '#5d4037', '#7cb342']
  const mkImg = async (i: number, label: string) => {
    const name = `seed-${i}.png`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="${palette[i % palette.length]}"/><text x="500" y="520" font-size="90" text-anchor="middle" fill="#fff" font-family="sans-serif">${label.replace(/[<&>]/g, '')}</text></svg>`
    await writeFile(path.join(uploadDir, name), await sharp(Buffer.from(svg)).png().toBuffer())
    return `/api/files/${name}`
  }

  // ── products ──
  type P = { name: string; cat: number; price: number; cost: number; weight?: boolean; variants?: Array<[string, number]>; disc?: number; emi?: boolean; stock?: number }
  const defs: P[] = [
    { name: 'Basmati Rice', cat: 0, price: 480, cost: 400, weight: true, stock: 200 },
    { name: 'Red Lentils', cat: 0, price: 360, cost: 300, weight: true, stock: 150 },
    { name: 'Coconut Oil 1L', cat: 0, price: 1250, cost: 1000, disc: 10 },
    { name: 'Ceylon Tea 400g', cat: 0, price: 950, cost: 700 },
    { name: 'Spice Mix Pack', cat: 0, price: 420, cost: 300 },
    { name: 'Jackfruit Seeds', cat: 1, price: 250, cost: 150, weight: true, stock: 40 },
    { name: 'Mango Sapling', cat: 1, price: 800, cost: 500, variants: [['Small', 800], ['Large', 1500]] },
    { name: 'Orchid Plant', cat: 1, price: 2200, cost: 1500, emi: true },
    { name: 'Tomato Seed Packet', cat: 1, price: 150, cost: 80 },
    { name: 'Organic Compost 5kg', cat: 1, price: 1100, cost: 800, disc: 5 },
    { name: 'Garden Shovel', cat: 2, price: 1800, cost: 1200 },
    { name: 'Pruning Shears', cat: 2, price: 2400, cost: 1700, emi: true },
    { name: 'Watering Can', cat: 2, price: 1300, cost: 900, variants: [['5L', 1300], ['10L', 1900], ['15L', 2500]] },
    { name: 'Garden Gloves', cat: 2, price: 650, cost: 400, variants: [['M', 650], ['L', 650]] },
    { name: 'Sprinkler Hose 20m', cat: 2, price: 3900, cost: 2800, stock: 0 },
  ]
  const productIds: string[] = []
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]
    const id = randomUUID()
    productIds.push(id)
    await I('products', {
      id, category_id: cats[d.cat].id, name: d.name, sku: `SEED-${String(i + 1).padStart(3, '0')}`, barcode: `890000${String(i + 1).padStart(4, '0')}`,
      description: `${d.name} - sample product for app testing.`, short_description: `${d.name}`, cost_price: d.cost, selling_price: d.price, tax_rate: 0,
      track_stock: 1, is_active: 1, is_online: 1, not_for_sale: 0, is_manage_stock: 1, sale_by: d.weight ? 'weight' : 'normal', unit: d.weight ? 'kg' : 'pcs',
      slug: d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), discount_pct: d.disc ?? 0, enable_emi: d.emi ? 1 : 0, product_type: d.variants ? 'variable' : 'simple',
      image_url: await mkImg(i, d.name),
    })
    if (d.variants) {
      for (let v = 0; v < d.variants.length; v++) {
        const vid = randomUUID()
        await I('product_variants', { id: vid, product_id: id, variant_name: d.variants[v][0], sku: `SEED-${String(i + 1).padStart(3, '0')}-V${v + 1}`, selling_price: d.variants[v][1], cost_price: d.cost, is_active: 1, sort_order: v })
        for (const b of [b1, b2]) await I('product_variant_stocks', { id: randomUUID(), variant_id: vid, product_id: id, branch_id: b, quantity: b === b1 ? 25 : 10, damaged_qty: 0 })
      }
    } else {
      for (const b of [b1, b2]) await I('stocks', { id: randomUUID(), product_id: id, branch_id: b, quantity: d.stock ?? (b === b1 ? 50 : 20), damaged_qty: 0 })
    }
  }

  // ── banner + settings ──
  await I('app_banners', { id: randomUUID(), title: 'Welcome to Natural Plantation', subtitle: 'Fresh from our farms', image_url: await mkImg(20, 'Welcome'), is_active: 1, sort_order: 1 }).catch(e => console.warn('banner skipped:', (e as Error).message))
  await tp.query(`INSERT INTO app_settings (id, setting_key, value) VALUES (?, 'default_branch_id', ?), (?, 'delivery_flat_fee', '250') ON DUPLICATE KEY UPDATE value = VALUES(value)`, ['default_branch_id', b1, 'delivery_flat_fee'])

  // ── customers ──
  const cust = [
    { id: randomUUID(), name: 'Anula Perera', phone: '0771110001', address: '10 Temple Road, Colombo 05' },
    { id: randomUUID(), name: 'Kamal Silva', phone: '0771110002', address: '22 Lake Drive, Kandy' },
    { id: randomUUID(), name: 'Nimal Fernando', phone: '0771110003', address: '8 Hill Street, Galle' },
    { id: randomUUID(), name: 'Sunil Jayasinghe', phone: '0771110004', address: '3 Beach Road, Matara' },
  ]
  for (const c of cust) await I('customers', { ...c, is_active: 1 })

  // ── agent ──
  const agentId = randomUUID()
  await I('agents', { id: agentId, code: 'AG001', name: 'Ruwan Agent', phone: '0779990001', branch_id: b1, default_commission_pct: 2, status: 'active' })

  // ── Smart Buy ──
  const schemeId = randomUUID()
  await I('chit_schemes', {
    id: schemeId, scheme_number: 'SB-0001', name: 'Garden Saver 4x4', branch_id: b1, agent_id: agentId, member_count: 4, cycle_count: 4, frequency: 'monthly',
    contribution_amount: 5000, chit_value: 20000, start_date: new Date(Date.now() - 70 * 86400000), next_draw_date: new Date(Date.now() + 10 * 86400000), status: 'active',
  })
  const memberIds: string[] = []
  for (let i = 0; i < 4; i++) {
    const mid = randomUUID()
    memberIds.push(mid)
    await I('chit_members', { id: mid, scheme_id: schemeId, customer_id: cust[i].id, agent_id: agentId, join_order: i + 1, contributions_paid: 10000, status: 'active', paper_reference_code: i === 0 ? 'PR-1001' : null })
    for (let cy = 1; cy <= 2; cy++) {
      await I('chit_contributions', { id: randomUUID(), scheme_id: schemeId, member_id: mid, cycle_no: cy, amount: 5000, method: 'cash', receipt_number: `RC-${i + 1}-${cy}`, status: 'approved', paid_at: new Date(Date.now() - (3 - cy) * 30 * 86400000) })
    }
  }
  await I('chit_draws', { id: randomUUID(), scheme_id: schemeId, cycle_no: 1, draw_date: new Date(Date.now() - 35 * 86400000), winner_member_id: memberIds[2], eligible_count: 4, method: 'random' })
  await I('chit_draws', { id: randomUUID(), scheme_id: schemeId, cycle_no: 2, draw_date: new Date(Date.now() - 5 * 86400000), winner_member_id: memberIds[0], eligible_count: 3, method: 'random' })
  await tp.query(`UPDATE chit_members SET won_cycle_no = 1 WHERE id = ?`, [memberIds[2]])
  await tp.query(`UPDATE chit_members SET won_cycle_no = 2 WHERE id = ?`, [memberIds[0]])
  const walletId = randomUUID()
  await I('smartbuy_wallet', { id: walletId, customer_id: cust[0].id, balance: 1500 })
  await I('smartbuy_wallet_transactions', { id: randomUUID(), wallet_id: walletId, customer_id: cust[0].id, transaction_type: 'credit', amount: 1500, balance_after: 1500, source: 'seed' })
  await I('commission_ledger', { id: randomUUID(), source_table: 'chit_contributions', source_id: randomUUID(), scheme_id: schemeId, member_id: memberIds[0], registration_agent_id: agentId, base_amount: 5000, registration_commission: 100, total_commission: 100, status: 'pending_manager_approval' })

  // ── app users ──
  const hash = await hashPassword(PASSWORD)
  const mkUser = async (name: string, phone: string, memberNo: string | null, roles: string[], customerId: string | null, agent: string | null) => {
    const id = randomUUID()
    await tp.query(
      `INSERT INTO app_users (id, phone, member_no, name, password_hash, must_change_password, customer_id, agent_id, roles, status, created_by_source) VALUES (?,?,?,?,?,0,?,?,?, 'active', 'seed')`,
      [id, phone, memberNo, name, hash, customerId, agent, JSON.stringify(roles)])
    return id
  }
  const uAnula = await mkUser(cust[0].name, cust[0].phone, 'NP-1', ['customer', 'smartbuy'], cust[0].id, null)
  const uNimal = await mkUser(cust[2].name, cust[2].phone, 'NP-3', ['customer', 'smartbuy'], cust[2].id, null)
  const uAgent = await mkUser('Ruwan Agent', '0779990001', null, ['agent'], null, agentId)

  // An order for Anula, packed and assigned to the agent (delivery completion tests).
  const orderId = randomUUID()
  const otpOrderNumber = `APP-SEED-${Date.now().toString(36).toUpperCase()}`
  await I('customer_orders', {
    id: orderId, order_number: otpOrderNumber, branch_id: b1, customer_id: cust[0].id, customer_name: cust[0].name, customer_phone: cust[0].phone,
    customer_address: cust[0].address, status: 'ready_for_delivery', payment_status: 'unpaid', total_amount: 1730, channel: 'app', app_user_id: uAnula,
    assigned_agent_id: agentId, delivery_fee: 250, payment_method: 'cod', status_history: JSON.stringify([{ status: 'pending', at: new Date().toISOString() }, { status: 'ready_for_delivery', at: new Date().toISOString() }]),
  })
  await I('customer_order_items', { id: randomUUID(), order_id: orderId, product_id: productIds[2], product_name: 'Coconut Oil 1L', quantity: 1, unit_price: 1125, line_total: 1125 })
  await I('customer_order_items', { id: randomUUID(), order_id: orderId, product_id: productIds[3], product_name: 'Ceylon Tea 400g', quantity: 1, unit_price: 355, line_total: 355 })

  // ── first-login invite via the real admin endpoint (temp password, must change) ──
  let invite: Row | null = null
  try {
    const res = await fetch(`${BASE}/api/app/v1/admin/app-access/invite`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': t.apiKey },
      body: JSON.stringify({ targets: [{ customer_id: cust[1].id }], download_link: 'https://example.test/app', sent_by: 'seed' }),
    })
    const json = (await res.json()) as { results?: Row[] }
    invite = json.results?.[0] ?? null
  } catch (e) {
    console.warn(`Invite step skipped (is the dev server running on ${BASE}?): ${(e as Error).message}`)
  }
  const msg = invite && typeof invite.message === 'string' ? invite.message : ''
  const tempPassword = /Temporary password: (\S+)/.exec(msg)?.[1] ?? null

  const out = {
    base_url: BASE, company_id: t.companyId, db_schema: t.dbSchema, pos_api_key: t.apiKey, app_key: appKey, password: PASSWORD,
    branches: { main: b1, kandy: b2 }, product_ids: productIds, scheme_id: schemeId, agent_id: agentId,
    logins: {
      customer_smartbuy: { identifier: cust[0].phone, member_no: 'NP-1', password: PASSWORD, user_id: uAnula, customer_id: cust[0].id },
      other_customer: { identifier: cust[2].phone, member_no: 'NP-3', password: PASSWORD, user_id: uNimal, customer_id: cust[2].id },
      agent: { identifier: 'AG001', phone: '0779990001', password: PASSWORD, user_id: uAgent },
      first_login_invite: { identifier: cust[1].phone, temp_password: tempPassword, user_id: invite?.user_id ?? null },
    },
    delivery_order_id: orderId,
    delivery_order_number: otpOrderNumber,
  }
  await writeFile(OUTPUT, JSON.stringify(out, null, 2))

  console.log('\n=== App test company seeded (LOCAL ONLY) ===')
  console.log('App Key        :', appKey)
  console.log('Base URL       :', BASE)
  console.log('Customer+SB    :', cust[0].phone, '(or NP-1)  /', PASSWORD)
  console.log('Other customer :', cust[2].phone, '(or NP-3)  /', PASSWORD)
  console.log('Agent          :', 'AG001 (or 0779990001)  /', PASSWORD)
  console.log('First-login    :', cust[1].phone, '/', tempPassword ?? '(invite skipped)')
  console.log('Details written to backend/.seed-output.json (gitignored)')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
