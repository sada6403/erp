import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/rbac'
import { withTenant } from '@/lib/tenant'

export async function GET(req: NextRequest) {
  const auth = requirePermission(req, 'reports')
  if ('error' in auth) return auth.error
  const companyId = auth.payload.company_id!

  const sp       = req.nextUrl.searchParams
  const type     = sp.get('type') ?? 'sales'
  const from     = sp.get('from') ?? new Date(Date.now() - 30*86400000).toISOString().split('T')[0]
  const to       = sp.get('to')   ?? new Date().toISOString().split('T')[0]
  const branchId = sp.get('branch_id')

  const data = await withTenant(companyId, async (client) => {
    const bf = branchId ? `AND i.branch_id = ?` : ''
    const bargs: unknown[] = branchId ? [branchId] : []

    if (type === 'sales') {
      const { rows } = await client.query(
        `SELECT DATE(i.created_at) as date, COUNT(*) as invoice_count,
                SUM(i.total) as revenue, SUM(i.discount) as discounts, b.name as branch_name
         FROM invoices i JOIN branches b ON b.id = i.branch_id
         WHERE i.status='completed' AND DATE(i.created_at) BETWEEN ? AND ? ${bf}
         GROUP BY DATE(i.created_at), b.name ORDER BY date DESC`,
        [from, to, ...bargs]
      )
      return rows
    }

    if (type === 'installments') {
      const { rows } = await client.query(
        `SELECT
           SUM(status='active') as active, SUM(status='overdue') as overdue,
           SUM(status='completed') as completed,
           COALESCE(SUM(due_amount),0) as total_outstanding,
           COALESCE((SELECT SUM(amount) FROM installment_payments ip
                     WHERE ip.status='approved' AND DATE(ip.created_at) BETWEEN ? AND ?),0) as collections
         FROM installments`,
        [from, to]
      )
      return rows[0]
    }

    if (type === 'staff') {
      const { rows } = await client.query(
        `SELECT u.name as cashier, COUNT(i.id) as invoices, COALESCE(SUM(i.total),0) as revenue
         FROM invoices i JOIN users u ON u.id = i.cashier_id
         WHERE i.status='completed' AND DATE(i.created_at) BETWEEN ? AND ? ${bf}
         GROUP BY u.name ORDER BY revenue DESC`,
        [from, to, ...bargs]
      )
      return rows
    }

    return []
  })

  return NextResponse.json({ type, from, to, data })
}
