# Enterprise POS ERP — Project Guide

## Stack
- **Electron** (main process) + **React + TypeScript + Vite** (renderer)
- **TailwindCSS** (dark-first design system)
- **SQLite** via `better-sqlite3` (local, encrypted-capable)
- **Next.js + PostgreSQL** (self-hosted VPS cloud sync)
- **Zustand** (state: auth + cart)

## Quick Start
```bash
npm install
npm run dev        # Electron + React dev server
```

## Build
```bash
npm run build:win  # Windows NSIS installer
```

## Key Directories
```
electron/
  main.ts              # Electron entry, bootstraps everything
  preload.ts           # Context bridge → window.api
  database.ts          # SQLite init + seed
  ipc/                 # IPC handlers (products, invoices, ...)
  services/
    syncService.ts     # 30s background sync to the VPS API
    syncQueue.ts       # Enqueue helper

src/
  pages/
    pos/POSPage.tsx    # Main POS interface (F1-F6 shortcuts)
    admin/             # All admin pages
  components/
    pos/               # ProductGrid, Cart, PaymentModal, ...
    layout/AppLayout   # Sidebar nav + sync indicator
    shared/            # Modal, PageHeader, StatCard
  store/
    authStore.ts       # Zustand auth (JWT)
    cartStore.ts       # Zustand cart (computed totals)
  hooks/
    useKeyboard.ts     # Global keyboard shortcut system
    useSyncStatus.ts   # Online/offline + sync queue polling

database/schema.sql    # SQLite schema (all 16 tables)
backend/               # Next.js API, PostgreSQL schema, Docker deployment
```

## Default Login
- Email: `admin@pos.local`
- Password: `admin123`
- PIN: `1234`

## POS Keyboard Shortcuts
| Key | Action |
|-----|--------|
| F1 | New Invoice |
| F2 | Search Customer |
| F3 | Hold Invoice |
| F4 | Payment Screen |
| F5 | Print |
| F6 | Focus Product Search |
| ESC | Close Modal |
| Enter | Add Product |
| Arrow keys | Navigate product grid |
| Ctrl+S / Ctrl+P | Save / Print |

## Offline-First Architecture
1. Every write goes to SQLite immediately (zero latency, zero data loss)
2. Write is also enqueued in `sync_queue` table
3. `SyncService` runs every 30s → pushes pending items to the VPS API
4. Upsert with `onConflict: 'id'` → last-write-wins conflict resolution
5. Failed items retry up to 5 times before marking `failed`

## Self-Hosted Backend Setup
1. Configure `backend/.env` or `backend/docker-compose.yml`
2. Run `docker compose up -d --build` from `backend/`
3. Enter the API URL + API key in Admin → Settings → Self-Hosted Cloud Sync

## User Roles & Permissions
| Role | POS | Inventory | Reports | Employees | All |
|------|-----|-----------|---------|-----------|-----|
| Super Admin | ✓ | ✓ | ✓ | ✓ | ✓ |
| Branch Manager | ✓ | ✓ | ✓ | ✓ | — |
| Cashier | ✓ | — | — | — | — |
| Warehouse Staff | — | ✓ | — | — | — |
| Delivery Staff | — | — | — | — | — |
