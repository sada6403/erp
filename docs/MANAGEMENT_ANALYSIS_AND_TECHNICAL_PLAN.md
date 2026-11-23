# Supermarket Management Control + Director Website

Phase 1 — Existing POS Analysis & Technical Plan  
Prepared: 7 November 2026  
Status: Source audit completed; proposed changes below are not implemented.

## 1. முடிவு

Existing POS-ஐ rebuild செய்ய வேண்டியதில்லை. Users, roles, agents, branches, regions/zones, sales/returns, stock batches, expenses, capital transactions மற்றும் sync infrastructure ஆகியவற்றை reuse செய்து விரிவுபடுத்தலாம்.

புதிய Management Control module existing POS-க்குள் இருக்கும். Director-க்கு read-only financial/performance website உருவாக்க வேண்டும். Employee mobile frontend அல்லது APK உருவாக்கக்கூடாது; அதற்கான backend contracts மட்டும் தயாரிக்க வேண்டும்.

இந்த phase-ல் source files மட்டுமே ஆய்வு செய்யப்பட்டன. Production database, server, accounts அல்லது financial records மாற்றப்படவில்லை. Live deployment, actual data completeness மற்றும் backup restore இப்போது சரிபார்க்கப்படவில்லை. முந்தைய purchase-workflow fix working tree-ல் உள்ளது; அதை இந்த audit மாற்றவில்லை.

## 2. Existing architecture

| Layer | Found in project | Evidence |
|---|---|---|
| Desktop POS | Electron 33, React 18, TypeScript, Vite, Tailwind, Zustand, React Router | `package.json`, `src/` |
| Local data | Offline-first SQLite using better-sqlite3, per-company workspace | `electron/database.ts`, `electron/services/companyWorkspace.ts` |
| Central backend | Next.js 15 App Router, React 19, TypeScript | `backend/package.json`, `backend/app/api/` |
| Central database | MySQL through mysql2; company tenant database resolution | `backend/lib/db.ts:1`, `backend/lib/tenant.ts:10` |
| Authentication | bcrypt passwords/PINs, JWT access tokens, rotating refresh tokens; local desktop auth | `electron/ipc/auth.ts`, `backend/lib/jwt.ts` |
| Authorization | Role permissions and owner/branch scopes, local handler permission checks | `backend/lib/rbac.ts`, `electron/ipc/admin.ts` |
| Sync | Local queue, push/pull, deletion handling, tenant-scoped table allowlist | `electron/services/syncService.ts`, `backend/lib/sync.ts` |
| Existing web portal | Superadmin portal; backend admin API endpoints | `portals/superadmin/`, `backend/app/api/admin/` |
| Backups | Local backup service and central company backup endpoints/scripts | `electron/services/backupService.ts`, `backend/lib/backup.ts` |

Important: `backend/README.md` still describes PostgreSQL, whereas current runtime imports mysql2. Deployment instructions must follow actual MySQL code/configuration and be corrected before rollout.

“No duplicate database” means extending the existing company SQLite/MySQL sync architecture. No second independent employee/customer/sales database will be introduced.

## 3. Existing / incomplete / missing

