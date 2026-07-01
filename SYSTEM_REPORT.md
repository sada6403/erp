# Enterprise POS ERP — System Architecture Report
**Generated:** 2026-06-29

---

## 1. SYSTEM OVERVIEW (எப்படி இயங்குகிறது)

இந்த system மூன்று தளங்களில் (3-Tier) இயங்குகிறது:

```
┌─────────────────────────────────────────────────────────────────┐
│  TIER 1 — POS Desktop App (Customer's Windows PC)               │
│  Electron + React + SQLite (Offline-First)                      │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS sync every 30s
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  TIER 2 — Cloud Backend (VPS Server)                            │
│  Next.js API + MySQL (Multi-tenant SaaS)                        │
└─────────────────────────┬───────────────────────────────────────┘
                          │ Full Control
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  TIER 3 — SuperAdmin Portal (Platform Owner's Browser)          │
│  Vite React (portals/superadmin/)                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. TIER 1 — POS DESKTOP APP

### Technology Stack
| Component     | Technology                        |
|---------------|-----------------------------------|
| Shell         | Electron (Windows .exe)           |
| UI            | React + TypeScript + Vite         |
| Styling       | TailwindCSS (dark-first)          |
| Local DB      | SQLite via `better-sqlite3`       |
| State         | Zustand (auth + cart)             |
| IPC Bridge    | Electron contextBridge (preload)  |

### App Startup Flow
```
1. Electron main.ts starts
2. initDatabase() — SQLite file at %AppData%/pos-erp/pos-erp.db
   ├── Fresh install: schema.sql இயங்கும் + default data seed
   └── Existing: runMigrations() — ALTER TABLE for new columns
3. ensureSettingsDefaults() — default settings create
4. 27 IPC handler groups register ஆகும்
5. BrowserWindow create → React app load
6. React App.tsx:
   ├── isActivated() check → if false: ActivationPage காட்டும்
   └── if true: init() auth → Login or Dashboard
7. SyncService.start() — 30s interval sync தொடங்கும்
8. startAutoBackup() — 3 min delay, then every 24h backup
9. startLicenseChecks() — license validity check
10. startReminderScheduler() — installment due reminders
```

### Database Tables (SQLite Local — 35 Tables)

**Core Business:**
- `branches` — கிளைகள்
- `warehouses` — கோதாம்கள்
- `users` — பயனர்கள் (bcrypt password + PIN)
- `roles` — அனுமதிகள் (JSON permissions)
- `categories` — பொருள் வகைகள்
- `suppliers` — வழங்குநர்கள்
- `products` — பொருட்கள் (barcode, UOM, batch support)
- `product_uom` — அலகு மாற்றங்கள் (kg/g, litre/ml etc.)
- `batches` — batch tracking (expiry dates)

**Sales:**
- `customers` — வாடிக்கையாளர்கள்
- `invoices` — விற்பனை invoice (cash/credit/installment)
- `invoice_items` — invoice உள்ள பொருட்கள்
- `payments` — கட்டணங்கள்
- `returns` — திரும்ப பொருட்கள்
- `quotations` — விலை மேற்கோள்

**Inventory:**
- `stocks` — branch+warehouse stock levels
- `stock_movements` — every stock in/out record
- `stock_transfers` — branch-to-branch transfers
- `stock_counts` — physical counting sessions
- `stock_count_items` — individual count items

**Finance:**
- `installments` — தவணை விற்பனை
- `installment_plans` — தவணை திட்டங்கள்
- `installment_schedule` — payment schedule
- `installment_payments` — actual payments made
- `installment_reminders` — reminder log
- `expenses` — செலவுகள்
- `expense_categories` — செலவு வகைகள்
- `cash_sessions` — day-open/close register

**Operations:**
- `deliveries` — delivery tracking
- `customer_orders` — advance orders
- `customer_order_items` — order items
- `purchase_orders` — purchase from suppliers
- `purchase_order_items` — PO items
- `audit_logs` — local action history

**System:**
- `sync_queue` — pending cloud sync items
- `notifications` — in-app alerts

### IPC Architecture (React ↔ Electron)

```
React Component
    │
    ▼ window.api.products.list()
    │
