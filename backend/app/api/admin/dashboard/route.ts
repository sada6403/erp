import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/rbac'
import { withTenant } from '@/lib/tenant'

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req)
  if ('error' in auth) return auth.error
  const companyId = auth.payload.company_id!

  // A branch-scoped admin (Branch Manager) must only see their own branch's
  // figures — this previously always aggregated the whole company regardless
  // of who was asking, with no permission check at all beyond "is an admin
  // portal session". `branch_id` is null on the JWT for a company-wide
  // Company Admin, so this only narrows the query for genuinely
  // branch-scoped callers.
  const branchId = auth.payload.branch_id

  const stats = await withTenant(companyId, async (client) => {
    const today = new Date().toISOString().split('T')[0]
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]

    const [sales, customers, products, installments] = await Promise.all([
      client.query(
        `SELECT
           SUM(CASE WHEN DATE(created_at)=? THEN 1 ELSE 0 END) as today_count,
           COALESCE(SUM(CASE WHEN DATE(created_at)=? THEN total ELSE 0 END),0) as today_revenue,
           SUM(CASE WHEN DATE(created_at)>=? THEN 1 ELSE 0 END) as month_count,
           COALESCE(SUM(CASE WHEN DATE(created_at)>=? THEN total ELSE 0 END),0) as month_revenue
         FROM invoices WHERE status='completed' ${branchId ? 'AND branch_id = ?' : ''}`,
        branchId ? [today, today, monthStart, monthStart, branchId] : [today, today, monthStart, monthStart]
      ),
      client.query(
        `SELECT COUNT(*) as total, SUM(is_active) as active FROM customers
         ${branchId ? 'WHERE branch_id = ? OR branch_id IS NULL' : ''}`,
        branchId ? [branchId] : []
      ),
      client.query(
        `SELECT COUNT(*) as total, SUM(is_active) as active FROM products
         ${branchId ? 'WHERE branch_id = ? OR branch_id IS NULL' : ''}`,
        branchId ? [branchId] : []
      ),
      client.query(
        `SELECT
           SUM(status='active') as active, SUM(status='overdue') as overdue,
           COALESCE(SUM(CASE WHEN status IN ('active','overdue') THEN due_amount ELSE 0 END),0) as outstanding
         FROM installments ${branchId ? 'WHERE branch_id = ?' : ''}`,
        branchId ? [branchId] : []
      ),
    ])
    return {
      sales:        sales.rows[0],
      customers:    customers.rows[0],
      products:     products.rows[0],
      installments: installments.rows[0],
    }
  })

  return NextResponse.json(stats)
}
