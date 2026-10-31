-- ============================================================
--  二级域名分发系统 · D1 (SQLite) 表结构
--  初始化： npx wrangler d1 execute subdomain-hub-db --remote --file=./schema.sql
-- ============================================================

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'user',      -- user | admin
  status        TEXT    NOT NULL DEFAULT 'active',    -- active | banned
  ban_reason    TEXT,
  quota         INTEGER NOT NULL DEFAULT 5,           -- 最多可持有的子域名数
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

-- 会话表
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ip         TEXT,
  ua         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 子域名表
CREATE TABLE IF NOT EXISTS subdomains (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  label         TEXT    NOT NULL UNIQUE,      -- 二级部分，如 mail
  fqdn          TEXT    NOT NULL UNIQUE,      -- 完整域名，如 mail.meoy.top
  user_id       INTEGER NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | suspended
  reason        TEXT,                          -- 驳回 / 停用原因
  note          TEXT,                          -- 用户申请时填写的用途说明
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  reviewed_at   INTEGER,
  reviewed_by   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_subdomains_user   ON subdomains(user_id);
CREATE INDEX IF NOT EXISTS idx_subdomains_status ON subdomains(status);

-- DNS 记录表
CREATE TABLE IF NOT EXISTS dns_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  subdomain_id  INTEGER NOT NULL,
  cf_record_id  TEXT,                          -- Cloudflare 侧的 record id
  type          TEXT    NOT NULL,              -- A/AAAA/CNAME/MX/TXT/NS/PTR/SRV/CAA/NAPTR/DS
  host          TEXT    NOT NULL,              -- 用户填写的相对主机名，@ 表示子域名本身
  name          TEXT    NOT NULL,              -- 最终写入 Cloudflare 的完整记录名
  content       TEXT    NOT NULL DEFAULT '',   -- 主值（A/AAAA/CNAME/MX/TXT/NS/PTR）
  data          TEXT,                          -- 结构化字段 JSON（SRV/CAA/NAPTR/DS）
  ttl           INTEGER NOT NULL DEFAULT 1,    -- 1 = 自动
  proxied       INTEGER NOT NULL DEFAULT 0,    -- 仅 A/AAAA/CNAME
  priority      INTEGER,                       -- MX / SRV
  comment       TEXT,
  -- 根域名验证锁：1 = 已锁定，任何人都不能改/删，只有发起人点“确认认证完成”或管理员强制解锁
  verify_lock   INTEGER NOT NULL DEFAULT 0,
  verify_preset TEXT,                          -- vercel / netlify / dnspod / custom
  locked_at     INTEGER,
  locked_by     INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_sub ON dns_records(subdomain_id);
CREATE INDEX IF NOT EXISTS idx_records_cf  ON dns_records(cf_record_id);
-- 同一完整记录名下，只允许存在一条处于锁定状态的记录（防抢占）
CREATE UNIQUE INDEX IF NOT EXISTS idx_records_lock_unique
  ON dns_records(name, type) WHERE verify_lock = 1;

-- 审计日志
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  action     TEXT    NOT NULL,
  target     TEXT,
  detail     TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);

-- 站点配置（可选，用于运行时开关）
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings(key, value) VALUES ('signup_open', '1');
INSERT OR IGNORE INTO settings(key, value) VALUES ('approval_required', '1');
INSERT OR IGNORE INTO settings(key, value) VALUES ('announcement', '欢迎使用二级域名分发系统');
