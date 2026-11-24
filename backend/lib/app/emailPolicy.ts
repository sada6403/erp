// Who may receive email from this deployment. Pure (no imports) so it is unit-tested without a database.
//
// EMAIL_MODE=production  -> every recipient gets mail; EMAIL_ALLOWLIST is ignored.
// anything else / unset  -> RESTRICTED: only addresses listed in EMAIL_ALLOWLIST (comma separated) are sent,
//                           all others are suppressed. Unknown or missing mode is restricted on purpose, so a
//                           staging copy holding real customer emails can never mail them by accident.
// NODE_ENV is NOT used: staging also runs `next start` with NODE_ENV=production.

export type EmailEnv = { EMAIL_MODE?: string; EMAIL_ALLOWLIST?: string }
export type EmailMode = 'production' | 'restricted'

export function resolveEmailMode(env: EmailEnv): EmailMode {
  return String(env.EMAIL_MODE ?? '').trim().toLowerCase() === 'production' ? 'production' : 'restricted'
}

export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(String(raw ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean))
}

export type DeliveryDecision = { action: 'send' | 'suppress'; mode: EmailMode; reason: 'production' | 'allow_listed' | 'not_allow_listed' }

export function decideDelivery(email: string, env: EmailEnv): DeliveryDecision {
  const mode = resolveEmailMode(env)
  if (mode === 'production') return { action: 'send', mode, reason: 'production' }
  const ok = parseAllowlist(env.EMAIL_ALLOWLIST).has(String(email ?? '').trim().toLowerCase())
  return ok ? { action: 'send', mode, reason: 'allow_listed' } : { action: 'suppress', mode, reason: 'not_allow_listed' }
}
