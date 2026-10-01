import { NextRequest, NextResponse } from 'next/server'
import { withTransaction } from '@/lib/db'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { createApprovalCode } from '@/lib/productKeyAccess'

type Params = { params: Promise<{ id: string }> }

type AccessRequestRow = {
  id: string
  company_id: string
  company_name: string
  device_name: string
  status: string
  expires_at: string
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { action?: string }
  const action = String(body.action || '')
  if (!['approve', 'deny'].includes(action)) {
    return NextResponse.json({ error: 'Action must be approve or deny' }, { status: 400 })
  }

  try {
    const response = await withTransaction(async client => {
      const { rows } = await client.query<AccessRequestRow>(
        `SELECT r.id, r.company_id, c.name AS company_name, r.device_name,
                r.status, r.expires_at
         FROM product_key_access_requests r
         JOIN companies c ON c.id = r.company_id
         WHERE r.id = ? LIMIT 1 FOR UPDATE`,
        [id]
      )
      const request = rows[0]
      if (!request) return { status: 404, body: { error: 'Access request not found' } }
      if (request.status !== 'pending') {
        return { status: 409, body: { error: `This request is already ${request.status}` } }
      }
      if (new Date(request.expires_at).getTime() <= Date.now()) {
        await client.query(`UPDATE product_key_access_requests SET status = 'expired' WHERE id = ?`, [id])
        return { status: 410, body: { error: 'This access request has expired' } }
      }

      if (action === 'deny') {
        await client.query(
          `UPDATE product_key_access_requests
           SET status = 'denied', approved_by = ?, approved_at = NOW()
           WHERE id = ? AND status = 'pending'`,
          [auth.payload.sub, id]
        )
        return {
          status: 200,
          body: { ok: true, status: 'denied', company_id: request.company_id },
        }
      }

      const approval = createApprovalCode()
      await client.query(
        `UPDATE product_key_access_requests
         SET status = 'approved', code_hash = ?, code_salt = ?, attempts = 0,
             approved_by = ?, approved_at = NOW(), expires_at = ?
         WHERE id = ? AND status = 'pending'`,
        [approval.hash, approval.salt, auth.payload.sub, approval.expiresAt, id]
      )
      return {
        status: 200,
        body: {
          ok: true,
          status: 'approved',
          code: approval.code,
          expires_at: approval.expiresAt.toISOString(),
          company_id: request.company_id,
          company_name: request.company_name,
          device_name: request.device_name,
        },
      }
    })

    const companyId = 'company_id' in response.body ? String(response.body.company_id) : null
    await auditLog({
      portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
      actorName: auth.payload.name, companyId,
      action: `product_key_access.${action}`,
      resource: 'product_key_access_requests', resourceId: id,
      newValues: { status: response.body.status },
    })
    return NextResponse.json(response.body, { status: response.status })
  } catch (error) {
    console.error('[superadmin product-key-access PATCH]', error)
    return NextResponse.json({ error: (error as Error).message || 'Unable to update access request' }, { status: 500 })
  }
}

