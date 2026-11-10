# Play Console — "App access" (reviewer login instructions)

Play Console > Policy > App content > **App access** > "All or some functionality is restricted" > Add instructions.
Create these accounts with `backend/scripts/create-review-accounts.ts` (see `PRODUCTION_RUNBOOK.md` step 5) on the
**real** company BEFORE submitting, and test each login on the production build. The Nov 2026 rejection (versionCode 5) was
"Login credentials are incorrect": the old backend was down. Keep the server up during review.

Replace `<PASSWORD>` with the password Moni chose for `REVIEW_PASSWORD`. Never commit the real password.

---
## Paste into the Play Console instructions box

```
The app needs a login. No SMS or OTP is used, so the accounts below work immediately.
Open the app, tap Login, enter the ID and the password, tap Sign in. There is one login screen; each account opens its own dashboard.
All accounts are test accounts; any order placed with them is tagged TEST and is not delivered.

1) Customer (shop)
   ID: 0700000101
   Password: <PASSWORD>
   Try: browse products, add to cart, Checkout (Cash on delivery), Orders to track it.

2) Smart Buy member (savings scheme + shop)
   ID: 0700000102   (member number PR-SB1 also works)
   Password: <PASSWORD>
   Try: Schemes tab (statement and payments), switch to Shop from the top of the screen.

3) Field Officer (delivery agent)
   ID: AG-REVIEW
   Password: <PASSWORD>
   Try: Deliveries, Members, Earnings.

4) Branch Manager (sales team dashboard)
   ID: <ADD AFTER THE STAFF ROLE IS DEPLOYED>
   Password: <PASSWORD>
   Try: Team dashboard, Targets, Field visits.

Language can be changed in Settings (English / Tamil / Sinhala). Card payments and some Smart Buy actions show "Coming in the next update"; Cash on delivery works.
If a login ever shows "Incorrect ID or password", please contact monimomj@gmail.com and we will fix it within a few hours.
```

## Pre-submission checklist
- [ ] All four logins succeed against production from a fresh install of the release build (not a dev build).
- [ ] Backend and VPS reachable (open the status URL from a phone on mobile data).
- [ ] Reviewer orders show `[TEST ORDER - Play review]` in the POS notes.
- [ ] The contact email in the box is monitored.
- [ ] Item 4 (Branch Manager) filled in or deleted from the text before pasting.
