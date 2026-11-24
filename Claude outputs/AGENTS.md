# AGENTS.md — LankaHome Customer & Agent App

Instructions for any AI coding agent (Antigravity, Claude Code, Gemini, Cursor) working on this project.
Read this file fully before the first change in every session. Then read `docs/ARCHITECTURE.md`
for the area you are touching, and load the matching skill from `.agent/skills/`.

---

## 1. What we are building

One Android app (working name **LankaHome**, package `com.aistudio.lankahome.qvxzmt`) for ONE
company (single tenant for now). It connects live to the company's existing **POS ERP** system.

One login screen, three roles, three dashboards:

| Role | Gets an account how | Sees |
|---|---|---|
| Agent | POS admin enables app access → credentials sent on WhatsApp | Own commission, own schemes & members, assigned deliveries, bill printing |
| Smart Buy customer | Existing members: POS admin sends credentials on WhatsApp. New: join request from app → POS admin approves | Scheme statement, draws + draw proof video, wallet (products only) |
| Normal customer | Self-register in app (phone + password, email optional) | Shop: browse, cart, wishlist, orders |

Agents and Smart Buy customers can switch to the Shop with one tap. A person can hold several roles
on one account (roles are added to the account, never a second login).

The approved UI concept is the current demo (screens for Guest / Customer / Smart Buy / Agent).
Do not redesign it. Change only what a task asks for.

## 2. Repositories and where code goes

