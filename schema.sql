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

-- 注册登记表：记录注册 IP、UA 与条款同意情况（独立表，避免改动 users 结构）
CREATE TABLE IF NOT EXISTS registrations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  ip           TEXT,
  ua           TEXT,
  agreed_terms INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reg_ip    ON registrations(ip);
CREATE INDEX IF NOT EXISTS idx_reg_user  ON registrations(user_id);

-- NS 委派：把子域名托管到第三方 DNS（anyns.io / DNSHE / Cloudflare / 自定义）
CREATE TABLE IF NOT EXISTS delegations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  subdomain_id  INTEGER NOT NULL UNIQUE,
  provider      TEXT    NOT NULL,            -- anyns | dnshe | cloudflare | custom
  zone_name     TEXT    NOT NULL,
  ns_list       TEXT    NOT NULL,            -- JSON 数组
  provider_zone TEXT,                        -- 服务商侧的 zone id（若通过 API 创建）
  created_by    INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delegations_sub ON delegations(subdomain_id);

-- 积分余额（独立表，不动 users 结构；-1 表示不限，仅管理员）
CREATE TABLE IF NOT EXISTS user_points (
  user_id    INTEGER PRIMARY KEY,
  points     INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- 积分流水：签到获得，申请/兑换子域名消耗（单字域名更贵）
CREATE TABLE IF NOT EXISTS point_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  delta      INTEGER NOT NULL,               -- 正数为获得，负数为消耗
  balance    INTEGER NOT NULL,               -- 变动后的余额
  reason     TEXT    NOT NULL,               -- checkin | apply | admin_adjust | ...
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_point_logs_user ON point_logs(user_id, created_at DESC);

-- 每日签到（同一天只能领一次，按站点时区计）
CREATE TABLE IF NOT EXISTS checkins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  day        TEXT    NOT NULL,               -- YYYY-MM-DD
  points     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_user_day ON checkins(user_id, day);

-- IP 封禁名单（某 IP 下的账号超限时由管理员一键封禁）
CREATE TABLE IF NOT EXISTS ip_bans (
  ip         TEXT PRIMARY KEY,
  reason     TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL
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
-- 同 IP 可注册的账号数上限（管理员可在后台调整）
INSERT OR IGNORE INTO settings(key, value) VALUES ('max_accounts_per_ip', '2');
-- 积分规则
INSERT OR IGNORE INTO settings(key, value) VALUES ('checkin_points', '5');      -- 每日签到奖励
INSERT OR IGNORE INTO settings(key, value) VALUES ('domain_cost', '5');         -- 申请一个子域名消耗
INSERT OR IGNORE INTO settings(key, value) VALUES ('short_domain_cost', '35');  -- 单字域名消耗
INSERT OR IGNORE INTO settings(key, value) VALUES ('short_domain_len', '1');    -- 长度 <= 该值视为单字域名
INSERT OR IGNORE INTO settings(key, value) VALUES ('initial_points', '10');     -- 新用户初始积分
-- WHOIS 持有人邮箱显示方式：masked 脱敏（默认）| none 不显示 | full 完整
INSERT OR IGNORE INTO settings(key, value) VALUES ('whois_holder', 'masked');
-- 站点品牌（后台「站点设置」可改）
INSERT OR IGNORE INTO settings(key, value) VALUES ('site_name', 'Meoy');
INSERT OR IGNORE INTO settings(key, value) VALUES ('logo_url', '/img/logo.jpg');
INSERT OR IGNORE INTO settings(key, value) VALUES ('favicon_url', '/favicon.ico');

-- 迁移：早期默认 favicon 为 png，现统一为根目录的 .ico（仅改仍是旧默认值的库）
UPDATE settings SET value = '/favicon.ico' WHERE key = 'favicon_url' AND value = '/img/favicon.png';
