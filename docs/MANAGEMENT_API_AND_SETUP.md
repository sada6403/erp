# Management Control — implementation and API guide

## Current implementation

The supermarket POS has a Company-Admin-only **Management Control** menu. Director reporting is served by the existing backend at **`/director`**. Management records live in the existing company MySQL tenant, not a new independent application database. Existing SQLite billing and sync continue as before.

Employee mobile screens/APKs are not included. Employee endpoints are available for a future client. All newly payable business amounts and rates must be explicitly configured; the example amounts used in tests are not seeded into company data.

This change is source implementation, not a deployed release. The management migration has been exercised only in disposable local MySQL test databases. No existing company schema has been migrated. Do not expect the new menu to connect to an older remote backend before the matching backend/migration is deployed.

## POS workflow

1. Enable the existing Supermarket module/stock option; log in as Company Admin.
2. Open **Management Control**. Connect with the current POS Company Admin's email/password and company slug. The configured existing Cloud API URL is used; cloud API keys and management session tokens are not exposed to the renderer.
3. Under **Users & Roles**, create a management account or assign an existing non-admin account. Assign role, branch/region/zone/company scope, reporting manager and active/inactive/suspended status.
4. Assigning management platform access changes that user's existing role to the stable **Management Web Only** role. This intentionally removes POS operational access. Do not convert a cashier account that must continue billing; use the appropriate dedicated management login. Company Admin accounts cannot be converted through this action.
5. Configure **Targets** with calendar month, amount, activation and optional deactivation date. Set the sales credit mode explicitly. Manual assignment overrides automatic credit, so one invoice contributes once.
6. Under **Salary & Commission**, enter a dated policy and every amount/threshold, including zero for unused components. Policies can apply to a role or override one employee. No policy covering the month means “not configured”.
7. For AGM/GM select fixed basic and “basic always payable”. For other roles choose the eligibility explicitly. Commission uses actual eligible sales and the highest reached tier. Customer allowance uses verified unique registrations and configured working days/minimum/cap.
8. Close the previous policy before adding a new version. An employee override takes priority over its role policy. Approved/paid payroll retains its stored rule and calculation snapshots.
9. Review customer registrations under **Customer Activity**; only valid, reviewed registrations count. Future Field Officer registration APIs write the existing customers table, with pending activity awaiting review.
10. Under **Payroll**, calculate, create a draft, approve and mark paid. A draft whose inputs have changed is rejected at approval; discard/recreate it. Paid/approved rows cannot be deleted or silently recalculated.
11. Use **Investment & Finance** to open existing investment/expense pages and classify existing records. A withdrawal is not automatically treated as capital returned.
12. **Audit Logs** records rule/target/account changes, login, approvals, classifications and session revocation.

## Dynamic settings

| Setting | Configuration |
|---|---|
| Salary scope | Per management role; optional individual employee override |
| Salary mode | Fixed or target-based |
| Basic eligibility | Always, or an explicit achievement threshold and below-threshold amount |
| Incentive | Amount and minimum achievement |
| Commission | Minimum achievement, ascending unique achievement thresholds and rates |
| Customer activity | Daily/monthly targets, minimum verified count, per-customer allowance, monthly cap, working weekdays, qualification mode |
| Other pay | Allowances and deductions |
| Effective dates | From/to per policy version; one applicable version at each scope |
| Targets | Per employee/month amount and activation dates/status |
| Sales credit | Manual, agent-link, or cashier; explicit assignment has priority |
| Reporting | Role, manager, company/zone/region/branch assignment and account status |

No automatic basic-salary reduction is inferred from target performance. A zero/no target does not qualify incentives/commission automatically. Target activation limits the credited sales dates; the administrator sets the full target amount explicitly. Salary and targets are not automatically prorated.

## Authentication and transport

Base path: `/api/management/`. Every protected endpoint checks the current user, platform, status, assigned scope, session version and expiry in the tenant database on each request. Password reset, access changes and explicit revocation invalidate existing management sessions.

`POST login`:

```json
{"company":"your-company-slug","email":"director@example.com","password":"your-password","platform":"director"}
```

Platforms: `director`, `employee`, `control`. Only existing Company Admin/full-access users can use `control`. Only the Director-assigned platform can use Director reporting login. Staff management accounts cannot use the legacy POS login.

