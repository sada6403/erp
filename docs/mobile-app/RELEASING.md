# Releasing the mobile app

Two channels exist everywhere: `test` (staging, sideloaded APK) and `production` (Google Play).
Rule of thumb: agents may touch `test`; anything `production`, Play or a deploy needs the owner.

## What goes where

| Change | Path | Reaches |
|---|---|---|
| JS / assets only (no new native module, no permission, no SDK bump) | OTA with `eas update` | installed builds with the same `runtimeVersion` |
| Anything native (new library with native code, permission, Expo SDK, app.config plugins) | New build + version bump | users who install it |

OTA policy: `runtimeVersion: { policy: "appVersion" }`, so an OTA only reaches binaries with the same
`version` in `app.config.ts`. Bump `version` whenever the native layer changes; the old OTA stream then
stops for that app version by design. Channels (`eas.json` build profiles): `test`, `production`.

## (a) JS-only fix

```
cd mobile
npx tsc --noEmit && npm test                         # must be green first
eas update --channel test --message "fix: <what>"    # agents may run this
eas update --channel production --message "fix: <what>"   # OWNER ONLY
```
Verify on a test phone: app shows "Update ready", restart, change is visible. Only then ask the owner
to publish to `production` (the owner approves each production update).

## (b) Native change

1. Bump `version` in `mobile/app.config.ts` (test builds: `1.0.0-test.N`, Play: `1.0.0`; bump `versionCode`).
2. Build.
   - Staging / test APK: the local gradle pipeline (see `TEST_APK_GUIDE.md`); agents may do this.
   - Play: `eas build -p android --profile production` (OWNER approves and runs; EAS credentials stay with the owner).
3. Upload.
   - Test: copy the APK to the staging server directory served over https (host must be on the allow-list below).
   - Play: owner uploads the AAB to Play Console, internal testing first, then staged rollout.
4. Publish the version in POS -> Mobile App -> **App Versions**.
   - Test tab: latest, minimum, release notes (en/ta/si), APK URL, press Save, then **Fetch & hash APK**
     (server downloads the APK, max 120 MB, stores SHA-256 + size). Agents may do this.
   - Production tab: latest / minimum / notes. OWNER ONLY, and only after the build is live on Play.
5. Check: `GET /api/app/v1/status?platform=android&channel=test&version=<installed>` shows the new
   `latest_version`, `update_url`, `apk_sha256`, and `update_required` / `update_available` as expected.

Server rules: `update_url` must be https on a host from `APP_UPDATE_HOSTS` (comma list; default the
`PUBLIC_BASE_URL` host). The production channel never serves `update_url` (Play handles it).
Versions are semver: `1.0.0-test.5 < 1.0.0-test.6 < 1.0.0-test.10 < 1.0.0` (trailing number compared
numerically; the plain release beats any test tag). Minimum cannot exceed latest.
Raise the minimum only after the matching build is available, and before any breaking API change.

## (c) Rollback

| Problem | Action | Who |
|---|---|---|
| Bad OTA | `eas update --channel <ch> --republish --group <good-group-id>` or `eas update:rollback --channel <ch>` (back to the embedded bundle) | test: agents; production: OWNER |
| Bad Play release | Play Console -> halt the staged rollout; promote the previous release | OWNER |
| Force screen blocks good users | Lower `min_version` in App Versions (takes effect on the next status check) | test: agents; production: OWNER |
| Bad test APK | Put the previous APK URL + its hash in App Versions, lower latest | agents |

## (d) What the app does

- Checks `/status` on launch and on foreground (version sent as `?version=`; channel from the build flavour).
- Installed < minimum (`update_required`): full-screen blocking "Update" screen, no way past it.
- Installed < latest (`update_available`): dismissible sheet with the release notes in the user's language;
  after dismissal it shows again after 3 days.
- Play build: Google Play In-App Updates, IMMEDIATE flow when forced or `latest_version_critical`, FLEXIBLE otherwise.
- Test build: downloads the APK from `update_url`, verifies SHA-256 against `/status.apk_sha256`
  (mismatch = discard, show an error), then opens the system installer.
  `REQUEST_INSTALL_PACKAGES` exists only in the staging/test flavour manifest, never in the Play build.
- OTA (`expo-updates`): background download, "Update ready - Restart" snackbar, otherwise applied on next cold start.

## (f) Play In-App Updates (Play build)

The Play build uses `expo-in-app-updates` 0.13.0 (approved 2026-11-13). `useAppUpdate().start()` calls `checkAndStartUpdate(forced)`:
**IMMEDIATE** (full-screen Play flow) when the installed version is below `min_app_version`, **FLEXIBLE** (background download, then restart prompt) otherwise.
If the library or Play is unavailable the app opens the Play listing so a forced user is never stuck.

- **Can only be fully tested from Play Internal testing.** Play offers an update only to an app installed from Play with a higher `versionCode` published in the same track. Sideloaded/staging builds never see it (they use the APK self-update path instead).
- Test steps (owner, after the first Play upload): install build N from the Internal track, upload build N+1 to Internal, open N: the Play update flow appears. Raise `min_app_version` in POS > App Control > App Versions (production row) to test IMMEDIATE.
- The Play build must never declare `REQUEST_INSTALL_PACKAGES`: `eas.json` production `prebuildCommand` runs `scripts/check-play-manifest.cjs`, which fails the build if it does.

## (e) Hard STOP list (ask the owner, never do)

- Any `eas update --channel production` or production build.
- Anything in Play Console (upload, rollout, halt, listing).
- Saving the Production tab in App Versions, or editing production `app_settings`.
- Deploying to production, pushing to `main`, running anything against production data or the production VPS.
- Putting secrets (sync `x-api-key`, EAS tokens, keystores, Firebase credentials) in the app, the repo or logs.
- Adding `REQUEST_INSTALL_PACKAGES` outside the test flavour.
