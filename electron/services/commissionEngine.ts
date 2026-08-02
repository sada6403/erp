import crypto from 'crypto'
import type { getDb } from '../database'

function money(value: number): number {
  return Math.round(value * 100) / 100
}

// A rule matches at exactly one specificity level (product > category >
// brand > scheme > global). The highest-ranked active non-bonus rule wins
// as the "base" line; every matching active bonus/campaign rule stacks on
// top of it as its own additional line.
export function findCommissionRules(
  db: ReturnType<typeof getDb>,
  opts: { productId?: string | null; schemeId?: string | null }
): { base: Record<string, unknown> | undefined; bonuses: Record<string, unknown>[] } {
  const product = opts.productId
    ? db.prepare('SELECT id, category_id, brand FROM products WHERE id=?').get(opts.productId) as { id: string; category_id: string | null; brand: string | null } | undefined
    : undefined
  const now = new Date().toISOString()
  const rules = db.prepare(`
    SELECT * FROM commission_rules
    WHERE status='active' AND (active_from IS NULL OR active_from <= ?) AND (active_to IS NULL OR active_to >= ?)
  `).all(now, now) as Record<string, unknown>[]

  const rank = (r: Record<string, unknown>): number => {
    if (r.scope === 'product' && product && r.product_id === product.id) return 4
    if (r.scope === 'category' && product?.category_id && r.category_id === product.category_id) return 3
    if (r.scope === 'brand' && product?.brand && r.brand === product.brand) return 2
    if (r.scope === 'scheme' && opts.schemeId && r.scheme_id === opts.schemeId) return 1
    if (r.scope === 'global') return 0
    return -1
  }
  const matching = rules.filter(r => rank(r) >= 0)
  const bases = matching.filter(r => !r.is_bonus)
    .sort((a, b) => (rank(b) - rank(a)) || (Number(b.priority) - Number(a.priority)) || String(b.created_at).localeCompare(String(a.created_at)))
  return { base: bases[0], bonuses: matching.filter(r => r.is_bonus) }
}

// Splits one rule's commission between a registration-role agent and a
// sales-role agent — the two-agent scenario ("Agent A registered, Agent B
// sold/collected") the spec calls out explicitly. If the model calls for a
// role with no agent assigned, the whole commission collapses to whichever
// role IS assigned rather than being lost.
export function splitCommissionRule(
  rule: Record<string, unknown>, amount: number, registrationAgentId: string | null, salesAgentId: string | null
): { registrationCommission: number; salesCommission: number } {
  const commissionValue = rule.calculation_type === 'fixed'
    ? Number(rule.rate) || 0
    : money(amount * (Number(rule.rate) || 0) / 100)
  let regPct = 0
  let salesPct = 0
  if (rule.ownership_model === 'sales') salesPct = 100
  else if (rule.ownership_model === 'split') {
    regPct = Number(rule.registration_share_pct) || 0
    salesPct = Number(rule.sales_share_pct) || 0
  } else regPct = 100 // 'registration' (default)
  if (!registrationAgentId && salesAgentId) { salesPct += regPct; regPct = 0 }
  if (!salesAgentId && registrationAgentId) { regPct += salesPct; salesPct = 0 }
  return {
    registrationCommission: registrationAgentId ? money(commissionValue * regPct / 100) : 0,
    salesCommission: salesAgentId ? money(commissionValue * salesPct / 100) : 0,
  }
}