| Requirement | Current state | Integration decision |
|---|---|---|
| Staff accounts | Existing users CRUD, roles, branch assignment, active flag, password/security controls and import | Reuse users and existing Users/Roles UI; expose through Management Control navigation |
| Staff details | Agents have employee code, linked user, branch, region, appointment/personal details | Reuse identity linkage; do not create duplicate employee accounts |
| Regions / zones | Existing zones and regions, region→zone and agent→region | Reuse; add explicit branch→region and management scope assignments where absent |
| Reporting hierarchy | Branch manager references exist; complete configurable management tree not found | Add effective-dated reporting assignments and cycle validation |
| Director-only access | No Director portal in current JWT portal union; no Director website found | Add explicit Director platform access, login and read-only website |
| Session control | Refresh token store/revocation exists; universal live account/session check incomplete | Extend existing sessions, check current account/role/scope on every protected request |
| Login history | Last-login fields, audit infrastructure exist | Add structured success/failure and session history; reuse audit services |
| Suspension | Existing active flags; dedicated suspended status/history not found | Extend account state/history without changing old role behavior |
| Sales / returns | Existing invoices, invoice items, returns and return items | Reuse original documents; derive eligible net sales including reversals |
| Stock / COGS | Existing purchase orders, receipt batches, sale/return batch allocations and FIFO | Use original allocated batch costs; never current product price for historical COGS |
| Investments | Existing capital_transactions supports investment/withdrawal, branch and owner details | Reuse; add explicit capital-return versus profit-distribution classification |
| Expenses | Existing expense categories, amounts, paid amounts and branch records | Reuse; link payroll/commission sources to prevent double counting |
| Monthly targets | agents.monthly_target exists as a single editable value | Keep compatibility; add monthly/effective-dated target history, statuses and achievement service |
| Commissions | Existing Smart Buy/agent commission rules, ledger, approval logs, payouts and history | Preserve existing rules; add management achievement-tier rules without triggering duplicate rewards |
| Salary / payroll | No dedicated salary rules, payroll calculation/approval/payslip tables found | Add only missing payroll structures with immutable approved versions |
| Customer database | Existing customers and phone/NIC lookup | Reuse customers; add registered-by attribution, verification/activity history and duplicate protection |
| Customer allowance | No verified activity allowance engine found | Add configurable eligibility, working-day and monthly cap evaluation |
| Financial reports | Existing sales, allocation-based COGS and expense reports | Extend/reconcile; do not reuse old cloud dashboard queries unchanged |
| Director finance / ROI | No complete requested Director dashboard or capital recovery service found | Add read-only summaries from actual records with data-quality warnings |
| Future mobile APIs | Generic auth/admin/sync endpoints exist, but requested employee API contract absent | Add scoped employee APIs; no mobile screens |
| Management Control | Existing screens cover parts separately; requested integrated module absent | Add overview and missing sections; link existing screens instead of duplicating them |

Source anchors: `database/schema.sql:36` (roles/users), `database/schema.sql:444` (customers), `database/schema.sql:465` (invoices), `electron/database.ts:657` (capital), `electron/database.ts:744` (agents), `electron/database.ts:815` (zones/regions), `electron/database.ts:1236` (commission rules), `electron/database.ts:1948` (returns), `electron/database.ts:2067` (batches), `electron/ipc/reports.ts:354` (allocated COGS).

## 4. Data accuracy issues to resolve before Director reporting

1. Cloud dashboard uses `invoices.total` in `backend/app/api/admin/dashboard/route.ts:26`; compatibility migrations rename this to `total_amount` in `backend/lib/auth.ts:50`. Its customer/product active/scope queries also require schema reconciliation. These are source-level inconsistencies, not a verified production incident.
2. `agents.monthly_target` has no month-specific history. Editing it must not rewrite historical target achievement or approved payroll.
3. Existing commission engine matches product/category/brand/scheme/global rules. It does not establish the requested role/achievement salary policy. New policies cannot silently reinterpret old commission records.
4. Customers have a phone lookup index, not a complete verified registration/allowance ledger. A lookup alone cannot prevent concurrent duplicate or fake allowance claims.
5. Historical opening-stock cost can be unknown. Show known-cost totals plus unknown quantities; do not display incomplete COGS/net profit/ROI as definitive full-company figures.
6. Existing withdrawals do not by themselves prove return of principal. Historical withdrawals need explicit classification; do not infer actual capital returned from profit or sales.
7. Region/zone grouping currently serves agent profiles. Branch financial scope requires an explicit branch location map and historical assignment policy.

## 5. Proposed architecture

```text
Existing POS — Management Control
        | authenticated management commands + existing POS sync
        v
Existing Next.js central backend
  - live account/session/permission validation
  - company + branch/region/zone scope resolution
  - target, payroll, commission and financial services
        |
Existing company MySQL database <---- existing SQLite sync ----> POS
        |
        +---- Director website: read-only authorized reporting
        +---- Future employee APIs: backend only
```

Director website will be a separate user-facing route area in the existing Next.js application, for example `/director`, with its own login and responsive layout. This gives a separate secure website without creating another admin application or backend/database. A custom hostname can be mapped at deployment; no hostname is assumed now.

All operational writes remain initiated from authorized POS Management Control. Director APIs are read-only apart from login/logout/session operations. Director role must not inherit POS admin access through display-name fallbacks. Stable role/platform identifiers will control access.

## 6. Minimal database extension plan

Names below are proposals; final migrations must recheck the actual test schema before creating anything.