Browser login creates an HttpOnly, SameSite=Strict session cookie. Cookie writes must include a matching Origin. Set `MANAGEMENT_PUBLIC_ORIGIN` to the exact public HTTPS origin in production (for example `https://director.example.com`), including behind a reverse proxy. Browser login refuses production without this setting. Native POS/future mobile sends `"transport":"bearer"` at login; it receives a random opaque `token` and sends `Authorization: Bearer <token>`. Store mobile tokens in the OS secure credential store. Do not put tokens in URLs/localStorage or log them.

Sessions expire after eight hours; authenticate again after expiry. There is no implicit management refresh that can resurrect deactivated accounts. `POST logout` revokes that user's management sessions for the current platform. The new management session store is independent of the legacy JWT refresh flow; this change does not claim to retrofit all existing legacy APIs with immediate revocation.

Protected success: `{"success":true,"data":...}`. Expected errors: 400 validation, 401 login/revoked session, 403 platform/scope/permission, 404 resource, 409 duplicate record, 429 rate limit, 503 unavailable/setup required. Private responses are no-store.

## Read endpoints

| GET resource | Access | Result |
|---|---|---|
| `me` | Authenticated | Identity, current role, platform and effective scope |
| `locations` | Authenticated | Authorized branches/regions/zones |
| `finance?from=YYYY-MM-DD&to=YYYY-MM-DD&branch=&region=&zone=` | Director, POS control, authorized employee managers | Financial KPIs, capital, branches and employee performance |
| `estimate?userId=...&from=YYYY-MM-01&to=YYYY-MM-last` | POS control or employee self | Salary/commission/customer allowance breakdown or not-configured reason |
| `targets` | POS control; employee self | Monthly targets/history rows |
| `payroll` | POS control; employee self | Stored payroll/payslip breakdown/history |
| `activities` | POS control; employee self | Registration status/history |
| `users`, `policies`, `branches`, `regions`, `zones`, `expenses`, `capital`, `audit`, `settings` | POS control only | Administrative data |

Employee `estimate` ignores a client-supplied foreign user ID and always returns the authenticated employee. Field Officers cannot read company financial reports or other employees. Managers receive reports intersected with assigned scope. Client branch filters can narrow access, never widen it.

Current administration lists are bounded (500/1,000 records; payroll/self-target history up to 120). They are not an unlimited export API. A pagination/export extension is needed before using these lists for larger history datasets.

## POS control write endpoints

All resources below use POST and require the `control` platform. Director cannot invoke them.

| Resource | Body fields |
|---|---|
| `create-user` | `name,email,password` (new passwords at least 12 characters) |
| `access` | `userId,role,status,scopeType,scopeId?,managerUserId?` |
| `reset-password` | `userId,password` |
| `revoke` | `userId` |
| `branch-region` | `branchId,regionId` |
| `sales-credit-mode` | `mode`: manual / agent-link / cashier |
| `attribute-sale` | `invoiceId,userId`; one immutable attribution per invoice |
| `target` | `userId,from,to,amount,activeFrom,activeTo?,status` |
| `policy` | `role,userId?,from,to?,policy` |
| `close-policy` | `id,to` |
| `verify-customer` | `customerId,status`: valid / rejected |
| `payroll-draft` | `userId,from,to` |
| `payroll-status` | `id,status`: approved / paid / discard (draft only) |
| `classify-finance` | `sourceType,sourceId,classification,payrollId?,commissionId?` (one linked source only) |

Roles: director, assistant_general_manager, general_manager, zonal_manager, regional_manager, branch_manager, field_officer. Status: active/inactive/suspended. Scope: company/zone/region/branch; Field Officer requires branch. Reporting cycles are rejected.

Policy schema (numbers intentionally unspecified here; enter company rules in POS):

```typescript
{
 mode: 'fixed' | 'target',
 basic: number,
 basicEligibility: 'always' | 'minimum-achievement',
 basicMinimumAchievement: number,
 basicBelowMinimum: number,
 targetIncentive: number,
 incentiveMinimumAchievement: number,
 commissionMinimumAchievement: number,
 commissionTiers: Array<{ from: number; rate: number }>,
 otherAllowances: number,
 deductions: number,
 customer: {
   dailyTarget: number,
   monthlyTarget: number,
   minimumValidCustomers: number,
   allowancePerCustomer: number,
   maximumMonthlyAllowance: number,
   eligibleWeekdays: number[], // Sunday=0 ... Saturday=6
   qualification: 'minimum-count' | 'daily-target' | 'monthly-target'
 }
}
```

Commission threshold comparison uses unrounded achievement; rates are percentages. Money rounds to cents. Tiers must be ascending, unique and non-overlapping. No tiers means no commission.

