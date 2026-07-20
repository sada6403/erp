import mysql, { type Pool, type PoolOptions } from 'mysql2/promise'
import { format as sqlFormat } from 'mysql2'

// ─── Convert PostgreSQL $1,$2 placeholders → MySQL ? ─────────────────────────
function convertSql(sql: string): string {
  return sql
    .replace(/\$\d+/g, '?')           // $1 $2 → ?
    .replace(/::\w+(\[\])?/g, '')      // ::int ::text ::timestamptz → remove
    .replace(/ILIKE/gi, 'LIKE')        // ILIKE → LIKE (MySQL case-insensitive by default)
}

// Pre-format SQL with values using mysql2 escaping so we never pass a values
// array into pool.query() — this fully bypasses the prepared-statement cache
// (PrepareStatementCache.set) that throws "Use `delete()` to clear values".
function fmt(sql: string, values?: unknown[]): string {
  const converted = convertSql(sql)
  return values && values.length > 0 ? sqlFormat(converted, values as Parameters<typeof sqlFormat>[1]) : converted
}

// ─── pg-style query result type ───────────────────────────────────────────────
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[]
}

export interface QueryClient {
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<T>>
  release(): void
}

// ─── MySQL connection config ──────────────────────────────────────────────────
interface WrappedPool {
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<T>>
  connect(): Promise<QueryClient>
}

// Exported so callers that need to shell out to the mysql/mysqldump CLI
// (backup.ts) can reuse the exact same host/port/user/password resolution
// instead of re-parsing DATABASE_URL themselves.
export function getConfig(database?: string): PoolOptions {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL)
    return {
      host:     url.hostname,
      port:     Number(url.port) || 3306,
      user:     url.username,
      password: url.password,
      database: database ?? url.pathname.slice(1),
      timezone: '+00:00',
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 8),
    }
  }
  return {
    host:     process.env.MYSQL_HOST     ?? '127.0.0.1',
    port:     Number(process.env.MYSQL_PORT ?? 3306),
    user:     process.env.MYSQL_USER     ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: database ?? (process.env.MYSQL_DATABASE ?? 'pos_erp_saas'),
    timezone: '+00:00',
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 8),
  }
}

// ─── Singleton pool (main SaaS database) ─────────────────────────────────────
declare global {
  var _posErpPool: Pool | undefined
  var _posErpTenantPools: Map<string, Pool> | undefined
}

const poolInstance = global._posErpPool ?? mysql.createPool(getConfig())
global._posErpPool = poolInstance
const tenantPoolInstances = global._posErpTenantPools ?? new Map<string, Pool>()
global._posErpTenantPools = tenantPoolInstances

function wrapPool(instance: Pool): WrappedPool {
  return {
    query: async <T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<T>> => {
      const [rows] = await instance.query(fmt(sql, values))
      return { rows: rows as T[] }
    },
    connect: async (): Promise<QueryClient> => {
      const conn = await instance.getConnection()
      return {
        query: async <T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<T>> => {
          const [rows] = await conn.query(fmt(sql, values))
          return { rows: rows as T[] }
        },
        release: () => conn.release(),
      }
    },
  }
}

export const pool = wrapPool(poolInstance)
export const db   = pool

// ─── Transaction helper (keeps same API as before) ────────────────────────────
export async function withTransaction<T>(fn: (client: QueryClient) => Promise<T>): Promise<T> {
  const conn = await poolInstance.getConnection()
  const client: QueryClient = {
    query: async <T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<T>> => {
      const [rows] = await conn.query(fmt(sql, values))
      return { rows: rows as T[] }
    },
    release: () => conn.release(),
  }
  try {
    await conn.beginTransaction()
    const result = await fn(client)
    await conn.commit()
    return result
  } catch (err) {
    try { await conn.rollback() } catch { /* ignore rollback error */ }
    throw err
  } finally {
    conn.release()
  }
}

// ─── Simple query helper ──────────────────────────────────────────────────────
export async function rows<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(sql, values)).rows
}

