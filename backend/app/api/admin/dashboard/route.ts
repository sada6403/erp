import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/rbac'
import { withTenant } from '@/lib/tenant'

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req)
  if ('error' in auth) return auth.error
  const companyId = auth.payload.company_id!

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
         FROM invoices WHERE status='completed'`,
        [today, today, monthStart, monthStart]
      ),
      client.query(`SELECT COUNT(*) as total, SUM(is_active) as active FROM customers`),
      client.query(`SELECT COUNT(*) as total, SUM(is_active) as active FROM products`),
      client.query(
        `SELECT
           SUM(status='active') as active, SUM(status='overdue') as overdue,
           COALESCE(SUM(CASE WHEN status IN ('active','overdue') THEN due_amount ELSE 0 END),0) as outstanding
         FROM installments`
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