## Future customer registration

`POST register-customer`, employee platform, Field Officer only:

```json
{"name":"Customer name","phone":"customer mobile number"}
```

Branch, employee identity, date and status are server-assigned. Sri Lankan local mobile formats normalize to the 94 country prefix. Existing customer phone variants and the normalized unique activity key prevent duplicate allowance registrations; admin verification is still required to reject fake registrations. Existing POS customer entry remains available; it does not invent a Field Officer attribution.

## Financial basis and safeguards

- Net sales exclude tax and discounts and use original batch sale allocations. Returns restate the original invoice period. Cancelled/draft/held invoices do not contribute.
- Purchase value counts received batches, not draft orders. Purchases are not deducted again when COGS is already counted.
- Salary/commission use approved payroll payable components recognized at month end. Payment status is separate. Existing approved/paid agent commissions are also included unless explicitly linked to the same payroll.
- Classify operating/salary/commission/other expenses. Link the same expense to its approved payroll ID to exclude the duplicate source. For an expense already represented by an approved/paid legacy commission, link `commissionId` instead. `payroll` classification represents a combined salary+commission payment; linked totals cannot exceed the corresponding recorded amounts or cross cost branches.
- Company-wide costs remain unallocated in branch ranking rather than being assigned arbitrarily.
- Capital returned counts only classified principal returns. Profit distributions are separate. Investment/capital metrics are cumulative through the selected end date.
- ROI uses cumulative net profit / total invested capital. Zero investment or missing/unknown costs, unclassified expenses or withdrawals withhold definitive ROI. Missing cost data is never filled from current product prices.
- Reports reflect centrally synced records. Offline sales appear after existing POS sync. Server generation time is not proof that every offline device is current.
- A later return changes live achievement/estimates; approved/paid payroll snapshots remain unchanged. This version does not automatically post a recovery adjustment against an already paid payroll. Such adjustments need an explicit subsequent accounting workflow before payroll is used for automatic recovery.

## Test-only migration and deployment

`backend/database/migrate-007-management.sql` is additive and repeatable. Management tables are centrally authoritative and deliberately not added to the generic device sync write allowlist. This prevents stale device sync from resurrecting management access or overwriting payroll.

The runner refuses production and requires an existing dedicated test database whose name contains `test`:

```powershell
$env:MANAGEMENT_ENV='test'
$env:MANAGEMENT_TEST_DATABASE='your_existing_management_test_database'
$env:MANAGEMENT_BACKUP_DIR='C:\absolute\backup-directory'
$env:MYSQLDUMP_BIN='C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe'
# Set local MYSQL_HOST/PORT/USER/PASSWORD through your existing secure environment.
node backend/scripts/migrate-management.mjs
```

The runner takes a nonempty mysqldump backup before applying statements and enables this module only in that test schema. It does not create tenant registry/company accounts, copy production data or migrate real company databases.

For deployment: first back up and restore-test the local company SQLite, central tenant MySQL and bill attachments separately. Test the matching backend against a test company. Deploy the backend and reviewed tenant migration before the POS client, enable the supermarket tenant explicitly, configure real policies/accounts, and verify the Director HTTPS hostname points to `/director`. No production migration or public release was executed in this task. The old PostgreSQL docker-compose file is not the correct MySQL deployment recipe.

## Validation commands

```powershell
npm.cmd run typecheck
node node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit
npm.cmd run test:unit
$env:MANAGEMENT_MYSQL_TEST='1'
npm.cmd run test:integration -- electron/__qa__/management.integration.test.ts
npm.cmd run build:web
```

Backend checks run inside `backend`: `npm.cmd run typecheck` and `npm.cmd run build`. Set `POS_DISABLE_AUTO_MIGRATIONS=1` before starting a browser QA server or building with existing local environment configuration: the pre-existing backend automatically runs SaaS compatibility migrations at module load otherwise. This flag is for isolated verification and does not change normal startup behavior by default. An initial browser QA server was started before this legacy behavior was noticed; its existing startup migration routine ran (duplicate-column skips were logged). No management migration was applied to an existing company schema. The server was stopped and subsequent build/QA checks disable automatic migrations.

The opt-in management integration suite reads existing local MySQL connection settings without logging credentials, refuses nonlocal hosts, creates a randomized disposable schema, backs it up, runs migration twice, tests scenarios and drops only that generated test schema.

Browser QA uses `output/playwright/verify-director-ui.js`: all account/report requests are intercepted QA fixtures. Screenshots prove UI layout/interaction only, not production financial results.