preload.ts (contextBridge)
    │ ipcRenderer.invoke('products:list')
    │
electron/ipc/products.ts
    │ ipcMain.handle('products:list')
    │
    ▼ SQLite query via getDb()
    │
    ▼ return result
```

**Registered Handler Groups (27):**

| Namespace         | Handlers | Purpose                        |
|-------------------|----------|--------------------------------|
| `auth`            | 8        | Login, PIN, 2FA                |
| `products`        | 10       | Product CRUD, Import/Export    |
| `invoices`        | 12       | Sales, Credit, Approval        |
| `customers`       | 7        | Customer CRUD, History         |
| `stocks`          | 11       | Stock adjust, Transfer, Movements |
| `stockCounts`     | 8        | Physical count sessions        |
| `admin`           | 35+      | Branches, Users, Roles, etc.   |
| `sync`            | 8        | Sync status, trigger, diagnose |
| `settings`        | 4        | App settings, S3 test          |
| `analytics`       | 5        | Sales charts, Reports          |
| `printer`         | 5        | Print receipts, Invoice        |
| `purchases`       | 5        | Purchase orders                |
| `returns`         | 6        | Return management              |
| `cash`            | 4        | Cash register open/close       |
| `loyalty`         | 6        | Points earn/redeem             |
| `batches`         | 7        | Batch tracking, Expiry         |
| `comm`            | 6        | Email/SMS/WhatsApp alerts      |
| `reports`         | 3        | Excel/PDF export               |
| `notifications`   | 5        | In-app notifications           |
| `backup`          | 6        | DB backup + S3 upload          |
| `monitor`         | 3        | Health, Vacuum, Integrity      |
| `orders`          | 4        | Customer advance orders        |
| `license`         | 2        | License status, refresh        |
| `app`             | 5        | Device info, Activation        |
| `activation`      | 3        | License key activation         |
| `cashRegister`    | 4        | Cash session management        |
| `reports`         | 3        | File open, Excel, PDF          |

**Total: 288 exposed methods — all connected ✓**

### Authentication Flow
```
Login Page → email + password
    │
    ▼ window.api.auth.login()
    │
SQLite: verify bcrypt hash
    │
    ▼ return JWT token (signed locally)
    │
Zustand authStore.setUser()
    │
    ▼ Role + Permissions loaded
    │
Route guards check permissions.all / permissions.inventory etc.
```

**2FA (TOTP):**
- Setup: TOTP secret generate → QR code → user scans with authenticator app
- Login: password ✓ → PIN ✓ → if 2FA enabled → 6-digit code verify

**PIN Quick Login:**
- Full password login first
- After that: PIN (4-6 digits) sufficient for fast re-login

### POS Page (Main Sales Screen)

```
F6 → Search Product
      │
      ▼ Add to Cart (Zustand cartStore)
      │
F2 → Select Customer (optional)
      │
F4 → Payment Screen
      │ ├── Cash payment
      │ ├── Card payment
      │ ├── Credit (net 30)
      │ ├── Installment plan
      │ └── Loyalty points redeem
      │
F5 → Print Receipt
      │
Invoice → SQLite save → sync_queue enqueue
```

**Keyboard Shortcuts:** F1 (New), F2 (Customer), F3 (Hold), F4 (Pay), F5 (Print), F6 (Search)

---

## 3. SYNC SERVICE (Offline → Cloud)

### How It Works
```
Every 30 seconds:
    │
    ├── 1. PUSH (Local → Cloud)
    │       sync_queue table-ல் 'pending' items (max 50)
    │       → POST /api/sync/push
    │       → Cloud MySQL-ல் INSERT OR REPLACE
    │       → status = 'synced' (or 'failed' after 5 attempts)
    │
    ├── 2. PULL (Cloud → Local) — PARALLEL (optimized)
    │       18 tables × GET /api/sync/changes?table=X&since=<timestamp>
    │       → All 18 requests fire simultaneously
    │       → Results written to SQLite (skip if pending locally)
    │       → Invoices: also pull invoice_items + payments (related)
    │       → Installments: pull installment_payments (reuse IDs)
    │
    └── 3. COLUMN CACHE
            PRAGMA table_info() called once per table per session
            Cached in Map<string, Set<string>> (no repeat queries)
