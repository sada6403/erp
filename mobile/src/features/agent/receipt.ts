import type { AgentBillDto } from '@/api/localTypes';
import type { LocalReceipt } from '@/store/collectionStore';
import { formatQty } from '@/lib/money';
import { colomboParts } from '@/lib/format';

/** 58mm ESC/POS paper = 32 columns. Printed text is fixed English, as on the demo receipt. */
export const RECEIPT_WIDTH = 32;
const EQ = '='.repeat(RECEIPT_WIDTH);
const DASH = '-'.repeat(RECEIPT_WIDTH);

export const center = (s: string, w = RECEIPT_WIDTH) => ' '.repeat(Math.max(0, Math.floor((w - s.length) / 2))) + s;

const grouped = (n: number) => Math.round(n).toLocaleString('en-US');
/** "Rs  2,450" right aligned in 9 columns. */
const rs = (n: number, prefix = 'Rs') => `${prefix}${grouped(n).padStart(7)}`;
const totalRow = (label: string, text: string) => `${label.padEnd(21)}:${text.padStart(13)}`;

function wrapName(name: string, width = 20): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of name.split(/\s+/)) {
    if (cur && (cur + ' ' + word).length > width) {
      out.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) out.push(cur);
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
function stamp(iso: string): string {
  // Sri Lanka time whatever the phone's timezone is (server sends UTC).
  const p = colomboParts(iso);
  if (!p) return '';
  const h = p.hour;
  return `${p.year}-${pad2(p.month + 1)}-${pad2(p.day)}  ${pad2(h % 12 === 0 ? 12 : h % 12)}:${pad2(p.minute)} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Thermal receipt text for a delivery bill (same layout as the demo billModal). Shows bill_no as the invoice number. */
export function buildBillText(b: AgentBillDto & { tagline?: string | null }): string {
  const out: string[] = [EQ, center(b.company_name.toUpperCase())];
  if (b.tagline) out.push(center(b.tagline));
  const branch = [b.branch_name, b.branch_phone ? `Tel: ${b.branch_phone}` : null].filter(Boolean).join(' • ');
  if (branch) out.push(center(branch));
  if (b.company_tin) out.push(center(`Reg: ${b.company_tin}`));
  out.push(EQ);
  out.push(`Bill No   : ${b.bill_no}`);
  out.push(`Order ID  : ${b.order_number}`);
  out.push(`Date      : ${stamp(b.date)}`);
  out.push(`Agent     : ${b.agent_name} (${b.agent_code})`);
  out.push(`Customer  : ${b.customer_name}`);
  if (b.address) out.push(`Address   : ${b.address}`);
  out.push(DASH, 'ITEM               QTY    AMOUNT', DASH);
  for (const l of b.lines) {
    const parts = wrapName(l.name);
    out.push(...parts.slice(0, -1));
    const q = formatQty(l.quantity, l.unit).replace(/\s+/g, '');
    out.push(`${(parts[parts.length - 1] ?? '').padEnd(21)}${q.padEnd(5)}Rs ${grouped(l.line_total).padStart(6)}`);
  }
  out.push(DASH, totalRow('Subtotal', rs(b.subtotal)));
  if (b.discount > 0) out.push(totalRow('Discount', rs(b.discount, '-Rs')));
  out.push(totalRow('Delivery Fee', rs(b.delivery_fee)), DASH, totalRow(`TOTAL (${b.payment_label})`, rs(b.total)), EQ);
  if (b.paid_in_full) out.push(center('PAID IN FULL - CASH RECEIVED'));
  if (b.otp) out.push(center(`CUSTOMER OTP: ${b.otp}`));
  if (b.footer_note) out.push(...wrapName(b.footer_note, RECEIPT_WIDTH).map((l) => center(l)));
  out.push(...wrapName(`Thank you for choosing ${b.company_name}!`, RECEIPT_WIDTH).map((l) => center(l)), EQ);
  return out.join('\n');
}

/** Exactly 32 columns (the bill's totalRow is wider than the paper). */
const amountRow = (label: string, text: string) => `${label.padEnd(18)}:${text.padStart(13)}`;

const STATUS_LINE: Record<LocalReceipt['status'], string> = {
  queued: 'SAVED ON PHONE - NOT SENT YET',
  pending_verification: 'PENDING VERIFICATION',
  approved: 'PAID - VERIFIED',
  rejected: 'NOT ACCEPTED - SEE AGENT',
};

/** Thermal receipt text for Smart Buy cash taken from a member (company, member, scheme, cycle, amount, balance, agent, Colombo time). Printed text is English. */
export function buildCollectionText(r: LocalReceipt, company?: { tin?: string | null; phone?: string | null } | null): string {
  const out: string[] = [EQ, center((r.company_name || 'RECEIPT').toUpperCase())];
  const branch = [r.branch_name, company?.phone ? `Tel: ${company.phone}` : null].filter(Boolean).join(' • ');
  if (branch) out.push(center(branch));
  if (company?.tin) out.push(center(`Reg: ${company.tin}`));
  out.push(EQ, center('SMART BUY PAYMENT RECEIPT'), DASH);
  out.push(`Receipt No: ${r.receipt_number}`);
  out.push(`Date      : ${stamp(r.collected_at)}`);
  out.push(`Member    : ${r.customer_name}`);
  out.push(...wrapName(r.scheme_name, 22).map((l, i) => `${i === 0 ? 'Scheme    : ' : '            '}${l}`));
  if (r.cycle_no) out.push(`Cycle     : ${r.cycle_no}`);
  out.push(`Agent     : ${r.agent_name} (${r.agent_code})`, DASH);
  out.push(amountRow('Amount received', rs(r.amount)));
  if (r.late_fee_applied > 0) out.push(amountRow('  incl. late fee', rs(r.late_fee_applied)));
  out.push(amountRow('Balance this cycle', rs(r.balance_after)), EQ, center(STATUS_LINE[r.status]));
  out.push(...wrapName('Payments are final once verified by the branch.', RECEIPT_WIDTH).map((l) => center(l)));
  out.push(...wrapName(`Thank you for choosing ${r.company_name || 'us'}!`, RECEIPT_WIDTH).map((l) => center(l)), EQ);
  return out.join('\n');
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);

/** Same text, as a monospace HTML page for the PDF share. */
export function textToHtml(text: string): string {
  return `<html><body style="margin:0"><pre style="font-family:monospace;font-size:12px;line-height:1.35;margin:8px">${esc(text)}</pre></body></html>`;
}
