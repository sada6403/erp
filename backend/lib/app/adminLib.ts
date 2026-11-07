// Admin (POS desktop) endpoints authenticate with the company sync key (x-api-key), NOT the app key.
import { NextRequest } from 'next/server'
import { resolveCompany, AccountStatusError, ensureTenantCompatibility } from '../auth'
import type { AppCompany } from './context'
import { fail } from './http'

export async function resolveAdminCompany(req: NextRequest): Promise<AppCompany> {
  let c
  try {
    c = await resolveCompany(req)
  } catch (e) {
    if (e instanceof AccountStatusError) fail(403, 'COMPANY_SUSPENDED', e.message)
    throw e
  }
  if (!c) fail(401, 'UNAUTHORIZED', 'Invalid API key')
  await ensureTenantCompatibility(c.dbSchema)
  return { id: c.id, dbSchema: c.dbSchema, name: c.name, slug: c.slug, tp: c.tp }
}
