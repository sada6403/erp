# Natural Plantation app — 14-day release plan (7 → 21 Nov 2026)

Goal: replace the old "Natural Farming" Flutter app on its existing Play Store listing with the new
React Native app by **21 Nov 2026**, then keep shipping features as updates.

## How releases work
| Channel | Who sees it | Use |
|---|---|---|
| Play **Internal testing** | Up to 100 testers by email (boss, team) | Every build from day 4. Installs from the Play Store like a normal app. |
| Play **Production** | Everyone | v1.0 on day 12, then normal updates |
| **OTA update** (`expo-updates`) | Installed apps on that channel | JS/UI-only fixes in minutes, no Play review. Native changes still need a Play build. |

Every Play build: same package name, same upload key, `versionCode` + 1.

## Day by day

| Day | Date | Moni | Claude Code / dev |
|---|---|---|---|
| 0 | Sat 7 Nov | Push branch; Play Console checks (package name, Play App Signing, upload key, production access); request upload-key reset if the key is lost; testers email list; create test company | Repo setup; start Run 1 (backend auth + catalog, app shell, POS App Access) |
| 1–3 | 8–10 Nov | Expo account + Firebase project; give package name | Auth (phone / member no / agent code), catalog + variants sync fix, cart, COD orders into POS, order tracking, offline catalog, themes, EAS build profiles with the Play package |
| 4 | Wed 11 Nov | Install from Play internal link and review | **Build 1 → Internal testing** (boss preview) |
| 5–8 | 12–15 Nov | Daily feedback in one list | Smart Buy read-only (schemes, statement, draws, passbook/wallet balance), Agent (deliveries, OTP completion, members, earnings), push notifications, WhatsApp click-to-chat invites; builds every 1–2 days, OTA for JS fixes |
| 9–10 | 16–17 Nov | Play listing: new name/icon/screenshots/description, Data safety, financial features declaration, privacy policy + account deletion URLs, reviewer test login, content rating | Hardening: test matrix, performance budget, crash fixes; privacy/deletion pages |
| 11 | Wed 18 Nov | Approve backend production deploy; create real-company App Key; invite pilot users | Deploy backend (after approval); production build |
| 12 | Thu 19 Nov | Submit **v1.0 to Production** | Watch crashes/logs |
| 13–14 | 20–21 Nov | Buffer for Play review (can take hours to several days) | Fixes via OTA |

## v1.0 scope (real data only — no fake data in any Play build)
In: login (no SMS), shop (browse, search, variants, weight items, cart, COD/bank slip order, tracking,
cancel), offline catalog, notifications, themes, languages, account deletion; Smart Buy read-only;
Agent deliveries with OTP, members, earnings read-only.

Next updates (v1.1+): draw proof video, wallet spending in shop (needs the wallet sync fix,
ARCHITECTURE §10), Bluetooth bill printing, Join Smart Buy request, WhatsApp Cloud API, agent cash
collection entry, reviews/returns, live agent location.
Screens for these show "Coming in the next update", never mock data.

## Risks to clear on day 0
1. **Package name / upload key.** The Flutter source on the PC uses `com.example…` with debug signing,
   so the Play build was made elsewhere. Get the real package name from Play Console. If the upload key
   is lost, request an upload-key reset now (Play App Signing must be on).
2. **Production access.** If the developer account is personal and the app has no production access
   yet, Play requires a closed test with ≥ 12 opted-in testers for 14 days before production. Check the
   Dashboard; if it applies, start the closed test today.
3. **Review time** is not under our control. Submit v1.0 by day 12.
4. **Backend deploy** touches production; only after Moni approves (day 11).

## Added 2026-11-07: POS desktop release and branch hygiene
- Convert-to-invoice lives in the POS desktop (`orders:convertToInvoice`, delivery fee on invoices, new columns). v1.0 therefore also needs a **POS desktop release with these changes installed on all branch PCs before the app goes live**. Plan it for **day 11 (Wed 18 Nov) together with the backend deploy**. Order: backend first (new columns migrate on first API hit), then desktop. Both only with Moni's approval.
- `main` moves fast (other developers release v2.9.x). Rebase `feature/mobile-app-foundation` on `origin/main` **at least once a day** and report any conflict in POS files (`electron/ipc/invoices.ts`, `orders.ts`, `electron/preload.ts`, `electron/database.ts`) immediately. Last checked 2026-11-07: branch is 0 commits behind `origin/main`.

## Proposed 2026-11-08: Sales force (Run 3) split between v1.0 and v1.1
Not approved yet; see ARCHITECTURE.md section 18.
- **v1.0 (21 Nov, if the demo is approved this week):** hierarchy + role dashboards (read-only), targets set in the POS, field visits with offline outbox and follow-up reminders (local notifications), agent-initiated Smart Buy join with POS approval.
- **v1.1:** salary/commission payroll and approvals, card payments live (sandbox code may ship earlier behind a flag, never live keys), in-app target assignment, server-side reminder fallback (needs a scheduler).
- Risk to v1.0: this adds POS desktop migrations (`branches.region_id`, `staff_assignments`, `staff_targets`) to the day-11 POS release; backend first, then desktop, only with Moni's approval.

## v1.1: fast updates right after launch (target 25 to 28 Nov 2026)
Decided by Moni on 2026-11-13 ("the v1.1 items ship as fast updates right after"). Everything moved out of v1.0 to protect 21 Nov:
**Sales force**
- Salary rules, commission slabs, the monthly performance job and the approval chain (reuse `commissionEngine.ts` and the existing approval states).
- Card payment (PayHere hosted page; sandbox first, live keys only with Moni's approval).
- Reassign customers between officers; activate / deactivate subordinates.
- Leaderboard and alerts on the management dashboard; deliveries and join requests in the per-person drill-down; date filters beyond this month and last month.
- Server reminder push for follow-ups (needs a scheduler: a stop-and-ask deploy item).
- Syncing `staff_assignments`, `staff_targets` and `field_visits` to the POS database (they are cloud-only in v1.0; the POS page reads them from the cloud).
**Smart Buy cash collection**
- Managers see their team's collections by person and by day inside their scope.
- Bluetooth thermal printing of receipts (PDF to WhatsApp ships in v1.0).
**Housekeeping**
- Native review of the Tamil and Sinhala wording (`sf.*`, `collect.*`, `fewLeft`).
- Fix the one-day-early monthly due date in the POS (`cycleDueDate`), see PROGRESS 2026-11-13.
**Added 2026-11-13 (from the test.3 work)**
- Product share as an https link (universal / app links need a domain; v1.0 shares `naturalplantation://product/<id>`).
- "Newest" sort uses `updated_at`; add `created_at` to the product list DTO for a true newest.
- POS category image upload (today only a manual URL; the create form does not save `image_url`) and a category-assignment helper for the 775 uncategorised production products.
- Pinch-zoom gallery uses built-in gestures (no gesture-handler); revisit if a gesture library is approved.
- Order-by-order review prompts (push "How was your order?" after delivery) and photo reviews.
- Email: per-user unsubscribe for marketing types (none are marketing in v1.0), delivery status webhooks from the email provider.
- Native review of Tamil and Sinhala wording for the new `product.*`, `categories.*`, join and email strings.
