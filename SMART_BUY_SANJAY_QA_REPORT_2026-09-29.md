# Smart Buy Manager QA Report — Sanjay

**Test date:** 2026-09-29  
**App version:** 2.7.13  
**Account role:** Smart Buy Manager  
**Home branch:** Colombo - Flagship Showroom & HQ  
**Method:** Electron UI automation against the real renderer and IPC layer, using the account's existing authenticated session.

## Overall result

**Blocked for production use.** Login, Smart Buy navigation, notifications, calculator validation, and empty-state pages work. The core business flow cannot start: a Smart Buy Manager cannot create the first scheme because the backend requires a Scheme Master template, while the account has no template and cannot create one. Member enrollment is consequently blocked.

No QA scheme, customer, member, agent, contribution, or draw was persisted. Both attempted writes stopped at validation before database insertion.

## Findings

### SB-01 — Critical — Hidden ERP routes are accessible to the Smart Buy Manager

The sidebar correctly shows only Smart Buy functions, but changing the hash/URL opens non-Smart-Buy screens. This is a real data exposure, not just an empty page: Employee Management displayed five user records, email addresses, roles, branches, last-login information, and action controls such as Add User, Edit User, Change PIN, Enable/Disable, and Deactivate.

Confirmed accessible routes:

- Products
- General Customers
- Employee Management
- Analytics
- Transaction Report
- Advanced Reports
- Cash Register
- Returns
- Categories
- Regions
- Zones
- Coupons
- Audit Logs
- Operations Hub
- Sync Monitor
- POS Billing

**Reproduction**

1. Sign in as the Smart Buy Manager.
2. Change the app hash to `#/admin/users`.
3. Employee Management opens and exposes real records and action controls.
4. Repeat with the routes listed above.

**Expected:** A Smart Buy-only account is redirected to the Smart Buy dashboard or shown Access Denied.  
**Actual:** Pages render and return data. Destructive actions were not executed during this audit.

**Likely cause:** Several routes are inside `RequireAuth` only and do not use a permission guard. Examples: `src/App.tsx:271`, `src/App.tsx:273`, `src/App.tsx:288`, and `src/App.tsx:319`.

### SB-02 — Critical — Scheme creation is impossible for a Smart Buy Manager

The New Smart Buy Scheme form lets the manager enter a scheme name, contribution, duration, product value, capacity, branch, start date, and notes. After all visible required fields are valid, Save fails with:

> Scheme Master template is required to create a scheme

The form has no Scheme Master selector and sends no `template_id`. The Scheme Master page contains zero templates and is read-only for this role. Its empty state says to create a scheme, but the New Scheme action is only rendered for Company Admin.

**Reproduction**

1. Dashboard → Start a New Scheme → New Smart Buy Scheme.
2. Fill all visible required fields and select the home branch.
3. Click Create Scheme.
4. Observe the template-required error.

**Expected:** Either the form must require an active Scheme Master selection, or direct entry must be accepted for this role.  
**Actual:** The UI offers direct entry while the backend rejects direct entry.

**Code evidence:**

- The UI submits `window.api.chits.create(form)` without a template selector: `src/pages/admin/ChitSchemesPage.tsx:334`.
- The backend comment says direct entry requires no template, but the non-global branch immediately rejects missing templates: `electron/ipc/chits.ts:793-825`.
- Scheme Master create/edit is hidden from non-admin accounts: `src/pages/admin/SchemeMasterPage.tsx:64`.

### SB-03 — High — Member onboarding is a dead end when no open scheme exists

Add Smart Buy Customer remains enabled even when the modal explicitly says there are no open schemes. A user can fill the full customer form and only learns at final submit that a scheme must be selected.

**Expected:** Disable Add Customer or block the form before data entry, with a link/instruction to create or activate a scheme.  
**Actual:** The user completes the form, then receives `Select a Smart Buy scheme`.

This finding compounds SB-02: because the manager cannot create the first scheme, no member can be enrolled.

### SB-04 — High — Branch choices are not scoped in Smart Buy forms

The Colombo Smart Buy Manager sees every branch in scheme, customer, agent, and report filters/forms, including recovered historical branch records. The Add Agent form also allows another branch to be selected even though the backend later forces a non-admin write back to the caller's home branch.

**Expected:** A branch-scoped manager sees the home branch only unless a documented cross-branch collaboration grants access.  
**Actual:** All branch names are exposed and selectable, creating misleading intent and revealing organization topology.

### SB-05 — Medium — Viability calculator's default result is dangerously optimistic

The default values use a Rs.60,000 product entitlement and 50 participants but set Average Product Cost to Rs.0. The result reports:

- Expected product cost: Rs.0
- Expected profit: Rs.2,670,000
- Profit margin: 100%
- “PROFITABLE / SAFE TO START”

**Expected:** Average Product Cost should be required and greater than zero, or the result should show a prominent incomplete-input warning and must not label the scheme safe.  
**Actual:** The default zero cost produces a green safe recommendation. The default comes from `src/components/shared/SmartBuyViabilityCalculator.tsx:41`.

### SB-06 — Low — Scheme Master empty-state instruction is wrong for this role

The page says, “No SmartBuy schemes yet — create one,” but Smart Buy Managers have no create button and the backend reserves template creation for Company Admin.

**Expected:** “No active Scheme Master templates. Ask a Company Admin to create one.”

## Passed checks

- Account identity and role display correctly as Smart Buy Manager at the Colombo branch.
- Sidebar contains only Smart Buy navigation.
- Notification panel shows **No notifications**; stock alerts and stock-request links were not shown.
- Direct Stock Requests and Settings routes are blocked and redirect to the Smart Buy dashboard.
- All 11 Smart Buy pages opened without renderer exceptions or console errors.
- Award Winners correctly shows no winners before any draw.
- Empty export buttons are disabled where there is no data.
- Calculator rejects a zero monthly payment with `Monthly payment must be greater than 0`.
- Scheme form rejects an empty scheme name with `Enter a scheme name`.
- Customer form prevents persistence without selecting a scheme.
- No page hang was reproduced during this run. Navigation remained responsive after visiting every Smart Buy page.

## Core flow coverage

| Flow | Result |
|---|---|
| Login / session identity | Pass |
| Smart Buy-only sidebar | Pass |
| Role-scoped notifications | Pass |
| Scheme validation | Pass |
| Create first scheme | **Blocked by SB-02** |
| Create/enroll member | **Blocked by SB-02/SB-03** |
| Record contribution | Not reachable |
| Payment reminder | Page loads; transaction flow not reachable |
| Draw / award winner | Empty state works; transaction flow not reachable |
| Bank transfer approval | Page loads; no transaction available |
| Reports | Page loads; no scheme data available |
| Direct-route authorization | **Fail — SB-01** |

## Evidence

- `.local-audit/smartbuy-create-filled.png`
- `.local-audit/smartbuy-after-create.png`
- `.local-audit/smartbuy-customer-filled.png`
- `.local-audit/smartbuy-customer-after-submit.png`
- `.local-audit/smartbuy-inspect.png`

## Recommended fix order

1. Apply explicit route guards to every ERP page and enforce the same permission at its IPC handlers.
2. Resolve the Scheme Master contract: add a required active-template selector for Smart Buy Managers, or permit direct creation consistently in both UI and backend.
3. Disable member onboarding until at least one accessible open scheme exists.
4. Scope all branch selectors to the caller's branch/collaborations.
5. Require a realistic product cost before the calculator can label a plan safe.
6. After fixes, run the full scheme → three members → contributions → draw → voucher/redemption → reports flow.
