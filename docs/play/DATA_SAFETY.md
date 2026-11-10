# Play Console — Data safety draft + financial features notes (v1.0)

**Draft for Moni to verify against the final build and the company's real practices before submitting.** It is based
on the code as of 10 Nov 2026 (v1.0 scope, mocks off). Answer "No" to anything the app does not do; Play checks the
APK against the declaration, and a wrong answer can get an update rejected. Re-check every time a library is added
(especially analytics, crash reporting, maps, location, camera).

## 1. Data safety form

**Does your app collect or share any of the required user data types?** Yes.
**Is all of the user data collected by your app encrypted in transit?** Yes, provided the production build's `API_BASE_URL` is an `https://` URL (set it in the production EAS profile; the dev manifest allows cleartext only in debug builds).
**Do you provide a way for users to request that their data is deleted?** Yes. In app: Settings > Delete account.
Web: `[HOSTED account-deletion.html]` (Play requires this URL in the form).

### Data types
| Category | Type | Collected | Shared | Required or optional | Purposes |
|---|---|---|---|---|---|
| Personal info | Name | Yes | No | Required | App functionality, Account management |
| Personal info | Phone number | Yes | No | Required | App functionality, Account management |
| Personal info | Email address | Yes | No | Optional | Account management |
| Personal info | Address | Yes (delivery addresses) | No | Optional (needed to order) | App functionality |
| Personal info | User IDs (member no, agent code) | Yes | No | Required | App functionality, Account management |
| Financial info | Purchase history (orders) | Yes | No | Required to order | App functionality |
| Financial info | Other financial info (Smart Buy contributions, wallet balance, agent earnings, shown from company records) | Yes | No | Only for members/agents | App functionality |
| Device or other IDs | Device or other IDs (push notification token) | Yes | No* | Optional (if notifications allowed) | App functionality (notifications) |

\* Tokens go to Expo and Google (Firebase Cloud Messaging) only to deliver our notifications, as service providers acting for us. Google's guidance treats transfer to a service provider that processes data on the developer's behalf as not "sharing". Confirm in the form's help text; if unsure, tick "Shared" for the token with purpose App functionality.

### Types to answer "Not collected"
Location (approximate/precise), Contacts, Photos/videos, Audio, Files, Calendar, Web browsing, Health/fitness, Messages (SMS/other), App activity (no analytics), App info and performance (no crash/diagnostics SDK in v1.0), Race/ethnicity and other sensitive info, Credit card number / payment info (cash on delivery and bank transfer only, no card data in the app in v1.0).

> If v1.1 adds PayHere card payments, card data is entered on PayHere's page: still re-check this form then. If it adds Sentry/Crashlytics, add "Crash logs" and "Diagnostics". If agents' GPS visits ship, add "Approximate/Precise location" and the camera/photos types.

### Security practices
- Data encrypted in transit: Yes.
- Data deletion request: Yes (in-app and web URL).
- "Committed to Play Families policy": No (not a children's app). Target audience: 18 and over.
- Independent security review: No.

### Ads
Contains ads: **No**.

## 2. App content declarations
| Item | Answer |
|---|---|
| Privacy policy URL | `[HOSTED privacy-policy.html]` |
| App access | Restricted: reviewer logins from `APP_ACCESS.md` |
| Target audience | 18+ (adults) |
| Content rating (IARC questionnaire) | Shopping app; no violence, no user-generated content, no chat, no gambling; "Smart Buy draws" are savings-scheme draws among members: answer the gambling question honestly (see section 3) |
| News app / COVID / government | No |
| Data safety | Section 1 |
| Advertising ID | Not used (answer "No") |
| Health apps | No |
| Financial features | Section 3 |

## 3. Financial features declaration notes
Play Console > Policy > App content > **Financial features**. Notes for choosing the right answer:
- The app **does not** move money inside the app in v1.0: orders are cash on delivery or bank transfer (slip/reference) settled outside the app. The wallet is store credit usable for products only; spending in the app is not in v1.0.
- Smart Buy is a **savings/draw scheme operated by the company**; the app shows members their own statement, payments and draws (read-only) and lets agents see their members and earnings. Contributions are collected by branches/agents.
- Likely answers: not a bank, not a loan/credit app, no investment/trading, no crypto, no money-transfer or payment-processing service. If the form has "other" financial products or "savings", declare the Smart Buy scheme there with a one-line description.
- **Ask the company before submitting** (not decidable from code): is the Smart Buy scheme registered or licensed as required in Sri Lanka, and do they have the licence/registration number Play may request? If Play asks for licence documents, Moni supplies them. If the draws are regulated like a lottery, the gambling/content-rating answers must say so.
- Trader status (EU DSA) declaration: still pending in Console (HANDOFF §4).
- State "no personal loans" explicitly if asked about loan apps: the app offers no loans.

## 4. Consistency checklist (do before each release)
- [ ] `mobile/package.json` has no analytics, ads or crash SDK not covered above.
- [ ] `mobile/app.config.ts` permissions list matches (the generated dev manifest currently has INTERNET, VIBRATE, READ/WRITE_EXTERNAL_STORAGE (max SDK 32) and SYSTEM_ALERT_WINDOW, the last from the dev client; inspect the PRODUCTION AAB's merged manifest with `bundletool dump manifest` and make sure SYSTEM_ALERT_WINDOW and the storage permissions are absent or justified, because Play can query them).
- [ ] Privacy policy text, this form and `LISTING.md` say the same thing.
- [ ] Reviewer logins work on the production build.
