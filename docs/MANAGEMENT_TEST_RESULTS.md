# Management Control validation

Date: 8 November 2026 (Asia/Colombo).

## Results

| Check | Result |
|---|---|
| Full unit suite | 180 passed, 20 files |
| Full integration suite | 281 passed, 8 skipped; 13 passing files, 1 opt-in MySQL sync file skipped |
| Final management-only MySQL suite | 15 passed, including the additional role/password-reset case added after the full-suite run |
| POS TypeScript | Passed |
| Electron TypeScript / compilation | Passed |
| Backend TypeScript (separate from Next build) | Passed |
| POS web production build | Passed; management component is lazy loaded; tests are not bundled |
| Backend production build | Passed with automatic SaaS migrations disabled; `/director` and management API route generated |
| Director browser fixtures | Desktop login, finance, branches, employee performance, mobile layout, metric selection and logout passed; no page errors or page-width overflow |
| Diff whitespace check | Passed |

The full integration count includes 14 management cases at the time of that run. The subsequent management-only run includes all 15 final cases. Do not add these counts together as separate independent tests.

## MySQL test isolation

The management suite connects only to a local MySQL server using existing local credentials without printing them. It creates a randomized `pos_erp_management_test_<hex>` database, dumps a backup before applying schema changes, applies the management DDL twice, seeds synthetic fixtures, and drops only that generated database after the suite. It does not insert into the actual SaaS company registry or migrate existing company schemas. Registry lookup is mocked to the disposable test tenant while business queries/migrations use real MySQL.

Covered scenarios:

- Dynamic salary and commission calculation from real credited sale allocations.
- Missing policy remains unconfigured; duplicate credit and overlapping policy dates rejected.
- Director versus control platform permissions; employee self/branch boundaries.
- Immediate management session rejection after deactivation, revocation, role/platform change or password reset.
- Cross-branch filter denial and cross-origin cookie-write rejection.
- Returns reducing achievement/commission and invalidating stale payroll drafts.
- Draft → approved → paid transitions; immutable finalized payroll and duplicate-payroll rejection.
- Customer registration normalization, duplicate prevention and required admin verification.
- Expense/payroll source linkage, principal-return classification and withheld ROI for incomplete costs.
- Dynamic automatic agent/cashier attribution with manual override counted once.
- Individual salary override preserving already paid history.
- Target activation dates restricting eligible credit.
- Legacy commission expense linked to its existing ledger without double counting.
- Finalized payroll history retained after a legacy employee deletion.

## Browser artifacts

Screenshots in `output/playwright/`:

- `director-login-desktop.png`
- `director-finance-desktop.png`
- `director-branches-desktop.png`
- `director-employees-mobile.png`
- `director-finance-mobile.png`

These use intercepted synthetic QA data. They validate layout and interaction, not a live company's figures. API/domain behavior is tested separately by the real MySQL suite. A live end-to-end POS → sync → Director deployment has not been exercised against an actual company in this task.

## Diagnostic findings that remain

The full integration runner exits successfully, but its existing Smart Buy QA script logs findings about final-cycle voucher redemption, single-winner commission accrual and dashboard performance at 10,000/50,000-member test sizes. These are diagnostic messages, not failed assertions; they have not been independently confirmed or fixed in this management change. Do not interpret the passing suite as proof that these business/performance concerns are resolved.

Existing temporary-database tests also print a `credit_ledger` backfill warning during bootstrap, although their assertions pass. Next/Vite print existing Browserslist/workspace/Tailwind warnings. No dependency upgrades or unrelated Smart Buy redesigns were made.

## Startup migration observation

An initial local browser QA server was started with the existing backend environment before noticing that `backend/lib/db.ts` runs legacy SaaS compatibility migrations at module import. That routine ran and logged duplicate-column skips. The server was stopped; a `POS_DISABLE_AUTO_MIGRATIONS=1` guard was added and used for subsequent build verification. No new management migration was applied to an existing company schema. This report does not claim that the initial legacy startup routine was read-only.

## Release status

Source implementation and isolated validation are complete for this delivery. No version bump, installer publication, production management migration, public Director hostname or live company configuration was performed.

Before operational rollout, back up and restore-test real tenant/local data and attached bills, deploy matching backend and reviewed tenant migration, configure `MANAGEMENT_PUBLIC_ORIGIN` with HTTPS, assign accounts and real policies, reconcile historical financial source records, review the Smart Buy diagnostics and run a test-company end-to-end sync rehearsal.

See [API and setup guide](MANAGEMENT_API_AND_SETUP.md) for endpoints, configuration and known boundaries, including bounded history lists and the absence of automatic recovery postings against already paid payroll.
