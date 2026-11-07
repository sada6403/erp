/**
 * Dev-mock only: the demo's monthly commission statement text (showCommissionStatement). The PDF slip has no
 * backend yet, so this module is only required from a `MOCK_FEATURES` branch and never runs in production.
 */
import { center } from './receipt';
import type { AgentExtras, CommissionView } from './types';

const EQ = '='.repeat(32);
const DASH = '-'.repeat(32);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const grouped = (n: number) => Math.round(n).toLocaleString('en-US');

export function buildStatementText(args: { agentName: string; agentCode: string; extras?: AgentExtras; commission: CommissionView }): string {
  const { agentName, agentCode, extras: x, commission: c } = args;
  const [y, m] = c.month.split('-').map(Number);
  const month = MONTHS[(m || 1) - 1];
  const last = new Date(y, m, 0).getDate();
  const out = [
    EQ,
    center('NATURAL PLANTATION (PVT) LTD'),
    center(`${x?.branch_name ?? ''} • Agent ${agentCode}`),
    center('MONTHLY COMMISSION STATEMENT'),
    center(`Period: ${month} 01 - ${month} ${last}, ${y}`),
    EQ,
    `Agent Name : ${agentName}`,
    `Status     : ${x?.rank_label ?? ''}${x?.rank_detail ? ` (${x.rank_detail.split(' in ')[0]})` : ''}`,
    `Customers  : ${x?.families_served ?? 0} Families Served`,
    `Members    : ${x?.smartbuy_members ?? 0} Active Scheme Enrollees`,
    DASH,
    'EARNINGS BREAKDOWN:',
    ...c.rows.map((r, i) => `${i + 1}. ${r.source}\n${' '.repeat(26)}Rs ${grouped(r.amount).padStart(6)}`),
    DASH,
    `TOTAL MONTH COMMISSION          : Rs ${grouped(c.total)}`,
    EQ,
    'Payment Method: Direct Bank Transfer',
    'Approval      : Branch Manager Verified ✓',
    EQ,
  ];
  return out.join('\n');
}
