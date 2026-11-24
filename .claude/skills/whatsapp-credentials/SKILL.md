---
name: whatsapp-credentials
description: App login without SMS — POS admin sends User ID + temporary password on WhatsApp, first-login password change, optional email verification over SMTP, and password reset. Use for any account, login or WhatsApp messaging work.
---

# WhatsApp credentials & email verification

SMS is not used anywhere in the app.

## Invite (POS → WhatsApp)
1. POS "App Access" page: pick customers (filters: Smart Buy members, branch, agent) or agents.
   Bulk select allowed. Show the phone each message goes to; skip rows with no valid mobile.
2. Backend `POST /api/app/v1/admin/app-access/invite`:
   - upsert `app_users` by normalised phone; roles from data (`chit_members` → smartbuy, `agents` → agent,
     any customer → customer).
   - temporary password: 10 chars from `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789`,
     bcrypt hash, `must_change_password = 1`, `temp_password_expires_at = now + 7 days`.
   - send, then log to `app_credential_dispatches`.
3. Channels:
   - **A — WhatsApp Business Cloud API** (`POST https://graph.facebook.com/v{N}/{phone_number_id}/messages`,
     template message). Template `app_login_details` (category Utility/Authentication as Meta approves),
     params: name, user id, temporary password, download link. Credentials per company come from
     Super Admin settings (encrypted with `backend/lib/secretCrypto.ts`). Send server-side only.
   - **B — click-to-chat fallback:** backend returns the message text; POS opens
     `https://wa.me/94XXXXXXXXX?text=<encoded>` and staff press send (same as v2.7.28 branch share).
4. Bulk sends: throttle (≤ 1 msg/sec), stop on repeated provider errors, show a summary.
   Never run a bulk send on production without Moni's go-ahead in chat.

Message (EN; add TA/SI variants):
```
Hi {name}, your {company} app login is ready.
User ID: {phone}
Temporary password: {temp} (valid 7 days, change it at first login)
Download: {link}
```

## First login (app)
Login with phone + temp password → server returns `must_change_password: true` → forced Set Password
screen (min 8 chars, not equal to the temp one) → optional Add Email step.

## Email verification (optional)
`/auth/email/start` → 6-digit code by SMTP (`backend/lib/email.ts`), hash stored, 15-min expiry,
5 attempts → `/auth/email/verify` sets `email_verified_at`.

## Forgot password
- Verified email → code/link by email → set new password.
- No verified email → create `app_password_reset_requests` row (synced) → POS App Access shows it →
  admin re-sends a temporary password (invite flow).

## Security
- Lock 15 min after 5 failed logins; rate limit by IP and phone.
- Temp passwords expire; using an expired one returns `TEMP_PASSWORD_EXPIRED` → "ask your branch".
- Never log passwords or tokens. Never put a password in a push notification or in the app inbox.
- Self-registered accounts are `phone_verified = false`; their first COD order gets
  `needs_call_confirmation = 1`.
