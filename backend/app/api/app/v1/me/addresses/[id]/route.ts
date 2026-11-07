import { appRoute, need } from '@/lib/app/context'
import { fail } from '@/lib/app/http'
import { parseAddressInput } from '@/lib/app/ordersLib'
import { addressToDto } from '@/lib/app/addressLib'
import type { AddressDto } from '@/lib/app/contracts/addresses'
import type { OkResponse } from '@/lib/app/contracts/common'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Ownership: every statement is bound to the token's user_id; another user's id is a 404.
export const PUT = appRoute({ auth: 'user', roles: ['customer'] }, async (c): Promise<AddressDto> => {
  const { company, user, params, body } = need(c)
  const a = parseAddressInput(await body())
  const own = await company.tp.query(`SELECT id FROM app_addresses WHERE id = ? AND user_id = ?`, [params.id, user.userId])
  if (!own.rows[0]) fail(404, 'NOT_FOUND', 'Address not found')
  if (a.is_default) await company.tp.query(`UPDATE app_addresses SET is_default = 0 WHERE user_id = ?`, [user.userId])
  await company.tp.query(
    `UPDATE app_addresses SET label=?, recipient_name=?, phone=?, line1=?, line2=?, city=?, district=?, postal_code=?, latitude=?, longitude=?, is_default=?
      WHERE id = ? AND user_id = ?`,
    [a.label, a.recipient_name, a.phone, a.line1, a.line2, a.city, a.district, a.postal_code, a.latitude, a.longitude, a.is_default ? 1 : 0, params.id, user.userId])
  const { rows } = await company.tp.query<Record<string, unknown>>(`SELECT * FROM app_addresses WHERE id = ?`, [params.id])
  return addressToDto(rows[0])
})

export const DELETE = appRoute({ auth: 'user', roles: ['customer'] }, async (c): Promise<OkResponse> => {
  const { company, user, params } = need(c)
  const r = await company.tp.query(`DELETE FROM app_addresses WHERE id = ? AND user_id = ?`, [params.id, user.userId])
  if (Number((r.rows as unknown as { affectedRows?: number }).affectedRows) === 0) fail(404, 'NOT_FOUND', 'Address not found')
  return { ok: true }
})
