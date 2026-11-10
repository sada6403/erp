# HANDOFF — Natural Plantation mobile app (read this first, every session)

Last updated: 10 Nov 2026, 18:15 (Asia/Colombo). Owner: Moni (Mathan Monishan).
You are the coding agent (VS Code Claude agent / Claude Code). Work **autonomously**: decide using the
docs, log choices in `docs/mobile-app/DECISIONS.md`, and report to Moni once per milestone in short,
simple Tanglish or English. Stop only for the hard limits in §6.

## 1. What we are building
- One React Native (Expo, TypeScript) app **"Natural Plantation"** inside this POS ERP repo at `mobile/`.
  Roles: Customer, Smart Buy member, Field Officer (agent), Branch / Regional / Zonal Manager, Manager,
  AGM, Director. One login page; each role gets its own dashboard.
- Backend = the existing Next.js API in `backend/`, extended with `/api/app/v1`. No separate backend.
- POS desktop (Electron, `src/` + `electron/`) got: App Access, Online Store, app-order badge, assign
  agent, **Convert to invoice** (locked order price, delivery fee in invoice total, tax same as counter).
- Approved UI = web demo `C:\work\mobile app\web-demo` (GitHub `Monishan2003/mobile-app-demo`, live
  https://mobile-app-demo-jet.vercel.app/). Sales-force screens are on demo branch `design/sales-force`.

## 2. Read in this order
1. This file
2. `docs/mobile-app/RELEASE_PLAN.md` (deadline + scope)
3. `AGENTS.md` (rules, stack, approved libraries)
4. `docs/mobile-app/ARCHITECTURE.md` (§18 = sales force)
5. `docs/mobile-app/DECISIONS.md`, `PROGRESS.md`, `KEY_HANDLING.md`, `CLAUDE_CODE_KICKOFF.md`
6. `.claude/skills/*` (same as `.agent/skills/*`)
7. `CLAUDE.md` (POS desktop rules)

## 3. Where things are
| Thing | Location |
|---|---|
| Repo | `C:\work\nf plantation full project\nf plantation project\erp` (GitHub `sada6403/erp`) |
| Branch | `feature/mobile-app-foundation` — push only this. **`main` = production deploy, never push/merge.** Rebase on `origin/main` daily (another developer, Kulendradas Sabiharan, releases POS v2.9.x on main). |
| Git on this Windows repo | always `git -c core.autocrlf=true …`; pre-commit hook `.githooks` blocks key/credential files |
| Native Android build | from short-path copy `C:\np` (Windows 260-char limit). JS always from the real `mobile/` folder. Never edit code in `C:\np`. |
| Local dev | backend on :3000 + local MySQL + seeded test company; emulator `Pixel_6` uses `10.0.2.2:3000`; Moni's phone (realme, serial `0002205R60002053`) uses `adb reverse` + `mobile/scripts/phone.ps1 -Real` |
| Moni's shell | Windows **CMD** by default (not PowerShell) — give CMD commands, or open a visible window yourself |
| Play upload key | `C:\secure\nf-keys\nf-release-key.jks` (PKCS12, alias `nf-farming`, created 8 Jun 2026). Never read its password, never copy it elsewhere, never commit. EAS profiles use `credentialsSource: "remote"`. |
| VPS | `72.61.115.222` (root). Production backend in `/var/www/pos-backend`, deployed by GitHub workflow + `/usr/local/bin/pos-deploy`. Domain `nfplantation.com` (`posadmin.`, `updates.`). |
| SSH for you | key `C:\Users\matha\.ssh\nf_vps_claude`, host alias `nfvps` — **not installed on the VPS yet** (see §5) |

## 4. Play Store facts
- Existing listing **"Nature Farming"**, package **`nfgroups.naturefarming.app`**, production active (8 devices, Sri Lanka).
- versionCodes used: 1–5. Production live = 4 (0.1.3). Rejected = 5 (0.1.4). **Our first build = versionCode 6, versionName 1.0.0.**
- Rejection reason: "Login credentials are incorrect" (old Flutter app's backend `13.48.199.103` was down). Fix = working reviewer accounts (customer, Smart Buy, Field Officer, Branch Manager) flagged `is_review_account`, orders marked TEST, + exact "App access" text for Play Console.
- Pending in Console: trader status declaration; Upload-key fingerprint comparison (Moni pastes Play "Upload key certificate" SHA-1/SHA-256 + local keytool output → you answer MATCH / NO MATCH; if NO MATCH → upload-key reset path).
- Dev builds use app id `com.naturalplantation.app.dev`; staging APK `nfgroups.naturefarming.app.staging`.

## 5. CURRENT TASK — VPS blocked, waiting for access; local work in progress
**10 Nov 2026:** VPS access is blocked (root password rejected; access belongs to another developer).
All VPS steps are paused. Local work, in order: staging scripts (ready, not executed) + `STAGING_SETUP.md`,
`PRODUCTION_RUNBOOK.md`, reviewer-accounts script, Play release prep, app quality, sales force v1.0
(server → POS → RN), local E2E on Moni's phone. When access arrives: install the key via the provider
console (`nf_vps_claude.pub` → `/root/.ssh/authorized_keys`), then run Stage 1 below.

### Stage 1 (when VPS access arrives): staging backend on the VPS + staging APK
Status: SSH key generated, **not installed**. `ssh nfvps` → "Permission denied". A visible window
"Install VPS key" was opened for Moni to type the VPS root password once.
Next:
1. If the key still isn't installed, open the install window again (visible) and wait; Moni types the
   root password there. Never ask for / store it.
2. Read-only pre-checks (OS, disk, RAM, Node/Docker/pm2, MySQL, nginx sites, ports, how production runs).
3. Backups before any change: nginx config + mysqldump of production DBs → `/root/backup-<date>/`.
4. Separate staging: `/var/www/pos-staging` (this branch), own process + free port, own MySQL DBs + user,
   seeded test company + App Key.
5. HTTPS without DNS: nginx server block `staging-api.72-61-115-222.sslip.io` + certbot (fallback nip.io).
6. Verify status endpoint, every seeded role's login, an order, the order visible from a POS pointed at staging.
7. Staging APK (app id above, API = staging URL, mocks off, staging signing key in
   `C:\secure\nf-keys\staging\`) → `C:\work\mobile app\release\NaturalPlantation-STAGING-<date>.apk`,
   install on Moni's phone.
8. Write `docs/mobile-app/PRODUCTION_RUNBOOK.md` (plan only: backup/restore test, merge plan with main
   developer, backend deploy, POS desktop release to branch PCs, real company App Key, reviewer accounts,
   production AAB via EAS with the Play key, Internal testing → Production, rollback per step).
9. One final report: staging URL, test logins (seed only), APK path/size, verified items, failures/skips,
   rollback commands, the single step to go to production.

## 6. Hard limits (only reasons to stop and ask Moni)
- Any change to production: `/var/www/pos-backend`, its process, production databases (dump only), existing
  nginx sites, `pos-deploy`, the deploy workflow, `main`.
- Play Store upload, OTA publish, real WhatsApp messages, live payment keys.
- Wallet spending/sync changes (ARCHITECTURE §10), salary payroll going live.
- A library not listed in AGENTS.md §4.
- Never handle passwords; never copy/commit keys.

## 7. Backlog after Stage 1 (in order)
1. Upload-key MATCH check → `eas credentials` (Moni types passwords) → production AAB → Play Internal testing (versionCode 6).
2. Reviewer accounts script (real company, after production approval).
3. Sales force v1.0 (ARCHITECTURE §18): hierarchy + role dashboards, targets, field visits + reminders, agent Smart Buy join. Design on `design/sales-force` — confirm Moni approved it before building.
4. v1.1: payroll/commission (rates are data in `salary_rules`/`commission_slabs`; real slabs still pending from company), PayHere card payments (sandbox until approved), draw proof video, wallet spending, Bluetooth printing, Join Smart Buy, WhatsApp Cloud API.

## 8. Waiting on Moni / company (don't block on these; note them in reports)
- VPS root password (for the one-time key install)
- Play upload-key fingerprints (compare), trader status declaration
- Expo account username; Firebase project + `google-services.json` (package `nfgroups.naturefarming.app`)
- Sales-force design approval; company answers: Manager-level scope (#3), real salary threshold/slabs/basic salaries (#6)
- PayHere merchant account
- Delete the keystore message from WhatsApp after it's stored in EAS

## 9. Dates
- v1.0 on Play target: **21 Nov 2026** (submit by 19 Nov). Build 1 to Internal testing slipped from 11 Nov; do it as soon as staging + key + Firebase are ready.