```

### Conflict Resolution
- **Strategy:** Last-Write-Wins
- Local write → immediate SQLite save (zero latency)
- Cloud pull → skip if local pending (local wins for in-progress records)
- `synced_at` timestamp tracks what went to cloud

### Offline Behavior
- Internet இல்லாமல்: எல்லாமே SQLite-ல் சேமிக்கப்படும்
- sync_queue-ல் குவியும் (no limit)
- Internet வந்தவுடன்: batch 50 × 30s = எல்லாம் sync ஆகும்
- Image uploads: `app-img://` → first upload to cloud, then sync URL

---

## 4. TIER 2 — CLOUD BACKEND (VPS)

### Technology Stack
| Component  | Technology                     |
|------------|--------------------------------|
| Framework  | Next.js 14 (App Router)        |
| Database   | MySQL (via mysql2/promise)     |
| Auth       | JWT (HS256)                    |
| Deployment | Docker + docker-compose        |

### API Routes

**Sync Endpoints (POS App uses these):**
| Route                    | Method | Purpose                           |
|--------------------------|--------|-----------------------------------|
| `/api/sync/push`         | POST   | POS → Cloud record upsert         |
| `/api/sync/changes`      | GET    | Cloud → POS changed records       |
| `/api/sync/related`      | POST   | Pull child records by foreign key |

**Auth:**
| Route              | Method | Purpose                    |
|--------------------|--------|----------------------------|
| `/api/auth/login`  | POST   | Company admin login (JWT)  |
| `/api/auth/me`     | GET    | Token verify               |

**SuperAdmin (platform owner only):**
| Route                                    | Purpose                        |
|------------------------------------------|--------------------------------|
| `/api/superadmin/stats`                  | Dashboard stats                |
| `/api/superadmin/companies`              | List/Create companies          |
| `/api/superadmin/companies/[id]`         | Edit info/limits/subscription  |
| `/api/superadmin/companies/[id]/modules` | Enable/disable features        |
| `/api/superadmin/companies/[id]/devices` | Manage POS devices             |
| `/api/superadmin/packages`               | Subscription packages          |
| `/api/superadmin/packages/[id]`          | Edit/deactivate package        |
| `/api/superadmin/impersonate`            | Login as company admin         |
| `/api/superadmin/audit`                  | Audit trail log                |
| `/api/superadmin/settings`               | Platform-wide settings         |
| `/api/superadmin/email-test`             | Test SMTP config               |
| `/api/superadmin/cron/trial-expiry`      | Send trial expiry emails       |

### Multi-Tenant Architecture
```
One MySQL database → Many companies
    │
    ├── companies table (saas_companies)
    ├── Each company has: tenant_id (UUID)
    ├── Each API request: X-API-Key header
    │       → resolve company → use company's schema
    └── Data isolation: tenant_id column on all records
```

### MySQL SaaS Tables
- `saas_companies` — registered companies (tenants)
- `subscription_packages` — Free/Starter/Pro/Enterprise
- `company_modules` — per-company feature flags
- `company_devices` — licensed POS devices
- `system_settings` — platform-wide settings (branding, SMTP, etc.)
- `saas_audit_logs` — all SuperAdmin actions logged
- `support_sessions` — impersonation sessions

---

## 5. TIER 3 — SUPERADMIN PORTAL (முழு விவரம்)

### Technology
- Vite + React + TypeScript (POS app-இல் இருந்து தனி app)
- Location: `portals/superadmin/`
- Separate deployment — own port, own JWT secret

---

