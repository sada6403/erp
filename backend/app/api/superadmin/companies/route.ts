import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { createTenant, listCompanies } from '@/lib/tenant'

export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  try {
    const sp = req.nextUrl.searchParams
    const result = await listCompanies({
      page:   Number(sp.get('page')  ?? 1),
      limit:  Number(sp.get('limit') ?? 20),
      search: sp.get('search') ?? undefined,
      status: sp.get('status') ?? undefined,
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[companies GET]', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const body = await req.json()
  const { name, email, phone, address, timezone, currency, country,
          adminEmail, adminName, adminPhone, adminPassword,
          packageId, trialDays, notes,
          maxBranches, maxUsers, maxPosDevices, maxStorageGb } = body

  if (!name || !email || !adminEmail || !adminName) {
    return NextResponse.json({ error: 'name, email, adminEmail, adminName required' }, { status: 400 })
  }
  if (!adminPassword || adminPassword.length < 8) {
    return NextResponse.json({ error: 'adminPassword must be at least 8 characters' }, { status: 400 })
  }

  const result = await createTenant({
    name, email, phone, address, timezone, currency, country,
    adminEmail, adminName, adminPhone, adminPassword,
    packageId, trialDays,
    createdBy: auth.payload.sub, notes,
    maxBranches, maxUsers, maxPosDevices, maxStorageGb,
  })

  await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
    actorName: auth.payload.name, action: 'company.create',
    resource: 'companies', resourceId: result.companyId, companyId: result.companyId,
    newValues: { name, email, adminEmail, slug: result.slug } })

  return NextResponse.json({ ...result, company_key: result.companyKey, adminEmail }, { status: 201 })
}