| Reuse | Extend / add only if missing |
|---|---|
| users, roles, agents | Account status/session version; management role/platform access and effective-dated scope assignments |
| branches, regions, zones | Branch→region association and manager reporting assignments; prevent hierarchy cycles |
| refresh_tokens, audit_logs, saas audit | Session identifier/revocation metadata, login/status history; company-scoped revocation |
| agents.monthly_target | monthly_targets + target_history for dated versions; retain legacy field compatibility |
| commission_rules/ledger/payouts | Management tier rule extension or linked subtype, effective dates, source uniqueness and reversal links |
| customers | Verified registration attribution/activity, normalized identity constraints and validation history |
| expenses | Source references/classification for operating, salary and commission expense reconciliation |
| capital_transactions | Explicit principal returned / profit distribution classification; backfill only verified records |
| existing audit history | Salary rule versions, payroll runs/lines/components and approval/payment history |

Business values remain configurable. Example salary, target and tier amounts from the prompt will be test fixtures, never production defaults. No paid payroll is generated for unconfigured policies.

Use additive, repeatable SQLite and MySQL migrations. Existing cloud tenant bootstrap is frozen (`backend/lib/tenant.ts:49`); compatibility changes belong in the established migration path, not a separate competing schema. Add constraints/indexes and migration tracking; avoid destructive schema rewrites.

## 7. Target and salary calculation contract

- Store one explicit sales attribution per eligible sale. Cashier, referral agent and Field Officer are distinct concepts. No automatic multi-employee credit.
- Manager scope summaries may aggregate team performance, but their own payable commission must follow an explicit policy; aggregates must not multiply company sales.
- Target achievement = eligible net sales / configured target × 100. Zero/unconfigured target returns “not configured”, not infinity or automatic eligibility.
- Returns/cancellations reduce credited sales; replay/sync retries must not duplicate credit. After paid payroll, use linked adjustments rather than rewriting history.
- Salary = eligible basic + target incentive + commission + verified customer allowance + other allowances − applicable deductions.
- AGM/GM fixed salary must not fall merely because a target is missed. Other roles also keep basic salary unless an explicit approved eligibility policy says otherwise.
- Commission tiers are effective-dated, non-overlapping and evaluated against actual eligible sales, with defined threshold inclusivity.
- Customer allowance uses verified unique registrations, configured working days, minimums and monthly caps; no assumption that repeated registrations are new customers.
- Payroll stages: draft → reviewed/approved → paid. Store input/rule snapshots, calculation breakdown and revision/audit references. Prevent duplicate month/employee payouts and self-approval where required by assigned permissions.
- LKR money rounds consistently to cents; achievement precision and tier comparisons are specified separately.

### Business decisions needed before enabling payable rules

1. Role-wise basic/fixed salary, incentive amounts and below-threshold eligibility. Until configured, no invented salary rules.
2. Sale attribution: select a Field Officer per invoice, use linked referral agent, or another explicit method? Do not default to cashier.
3. Eligible sales: tax treatment, discounts, credit/unpaid invoices, eligible product lines and return recognition date.
4. Mid-month activation/deactivation and whether targets/basic salary prorate; working-day calendar/holidays.
5. Customer verification authority, mobile/NIC normalization exceptions and daily target versus minimum qualification rules.
6. Capital withdrawal classification and ROI capital basis when additional investment is received during a period.

These decisions do not block schema/API contracts, but payable calculations and final reporting must not assume the answers.

## 8. Financial service contract

| Metric | Proposed source / treatment |
|---|---|
| Total investment | Verified investment entries in capital_transactions; branch/company-unallocated displayed separately |
| Gross / net sales | Actual posted invoices; subtract discounts and valid returns once; exclude cancellations; separate tax according to confirmed policy |
| Purchase cost | Actual received quantities × purchase batch unit cost, not draft PO totals |
| COGS | Original sale_batch_allocations with linked return/cancellation reversal; preserve unknown-cost coverage |
| Gross profit | Net sales − COGS |
| Operating expenses | Posted non-payroll operating expenses, excluding linked salary/commission duplicates |
| Salary expenses | Approved payroll salary/allowance components according to confirmed recognition basis |
| Commission expenses | Payroll/commission payable components once; reconcile existing commission ledger/payouts |
| Net profit | Gross profit − operating − salary − commission − other applicable expenses, each once |
| ROI | Cumulative net profit / confirmed invested-capital basis × 100; zero investment => unavailable |
| Actual capital returned | Explicit principal-return transactions, not sales receipts or calculated profit |
| Outstanding investment | Invested principal − classified principal returned; flag inconsistent over-return records |

