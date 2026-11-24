# Claude Code kickoff — Natural Plantation mobile app (Run 1)

You are building the Natural Plantation customer / Smart Buy / agent mobile app on top of the existing
POS ERP. Work fast but safely: parallelise with subagents, never touch production.

## 0. Read first (in this order)
0. `docs/mobile-app/RELEASE_PLAN.md` — the 14-day deadline and v1.0 scope. Prioritise by it.
1. `AGENTS.md` (repo root) — rules. They override anything below if they conflict.
2. `docs/mobile-app/ARCHITECTURE.md` — the plan. Sections 3, 4, 5, 7, 8, 11 matter most for this run.
3. `.agent/skills/*/SKILL.md` — load the matching skill before each kind of task.
4. `CLAUDE.md` — POS desktop rules (still apply when you touch `src/` or `electron/`).

## 1. Approved design = the source of truth for UI
- Live: https://mobile-app-demo-jet.vercel.app/
- Code: GitHub `Monishan2003/mobile-app-demo` (local copy `C:\work\mobile app\web-demo`):
  `index.html`, `styles.css`, `app.js` (vanilla HTML/CSS/JS, no framework).
- Rebuild every screen in React Native **visually identical** to the demo: layout, spacing, radii,
  typography, icons, colours, copy, bottom-nav items per role, the 3-step checkout indicator, the offline
  banner, toasts. Take the design tokens from `styles.css` `:root` and the two theme blocks
  (Olive & Yellow default: primary `#5A6B2E`, accent `#F2C230`; Purple & Pink: `#6B3FA0`, `#C93A78`).
  Fonts: Plus Jakarta Sans, Noto Sans Tamil, Noto Sans Sinhala, JetBrains Mono (numbers/receipts).
- Copy the demo's behaviour, not its fake data: e.g. the demo checkout shows Rs 0 while the receipt
  shows Rs 6,350 — real totals always come from the server.
- Demo-only things that must NOT ship: the "Quick Login demo" role buttons and hard-coded test IDs.
  Keep them only in development builds behind `__DEV__`.

Screens (from the demo): Home/Store, Login (Sign in / Sign up), Store catalog, Flash deals, Smart Buy
promo, Departments, Cart, Delivery address & branch, Payment method, Order confirmed, Order tracking,
Account & preferences, Notifications inbox, Offline/no internet, Join Smart Buy form, My Schemes, Monthly
draw results, Draw proof video player, Wallet/Passbook, Spend wallet in shop, Agent profile & earnings
(milestone progress, badges), Assigned scheme members, Agent field completion (OTP handover), Thermal
receipt preview.

Bottom nav per role (as in the demo):
- Customer: Groceries · Categories · Cart · My Orders · Settings
- Smart Buy: My Schemes · Draw Videos · Passbook · Spend Shop · Settings
- Agent: Deliveries · Members · Earnings · Print Bill · Settings

## 2. Decisions to apply (newer than or adding to ARCHITECTURE.md)
- App display name: **Natural Plantation**. Working code name in docs ("LankaHome") is fine internally.
- **Login identifier**: one field that accepts the mobile number, a Smart Buy member number
  (e.g. `NP-1042`) or an agent code (e.g. `NP-AG-204`); all resolve to the same `app_users` row.
  Password as per ARCHITECTURE §3. No SMS anywhere.
- **Agents collect scheme payments and COD cash** (the demo shows it). Collection = a pending
  `chit_contributions` row with `collected_by_agent_id`, a printed receipt, verified later in POS.
  Bank-transfer slips are verified by the branch admin in POS.
- **Android package name**: read it from env `ANDROID_PACKAGE` in `mobile/app.config.ts`.
  Moni will supply the existing Play Store package (we may publish as an update to the old
  "Natural Farming" listing). Until then use `com.naturalplantation.app.dev` for dev builds only.
  Never hard-code it elsewhere.
- Hide Smart Buy and Installments UI when the company's modules disable them (ERP v2.8 business types).
- **Deadline:** v1.0 on the existing Play listing by 21 Nov 2026. Follow `docs/mobile-app/RELEASE_PLAN.md`.
  Build 1 goes to Play Internal testing on 11 Nov. Set up EAS build profiles and `expo-updates` from the
  start so every later fix ships as an update.
- **Supermarket / grocery rules (POS v2.9.x):**
  - `products.sale_by` (weight items) → decimal quantities (e.g. 0.25 kg steps), price per kg shown;
    cart, orders and stock use REAL quantities, never integers.
  - Hide `not_for_sale` products; show the EMI line only when `enable_emi = 1`; `is_manage_stock = 0`
    means always available.
  - Companies with supermarket stock enabled sell FIFO by batch with optional batch selling prices and
    **no overselling**. The app shows the product's current selling price; the order locks
    `unit_price` at order time; checkout re-checks stock on the server and reserves it. POS must honour
    the app order price when converting the order to an invoice (flag it as an open question if the
    POS conversion path re-prices).
  - Supplier bills, purchases, capital/investments and profit dashboards are back-office only — not in the app.

