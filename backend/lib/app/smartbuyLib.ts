import type { AppCompany, AppUserCtx } from './context'
import { fail, round2, toIso } from './http'
import { getModules } from './settings'
import type { MySchemeDto } from './contracts/smartbuy'

export async function requireSmartBuy(company: AppCompany, user: AppUserCtx): Promise<string> {
  if (!(await getModules(company)).smartbuy) fail(403, 'MODULE_DISABLED', 'Smart Buy is not available.')
  if (!user.customerId) fail(403, 'FORBIDDEN', 'Not allowed for this account')
  return user.customerId
}

export function freq(v: unknown): 'weekly' | 'monthly' {
  return String(v) === 'weekly' ? 'weekly' : 'monthly'
}

export function mySchemeDto(r: Record<string, unknown>): MySchemeDto {
  const status = String(r.status)
  return {
    member_id: String(r.member_id), scheme_id: String(r.scheme_id),
    scheme_number: r.scheme_number ? String(r.scheme_number) : null, name: String(r.name),
    frequency: freq(r.frequency), contribution_amount: Number(r.contribution_amount), chit_value: Number(r.chit_value),
    cycle_count: Number(r.cycle_count), cycles_paid: Number(r.cycles_paid) || 0,
    contributions_paid: round2(Number(r.contributions_paid) || 0), next_draw_date: toIso(r.next_draw_date),
    status, badge: status === 'active' ? 'Active' : status.charAt(0).toUpperCase() + status.slice(1),
    won_cycle_no: r.won_cycle_no != null ? Number(r.won_cycle_no) : null, agent_name: r.agent_name ? String(r.agent_name) : null,
  }
}

/** "K. Ra... - Member #12" */
export function maskedWinner(name: string, joinOrder: number): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0] || ''
  const rest = parts.slice(1).join(' ')
  return `${first.charAt(0).toUpperCase()}. ${(rest || first).slice(0, 2)}... - Member #${joinOrder}`
}