| Repo | Path (Moni's PC) | What lives there |
|---|---|---|
| Mobile app | this repo | Kotlin + Jetpack Compose Android app |
| POS ERP | `C:\work\nf plantation full project\nf plantation project\erp` (GitHub `sada6403/erp`) | Electron desktop POS (`electron/`, `src/`), Next.js 15 cloud backend (`backend/`), Super Admin portal (`portals/superadmin/`) |

- All new server endpoints for the app go in the ERP repo: `backend/app/api/app/v1/**`.
- New POS admin screens (App Access, Join Requests, Online Store, Draw Video upload) go in the ERP repo
  `src/pages/admin/**` + `electron/ipc/**`.
- Never put business logic that must be trusted (prices, wallet, stock, roles) in the mobile app.

## 3. Golden rules (never break these)

1. **No secrets in the app.** Never embed the POS sync `api_key` (company `x-api-key`) in the APK.
   The app uses a separate **App Key** (`x-app-key`, identifies the company only) + the user's JWT.
2. **Every app API call is scoped on the server** by: App Key → company → tenant DB, and JWT → user →
   role → `customer_id` / `agent_id`. An agent sees only rows where `agent_id` = their id. A customer
   sees only their own rows. Never trust ids sent by the client for ownership.
3. **Schema changes are additive only**, and only in `backend/lib/auth.ts` → `ensureTenantCompatibility()`.
   A table the POS desktop must read/write also needs: `ALLOWED_TABLES` in `backend/lib/sync.ts`
   + a desktop SQLite migration in `electron/database.ts`. App-only tables stay cloud-only.
   Use skill `erp-schema-change`.
4. **Wallet money moves only on the server**, inside one DB transaction with a row lock, written as a
   ledger row. Never compute or store a balance on the phone. Use skill `smartbuy-wallet`.
5. **Draw proof videos are private.** Never use the public `/api/files/*` route, never YouTube public or
   unlisted links. Videos stream only through short-lived signed URLs to logged-in members of that
   scheme, played with `FLAG_SECURE`. Use skill `draw-proof-video`.
6. **No SMS anywhere.** The SMS gateway is not used. Credentials and password resets go over WhatsApp;
   optional email verification goes over the company SMTP. Use skill `whatsapp-credentials`.
7. **Offline-first reads.** Every list/detail screen renders from the local cache first. Buying,
   wallet payment, join requests and delivery completion need the server — show the offline sheet,
   never fail silently. Use skill `offline-cache`.
8. **Theme tokens only.** No hard-coded colours in UI code. Two themes: Olive & Yellow (default) and
   Purple & Pink, user-selectable in Settings, saved in DataStore. Status colours (success/warning/
   error/discount) are fixed across themes.
9. **Never touch a real company's data** (`natural-plantation` tenant or any other) while developing.
   Use a test tenant. Ask Moni before any migration, backfill or bulk message runs on production.
10. **Never send bulk WhatsApp messages** (credentials, offers) without Moni's explicit go-ahead in chat.

## 4. Tech stack

**Android app:** Kotlin, Jetpack Compose + Material 3, MVVM with unidirectional data flow, Hilt,
Navigation Compose, Retrofit + OkHttp + kotlinx.serialization, Room, DataStore, WorkManager,
Coil 3, Media3 ExoPlayer, Firebase Cloud Messaging, ML Kit barcode scanning, CameraX (NIC photos),
Fused Location (nearby branches), Bluetooth ESC/POS printing, Tink/EncryptedSharedPreferences for tokens.
Check `app/build.gradle.kts` before adding a library; do not add a second library for the same job.

**Backend:** Next.js 15 route handlers (Node runtime), MySQL via `withTenant()` / `company.tp`
(`backend/lib/db.ts`, `backend/lib/tenant.ts`), JWT helpers in `backend/lib/jwt.ts`, email via
`backend/lib/email.ts`, rate limits via `backend/lib/rateLimit.ts`.

## 5. App package layout

```
app/src/main/java/com/aistudio/lankahome/
  core/
    network/      Retrofit API, auth interceptor (x-app-key + Bearer), connectivity monitor
    database/     Room DB, DAOs, entities, outbox
    auth/         session, token store, role resolver
    designsystem/ theme (2 themes), tokens, shared components
    util/         money (Rs formatting), dates, result types
  data/           repositories (one per domain), DTO ↔ entity mappers
  feature/
    auth/         login, register, first-login password change, email verify
    shop/         home, categories, product, cart, checkout, orders, wishlist
    smartbuy/     dashboard, statement, draws, draw video, wallet, join flow
    agent/        dashboard, members, commission, deliveries, bill print
    settings/     profile, theme, language, notifications
  MainActivity.kt
```

## 6. How to do a task

1. Restate the task in 2–3 lines and list the files you expect to touch.
2. Load the matching skill(s) from `.agent/skills/` and follow them.
3. Make the smallest change that completes the task. Keep the approved UI.
4. Server first, then app: an app screen never ships before its endpoint exists and is tested.
5. Run the checks in section 7.
6. Report: what changed (files), how you verified it, screenshots for UI work, anything left open.

## 7. Definition of done

- App: `./gradlew assembleDebug` and `./gradlew testDebugUnitTest` pass; installed on the `Pixel_6`
  emulator (`preview.bat`), the changed screens checked in BOTH themes and in offline mode
  (airplane mode) where the screen reads data.
- Backend: `npm run typecheck` in `backend/` passes; each new endpoint tested with a valid token, a
  token of the wrong role, another user's id, and no token.
- Desktop (if touched): `npm run typecheck` at repo root passes.
- No secrets, keys or real customer data committed. `.env` stays git-ignored.

## 8. Skills index (`.agent/skills/`)

| Skill | Use when |
|---|---|
| `app-api-endpoint` | Adding or changing any `/api/app/v1` endpoint |
| `erp-schema-change` | Any new table/column in the cloud or desktop DB |
| `android-compose-screen` | Building or changing an app screen |
| `offline-cache` | Any screen that loads data, or any action that needs the server |
| `smartbuy-wallet` | Anything touching wallet balance, wallet checkout, wallet credit |
| `draw-proof-video` | Draw video upload (POS) or playback (app) |
| `whatsapp-credentials` | Login credentials, password reset, email verification, WhatsApp messages |
| `build-and-verify` | Building, installing, previewing, release APK |

## 9. Language

Code, comments, commit messages and docs in English. Moni is fine with Tanglish in chat.
User-facing app text goes through string resources (English, Tamil, Sinhala).
