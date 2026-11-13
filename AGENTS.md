# AGENTS.md — LankaHome mobile app + App API (inside the POS ERP repo)

Instructions for any AI coding agent (Antigravity, Claude Code, Gemini, Cursor) working on the
customer/agent mobile app and the server code it needs. For the POS desktop itself, `CLAUDE.md` at
the repo root still applies. Read this file fully before the first change in every session, then
`docs/mobile-app/ARCHITECTURE.md` for the area you touch, then the matching skill in `.agent/skills/`.

---

## 1. What we are building

One **React Native (Expo)** app, working name **LankaHome**, for ONE company (single tenant for now),
built as part of this POS ERP repo. It connects live to the existing POS ERP cloud backend (Next.js).

One login screen, three roles, three dashboards:

| Role | Gets an account how | Sees |
|---|---|---|
| Agent | POS admin enables app access → credentials sent on WhatsApp | Own commission, own schemes & members, assigned deliveries, bill printing |
| Smart Buy customer | Existing members: POS admin sends credentials on WhatsApp. New: join request from app → POS admin approves | Scheme statement, draws + draw proof video, wallet (products only) |
| Normal customer | Self-register in app (phone + password, email optional) | Shop: browse, cart, wishlist, orders |

Agents and Smart Buy customers can switch to the Shop with one tap. One account can hold several roles.

The approved UI is the demo seen in the Kotlin/AI Studio prototype (Guest / Customer / Smart Buy /
Agent screens). That prototype is a **design reference only**. Rebuild its screens in React Native.
Do not port Kotlin code, and do not redesign.

## 2. Repo layout (this repo)

```
erp/
  backend/                 Next.js 15 cloud API (existing). App API goes in backend/app/api/app/v1/
    lib/app/               NEW: app auth/context, scoping, wallet, media signing, notify
    lib/app/contracts/     NEW: TypeScript types for every App API request/response (type-only)
  electron/  src/          POS desktop (existing). New admin pages: App Access, Join Requests,
                           Online Store, Draw video upload
  portals/superadmin/      Super Admin (existing). App Key generation, WhatsApp/SMTP keys
  mobile/                  NEW: Expo React Native app (own package.json, own tsconfig)
  docs/mobile-app/         ARCHITECTURE.md and decisions
  .agent/skills/           Skills for agents
```

- `mobile/` is independent: its own `package.json`, `node_modules`, `tsconfig.json`. Never install
  mobile packages at the repo root, and never import desktop code (`src/`, `electron/`) into `mobile/`.
- Shared API types live in `backend/lib/app/contracts/`. Mobile imports them **type-only**
  (`import type { … } from '@contracts/…'`) via a tsconfig path. Contracts files must contain only
  types: no runtime code, no imports from other backend files.
- `.github/workflows/deploy-vps.yml` deploys production on every push to `main`. Work on a feature
  branch (`feature/mobile-app-*`). Make sure `paths-ignore: ['mobile/**']` is in that workflow so
  mobile-only commits never trigger a VPS deploy.

## 3. Golden rules (never break these)

1. **No secrets in the app.** Never put the POS sync `api_key` (`x-api-key`) in the app or in
   `mobile/.env`. The app uses a separate **App Key** (`x-app-key`, identifies the company only) +
   the user's JWT. Anything in an Expo `EXPO_PUBLIC_*` variable ends up readable inside the APK.
2. **Server-side scoping on every App API call:** App Key → company → tenant DB; JWT → user → role
   → `customer_id` / `agent_id`. Never trust ownership ids sent by the client.
3. **Schema changes are additive only**, in `backend/lib/auth.ts` → `ensureTenantCompatibility()`.
   Tables the POS desktop uses also need `ALLOWED_TABLES` (`backend/lib/sync.ts`) and a desktop
   SQLite migration (`electron/database.ts`). Existing tables are reused, not redesigned.
   Skill: `erp-schema-change`.
4. **Wallet money moves only on the server**: one DB transaction, row lock, ledger row, idempotency
   key. Skill: `smartbuy-wallet`.
5. **Draw proof videos are private**: never the public `/api/files/*`, never YouTube. Short-lived
   signed URLs, members of that scheme only, screen capture blocked. Skill: `draw-proof-video`.
6. **No SMS anywhere.** Credentials/resets over WhatsApp, optional email verification over company
   SMTP. Skill: `whatsapp-credentials`.
7. **Offline-first reads.** Screens render from the persisted cache first. Ordering, wallet payment,
   join requests and password changes need the server: show the buy-later sheet, never fail silently.
   Skill: `offline-cache`.
