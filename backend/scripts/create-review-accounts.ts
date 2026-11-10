/* eslint-disable no-console */
// Creates the Google Play REVIEWER accounts (customer, Smart Buy member, Field Officer) in ONE company.
// NOT RUN YET: for the real company, run only after Moni approves the production deploy.
//   dry run :  REVIEW_COMPANY_NAME="<company>" REVIEW_PASSWORD="<pw>" node scripts/run-ts.cjs scripts/create-review-accounts.ts
//   apply   :  ... REVIEW_CONFIRM_COMPANY="<company>" node scripts/run-ts.cjs scripts/create-review-accounts.ts --apply
// The password comes from the environment only (never hard-coded, never printed). Accounts are flagged
// app_users.is_review_account = 1 and their orders are tagged "[TEST ORDER - Play review]". Idempotent: re-running
// skips existing accounts; add --reset-password to set the password again. The Branch Manager account is created
// once the sales-force `staff` role exists (it is skipped with a note while `staff_assignments` is missing).
import { randomUUID } from 'crypto'
import { pool, tenantPool } from '../lib/db'
import { ensureTenantCompatibility } from '../lib/auth'
import { hashPassword } from '../lib/app/security'

const APPLY = process.argv.includes('--apply')
const RESET = process.argv.includes('--reset-password')
const company = process.env.REVIEW_COMPANY_NAME || ''
const password = process.env.REVIEW_PASSWORD || ''

type Row = Record<string, unknown>
type Acct = { name: string; phone: string; roles: string[]; member_no: string | null }
const CUSTOMER: Acct = { name: 'Play Review Customer', phone: '0700000101', roles: ['customer'], member_no: null }
const SMARTBUY: Acct = { name: 'Play Review Member', phone: '0700000102', roles: ['customer', 'smartbuy'], member_no: 'PR-SB1' }
const AGENT: Acct = { name: 'Play Review Officer', phone: '0700000103', roles: ['agent'], member_no: null }
const AGENT_CODE = 'AG-REVIEW'

