# Mobile app decisions (Run 1)

| Date | Decision | Why |
|---|---|---|
| 2026-11-07 | Local dev uses the already-running MySQL80 service on 127.0.0.1:3306 (no Docker). | Docker is not installed; backend/.env already points at localhost. |
| 2026-11-07 | Skills copied from `.agent/skills` to `.claude/skills` and kept in sync. | Kickoff section 3. |
| 2026-11-07 | App JWTs are signed with a secret derived (HMAC) from `JWT_SECRET`, payload `portal:'app'`; refresh tokens are opaque, hashed, rotating with family reuse detection. | An app token can never validate as an admin/POS/superadmin token and no new secret has to be provisioned. |
| 2026-11-07 | `app_users.member_no` = Smart Buy `paper_reference_code` if present, else generated `NP-<n>`. Login accepts phone, member no, agent code or paper reference. | One memorable id for people who do not use phone numbers; matches the paper records. |
| 2026-11-07 | An app account is linked to a customer/agent only through trusted paths (POS invite endpoint, seed). Self-registration never links to existing POS customers by phone. | Prevents someone taking over another person's Smart Buy history by typing their phone number. |
| 2026-11-07 | Cloud `products` gained the POS-only columns (`not_for_sale`, `sale_by`, `is_manage_stock`, `enable_emi`, ...) plus `is_online` (default 1), `slug`, `gallery`. | The app needs them and the sync was silently dropping them; additive and defaulted. |
| 2026-11-07 | Variant sync fix: desktop now enqueues `product_variants` / `product_variant_stocks` / `product_attribute_values`; backend `RELATED_KEYS` extended. | Variants never reached the cloud, so app variant pickers were empty. |
| 2026-11-07 | Delivery OTP is a deterministic HMAC of the order id (customer sees it in the app; salted hash in `delivery_otp_hash`); complete is idempotent by `event_id`, wrong codes limited per order and per IP. | No plaintext OTP stored, works offline-replay safe, nothing to expire or resend. |
| 2026-11-07 | `stock_reservations` are committed at order create and released on dispatched/delivered/cancelled/returned, via a post-commit hook in `sync/push` for POS-side changes. | Stock stays held while the order is in flight and is returned if it is cancelled. |
| 2026-11-07 | Selling price is treated as tax-inclusive; only `products.discount_pct` is applied (the `discounts` table is ignored); price is locked at order time. | Matches how the POS shows prices; keeps the quote simple and auditable. |
| 2026-11-07 | Notifications are queued in `notification_jobs` and sent by `/api/app/v1/cron/notifications`; Expo push and WhatsApp Cloud API are dry-run unless their flags are set. Invite messages are click-to-chat (`wa.me`) only. | Stop-list: never send real WhatsApp/push during this run. |
| 2026-11-07 | Existing real-company products need a one-time re-push from the POS after deploy, and the new tables/columns migrate on first API hit. Both are deploy-time events and need Moni's approval. | Defaults on the new product columns are not the real values until the desktop re-syncs. |
| 2026-11-07 | `master.companies.app_key` is `CHAR(36)` (`npk_` + 32 hex), generated from Super Admin; previous key honoured for a grace period. | Mirrors the existing api_key/company_key rotation pattern. |
