# Natural Plantation (Test) app: tester guide

Version 1.0.0-test.1 (13 Nov 2026). This is a TEST app. It talks to a test server with test data, not to the real shop. Nothing you do here touches real stock, real money or real customers.

## 1. Install
1. Copy `NaturalPlantation-TEST-2026-11-13.apk` to your Android phone (WhatsApp, USB cable or Google Drive).
2. Tap the file. If the phone asks, allow **Install unknown apps** for the app you opened it from (Files, WhatsApp or Chrome), then tap Install.
3. Open **Natural Plantation (Test)**. Allow notifications when asked.
4. You need internet (Wi-Fi or mobile data) to log in the first time.

## 2. Test logins
Password for every test account: **Test@1234**. Log in with the phone number.

| Role | Phone | What you see |
|---|---|---|
| Customer | 0771110011 | Shop, cart, orders |
| Smart Buy member | 0779998877 | Shop + Smart Buy (read only) |
| Field Officer | 0779990031 | Deliveries, Members, Visits, Earnings |
| Branch Manager | 0779990011 | Management Dashboard (team of 2 officers) |
| Regional Manager | 0779990024 | Management Dashboard (team below) |
| Zonal Manager | 0779990023 | Management Dashboard |
| Manager | 0779990022 | Management Dashboard |
| AGM | 0779990021 | Management Dashboard |
| Director | 0779990020 | Management Dashboard (whole test team) |

The Branch Manager (0779990011) is also the delivery agent AG001. In **Me** you can switch between the management view and the field officer view.

## 3. What to try
**Customer (0771110011)**
- Browse, search, open a product, pick a variant or a weight, add to cart.
- Check out with **Cash on delivery**. Then try **Bank transfer** and attach a photo of a slip.
- Open **My Orders**, follow the tracking, cancel an order that is still new.
- Turn the internet off: the shop still shows saved products, and you can add to the cart. Turn it on again and finish the order.
- Settings: change the colour theme, the language (English, Tamil, Sinhala), open the notifications inbox.

**Smart Buy member (0779998877)**
- After login you see the shop. Open **Settings** and tap **Smart Buy** to switch to your schemes.
- Open My Schemes and View statement. Payments show **Pending verification** first and **Paid** after the shop approves them. (The statement screen blocks screenshots on purpose.)
- Draws and Passbook are read only in this test.

**Field Officer (0779990031) and the delivery agent (0779990011, field view)**
- Deliveries: open a delivery, complete it with the customer's OTP.
- Members: see each member's due. Tap **Collect cash**, enter the amount, save. A receipt appears with a number like AG001-000003. The payment is **Pending** until the shop approves it.
- Visits: log a visit (location is saved if you allow it).
- Earnings, Settings.

**Managers (any manager login)**
- Dashboard: team target and what was achieved this month, field officers, visits.
- Team: tap a person to see their sales, collections and visits. Set a target for someone below you.
- You only ever see your own team.

## 4. Coming in the next update (shown as "Coming in the next update", this is normal)
Bluetooth receipt printing, commission slip PDF, leaderboard and alerts for managers, card payment, managers' collection reports by day.

## 5. Report a bug
1. Take a screenshot (power + volume down).
2. Send it to Moni on WhatsApp with 2 lines: which login you used, and what you pressed.
3. If the app closes by itself, say so and what time it happened.

## 6. For Moni: approving orders and cash in the POS
Orders and cash collections made in the test app appear in a POS that is pointed at the test server.
1. On the POS PC open **Admin, Settings, Self-Hosted Cloud Sync**.
2. API URL: `https://staging-api.72-61-115-222.sslip.io`. API key: the key for the test company (Moni has it; do not share it).
3. Press **Sync now**. App orders appear under **App Requests / Online orders**. Convert an order to an invoice there.
4. Cash collected by agents: **Smart Buy, Agent Cash**. Tick the receipts you received the cash for, enter the cash received (it must equal the ticked total), press **Settle**. The member statement then shows **Paid**.
Use a POS with a separate test database, never the shop's real one.
