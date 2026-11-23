-- Additive, tenant-local management extension. Run only using the backup-first runner.
CREATE TABLE IF NOT EXISTS management_access (
 user_id CHAR(36) PRIMARY KEY, role_code VARCHAR(40) NOT NULL,
 platform VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'active',
 scope_type VARCHAR(16) NOT NULL, scope_id CHAR(36) NULL,
 manager_user_id CHAR(36) NULL, session_version INT NOT NULL DEFAULT 1,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS management_branch_regions (
 branch_id CHAR(36) PRIMARY KEY, region_id CHAR(36) NOT NULL
);
CREATE TABLE IF NOT EXISTS management_policies (
 id CHAR(36) PRIMARY KEY, role_code VARCHAR(40) NOT NULL, user_id CHAR(36) NULL, effective_from DATE NOT NULL,
 effective_to DATE NULL, policy JSON NOT NULL, created_by CHAR(36) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_management_policy_role(role_code,effective_from)
);
CREATE TABLE IF NOT EXISTS management_targets (
 id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, period_start DATE NOT NULL, period_end DATE NOT NULL,
 amount DECIMAL(14,2) NOT NULL, active_from DATE NOT NULL, active_to DATE NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'active', revision INT NOT NULL DEFAULT 1,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_management_target(user_id,period_start)
);
CREATE TABLE IF NOT EXISTS management_attributions (
 invoice_id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, assigned_by CHAR(36) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS management_customer_activity (
 customer_id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, branch_id CHAR(36) NOT NULL,
 activity_date DATE NOT NULL, normalized_phone VARCHAR(32) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending', verified_by CHAR(36) NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_management_customer_phone(normalized_phone)
);
CREATE TABLE IF NOT EXISTS management_payroll (
 id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, employee_name VARCHAR(255) NOT NULL, period_start DATE NOT NULL, period_end DATE NOT NULL,
 policy_id CHAR(36) NOT NULL, policy_snapshot JSON NOT NULL, breakdown JSON NOT NULL,
 scope_type VARCHAR(16) NOT NULL, scope_id CHAR(36) NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'draft', created_by CHAR(36) NOT NULL,
 approved_by CHAR(36) NULL, paid_by CHAR(36) NULL, paid_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_management_payroll(user_id,period_start)
);
CREATE TABLE IF NOT EXISTS management_sessions (
 id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, platform VARCHAR(16) NOT NULL,
 token_hash CHAR(64) NOT NULL UNIQUE, session_version INT NOT NULL,
 expires_at DATETIME NOT NULL, revoked_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_management_sessions_user(user_id)
);
CREATE TABLE IF NOT EXISTS management_audit (
 id CHAR(36) PRIMARY KEY, actor_id CHAR(36) NULL, action VARCHAR(64) NOT NULL,
 entity_id VARCHAR(64) NULL, details JSON NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS management_finance_classifications (
 source_type VARCHAR(20) NOT NULL, source_id CHAR(36) NOT NULL,
 classification VARCHAR(32) NOT NULL, payroll_id CHAR(36) NULL, commission_id CHAR(36) NULL,
 PRIMARY KEY(source_type,source_id)
);
CREATE TABLE IF NOT EXISTS management_settings (
 id VARCHAR(32) PRIMARY KEY, value JSON NOT NULL
);