8. **Theme tokens only.** No hard-coded colours in components. Themes: Olive & Yellow (default),
   Purple & Pink. User-selectable in Settings, persisted. Status colours fixed across themes.
9. **Never touch a real company's data** while developing. Use the test company. Ask Moni before any
   migration, backfill or deploy that reaches production.
10. **Never send bulk WhatsApp messages** without Moni's explicit go-ahead in chat.
11. **Light and smooth beats feature-rich.** Respect the performance budget in ARCHITECTURE §11.2
    (≤ 25 MB download, ≤ 2.5 s cold start on a low-end phone, 60 fps lists). Every new library needs a
    reason; prefer Expo modules and platform components. Thumbnails come from the server, never full images in lists.
12. **Every user-facing event gets a push + inbox entry + deep link** (order, delivery, wallet, draw,
    join, account). Pushes go through the backend notification queue, never from the app. Skill
    `notifications-and-updates`.
13. **Never break an installed app.** API changes are backward compatible; a breaking change needs
    `min_app_version` raised first. OTA (expo-updates) only for JS-only changes.
14. **Never print secret values.** When looking for config (`.env`, pm2 env, `DATABASE_URL`, SMTP/email keys, API keys, tokens), on the VPS or locally, print key NAMES only (`grep -o '^[A-Z_]*='`) or mask everything after `=`. A connection string is a secret as a whole (it holds the password). Run scripts that read the secret themselves and print results only. (Added 2026-11-13 after production DATABASE_URL credentials were printed in an agent session.) **Extended 2026-11-13 (a crontab leak slipped past an ad-hoc sed):** the rule also covers `crontab -l` and `/etc/cron.d`, systemd units (`systemctl cat`, `/etc/systemd`), pm2 (`pm2 env`, `pm2 jlist`, `~/.pm2/dump.pm2`), shell history (`.bash_history`, `history`), `docker inspect` and compose files, and process lists (`ps`, `/proc/*/environ`), on the VPS and locally. **Self-check before running any command: does it read a config / env / crontab / unit / dump file? If yes it MUST pipe through the mask helper**, e.g. `ssh -o BatchMode=yes nfvps 'crontab -l' | node scripts/mask-secrets.mjs`. The helper (`scripts/mask-secrets.mjs`, tested in `electron/__qa__/mask-secrets.test.ts`) masks KEY=value, KEY: value, `--flag value`, headers such as `x-cron-secret: ...`, `Authorization: Bearer ...`, URL `user:pass@`, JSON `"key":"value"` and 32+ char hex/base64 tokens; it is a safety net, not permission to dump files: prefer key NAMES only.


## 4. Tech stack

**Mobile (`mobile/`):** Expo (latest stable SDK) + TypeScript strict, Expo Router (file-based
navigation), development build via `expo-dev-client` (needed for Bluetooth printing; Expo Go is not
enough), EAS Build for APK/AAB.

| Concern | Library |
|---|---|
| Server state + offline cache | TanStack Query v5 + `persistQueryClient` on MMKV (`react-native-mmkv`) |
| Client state (session, cart, theme, outbox) | Zustand (same as the POS desktop) persisted to MMKV |
| HTTP | axios with interceptors (`x-app-key`, Bearer, refresh-token rotation) |
| Tokens | `expo-secure-store` |
| Connectivity | `@react-native-community/netinfo` |
| Forms + validation | react-hook-form + zod |
| Lists | `@shopify/flash-list` |
| Images | `expo-image` (disk cache) |
| Video | `expo-video` |
| Block screenshots/recording | `expo-screen-capture` (`usePreventScreenCapture`) |
| Push (system tray, app closed too) | `expo-notifications` + FCM (Expo Push API from the backend), Android channels, deep links |
| App updates | `expo-updates` (OTA JS updates) + `expo-in-app-updates` 0.13.0 (Play In-App Updates API: IMMEDIATE when forced, FLEXIBLE otherwise; approved by owner 2026-11-13) / APK self-update (sideload flavour) |
| APK self-update (staging/test flavour only) | `expo-file-system` (download the APK), `expo-crypto` (SHA-256 check against /status), `expo-intent-launcher` (open the Android installer). Expo first-party; owner informed 2026-11-13. |
| Maps (store locator, delivery pin) | `react-native-maps` — only on the screens that need it |
| Location | `expo-location` |
| Camera / NIC photos / barcode | `expo-camera`, `expo-image-picker` |
| PDF bill + share | `expo-print` + `expo-sharing` |
| Bluetooth ESC/POS printing | one maintained RN ESC/POS Bluetooth library, chosen after testing on the real printers (see skill `build-and-verify`) |
| i18n | i18next + react-i18next + `expo-localization` (en, ta, si) |
| Tests | Jest + React Native Testing Library; Maestro for E2E flows |

