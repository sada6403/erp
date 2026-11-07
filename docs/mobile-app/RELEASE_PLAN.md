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
