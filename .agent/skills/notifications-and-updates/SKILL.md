---
name: notifications-and-updates
description: Push notifications shown in the phone's tray even when the app is closed (channels, deep links, inbox, settings) and in-app app updates (expo-updates OTA, Play In-App Updates, APK self-update, force update). Use for any notification or update work.
---

# Notifications & app updates

Reference: `docs/mobile-app/ARCHITECTURE.md` §8.1, §8.2.

## Push notifications

### Setup (once)
1. Firebase project for the app's Android package; `google-services.json` path set in `app.config.ts`
   (`android.googleServicesFile`). Keep the Firebase server credentials only in the backend env /
   Expo project credentials, never in the repo.
2. `expo-notifications` plugin in `app.config.ts`; notification icon (white, transparent) + accent colour.
3. Create Android channels at startup (`setNotificationChannelAsync`): `orders`, `deliveries`,
   `smartbuy`, `account` (importance HIGH, sound), `offers` (DEFAULT).
4. Ask permission after login with an explainer screen (Android 13+ `POST_NOTIFICATIONS`). If denied,
   show a small "Turn on notifications" card in Settings that opens system settings.
5. Get the Expo push token (`getExpoPushTokenAsync({ projectId })`) → `POST /me/devices`. Re-register on
   login, on token change, and on app version change. Unregister on logout.

### Sending (backend only)
- Never send pushes from the app. Write a row to `notification_jobs` (user_id, type, channel, title,
  body, data JSON with `url` deep link, dedupe_key) inside the same transaction as the business change,
  or in the sync post-commit hook for POS-originated changes.
- Worker route (cron every minute): batch up to 100 messages per Expo Push API call; store receipts;
  on `DeviceNotRegistered` delete the token; retry transient errors with backoff; respect the user's
  per-type settings and quiet hours (offers only).
- Also insert into `app_notifications` (inbox) — the inbox entry exists even if the push fails.
- Never put passwords, OTPs for others, or full NIC/phone numbers in a notification.

### Opening
- Payload `data.url` like `lankahome://orders/ONL-1023`. Handle in the root layout with
  `Notifications.addNotificationResponseReceivedListener` + `getLastNotificationResponseAsync()`
  (cold start) → `router.push(url)`; if logged out, store it and open it after login.
- Foreground: show an in-app banner and refresh the related query (`queryClient.invalidateQueries`).
- Bell icon badge = unread count from `/me/notifications`.

### Test
App killed → send a test push from the backend → it appears in the tray with sound → tap opens the right
screen. Repeat for each channel. Muting the `offers` channel in phone settings stops only offers.

## App updates

### OTA (JS-only changes)
- `expo-updates` with `runtimeVersion` policy `appVersion` (so OTA never reaches a binary it doesn't fit).
- Check on launch + on foreground (max once per 30 min); download in the background; show a snackbar
  "Update ready — Restart" (`Updates.reloadAsync()`), otherwise it applies on next cold start.
- Channels: `preview`, `production`. Publishing to `production` needs Moni's go-ahead.

### New native versions
- Play builds: Play In-App Updates — flexible flow by default (download while using → "Restart to update"),
  immediate flow when `/status.latest_version_critical = true`.
- Sideload flavour (pilot APK only): compare `/status.latest_version` with the installed version → sheet
  "Update available" → download `apk_url` (VPS) → open the installer. `REQUEST_INSTALL_PACKAGES` exists
  only in this flavour's manifest.

### Force update
`/status.min_app_version` > installed version → blocking screen with an Update button (Play listing or
APK). Raise `min_app_version` before deploying any breaking API change.

### Test
Publish an OTA with a visible text change to `preview` → installed preview app shows "Update ready" →
restart shows the change. Set `min_app_version` above the installed version on the test backend →
blocking screen appears.