### PAGE 1: Login
- SuperAdmin email + password → JWT token → localStorage-ல் சேமிக்கும்
- Token எல்லா API calls-லயும் `Authorization: Bearer <token>` header-ல் அனுப்பும்

---


### PAGE 2: Dashboard (Platform Overview)

**4 Company Metric Cards:**
| Card | என்ன காட்டும் |
|------|----------------|
| Total Companies | மொத்த tenants + இந்த மாதம் புதியவை |
| Active | Active companies + % of total |
| On Trial | Trial companies + இந்த வாரம் expire ஆவவை |
| Suspended | Suspended count |

**3 Platform Health Cards:**
| Card | என்ன காட்டும் |
|------|----------------|
| MRR | Monthly Recurring Revenue (active subs only) |
| POS Devices | Total registered + active device count |
| Sync Health | Last 24h sync events, success%, failed count bar |

**2 Bottom Tables:**
- **Recent Companies** — Last 5 signups (name, package, status, date)
- **Trials Expiring This Week** — Company name, email, days remaining (red if ≤2 days)

---

### PAGE 3: Companies (முழு கட்டுப்பாடு)

**Table Columns:** Company | Slug | Email | Package | Limits (branches/users/devices) | Status | Sub End Date | Actions

**Status Badges:** 🟢 active | 🟡 trial | 🔴 suspended | ⬜ cancelled

**Filter Bar:** Search (name/email/slug) + Status dropdown + Refresh

**Pagination:** 20 per page, Prev/Next

---

#### Actions Column — 9 Buttons per Company Row:

**1. 🟠 Impersonate (LogIn icon)**
```
Purpose: SuperAdmin-ஆக company admin portal-ல் login பண்ண
Flow:
  1. Reason type பண்ண வேண்டும் (audit-க்காக mandatory)
  2. "Get Admin Token" click → POST /api/superadmin/impersonate
  3. 15-min valid JWT token return ஆகும்
  4. Instructions:
     - Company admin portal திற
     - DevTools → Application → Local Storage
     - sa_access = <copied token> set பண்ணு
     - Refresh → அவங்க admin-ஆ login ஆகும்
Note: Action fully logged in audit trail with reason + timestamp
```

**2. ⬜ Edit Company (Edit2 icon)**
```
EditCompanyModal — 3 tabs:

Tab 1: Info
  - Company Name, Email, Phone, Address
  - Notes (internal SuperAdmin notes — company-க்கு தெரியாது)

Tab 2: Limits (real-time enforced)
  - Max Branches  (e.g. 1, 3, 10)
  - Max Users     (e.g. 5, 20, unlimited)
  - Max POS Devices (e.g. 2, 5, 10)
  - Storage GB    (e.g. 5, 20, 100)

Tab 3: Subscription
  - Current package / status / end date (read-only info)
  - Change Package → dropdown (new package takes effect immediately)
  - Set End Date → date picker
  - Extend Trial → +7d / +14d / +30d / custom days
    (days added to current end date, or from today if expired)
```

**3. 🟢 Company Activation Key (ShieldCheck icon)**
```
Purpose: POS app-ஐ company-க்கு connect பண்ண one-time key
Flow:
  1. SuperAdmin "Generate Key" click
  2. Unique activation key create ஆகும்
  3. Key copy பண்ணி company-க்கு share பண்ணுவாங்க
  4. Company POS app first launch-ல் key enter பண்ணும்
  5. App activate → all devices unlock
Note: Regenerate பண்ணினா பழைய key invalid ஆகும்
      Existing active devices பாதிக்கப்படாது
```

**4. 🔵 POS Devices (Smartphone icon)**
```
Purpose: Company-க்கு license keys manage பண்ண
Slots shown: Active/Total (e.g. "2/3 slots used")

Add Device:
  - Device name enter பண்ணு (e.g. "Branch 1 - Counter 2")
  - "Add Device" → unique license_key generate
  - Key screen-ல் காட்டும் (ஒரே ஒரு தடவை — save பண்ணணும்)
  - POS app first run-ல் இந்த key enter பண்ணும்

Device List shows:
  - Device name, bound device ID (partial), last seen, app version
  - Status: active / pending / deactivated

Device Actions:
  - Deactivate (Ban icon) → அந்த machine POS access இழக்கும்
  - Reset (Refresh icon) → device unbind → key வேற machine-ல் use பண்ணலாம்

Limit reached: Upgrade message காட்டும்
```