Accrual expense recognition and cash payment status must be separate. Supplier payments do not create a second purchase expense. Purchases are not also deducted from profit when their sold cost is already COGS. Payroll components and linked expense entries require a unique source reference and one reporting owner.

Dates use company timezone (currently default Asia/Colombo) and half-open timestamp ranges. Filters: today, week, month, year, custom dates, branch/region/zone. Financial date filters and cumulative ROI/capital totals must have clear labels. Unassigned branches/users and missing costs remain visible as data-quality items.

## 9. API plan — proposed, not yet available

| Endpoint group | Purpose / boundary |
|---|---|
| `/api/management/auth/*` | Director/employee platform login, current session, logout and revocation; explicit tenant context |
| `/api/management/me` | Current user, effective roles/platforms/scopes; never trust client-selected employee ID |
| `/api/management/users/*` | POS-authorized CRUD/status/password/session and reporting assignments |
| `/api/management/targets/*` | POS configuration/history; read-only employee self/authorized team summaries |
| `/api/management/salary-rules/*` | POS-only effective-dated salary/allowance configuration |
| `/api/management/commission-rules/*` | POS-only dynamic tiers with validation/history |
| `/api/management/payroll/*` | POS calculation, review, approval/payment; employee self history/payslip reads |
| `/api/management/customer-activities/*` | POS review/validation; future employee registration into existing customers |
| `/api/director/finance` | Read-only investments, sales, COGS, expenses, profit and ROI |
| `/api/director/branches` | Read-only branch/region/zone performance, best/low branch with consistent ranking metric |
| `/api/director/employees` | Read-only target achievement, headcounts and salary/commission summaries |

Document requests/responses, pagination, LKR units, dates, validation, errors, idempotency, permissions and sync freshness. Future mobile routes return data only; no mobile form or APK.

## 10. Authentication / security findings and required changes

This is a targeted source review of requested integration boundaries, not a penetration test.

### SEC-01 — High: revocation is not immediate for existing access JWTs

Evidence: `backend/lib/rbac.ts:14` validates token signature/expiry; `backend/lib/jwt.ts:175` revokes refresh tokens only. Access lifetime is 15 minutes (`backend/lib/jwt.ts:8`). Current permission checks read claims from the token.

Impact: an already-issued access token may retain access or old permissions after deactivation, role change or refresh-token revocation.

Plan: server-side session ID/version plus current account, role, platform and scope checks on every protected Director/employee request. Deactivation/password reset/role change revoke or invalidate sessions in the same central transaction; frontend clears data on 401/403. Do not cache private reports publicly.

### SEC-02 — High: refresh does not explicitly recheck active state

Evidence: tenant-user lookups in `backend/lib/jwt.ts:107` and `backend/lib/jwt.ts:135` query user ID without `is_active=1`; the following path does not enforce account state.

Impact: a deactivated user with an unrevoked refresh session may receive new access credentials.

Plan: validate current active/suspended status, platform role, company availability and session revocation during refresh, not only initial login.

### SEC-03 — High if production environment is missing secrets

Evidence: `backend/lib/jwt.ts:6` and adjacent refresh-secret initialization use fallback development secret strings.

Impact: deployments that accidentally omit configured secrets would use predictable signing keys. Actual deployed secret configuration was not inspected.

Plan: fail startup in production when required signing secrets are absent; development uses explicit test configuration. Do not print or commit real secrets.

### Required application controls

- Email/password login with existing bcrypt; no PIN-only Director login. Reuse login throttling infrastructure and return generic credential errors.
- Director browser sessions use HttpOnly cookies with secure production flags, CSRF/origin protection for cookie-authenticated writes and explicit logout; future mobile uses its own documented token transport.
- Backend computes scope from authenticated assignments. Reject cross-company and unauthorized branch/region/zone IDs, including export and detail routes.
- Never expose desktop cloud API credentials to Director browser code.
- Audit account changes, rules, target revisions, payroll approval/payment and capital classification. Redact credentials and unnecessary personal data.
- Existing cloud sync write permissions must be extended carefully so stale devices cannot restore revoked management access or overwrite centrally authoritative payroll/session state.
- HTTPS is a production deployment requirement; actual reverse-proxy/TLS configuration needs deployment verification.