Approved by Moni on 2026-11-07 (do not ask again): `react-native-nitro-modules` (required peer of
`react-native-mmkv` v4), `expo-device` (device model/OS for push registration), `expo-constants` (app
config/version at runtime), `expo-linking` (deep links from pushes and WhatsApp), `expo-splash-screen`
(hold splash until fonts and session load), `expo-system-ui` (status/navigation bar colours per theme),
`expo-status-bar` (status bar style per theme). Dev-only: jest, jest-expo, `@react-native/jest-preset`,
React Native Testing Library, eslint and `eslint-config-expo` (the checks required in section 7).
Check `mobile/package.json` before adding a library. Use `npx expo install` for Expo-compatible
versions. Never add a second library for the same job.

**Backend:** Next.js 15 route handlers (Node runtime), MySQL via `withTenant()` / `company.tp`,
`backend/lib/jwt.ts`, `backend/lib/email.ts`, `backend/lib/rateLimit.ts`, `backend/lib/secretCrypto.ts`.

## 5. Mobile app layout

```
mobile/
  app/                         Expo Router routes
    (auth)/login.tsx, register.tsx, set-password.tsx, verify-email.tsx
    (shop)/index.tsx, categories.tsx, product/[id].tsx, cart.tsx, checkout.tsx, orders/…
    (smartbuy)/index.tsx, statement.tsx, draws.tsx, draw-video/[id].tsx, wallet.tsx, join/…
    (agent)/index.tsx, members/…, deliveries/…, commission.tsx, bill/[id].tsx
    settings/…
    _layout.tsx                providers + role-based redirects
  src/
    api/                       axios client, endpoint functions (typed with @contracts)
    query/                     query keys, queryClient, MMKV persister
    store/                     zustand: session, cart, theme, outbox
    theme/                     tokens, OliveYellow, PurplePink, ThemeProvider, useTheme
    components/                shared UI (cards, chips, badges, stat card, bottom sheet, banners)
    features/<area>/           hooks + components per area (shop, smartbuy, agent, auth)
    lib/                       money (Rs), dates, phone, connectivity, secure-screen
    i18n/                      en.json, ta.json, si.json
  app.config.ts                reads API_BASE_URL / APP_KEY from env per build profile
  eas.json
```

## 6. How to do a task

1. Restate the task in 2–3 lines and list the files you expect to touch.
2. Load the matching skill(s) and follow them.
3. **Server first, then app:** add the contract type, then the endpoint (tested), then the screen.
4. Make the smallest change that completes the task. Keep the approved UI.
5. Run the checks in section 7.
6. Report: files changed, how you verified, screenshots for UI work, anything left open.

## 7. Definition of done

- Mobile: `npx tsc --noEmit`, `npx expo lint`, `npm test` pass in `mobile/`. Run on the `Pixel_6`
  emulator (`npx expo run:android` or the dev build). Changed screens checked in both themes, in each
  role they belong to, and in airplane mode for data screens.
- Backend: `npm run typecheck` in `backend/` passes. Each new endpoint is tested with the right role,
  a wrong role, another user's id, no token, and a wrong App Key.
- Desktop (if touched): `npm run typecheck` at the repo root passes.
- No secrets or real customer data committed. `mobile/.env*` stay git-ignored.

## 8. Skills index (`.agent/skills/`)

| Skill | Use when |
|---|---|
| `app-api-endpoint` | Adding/changing any `/api/app/v1` endpoint or contract type |
| `erp-schema-change` | Any new table/column in the cloud or desktop DB |
| `rn-screen` | Building or changing a React Native screen |
| `offline-cache` | Any screen that loads data, or any action that needs the server |
| `smartbuy-wallet` | Wallet balance, wallet checkout, wallet credit, wallet sync |
| `draw-proof-video` | Draw video upload (POS) or playback (app) |
| `whatsapp-credentials` | Login credentials, password reset, email verification, WhatsApp messages |
| `notifications-and-updates` | Push notifications, notification channels/inbox/deep links, OTA and in-app updates, force update |
| `build-and-verify` | Running, previewing, building APK/AAB, printer testing, performance checks |

## 9. Language

Code, comments, commits and docs in English. Moni is fine with Tanglish in chat.
All user-facing app text goes through i18n keys (English, Tamil, Sinhala).