**5. 🌸 Branding (Palette icon)**
```
Purpose: Company-க்கு தனி brand color + logo set பண்ண
Fields:
  - Brand Color: color picker + hex input + 10 preset colors
  - Logo URL: public image URL (PNG/SVG)
Preview: Live preview bar காட்டும் (color background + logo + company name)
Effect: Next POS device activation or re-sync-ல் reflect ஆகும்
```

**6. 🟣 Modules (LayoutGrid icon)**
```
Purpose: Per-company feature on/off toggle
Module Groups:
  Core:       pos, inventory, customers
  Finance:    installments, expenses, purchase_orders
  Operations: deliveries, stock_transfers, multi_branch
  Reporting:  reports_basic, reports_full
  Advanced:   api_access, white_label

Each module shows:
  - 🔵 Blue dot = "package" (package-ல் include)
  - 🟣 Purple dot = "override" (manually changed by SuperAdmin)
Toggle: ON/OFF switch → immediate effect → next POS sync-ல் enforce

Note: Package change பண்ணினால் package modules auto-apply ஆகும்
      Override manually set panna package limits-ஐ bypass பண்ணும்
```

**7. 🟣 API Key (Key icon)**
```
Purpose: POS Electron app sync-க்கு company API key manage
Usage:
  1. POS desktop app திற
  2. Settings → Cloud Sync
  3. API Key field-ல் paste பண்ணு
  4. Save → இந்த company data-வுடன் sync தொடங்கும்

Regenerate:
  - Two-step confirm (accidental click தவிர்க்க)
  - Regenerate பண்ணினா ALL POS branches sync இழக்கும்
  - New key-ஐ எல்லா branches-லயும் update பண்ணணும்
```

**8. 🟢 Activate / 🟡 Suspend / 🔴 Cancel (status buttons)**
```
- Active company → "Suspend" button காட்டும்
- Non-active → "Activate" button காட்டும்
- Not cancelled → "Cancel" button காட்டும்
All status changes: confirm dialog + immediate effect
```

---

#### Create Company Modal (New Company)
```
Fields:
  Company:   Name*, Email*, Phone, Package, Trial Days, Timezone, Currency, Country
  Admin:     Admin Name*, Admin Email*, Admin Phone
  Limits:    Max Branches, Max Users, Max POS Devices, Storage GB

Auto-fill: Trial Days, Timezone, Currency, Country →
           Settings → Defaults-ல் இருந்து auto-fill ஆகும்

On create:
  - company record create
  - admin user create (welcome email optional)
  - api_key auto-generate
  - package modules apply
```

---

### PAGE 4: Packages

**Package Cards show:** Name, pricing, trial days, limits, active/inactive status

**Edit Package (Edit2 icon):**
```
EditPackageModal fields:
  - Name, Description
  - Monthly Price, Annual Price
  - Trial Days
  - Max Branches, Max Users, Max Products
  - Sort Order (display order)
```

**Deactivate/Reactivate (Power icon):**
```
- Active → PowerOff → deactivate (60% opacity)
- Inactive → Power → reactivate
- Deactivated packages: new companies-க்கு காட்டாது
- Existing companies பாதிக்கப்படாது
```

---

### PAGE 5: Audit Logs

**Purpose:** எல்லா SuperAdmin actions-ஐயும் track பண்ண

**Filter Panel:**
- Action (text search, e.g. "company.create", "package.update")
- Company (dropdown — all companies)
- From Date / To Date

**Log Entry shows:**
- Timestamp, Actor (SuperAdmin name), Action type
- Company name (if related), Resource ID
- Old values → New values (expandable JSON diff)