## 3. Repo setup (do first, then report)
1. `git fetch origin`. Work on branch `feature/mobile-app-foundation` (already has the docs commit).
   Rebase it onto the latest `origin/main`. Never push to `main`; never run the VPS deploy.
   Confirm `.github/workflows/deploy-vps.yml` has `paths-ignore` for `mobile/**`, `docs/**`, `.agent/**`,
   `AGENTS.md`.
2. Make the skills usable by Claude Code: copy `.agent/skills/*` to `.claude/skills/` (keep both in sync).
3. Add one line to `CLAUDE.md`: "Mobile app / App API work: read AGENTS.md and docs/mobile-app/ first."
4. Windows repo with `core.autocrlf=true`: do not rewrite line endings of files you don't change.

## 4. Run 1 scope (Phase 0 + Phase 1 + full UI shell)
Run three workstreams in parallel with subagents; integrate at the end.

**A. Backend (`backend/`)** — skills `app-api-endpoint`, `erp-schema-change`, `whatsapp-credentials`,
`notifications-and-updates`
1. `companies.app_key` (+ previous key/grace) and a "Generate App Key" action in Super Admin.
2. `backend/lib/app/`: `resolveAppCompany`, `requireAppUser`, error helper, rate limits;
   `backend/lib/app/contracts/` (type-only).
3. Auth tables + endpoints: login (phone / member no / agent code), refresh, logout, register,
   change-password (forced on first login), email start/verify, forgot.
4. `POST /admin/app-access/invite` (temp password, WhatsApp click-to-chat text; Cloud API behind a flag).
5. `/status` (ordering_enabled, maintenance_message, min_app_version, latest_version), `/watermark`.
6. Catalog: categories, products (delta `updated_since`), product detail with variants, banners, search,
   suggest. **Fix the variant sync gap first** (ARCHITECTURE §4.1): add `product_variants`,
   `product_variant_stocks`, `product_attributes`, `product_attribute_values` to `ALLOWED_TABLES` and the
   desktop push.
7. Image thumbnails (300 px / 800 px WebP via `sharp`) for product images.
8. Wishlist, addresses, checkout quote, orders (Idempotency-Key, `channel='app'`), order tracking
   timeline, cancel before dispatch, invoice PDF.
9. Notification queue + Expo Push sender + inbox endpoints + device registration.

**B. Mobile (`mobile/`)** — skills `rn-screen`, `offline-cache`, `notifications-and-updates`,
`build-and-verify`
1. Expo (latest stable SDK) + TypeScript strict + Expo Router + dev client; stack exactly as AGENTS.md §4.
2. Design system from the web demo tokens; both themes; i18n (en/ta/si); fonts.
3. Build **all screens listed in §1**, pixel-matched to the demo. Shop + auth wired to the real API
   first; then Smart Buy read-only and Agent deliveries/members/earnings (see `RELEASE_PLAN.md` v1.0
   scope). Mock data is allowed only in `__DEV__` builds. Any Play build shows "Coming in the next
   update" for features not yet backed by real endpoints — never fake data.
4. Offline: persisted cache, offline banner with cache age, buy-later sheet, Notify me.
5. Push: channels, permission explainer, deep links, inbox. Updates: `expo-updates` + force-update screen.
6. Screen capture blocked on draw video, wallet, NIC capture.

**C. POS desktop (`src/`, `electron/`)** — skills `erp-schema-change`, `whatsapp-credentials`
1. App Access page (invite single/bulk with filters, dispatch status, reset requests, disable).
2. Online Store page (banners, online products, delivery fees, ordering on/off, maintenance message).
3. Orders page: `channel=app` badge and assign-agent action.

## 5. Stop and ask Moni before
- Any migration, backfill or data change on a real company (only the test company is allowed).
- Merging to `main`, deploying the backend, publishing an OTA update, or building a release for Play.
- Sending any real WhatsApp message.
- Wallet checkout or wallet sync changes (Phase 3; needs the §10 decision).
- Adding a library not in AGENTS.md §4.

## 6. Definition of done for Run 1
- `npm run typecheck` (backend, root) and `npx tsc --noEmit`, `npm test` (mobile) pass.
- Every endpoint tested: right role, wrong role, other user's id, no token, wrong App Key.
- App runs on the `Pixel_6` emulator against the local backend + test company. Flows work end to end:
  invite → first login → set password; browse (online and airplane mode) → cart → checkout → order
  appears in POS → status change → push arrives with the app closed → tracking updates.
- Side-by-side screenshots of every screen vs the web demo (`mobile/screenshots/compare/`), in both themes.
- Performance numbers from `build-and-verify` step 9.
- A short report: what's done, what's mocked, open questions, and the exact next run.