// Computes commission for one sale event (a POS invoice line, or a SmartBuy
// redemption), writes one commission_ledger row per contributing rule (base
// + any stacked bonuses, each individually approvable/payable), and returns
// the total plus sync-queue entries for the caller to enqueue alongside its
// own transaction's rows. A product/line with no matching active rule earns
// zero commission — there is no flat-percentage fallback.
export function computeAndRecordCommission(
  db: ReturnType<typeof getDb>,
  opts: {
    sourceTable: string; sourceId: string; productId: string | null; schemeId: string | null; memberId: string | null
    registrationAgentId: string | null; salesAgentId: string | null; amount: number; branchId: unknown
  }
): { totalCommission: number; enqueue: Array<{ table: string; id: string; row: Record<string, unknown>; op: 'INSERT' }> } {
  const { sourceTable, sourceId, productId, schemeId, memberId, registrationAgentId, salesAgentId, amount, branchId } = opts
  const enqueue: Array<{ table: string; id: string; row: Record<string, unknown>; op: 'INSERT' }> = []
  if (amount <= 0) return { totalCommission: 0, enqueue }
  if (!registrationAgentId && !salesAgentId) return { totalCommission: 0, enqueue }
  const { base, bonuses } = findCommissionRules(db, { productId, schemeId })
  if (!base && bonuses.length === 0) return { totalCommission: 0, enqueue }

  const lines: Array<{ ruleId: string | null; isBonus: boolean; registrationCommission: number; salesCommission: number }> = []
  if (base) {
    const split = splitCommissionRule(base, amount, registrationAgentId, salesAgentId)
    lines.push({ ruleId: String(base.id), isBonus: false, registrationCommission: split.registrationCommission, salesCommission: split.salesCommission })
  }
  for (const bonus of bonuses) {
    const split = splitCommissionRule(bonus, amount, registrationAgentId, salesAgentId)
    if (split.registrationCommission > 0 || split.salesCommission > 0) {
      lines.push({ ruleId: String(bonus.id), isBonus: true, registrationCommission: split.registrationCommission, salesCommission: split.salesCommission })
    }
  }

  let totalCommission = 0
  for (const line of lines) {
    if (line.registrationCommission <= 0 && line.salesCommission <= 0) continue
    const id = crypto.randomUUID()
    const totalLine = money(line.registrationCommission + line.salesCommission)
    const row = {
      id, source_table: sourceTable, source_id: sourceId, scheme_id: schemeId, member_id: memberId,
      rule_id: line.ruleId, is_bonus: line.isBonus ? 1 : 0,
      registration_agent_id: line.registrationCommission > 0 ? registrationAgentId : null,
      sales_agent_id: line.salesCommission > 0 ? salesAgentId : null,
      base_amount: amount, registration_commission: line.registrationCommission, sales_commission: line.salesCommission,
      total_commission: totalLine, status: 'pending_manager_approval', branch_id: branchId || null,
    }
    db.prepare(`
      INSERT INTO commission_ledger
        (id, source_table, source_id, scheme_id, member_id, rule_id, is_bonus, registration_agent_id, sales_agent_id,
         base_amount, registration_commission, sales_commission, total_commission, status, branch_id)
      VALUES (@id,@source_table,@source_id,@scheme_id,@member_id,@rule_id,@is_bonus,@registration_agent_id,@sales_agent_id,
         @base_amount,@registration_commission,@sales_commission,@total_commission,@status,@branch_id)
    `).run(row)
    enqueue.push({ table: 'commission_ledger', id, row, op: 'INSERT' })

    // First entry in the commission's structured audit trail — satisfies
    // "Generated by: System" (changed_by=NULL reads as system-generated).
    const logId = crypto.randomUUID()
    const logRow = {
      id: logId, commission_id: id,
      agent_id: (row.registration_agent_id || row.sales_agent_id || null) as string | null,
      branch_id: branchId || null, action: 'GENERATED', previous_status: null,
      new_status: 'pending_manager_approval', changed_by: null, remarks: null,
    }
    db.prepare(`
      INSERT INTO commission_approval_logs
        (id, commission_id, agent_id, branch_id, action, previous_status, new_status, changed_by, remarks)
      VALUES (@id,@commission_id,@agent_id,@branch_id,@action,@previous_status,@new_status,@changed_by,@remarks)
    `).run(logRow)
    enqueue.push({ table: 'commission_approval_logs', id: logId, row: logRow, op: 'INSERT' })

    totalCommission += totalLine
  }
  return { totalCommission: money(totalCommission), enqueue }
}
