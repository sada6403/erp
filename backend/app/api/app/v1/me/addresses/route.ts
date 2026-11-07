import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { appRoute, need } from '@/lib/app/context'
import { fail } from '@/lib/app/http'
import { parseAddressInput } from '@/lib/app/ordersLib'
import { addressToDto } from '@/lib/app/addressLib'
import type { AddressesResponse } from '@/lib/app/contracts/addresses'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['customer'] }, async (c): Promise<AddressesResponse> => {
  const { company, user } = need(c)
  const { rows } = await company.tp.query<Record<string, unknown>>(`SELECT * FROM app_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC`, [user.userId])
  return { items: rows.map(addressToDto) }
})

export const POST = appRoute({ auth: 'user', roles: ['customer'] }, async (c) => {
  const { company, user, body } = need(c)
  const a = parseAddressInput(await body())
  const count = await company.tp.query<{ n: string }>(`SELECT COUNT(*) AS n FROM app_addresses WHERE user_id = ?`, [user.userId])
  if (Number(count.rows[0].n) >= 10) fail(400, 'VALIDATION', 'You can save up to 10 addresses')
  const id = randomUUID()
  const makeDefault = a.is_default || Number(count.rows[0].n) === 0
  if (makeDefault) await company.tp.query(`UPDATE app_addresses SET is_default = 0 WHERE user_id = ?`, [user.userId])
  await company.tp.query(
    `INSERT INTO app_addresses (id, user_id, label, recipient_name, phone, line1, line2, city, district, postal_code, latitude, longitude, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, user.userId, a.label, a.recipient_name, a.phone, a.line1, a.line2, a.city, a.district, a.postal_code, a.latitude, a.longitude, makeDefault ? 1 : 0])
  const { rows } = await company.tp.query<Record<string, unknown>>(`SELECT * FROM app_addresses WHERE id = ?`, [id])
  return NextResponse.json(addressToDto(rows[0]), { status: 201 })
})
