# Test users (staging only, test.10)

Staging flavour of the app (`nfgroups.naturefarming.app.staging`) against the staging API. All accounts are test data: no production data, no real customers. Passwords are in `TEST_APK_GUIDE.md`. Listed from the code of test.10 (release behaviour, no mocks); "Coming in the next update" means the control is visible but disabled or shows that badge.

Every screen has the same header: logo, company name, bell, Login (guest) or account pill (opens Settings). Settings holds theme, language, push, password, role switch (when the account has more than one role) and Logout.

## 1. Customer 0771110011 (plain customer)
- **Lands on:** Groceries (home): banners, flash deals, search, category pills, products.
- **Tabs:** Groceries, Categories, Cart, My Orders, Settings.
  - Groceries: open a product (Add to cart, Buy now, review), Smart Buy promo card (Join).
  - Categories: browse to the catalogue list.
  - Cart: change quantity, Proceed to checkout.
  - My Orders: order list, order detail with tracking.
  - Settings: theme, language, notifications, password, delete account, Smart Buy requests, Logout.
- **Coming in the next update:** coupon box in Cart; Wallet payment and (if the shop has not enabled it) Bank transfer in Checkout; the barcode button in the search bar.

## 2. Smart Buy member 0779998877 (customer + Smart Buy)
- **Lands on:** My Schemes.
- **Tabs:** My Schemes, Draw Videos, Passbook, Spend/Shop, Settings.
  - My Schemes: scheme list, Apply (join form), My Smart Buy requests, statement.
  - Draw Videos: list of draws.
  - Passbook: wallet balance and transactions.
  - Spend/Shop: spend view.
  - Settings: the Customer / Smart Buy role buttons switch to the shop tabs of section 1.
- **Coming in the next update:** Watch video on draws (and the video modal); "Spend wallet balance in shop" in Passbook and Spend.

## 3. Field Officer 0779990031
- **Lands on:** Deliveries.
- **Tabs:** Deliveries, Members, Visits, Team, Earnings, Settings.
  - Deliveries: assigned deliveries, verify OTP, print bill, call / WhatsApp the customer.
  - Members: add member, collect an amount with receipt.
  - Visits: log a visit (GPS, offline-capable), follow-ups, visit report.
  - Team: empty for a field officer (nobody below).
  - Earnings: month commission summary, print bill.
- **Coming in the next update:** PDF slip on deliveries; Bluetooth printer card and "Preview receipt" in Earnings; the Print button on receipts (WhatsApp share works).

## 4 to 9. Management logins (same screens, scope set by the server)
Branch Manager 0779990011 (also delivery agent AG001), Regional Manager 0779990024, Zonal Manager 0779990023, Manager 0779990022, AGM 0779990021, Director 0779990020.
- **Lands on:** Dashboard (a brief flash of Deliveries before it is normal).
- **Tabs:** Dashboard, Team, Me.
  - Dashboard: team target vs achievement this month, officers, visits and follow-ups, direct-report cards.
  - Team: everyone below them, person detail (sales, collections, visits, Set target).
  - Me: own level and performance, "Field officer view" (opens the 6 field tabs of section 3), Settings button (role buttons Manager / Agent).
- **Scope:** the team below the login (Branch Manager: their 2 officers; Director: the whole test team). Nobody can set their own target.
- **Coming in the next update:** nothing on the three management tabs. In field view, the items of section 3 apply.

## Not in v1.0 for anyone
Announcements (POS tab is a placeholder), delivery fees per area, wallet spending in the shop, draw proof video playback, Bluetooth printing, coupons.
