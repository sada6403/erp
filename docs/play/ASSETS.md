# Play Store graphics

Captured 10 Nov 2026 on a real phone (realme RMX3231, Android 11) running the dev build against the local seeded TEST
company. All names, numbers and orders are seed data. The status bar is cropped out.

| File | Size | Shows | Theme |
|---|---|---|---|
| `assets/screenshot-1-shop-home.png` | 720x1376 | Shop home, banner, flash deals | Olive (default) |
| `assets/screenshot-2-plants-list.png` | 720x1376 | Plants & Seeds product list | Purple |
| `assets/screenshot-3-variant-sheet.png` | 720x1376 | Product with size options | Olive |
| `assets/screenshot-4-checkout.png` | 720x1376 | Payment step, totals | Olive |
| `assets/screenshot-5-order-tracking.png` | 720x1376 | Order timeline, delivery agent | Olive |
| `assets/screenshot-6-smart-buy.png` | 720x1376 | Smart Buy scheme progress | Purple |
| `assets/screenshot-7-settings.png` | 720x1376 | Theme and language choice | Olive |
| `assets/screenshot-8-agent-dashboard.png` | 720x1376 | Field officer dashboard | Olive |
| `assets/feature-graphic-1024x500.png` | 1024x500 | Feature graphic (logo, name, 3 languages) | Olive |

Play rules checked: PNG, 8 phone screenshots (max), each side 320-3840 px, long side at most 2x the short side (1376/720 = 1.91).

## Before uploading
- These come from a **dev build**. Recapture from the production build for the final listing if anything on screen changes
  (the commands are in `docs/mobile-app/PROGRESS.md`; use `adb shell wm size 720x1440` so the aspect ratio stays within 2:1, then `adb shell wm size reset`).
- Screens that block screenshots by design (wallet, statement, draw video, join) cannot be captured and are not used.
- The cart screen was left out on purpose: its promo-code box shows the hint "Try: PLANT2026", which is not a real code.
- Smart Buy screenshot 6 and the agent screenshot show the seed names and amounts (Garden Saver 4x4, Rs 100 commission): fine for a listing, but swap
  in neutral data if the company prefers.
- Tamil and Sinhala listings can reuse these screenshots, or recapture with the language switched in Settings.