Immediate blocking means subsequent server requests are denied. Data already seen/downloaded cannot be remotely erased. An offline POS cannot instantly deliver an account deactivation to the server: management account/session changes should require online acknowledgement. Operational offline billing remains available under existing rules. Director reports must show last-synced time and pending/incomplete coverage rather than claim real-time completeness.

## 11. POS and Director UI plan

**Existing POS:** add Management Control navigation containing Overview, Users & Roles, Targets, Salary, Commission, Customer Activity, Investment & Finance, Payroll and Audit Logs. Existing Users/Roles/Regions/Zones/Investments/Expenses pages remain the edit destinations where suitable. Add only missing screens and fields. Restrict this capability to the supermarket module and authorized roles; preserve other industry modules.

**Director website:** responsive sidebar, LKR financial cards, selectable dates/scope, sales/profit charts, branch and employee performance, missing-data notices and sync timestamp. No user creation, payroll approval or other operational admin controls. Employee mobile UI remains out of scope.

## 12. Development sequence and acceptance gates

| Phase | Work | Gate |
|---|---|---|
| 1 — this delivery | Analysis, gap matrix, architecture, rule questions | Report provided before application development |
| 2 | Dedicated test company/database, backup and restore proof; additive migrations; session and scope contracts | Existing POS boots; old data intact; no production migration |
| 3 | Shared target/salary/commission/customer/finance domain services and scoped APIs | Deterministic fixtures and authorization tests pass |
| 4 | POS Management Control, reusing working screens | Authorized control works; other modules unaffected |
| 5 | Director login and responsive financial/performance website | Read-only access, valid totals and immediate online revocation |
| 6 | Future employee API contracts/OpenAPI and integration documentation | Self/team scope and registration APIs tested without mobile frontend |
| 7 | End-to-end, sync/replay, payroll and reporting reconciliation | No duplicate sales/expenses/payroll; return adjustments correct |
| 8 | Deployment instructions, rollback/restore rehearsal and reviewable release | Test results and remaining configuration documented before deployment |

### Required test matrix

- Director role/platform validation, wrong-password throttling, logout, expired/revoked sessions, inactive/suspended accounts, role/password changes.
- Cross-company access, tampered employee ID, unauthorized branch/region/zone, empty/unassigned scopes and reporting hierarchy cycles.
- Targets at 0%, below/at 50%, 74.99/75%, 99.99/100%; no target; activation dates; month/year boundaries.
- Fixture only: target 1,200,000; eligible sales 600,000 => 50%; configured 2% commission => 12,000. These are not seeded business defaults.
- Fixed salary retained when below target; configurable incentive eligibility; effective-date boundaries, deductions and cents rounding.
- Fixture only: configured basic 25,000 + commission 12,000 + customer allowance 5,000 => 42,000, once rules are configured.
- Duplicate/concurrent customer registration, verification rejection, working days, minimum count and monthly allowance caps.
- Partial/full sales returns and cancellation before/after payroll approval/payment; reversal idempotency.
- FIFO COGS and unknown historical cost; capital injection/return/distribution; no investment; additional investment; unallocated branch amounts.
- Expenses linked to payroll/commission counted once; purchases versus COGS; cash collections versus sales.
- Offline POS sales then sync replay/reordering, stale management updates, conflicts, backup/restore and schema migration reruns.
- Existing retail/other module routes and current supermarket purchase/direct/bill behavior remain unchanged.

## 13. Backup and deployment policy

Before any database change: back up the existing local company SQLite, central tenant database and required attached files; record migration version/checksums and prove restoration in a test environment. Supplier bill files in `purchase-invoices` need separate protection from a database-only backup.

Development must use a dedicated test company/schema and sample fixtures without copying real credentials into source. No production migration is part of this analysis. Central schema/session changes deploy before dependent POS/website clients, with an explicit compatibility window. Provide actual MySQL environment/reverse-proxy configuration instructions and required secret names without including values.

## 14. Current delivery status

Delivered now: source-based existing-feature analysis, missing-feature list, reuse strategy, security findings, technical/integration plan, API outline, calculation contracts and testing/deployment gates.

Not yet delivered: Management Control implementation, Director website, new APIs/migrations, payroll engines or their test results. No claim is made that these are already working. Salary/commission and attribution decisions above must be resolved or kept unconfigured before enabling payable behavior.
