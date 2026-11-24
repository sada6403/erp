# Natural Plantation (Test) app: tester guide

Version 1.0.0-test.8 (13 Nov 2026). If you have an older test build installed, install this file over it (your login is kept or you log in again). This is a TEST app. It talks to a test server with test data, not to the real shop. Nothing you do here touches real stock, real money or real customers.

**Changes in test.8:** home banner carousel (swipe, auto-slide 5 s, dots, tap opens product / category / flash deals / Smart Buy / https page), home sections order and on/off controlled from the POS (App Control), New arrivals and Featured rails, update sheet tap fix, real logo on the Android cold-start splash, skeleton instead of a "no results" flash on first open. The 3 banners shown on the test server are marked TEST.

**Changes in test.7:** first build with the App Control banners (superseded by test.8).

**Changes in test.6:** in-app updates (OTA banner once enabled, "New version available" sheet, force-update screen, APK download with SHA-256 check from our test server); bank reference now prefilled on the order page; Categories spinner no longer overlaps the subtitle; "Near me" in Join shows "Location found" or an error; bell has test id `header-bell`.

**Changes in test.5:** button labels (for example Add to cart) no longer overflow in Tamil and Sinhala. Step-13 regression on the phone: 9 roles, themes, 3 languages, offline, orders, Join Smart Buy (camera NIC, screenshot blocked) and reviews all passed; test customer 0771110011 is a plain customer again. Known: the bank reference typed at checkout is not prefilled in the order page transfer box.
**Changes in test.4:** "Join Smart Buy" is real: enter your details, the agent code (the app shows the agent name to confirm), pick a branch, photograph your NIC (screenshots are blocked on that screen); the branch approves or rejects in the POS and "My Smart Buy requests" shows Pending / Approved / Rejected with the reason. Note: test customer 0771110011 is now a Smart Buy member because the join flow was tested with it.
**Changes in test.3:** app is now named "Natural Plantation" with the real logo (launcher, splash, top bar); new top bar (logo + company name, bell, branch and role on a second line); tapping a product opens its own page (gallery with pinch-zoom, options, quantity, reviews, similar products), only the Add button on the card adds to the cart; Categories page shows POS categories with sub-categories and counts (empty ones hidden) and the product list has sort and price / in-stock filters; the bank-slip reference typed at checkout now shows in the POS.

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
- After login you land on **My Schemes** (Smart Buy home). Tap **Spend Shop** (or **Settings**, then **Customer**) to go to the shop. Tap **Smart Buy** in Settings to come back.
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

## 4b. Known issues (test.2)
- Bank transfer: the reference you type at checkout is not shown to the shop yet. Type it again in the **Bank transfer payment** box on the order page, then tap **Upload payment slip**.
- Smart Buy totals (**Paid: Rs ...**) change only after the shop approves the cash in the POS. A new collection shows as **Pending verification** until then. This is correct.
- The Smart Buy statement blocks screenshots on purpose. Describe what you see instead.
- Smart Buy Wallet and card as payment methods, promo codes and some manager reports show "Coming in the next update". This is normal.
- If a Smart Buy member lands on the shop instead of My Schemes, tell Moni: it means the test company settings were changed on the server (the app itself is fine).

## 5. Report a bug
1. Take a screenshot (power + volume down).
2. Send it to Moni on WhatsApp with 2 lines: which login you used, and what you pressed.
3. If the app closes by itself, say so and what time it happened.

## 6. For Moni: approving orders and cash in the POS
Orders and cash collections made in the test app appear in a POS that is pointed at the test server.
1. On the POS PC open **Admin, Settings, Self-Hosted Cloud Sync**.
2. API URL: `https://staging-api.72-61-115-222.sslip.io`. API key: the key for the test company (Moni has it; do not share it).
3. Press **Sync now** (the POS also syncs by itself every 30 seconds).
4. App orders: **Sell, Orders** (channel **Mobile app**). Press **Mark confirmed**; the customer sees **Confirmed** in the app within a minute. Assign an agent there for delivery.
5. Bank slips: **Mobile App, App Requests, Bank Slips**. Press **Verify**, check the slip picture, press **Verify payment**. The customer sees **Payment verified**.
6. Cash collected by agents: **Smart Buy, Agent Cash**. Three clicks: **Accept all**, type the cash received (it must equal the accepted total), **Save decisions**. The member's statement shows **Paid** and the totals on My Schemes go up.
Use a POS with a separate test database, never the shop's real one. Smart Buy join requests are also under **App Requests**.