// ─── Create a pool connected to a specific tenant database ───────────────────
export function tenantPool(database: string): WrappedPool {
  let instance = tenantPoolInstances.get(database)
  if (!instance) {
    instance = mysql.createPool(getConfig(database))
    tenantPoolInstances.set(database, instance)
  }
  return wrapPool(instance)
}

// ─── Auto-migrate: create Phase-2 tables if they don't exist ─────────────────
async function autoMigrate() {
  const stmts = [
    // max_branches
    `ALTER TABLE companies ADD COLUMN max_branches    INT NOT NULL DEFAULT 1`,
    `ALTER TABLE companies ADD COLUMN max_users       INT NOT NULL DEFAULT 5`,
    `ALTER TABLE companies ADD COLUMN max_pos_devices INT NOT NULL DEFAULT 2`,
    `ALTER TABLE companies ADD COLUMN max_storage_gb  INT NOT NULL DEFAULT 5`,
    // per-company branding + company activation key
    `ALTER TABLE companies ADD COLUMN brand_color    VARCHAR(7)   NULL`,
    `ALTER TABLE companies ADD COLUMN brand_logo_url VARCHAR(512) NULL`,
    `ALTER TABLE companies ADD COLUMN branding_json  TEXT         NULL`,
    `ALTER TABLE companies ADD COLUMN company_key    VARCHAR(36)  NULL UNIQUE`,
    `UPDATE companies SET company_key = UUID() WHERE company_key IS NULL OR company_key = ''`,

    // subscription grace period on packages
    `ALTER TABLE packages ADD COLUMN grace_period_days INT NOT NULL DEFAULT 7`,
    `ALTER TABLE packages ADD COLUMN trial_days        INT NOT NULL DEFAULT 14`,

    `CREATE TABLE IF NOT EXISTS package_modules (
       id         VARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT (UUID()),
       package_id VARCHAR(36)  NOT NULL,
       module_key VARCHAR(64)  NOT NULL,
       is_enabled TINYINT(1)   NOT NULL DEFAULT 1,
       UNIQUE KEY uq_pkg_module (package_id, module_key),
       CONSTRAINT fk_pm_package FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
     )`,

    `CREATE TABLE IF NOT EXISTS company_modules (
       id         VARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT (UUID()),
       company_id VARCHAR(36)  NOT NULL,
       module_key VARCHAR(64)  NOT NULL,
       is_enabled TINYINT(1)   NOT NULL DEFAULT 1,
       enabled_by VARCHAR(36)  NULL,
       enabled_at DATETIME     NULL,
       UNIQUE KEY uq_company_module (company_id, module_key),
       CONSTRAINT fk_cm_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
     )`,

    `CREATE TABLE IF NOT EXISTS modules (
       id         VARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT (UUID()),
       module_key VARCHAR(64)  NOT NULL UNIQUE,
       module_name VARCHAR(128) NOT NULL,
       description TEXT        NULL,
       sort_order  INT         NOT NULL DEFAULT 0,
       is_active   TINYINT(1)  NOT NULL DEFAULT 1,
       created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     )`,

    `CREATE TABLE IF NOT EXISTS features (
       id           VARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT (UUID()),
       feature_key  VARCHAR(128) NOT NULL UNIQUE,
       feature_name  VARCHAR(128) NOT NULL,
       module_key    VARCHAR(64)  NOT NULL,
       description   TEXT         NULL,
       sort_order    INT          NOT NULL DEFAULT 0,
       is_active     TINYINT(1)   NOT NULL DEFAULT 1,
       created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     )`,

    `CREATE TABLE IF NOT EXISTS plans (
       id           VARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT (UUID()),
       plan_key     VARCHAR(64)  NOT NULL UNIQUE,
       plan_name    VARCHAR(128) NOT NULL,
       description  TEXT         NULL,
       monthly_price DECIMAL(12,2) NOT NULL DEFAULT 0,
       annual_price  DECIMAL(12,2) NOT NULL DEFAULT 0,
       validity_days INT         NOT NULL DEFAULT 30,
       is_active    TINYINT(1)   NOT NULL DEFAULT 1,
       created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     )`,

    `CREATE TABLE IF NOT EXISTS plan_modules (
       id         VARCHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
       plan_id    VARCHAR(36) NOT NULL,
       module_key VARCHAR(64) NOT NULL,
       is_enabled TINYINT(1)  NOT NULL DEFAULT 1,
       created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UNIQUE KEY uq_plan_module (plan_id, module_key),
       CONSTRAINT fk_plan_modules_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
     )`,

    `CREATE TABLE IF NOT EXISTS plan_features (
       id           VARCHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
       plan_id      VARCHAR(36) NOT NULL,
       feature_key  VARCHAR(128) NOT NULL,
       is_enabled   TINYINT(1)  NOT NULL DEFAULT 1,
       created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UNIQUE KEY uq_plan_feature (plan_id, feature_key),
       CONSTRAINT fk_plan_features_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
     )`,

    `CREATE TABLE IF NOT EXISTS company_feature_overrides (
       id          VARCHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
       company_id  VARCHAR(36) NOT NULL,
       feature_key VARCHAR(128) NOT NULL,
       is_enabled  TINYINT(1)  NOT NULL DEFAULT 1,
       enabled_by  VARCHAR(36) NULL,
       enabled_at  DATETIME    NULL,
       UNIQUE KEY uq_company_feature (company_id, feature_key),
       CONSTRAINT fk_cfo_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
     )`,

    `CREATE TABLE IF NOT EXISTS company_module_overrides (
       id         VARCHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
       company_id VARCHAR(36) NOT NULL,
       module_key VARCHAR(64) NOT NULL,
       is_enabled TINYINT(1)  NOT NULL DEFAULT 1,
       enabled_by VARCHAR(36) NULL,
       enabled_at DATETIME    NULL,
       UNIQUE KEY uq_company_module_override (company_id, module_key),
       CONSTRAINT fk_cmo_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
     )`,

    `CREATE TABLE IF NOT EXISTS company_limits (
       id             VARCHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
       company_id     VARCHAR(36) NOT NULL UNIQUE,
       max_users      INT NOT NULL DEFAULT 0,
       max_branches   INT NOT NULL DEFAULT 0,
       max_pos_devices INT NOT NULL DEFAULT 0,
       max_storage_gb INT NOT NULL DEFAULT 0,
       updated_by     VARCHAR(36) NULL,
       updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       CONSTRAINT fk_cl_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
     )`,

    `CREATE TABLE IF NOT EXISTS licenses (
       id           VARCHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
       company_id   VARCHAR(36) NOT NULL,
       license_key  VARCHAR(255) NOT NULL UNIQUE,
       status       VARCHAR(20)  NOT NULL DEFAULT 'active',
       plan_id      VARCHAR(36)  NULL,
       issued_to    VARCHAR(255) NULL,
       issued_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       expires_at   DATETIME     NULL,
       revoked_at   DATETIME     NULL,
       device_id    VARCHAR(255) NULL,
       notes        TEXT         NULL,
       created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       INDEX idx_license_company (company_id),
       INDEX idx_license_status (status)
     )`,

    `CREATE TABLE IF NOT EXISTS feature_usage (
       id           VARCHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
       company_id   VARCHAR(36) NOT NULL,
       user_id      VARCHAR(36) NULL,
       device_id    VARCHAR(255) NULL,
       feature_key  VARCHAR(128) NOT NULL,
       usage_count  INT NOT NULL DEFAULT 0,
       last_used_at  DATETIME NULL,
       created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       UNIQUE KEY uq_feature_usage (company_id, feature_key, device_id)
     )`,

    `CREATE TABLE IF NOT EXISTS subscription_history (
       id           VARCHAR(36) NOT NULL PRIMARY KEY DEFAULT (UUID()),
       company_id   VARCHAR(36) NOT NULL,
       plan_id      VARCHAR(36) NULL,
       status       VARCHAR(20) NOT NULL,
       starts_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       ends_at      DATETIME NULL,
       changed_by   VARCHAR(36) NULL,
       notes        TEXT NULL,
       created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       INDEX idx_sub_history_company (company_id)
     )`,

    `CREATE TABLE IF NOT EXISTS pos_devices (
       id              VARCHAR(36)   NOT NULL PRIMARY KEY DEFAULT (UUID()),
       company_id      VARCHAR(36)   NOT NULL,
       branch_id       VARCHAR(36)   NULL,
       device_name     VARCHAR(128)  NOT NULL,
       device_id       VARCHAR(255)  NULL,
       license_key     VARCHAR(255)  NOT NULL,
       status          ENUM('pending','active','deactivated') NOT NULL DEFAULT 'pending',
       os_info         VARCHAR(255)  NULL,
       app_version     VARCHAR(32)   NULL,
       activated_at    DATETIME      NULL,
       last_seen_at    DATETIME      NULL,
       deactivated_at  DATETIME      NULL,
       notes           TEXT          NULL,
       created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       UNIQUE KEY uq_device_id    (device_id),
       UNIQUE KEY uq_license_key  (license_key),
       CONSTRAINT fk_pd_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
     )`,

    // Add missing columns to pos_devices if table was created with old schema
    `ALTER TABLE pos_devices ADD COLUMN activated_at   DATETIME     NULL`,
    `ALTER TABLE pos_devices ADD COLUMN os_info        VARCHAR(255) NULL`,
    `ALTER TABLE pos_devices ADD COLUMN app_version    VARCHAR(32)  NULL`,
    `ALTER TABLE pos_devices ADD COLUMN last_seen_at   DATETIME     NULL`,
    `ALTER TABLE pos_devices ADD COLUMN deactivated_at DATETIME     NULL`,
    `ALTER TABLE pos_devices ADD COLUMN updated_at     DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP`,

    `CREATE TABLE IF NOT EXISTS sync_logs (
       id         VARCHAR(36)  NOT NULL PRIMARY KEY DEFAULT (UUID()),
       company_id VARCHAR(36)  NOT NULL,
       device_id  VARCHAR(36)  NULL,
       status     ENUM('success','failed') NOT NULL,
       records    INT          NOT NULL DEFAULT 0,
       error_msg  TEXT         NULL,
       created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_sl_company   (company_id),
       INDEX idx_sl_created   (created_at)
     )`,

    `CREATE TABLE IF NOT EXISTS saas_audit_logs (
       id           CHAR(36)     NOT NULL PRIMARY KEY,
       portal       VARCHAR(20)  NOT NULL,
       actor_type   VARCHAR(30)  NOT NULL,
       actor_id     VARCHAR(36)  NOT NULL,
       actor_name   VARCHAR(255) NULL,
       company_id   CHAR(36)     NULL,
       action       VARCHAR(100) NOT NULL,
       resource     VARCHAR(100) NULL,
       resource_id  VARCHAR(36)  NULL,
       old_values   JSON         NULL,
       new_values   JSON         NULL,
       ip_address   VARCHAR(45)  NULL,
       user_agent   TEXT         NULL,
       created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_al_actor   (actor_type, actor_id),
       INDEX idx_al_company (company_id),
       INDEX idx_al_date    (created_at)
     )`,

    `CREATE TABLE IF NOT EXISTS system_settings (
       \`key\`      VARCHAR(64)  NOT NULL PRIMARY KEY,
       value       JSON         NOT NULL,
       updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
     )`,

    `CREATE TABLE IF NOT EXISTS support_sessions (
       id             CHAR(36)     NOT NULL PRIMARY KEY,
       superadmin_id  CHAR(36)     NOT NULL,
       company_id     CHAR(36)     NOT NULL,
       reason         TEXT         NULL,
       started_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
       ended_at       DATETIME     NULL
     )`,
  ]

  for (const sql of stmts) {
    try {
      await pool.query(sql)
    } catch (e) {
      // Log but don't crash — ALTER TABLE IF NOT EXISTS may be unsupported on older MySQL
      console.warn('[autoMigrate] skipped:', (e as Error).message?.slice(0, 120))
    }
  }
}

// Run once on cold start (Next.js module cache ensures single execution per process)
declare global { var _posErpMigrated: boolean | undefined }
if (!global._posErpMigrated) {
  global._posErpMigrated = true
  autoMigrate().catch(e => console.error('[autoMigrate] fatal:', e))
}
