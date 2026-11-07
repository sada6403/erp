---
name: build-and-verify
description: Run, preview and build the LankaHome Expo app (mobile/) on the Pixel_6 emulator or a phone, take verification screenshots, test Bluetooth printing, and produce APK/AAB builds. Use at the end of every app task.
---

# Build & verify (Expo)

Environment: Windows, PowerShell. Android SDK `C:\Users\matha\AppData\Local\Android\Sdk`. AVD `Pixel_6`.
App code in `erp\mobile`. A development build is required (Bluetooth printing and MMKV are native),
so Expo Go is not used.

## Every app task
1. In `mobile/`: `npx tsc --noEmit`, `npx expo lint`, `npm test` must pass.
2. Start the emulator with a visible window (never `-no-window`):
   `& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Pixel_6`
3. Run: `npx expo run:android` (first time, or after native/library changes), then
   `npx expo start --dev-client` for fast reloads.
4. Backend for dev: local `backend` on port 3000 → app `API_BASE_URL=http://10.0.2.2:3000` in
   `mobile/.env.development` (git-ignored). Never point a dev build at production.
5. Check the changed screens in both themes, for each role (demo role switch in dev builds only),
   and in airplane mode for data screens.
6. Screenshots: `adb exec-out screencap -p > mobile\screenshots\<screen>-<theme>.png`; attach to the report.
7. Crashes: `adb logcat -d *:E | findstr ReactNativeJS`.
8. Maestro flows (when present): `maestro test mobile/.maestro/`.
9. Performance (every release build, on the low-end phone; budget in ARCHITECTURE §11.2):
   - size: AAB per-device download ≤ 25 MB (check `bundletool get-size total` or the Play console)
   - cold start: `adb shell am start -W -n <package>/.MainActivity` → `TotalTime` ≤ 2500 ms
   - scroll the product list fast for 10 s: no blank cells, no visible jank
   - a regression against the last release blocks the release; report the numbers.

## Bluetooth printer
- Pick the ESC/POS library only after testing the 2–3 real printer models agents will use
  (58 mm and 80 mm). Record the result in `docs/mobile-app/ARCHITECTURE.md` §17.
- Requires a dev build and Android 12+ runtime permissions (`BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`).
- Always keep the PDF fallback working (`expo-print` → `expo-sharing`).

## Builds
- Demo APK: `eas build -p android --profile preview` (or local `npx expo run:android --variant release`).
  Name the file `LankaHome-preview.apk`.
- Play Store (Phase 4, ask Moni first): `eas build -p android --profile production` → AAB.
  Signing keys stay in EAS / outside the repo.
- JS-only hotfix after release: `eas update --channel production` only for changes with no native or
  API-contract change; ask first.

## Backend in the same task
`npm run typecheck` in `backend/`. Deploy order: backend (staging) → app → backend production → app release.