async function main() {
  if (!company) throw new Error('Set REVIEW_COMPANY_NAME')
  if (password.length < 10) throw new Error('Set REVIEW_PASSWORD (at least 10 characters)')
  const c = await pool.query<Row>(`SELECT id, name, db_schema FROM companies WHERE name = ? AND status != 'cancelled'`, [company])
  if (c.rows.length !== 1) throw new Error(`Expected exactly one company named "${company}", found ${c.rows.length}`)
  const schema = String(c.rows[0].db_schema)
  console.log(`Company: ${company}   schema: ${schema}   mode: ${APPLY ? 'APPLY' : 'DRY RUN (nothing written)'}`)
  if (APPLY && process.env.REVIEW_CONFIRM_COMPANY !== company) throw new Error('Set REVIEW_CONFIRM_COMPANY to the exact company name to apply')

  await ensureTenantCompatibility(schema)
  const tp = tenantPool(schema)
  const find = async (phone: string) => (await tp.query<Row>(`SELECT id FROM app_users WHERE phone = ?`, [phone])).rows[0] ?? null
  const hash = await hashPassword(password)
  const branch = (await tp.query<Row>(`SELECT id FROM branches WHERE is_active = 1 ORDER BY created_at, id LIMIT 1`)).rows[0]
  if (!branch) throw new Error('Company has no active branch')
  const branchId = String(branch.id)
  const plan: string[] = []

  const mkUser = async (a: Acct, customerId: string | null, agentId: string | null) => {
    const found = await find(a.phone)
    if (found) {
      plan.push(`${a.phone} already exists`)
      if (RESET && APPLY) {
        await tp.query(`UPDATE app_users SET password_hash = ?, must_change_password = 0, failed_logins = 0, locked_until = NULL, is_review_account = 1 WHERE id = ?`, [hash, found.id])
        plan.push('  password reset')
      }
      return
    }
    plan.push(`create app user ${a.name} (${a.phone}) roles=${a.roles.join('+')}`)
    if (APPLY) {
      await tp.query(
        `INSERT INTO app_users (id, phone, member_no, name, password_hash, must_change_password, customer_id, agent_id, roles, status, created_by_source, is_review_account)
         VALUES (?,?,?,?,?,0,?,?,?, 'active', 'review', 1)`,
        [randomUUID(), a.phone, a.member_no, a.name, hash, customerId, agentId, JSON.stringify(a.roles)])
    }
  }

  // 1. plain customer (no POS customer link until the first order)
  await mkUser(CUSTOMER, null, null)

  // 2. Smart Buy member: a POS customer + one small demo scheme, all named "[PLAY REVIEW]" so staff can ignore them
  if (await find(SMARTBUY.phone)) {
    await mkUser(SMARTBUY, null, null)
  } else {
    const custId = randomUUID(), schemeAgentId = randomUUID(), schemeId = randomUUID(), memberId = randomUUID()
    plan.push('create POS customer, scheme agent and demo scheme [PLAY REVIEW] for the Smart Buy member')
    if (APPLY) {
      await tp.query(`INSERT INTO customers (id, name, phone, address, is_active) VALUES (?,?,?,?,1)`, [custId, SMARTBUY.name, SMARTBUY.phone, 'Play review account'])
      await tp.query(`INSERT INTO agents (id, code, name, phone, branch_id, default_commission_pct, status) VALUES (?,?,?,?,?,0,'active')`,
        [schemeAgentId, 'AG-REVSB', '[PLAY REVIEW] Scheme agent', '0700000199', branchId])
      await tp.query(
        `INSERT INTO chit_schemes (id, scheme_number, name, branch_id, agent_id, member_count, cycle_count, frequency, contribution_amount, chit_value, start_date, next_draw_date, status)
         VALUES (?,?,?,?,?,1,4,'monthly',1000,4000,?,?, 'active')`,
        [schemeId, 'SB-PLAYREVIEW', '[PLAY REVIEW] Demo scheme', branchId, schemeAgentId, new Date(Date.now() - 40 * 86400000), new Date(Date.now() + 20 * 86400000)])
      await tp.query(`INSERT INTO chit_members (id, scheme_id, customer_id, agent_id, join_order, contributions_paid, status, paper_reference_code) VALUES (?,?,?,?,1,2000,'active',?)`,
        [memberId, schemeId, custId, schemeAgentId, SMARTBUY.member_no])
      for (let cy = 1; cy <= 2; cy++) {
        await tp.query(`INSERT INTO chit_contributions (id, scheme_id, member_id, cycle_no, amount, method, receipt_number, status, paid_at) VALUES (?,?,?,?,1000,'cash',?, 'approved', ?)`,
          [randomUUID(), schemeId, memberId, cy, `RC-PR-${cy}`, new Date(Date.now() - (3 - cy) * 30 * 86400000)])
      }
    }
    await mkUser(SMARTBUY, custId, null)
  }

  // 3. Field officer
  if (await find(AGENT.phone)) {
    await mkUser(AGENT, null, null)
  } else {
    const agentId = randomUUID()
    plan.push(`create agent ${AGENT_CODE}`)
    if (APPLY) {
      await tp.query(`INSERT INTO agents (id, code, name, phone, branch_id, default_commission_pct, status) VALUES (?,?,?,?,?,0,'active')`,
        [agentId, AGENT_CODE, AGENT.name, AGENT.phone, branchId])
    }
    await mkUser(AGENT, null, agentId)
  }

  // 4. Branch Manager: needs the sales-force staff role (item 6)
  const staff = await tp.query<Row>(`SELECT 1 AS x FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'staff_assignments'`, [schema])
  plan.push(staff.rows[0]
    ? 'Branch Manager: staff_assignments exists - extend this script with the staff reviewer (sales force)'
    : 'Branch Manager: SKIPPED (sales-force staff role not deployed yet)')

  console.log('\n' + plan.join('\n'))
  console.log(APPLY
    ? '\nDone. Give Play Console the logins in docs/play/APP_ACCESS.md (password = the value you passed in REVIEW_PASSWORD).'
    : '\nDry run only. Re-run with --apply and REVIEW_CONFIRM_COMPANY to write.')
  process.exit(0)
}
main().catch(e => { console.error('FAILED:', (e as Error).message); process.exit(1) })
