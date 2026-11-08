---
name: sales-force
description: Sales-force hierarchy (Director to Field Officer), subtree scoping, monthly targets, salary and commission by achievement, field visits and reminders, agent-initiated Smart Buy join, and hosted card payment. Use for any work on staff levels, targets, visits, payroll or the card payment page.
---

# Sales force

Design lives in `docs/mobile-app/ARCHITECTURE.md` section 18. Defaults and open questions are in `DECISIONS.md` (2026-11-08).

## Levels and scope
Director, AGM, Manager (company), Zonal Manager (zone), Regional Manager (region), Branch Manager (branch), Field Officer (self, an `agents` row).
Hierarchy comes only from `staff_assignments` (staff_id, level_key, scope, reports_to_staff_id, active_from, active_to).

## Rules
1. **Scope is resolved on the server** by `scopeOf(user)` on every request from `staff_assignments`. Never accept a staff id, zone, region or branch from the client as authority and never put scope in the JWT.
2. Every manager query filters on the caller's subtree. An id outside it answers 404 (not 403).
3. Mutations (targets, reassign, activate/deactivate) only on **strict descendants**, always with an `audit_logs` row. Nobody changes their own target or salary.
4. **Salary and commission data** are visible only to the person, their chain upward, and HR/admin (`all` permission).
5. **No second commission engine.** Slabs and salary eligibility call `electron/services/commissionEngine.ts` and write `commission_ledger`; approval reuses `pending_manager_approval -> pending_admin_approval -> approved_for_payment -> paid`.
6. Achievement % = achieved / active target for the month; salary only if achievement >= `threshold_pct` (default 50, configurable). Targets are dynamic per person per period with history; never overwrite a row, close it (`deactivated_at`) and add a new one.
7. Schema changes follow `erp-schema-change` (additive; synced tables also go in `ALLOWED_TABLES`, `REQUIRED_SYNC_PARENTS`, `syncService`, desktop migration). Visits, prospects and payment transactions are cloud-only in `appSchema.ts`.
8. **Visits:** idempotent on `client_event_id`, outbox item type `visit`, works offline; GPS denied saves with `gps_missing`. Reminders are local scheduled notifications with a `data.url` deep link; a server reminder needs a scheduler, which is a stop-and-ask deploy item.
9. **Card payment:** hosted gateway only (PayHere first). Card data never touches the app or server. Verify the callback signature server-side, take the amount from our own record, sandbox keys until Moni approves live keys.
10. New app routes must be listed in `RoleLayout` `SCREENS` and `Shell` `NAV_ITEMS`; money is formatted with `formatRs`; strings go in en/ta/si.

## Tests (every endpoint, every level)
Own scope OK; sibling, other zone/region/branch and ancestor denied; no token; wrong App Key; salary data denied to a peer.