**Actions logged include:**
- `company.create`, `company.update`, `company.status`
- `package.create`, `package.update`
- `module.toggle`
- `settings.update`
- `impersonate.start`
- `api_key.regenerate`, `company_key.regenerate`

---

### PAGE 6: Settings

**Tab 1: Branding**
```
- App Name → SuperAdmin portal header-ல் காட்டும்
- Tagline, Support Email
- Logo URL → header-ல் img tag-ஆ காட்டும்
- Primary Color → portal nav active color (live preview)
- ↺ Reset button → #2563eb (default blue)
Effect: Save பண்ணியவுடன் portal header/nav உடனே update ஆகும்
```

**Tab 2: Email / SMTP**
```
Fields: Host, Port, Username, Password, From Name, From Email
Test Connection:
  - Email address enter பண்ணு → "Send Test"
  - Nodemailer transporter create → test email அனுப்பும்
  - ✓ Success / ✗ Error message காட்டும்
Trial Expiry Emails:
  - "Send Trial Expiry Emails Now" button
  - 7, 3, 1 day-ல் expire ஆகும் companies-க்கு email அனுப்பும்
  - Result: "Processed X company/companies"
```

**Tab 3: SMS**
```
⚠️ Storage Only — SMS Sending Not Active
Fields: Provider (Twilio/Nexmo/Disabled), Account SID, Auth Token, From Number
Status: Credentials saved securely, actual SMS not yet implemented
```

**Tab 4: Payment Gateway**
```
⚠️ Storage Only — Billing Not Active
Fields: Stripe Public Key, Stripe Secret Key, PayPal Client ID
Status: Keys saved, auto-billing not yet implemented
Manual billing: Companies → Edit → Subscription tab-ல் manually manage
```

**Tab 5: Defaults**
```
Purpose: New company create பண்ணும்போது auto-fill values
Fields: Trial Days, Default Timezone, Default Currency, Default Country
Effect: Create Company Modal திறக்கும்போது இந்த values auto-fill ஆகும்
```

---

## 6. SECURITY & BACKUP

### Local Security
- **Passwords:** bcrypt hashed (never plain text)
- **PIN:** bcrypt hashed
- **2FA:** TOTP (Google Authenticator compatible)
- **Secrets (S3, API keys):** `safeStorage` (OS keychain) or AES-256-GCM fallback
- **Context isolation:** Electron `contextIsolation: true`, `nodeIntegration: false`

### Backup System
```
Auto Backup (every 24h, starts 3 min after app launch):
    │
    ├── SQLite DB → copy to %AppData%/pos-erp/backups/
    ├── Keep last 10 backups (older ones deleted)
    └── If S3 enabled:
            → Read credentials from electron-store (decrypt secret key)
            → Upload to S3: backups/pos-erp-backup-YYYY-MM-DD.db
            → Return s3Url to frontend
                ├── Success: "Backup saved & uploaded to S3 ✓"
                └── Partial: "Local saved" + "S3 upload failed: ..."
```

### License System
- Device fingerprint (CPU + RAM + hostname hash)
- License key activation required on first launch
- `licenseService` checks validity periodically
- SuperAdmin can manage devices per company

---

## 7. PAGES MAP (React Routes)

```
/ → /pos (redirect)

/login          — Login page
/pos            — Main POS (cash register)

/admin          — Dashboard (stats, quick actions)
/admin/products         — Product catalog
/admin/customers        — Customer list
/admin/inventory        — Stock levels per branch
/admin/stock-count      — Physical stock count
/admin/batches          — Batch tracking
/admin/stock-lookup     — Quick stock search
/admin/orders           — Customer advance orders
/admin/quotations       — Price quotations
/admin/credit-bills     — Unpaid credit invoices
/admin/purchase-orders  — Supplier purchase orders
/admin/expenses         — Business expenses
/admin/branches         — Branch management
/admin/users            — User management
/admin/categories       — Product categories
/admin/suppliers        — Supplier list
/admin/analytics        — Sales analytics & charts
/admin/deliveries       — Delivery tracking
/admin/installments     — Installment sales
/admin/audit-logs       — Action history
/admin/sync             — Sync monitor & diagnostics
/admin/roles            — Role & permission editor
/admin/returns          — Product returns
/admin/cash-register    — Cash session open/close
/admin/stock-requests   — Branch stock requests
/admin/backup           — DB backup (SuperAdmin only)
/admin/security         — 2FA settings
/admin/system-health    — DB health, vacuum (SuperAdmin only)
/admin/settings         — App settings (SuperAdmin only)
```

