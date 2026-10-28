---
name: app-api-endpoint
description: Add or change an endpoint under /api/app/v1 in the ERP backend (Next.js 15 + MySQL tenant DB) with App Key, JWT, role and owner scoping. Use for any server work the mobile app needs.
---

# App API endpoint

Repo: ERP (`erp/backend`). Route files: `backend/app/api/app/v1/<area>/<name>/route.ts`.
Shared helpers (create once, then reuse): `backend/lib/app/`.

## Steps

1. Read `docs/mobile-app/ARCHITECTURE.md` §5 for the endpoint. If it is not listed, add it there first.
   Then declare its request/response types in `backend/lib/app/contracts/<area>.ts`. These files are
   **type-only** (no runtime code, no imports from other backend files) because the React Native app
   imports them with `import type … from '@contracts/<area>'`. The route handler uses the same types.
2. Use the request pipeline below in this order. Never skip a step.
   1. Rate limit (`backend/lib/rateLimit.ts`).
   2. `resolveAppCompany(req)` → reads `x-app-key`, looks up `companies.app_key` (or the previous key
      while its grace period is active), rejects suspended/cancelled companies, returns `{ id, tp }`.
      Model it on `resolveCompany()` in `backend/lib/auth.ts`, but on a different column and header.
      NEVER accept `x-api-key` (the POS sync key) on app routes.
   3. Public routes stop here. Protected routes: `requireAppUser(req, company, roles?)` → verifies the
      JWT (`backend/lib/jwt.ts`, `portal === 'app'`, `company_id` must match), loads `app_users`
      (status `active`), and returns `{ userId, roles, customerId, agentId }`.
   4. Validate input (body, query, params): types, lengths, enums. Reject unknown fields.
   5. Query with `company.tp` / `withTenant()`. Ownership comes from the token, never from the body:
      - customer: `WHERE customer_id = ?` with `ctx.customerId`
      - agent: `WHERE agent_id = ?` (or `registration_agent_id` / `sales_agent_id` / `assigned_agent_id`)
        with `ctx.agentId`
   6. Map rows to a response DTO. Never return raw rows: no `cost_price`, no other users' phone/NIC,
      no internal notes.
3. Writes that move money or stock: use a transaction (`START TRANSACTION … COMMIT`), `SELECT … FOR UPDATE`,
   and an `Idempotency-Key` header stored in a receipts table (same idea as `sync_push_receipts`).
4. After a successful write that a user should hear about, call `enqueueNotification(...)`.
5. Error shape: `{ "error": { "code": "WALLET_INSUFFICIENT", "message": "..." } }` with a proper status
   (400 validation, 401 no/expired token, 403 wrong role/owner, 404, 409 conflict, 429, 500).
6. Add `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'` on routes reading
   live data.

## Skeleton

```ts
import { NextRequest, NextResponse } from 'next/server'
import { appLimiter } from '@/lib/rateLimit'
import { resolveAppCompany, requireAppUser, appError } from '@/lib/app/context'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const limited = appLimiter(req); if (limited) return limited
  const company = await resolveAppCompany(req)
  if (!company) return appError(401, 'APP_KEY_INVALID', 'Unknown app')
  const ctx = await requireAppUser(req, company, ['agent'])
  if (ctx instanceof NextResponse) return ctx
  const { rows } = await company.tp.query(
    `SELECT m.id, c.name, m.contributions_paid, m.won_cycle_no
       FROM chit_members m JOIN customers c ON c.id = m.customer_id
      WHERE m.agent_id = ? ORDER BY c.name LIMIT ?`,
    [ctx.agentId, 50]
  )
  return NextResponse.json({ items: rows.map(toMemberDto) })
}
```

## Tests (must exist before you say done)
- valid token of the right role → 200 with only own rows
- token of another role → 403
- another user's id in path/query → 403 or 404, never their data
- missing/expired token → 401; wrong `x-app-key` → 401
- `npm run typecheck` in `backend/` passes
