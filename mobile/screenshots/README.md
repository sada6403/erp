# Visual comparison: web-demo (spec) vs emulator

DEV-ONLY tooling. Not part of the app build; `mobile/package.json` is untouched.

Spec app: `C:\work\mobile app\web-demo` (override with `--demo <dir>` or `DEMO_DIR`).
Viewport 412x915 @ 2.625x (1082x2402 PNGs), mobile UA, frozen clock/countdown, animations off, scrollbars hidden, toast hidden.

## Setup (once)
```
cd mobile/screenshots
npm i --no-audit --no-fund
npx playwright install chromium     # only if launching fails; capture-demo falls back to any cached chromium
```
(`CHROMIUM_PATH=<chrome.exe>` forces a specific browser.)

## 1. Capture the demo (writes demo/<role>-<screen>-<theme>.png and screens.json)
```
node capture-demo.mjs                      # all 58 (29 screens x olive/purple)
node capture-demo.mjs --theme purple       # one theme
node capture-demo.mjs --only cart          # ids containing "cart" (manifest is merged)
```
Id convention: `<role>-<screen>-<theme>`, role in guest|customer|smartbuy|agent, theme in olive|purple.

## 2. Emulator shots (added by another step)
Save Pixel_6 screenshots as `emulator/<same-id>.png`, e.g. `emulator/customer-cart-step1-olive.png`.
`screens.json` has a `deeplinkHint` per id describing where to navigate in the app.
Emulator PNGs are resized to the demo size before diffing.

## 3. Build the comparison
```
node build-compare.mjs [--threshold 5] [--pixel-threshold 0.1]
```
Writes `diff/<id>.png`, `compare/results.json` and `compare/index.html` (open it directly in a browser; relative image paths).
Status: `pass` (mismatch <= threshold %), `accepted` (fail but listed in accepted.json), `fail`, `missing` (no emulator shot).
The page has role/theme/status filters and a wipe-slider / opacity overlay.

### accepted.json (optional, next to this README)
```json
{
  "customer-shop-*": "emoji glyphs differ (Noto vs Segoe UI Emoji)",
  "agent-bill-modal-olive": { "reason": "monospace font", "maxMismatch": 15 }
}
```
Keys are ids or `*` globs. `maxMismatch` (optional) caps the accepted mismatch %.

## Git
`.gitignore` ignores `node_modules/`, `diff/`, `compare/results.json` and `emulator/`. `demo/`, `screens.json`, `compare/index.html` are tracked.
Note: demo PNGs rendered on Windows use Segoe UI Emoji; remaining emoji/font differences vs Android are expected and are good candidates for accepted.json.