---

## 8. ROLE PERMISSIONS

| Role             | POS | Inventory | Analytics | Employees | Settings | All |
|------------------|-----|-----------|-----------|-----------|----------|-----|
| Super Admin      | ✓   | ✓         | ✓         | ✓         | ✓        | ✓   |
| Branch Manager   | ✓   | ✓         | ✓         | ✓         | —        | —   |
| Cashier          | ✓   | —         | —         | —         | —        | —   |
| Warehouse Staff  | —   | ✓         | —         | —         | —        | —   |
| Delivery Staff   | —   | —         | —         | —         | —        | —   |

Permissions stored as JSON in `roles.permissions`:
```json
{
  "pos": true,
  "inventory": true,
  "analytics": true,
  "employees": true,
  "all": true
}
```

---

## 9. DATA FLOW DIAGRAM (Full)

```
CASHIER (Windows PC)
    │
    ▼
[Electron App]
    ├── React UI (renderer process)
    │       ├── POSPage → cart → payment
    │       ├── window.api.invoices.create()
    │       └── window.api.stocks.adjust()
    │
    ├── Preload bridge (contextBridge)
    │
    ├── IPC Handlers (main process)
    │       ├── invoices.ts → INSERT INTO invoices
    │       ├── stocks.ts   → UPDATE stocks
    │       └── enqueuSync() → INSERT INTO sync_queue
    │
    └── SQLite (pos-erp.db)
            └── sync_queue: pending items
                    │
                    ▼ every 30s (SyncService)
                    │
              [VPS Backend - Next.js]
                    │
                    ├── POST /api/sync/push
                    │       └── MySQL: INSERT OR UPDATE
                    │
                    └── GET /api/sync/changes
                            └── MySQL: SELECT WHERE updated_at > lastPull
                                    │
                                    ▼ write to local SQLite
                                    (other devices see updates)
```

---

## 10. KNOWN ISSUES & STATUS

| Component             | Status  | Notes                                    |
|-----------------------|---------|------------------------------------------|
| All IPC handlers      | ✓ OK    | 288 methods, all registered              |
| stockCounts handlers  | ✓ Fixed | Was missing, now registered in main.ts   |
| Sync push/pull        | ✓ OK    | 30s cycle, optimized parallel pull       |
| Backend sync routes   | ✓ OK    | push, changes, related all working       |
| SuperAdmin portal     | ✓ OK    | Full CRUD, impersonate, settings         |
| Audit logs            | ✓ Fixed | Table create, LIMIT fix, React key fix   |
| S3 backup             | ✓ OK    | Decrypted creds → upload after backup    |
| SMTP email            | ✓ OK    | nodemailer, test button, trial cron      |
| SMS sending           | ⚠ Partial | Credentials saved, sending not active  |
| Payment billing       | ⚠ Partial | Keys saved, auto-billing not active    |
| 2FA                   | ✓ OK    | TOTP via authenticator app               |
| License system        | ✓ OK    | Device fingerprint, periodic check       |

---

## 11. DEFAULT CREDENTIALS

| System         | User              | Password    | Notes              |
|----------------|-------------------|-------------|--------------------|
| POS App        | admin@pos.local   | admin123    | PIN: 1234          |
| SuperAdmin     | (set via script)  | (custom)    | scripts/create-superadmin.js |

---

*Report generated from codebase analysis — 2026-06-29*
*Total: 35 SQLite tables, 288 IPC methods, 12 SuperAdmin API routes, 30 React pages*
