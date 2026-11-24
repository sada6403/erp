import { appRoute, need } from '@/lib/app/context'
import { only } from '@/lib/app/http'
import { readTargetBody, requireScope, setTarget, strictDescendant, targetHistory, visible } from '@/lib/app/staffLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async c => {
  const { company, user, params } = need(c)
  const scope = await requireScope(company, user)
  visible(scope, params.id)
  return { items: await targetHistory(company, params.id) }
})

// Only a strict descendant's target can be set: nobody raises their own, a peer's or a boss's target.
export const POST = appRoute({ auth: 'user', roles: ['agent'] }, async c => {
  const { company, user, params, body } = need(c)
  const scope = await requireScope(company, user)
  strictDescendant(scope, params.id)
  const b = await body()
  only(b, ['period', 'amount', 'registrations_target'])
  const t = readTargetBody(b)
  const out = await setTarget(company, user.userId, params.id, t.period, t.amount, t.regs)
  return { ok: true, id: out.id }
})
