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

-- 外部域名 WHOIS 结果缓存（避免触发 DNSHE 2次/分钟、RDAP 注册局限流）
CREATE TABLE IF NOT EXISTS whois_cache (
  domain     TEXT    PRIMARY KEY,
  data       TEXT    NOT NULL,
  fetched_at INTEGER NOT NULL
);

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
  status        TEXT    NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | suspended | expired
  reason        TEXT,                          -- 驳回 / 停用原因
  note          TEXT,                          -- 用户申请时填写的用途说明
  -- 有效期：NULL = 永久（迁移前已注册的域名）；有值 = 到期时间戳
  expires_at    INTEGER,
  renewed_at    INTEGER,                       -- 最近一次续期时间
  perpetual     INTEGER NOT NULL DEFAULT 0,    -- 1 = 永久有效（老域名 / 管理员设置）
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  reviewed_at   INTEGER,
  reviewed_by   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_subdomains_user    ON subdomains(user_id);
CREATE INDEX IF NOT EXISTS idx_subdomains_status  ON subdomains(status);
-- 注意：旧库没有 expires_at 列，CREATE TABLE IF NOT EXISTS 不会补列，
-- 因此 expires_at 相关索引放到「列补齐」步骤之后再建（见文件末尾）。
-- 这里先尝试建，失败会被忽略，末尾会重试。

-- 一次性迁移：迁移前已注册（approved）的域名设为永久，不追溯 1 年有效期。
-- 用 INSERT OR IGNORE 记录迁移标记，重复执行不会覆盖管理员后来的改动。
CREATE TABLE IF NOT EXISTS migrations (
  name       TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO migrations (name, applied_at) VALUES ('legacy_perpetual', 0);

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

-- ══════════════════════════════════════════════════════════
--  列补齐：CREATE TABLE IF NOT EXISTS 不会给已存在的表加列，
--  因此对旧库逐列检测后再 ALTER TABLE ADD COLUMN（SQLite 不支持 IF NOT EXISTS）。
--  wrangler d1 execute 执行整份文件时，每条语句独立提交，
--  失败会中断后续语句 —— 所以这些 ALTER 必须由应用层的幂等迁移承担。
--  这里保留注释说明，实际补齐逻辑见 src/lib/expiry.js 的 ensureExpiryColumns()。
-- ══════════════════════════════════════════════════════════

-- 有效期规则（管理员可在后台「站点设置」调整）
INSERT OR IGNORE INTO settings(key, value) VALUES ('domain_valid_days', '365');   -- 新申请域名有效期（天）
INSERT OR IGNORE INTO settings(key, value) VALUES ('renew_window_days', '180');   -- 到期前多少天内可续期

-- ══════════════════════════════════════════════════════════
--  兑换码：V-XXX 域名永久化 / PE-XXXXX 配额
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS redeem_codes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    NOT NULL UNIQUE,   -- 形如 V-A1B2C3 / PE-XXXXXXX
  type         TEXT    NOT NULL,          -- permanent | quota
  value        INTEGER NOT NULL DEFAULT 1,-- quota 类型表示增加的配额数量
  max_uses     INTEGER NOT NULL DEFAULT 1,
  used_count   INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'active',  -- active | disabled
  note         TEXT,                       -- 备注（派发给谁）
  expires_at   INTEGER,                    -- 为空表示长期有效
  created_by   INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redeem_status ON redeem_codes(status);
CREATE INDEX IF NOT EXISTS idx_redeem_type   ON redeem_codes(type);

-- 兑换记录（含 V 码兑换时绑定的域名）
CREATE TABLE IF NOT EXISTS redeem_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    NOT NULL,
  user_id      INTEGER NOT NULL,
  type         TEXT    NOT NULL,
  subdomain_id INTEGER,                    -- permanent 类型：被永久化的域名
  value        INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redeem_logs_user ON redeem_logs(user_id);

-- ══════════════════════════════════════════════════════════
--  聊天地（讨论区 / 博客）
-- ══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0,
  locked     INTEGER NOT NULL DEFAULT 0,
  views      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_posts_user ON chat_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_posts_time ON chat_posts(created_at);

CREATE TABLE IF NOT EXISTS chat_replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_replies_post ON chat_replies(post_id);

-- 全局中文字体（正文 / 标题）：system | noto | lxgw | zcool
INSERT OR IGNORE INTO settings(key, value) VALUES('font_body', 'zcool');
INSERT OR IGNORE INTO settings(key, value) VALUES('font_display', 'zcool');

-- 用户资料（独立表：不动 users 结构，避免已存在表补列失败）
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id     INTEGER PRIMARY KEY,
  uid         TEXT,                       -- 对外展示的 UID（不含敏感信息）
  avatar      TEXT,                       -- 头像地址（站内 /img/avatar/xx.svg 或外链）
  nickname    TEXT,                       -- 昵称
  bio         TEXT,                       -- 个人简介 / 签名
  updated_at  INTEGER
);

-- 工单系统
CREATE TABLE IF NOT EXISTS tickets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  subject    TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'open',   -- open=待处理 pending=处理中 answered=有回复 closed=已关闭
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ticket_replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_replies_ticket ON ticket_replies(ticket_id, id);

-- 域名转移记录（不可逆，留痕备查）
CREATE TABLE IF NOT EXISTS transfers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subdomain_id INTEGER NOT NULL,
  fqdn         TEXT    NOT NULL,
  from_user    INTEGER NOT NULL,
  to_user      INTEGER NOT NULL,
  to_email     TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transfers_fqdn ON transfers(fqdn, created_at DESC);

-- ══════════════════════════════════════════════════════════
-- 多根域名支持（幂等，可重复执行）
-- ══════════════════════════════════════════════════════════
-- 背景：原表 label 是 UNIQUE，导致同一 label 无法存在于不同根域名下
--      （如 mail.meoy.top 与 mail.foo.com 互斥）。
-- 做法：重建表，去掉 label 的 UNIQUE，唯一性改由 fqdn 承担（fqdn 已含根域名）。
-- 注意：不使用 ALTER TABLE ADD COLUMN —— SQLite 不支持 IF NOT EXISTS，
--      重复执行会报 duplicate column 并中断整个 schema。
--      root_domain 改由 fqdn 反推（substr 表达式），因此完全幂等。

CREATE TABLE IF NOT EXISTS subdomains_mr (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  label         TEXT    NOT NULL,
  root_domain   TEXT    NOT NULL DEFAULT '',
  fqdn          TEXT    NOT NULL UNIQUE,
  user_id       INTEGER NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'pending',
  reason        TEXT,
  note          TEXT,
  expires_at    INTEGER,
  renewed_at    INTEGER,
  perpetual     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  reviewed_at   INTEGER,
  reviewed_by   INTEGER
);

-- 迁移：仅当新表为空时执行（避免重复部署覆盖已有数据）
-- root_domain 从 fqdn 反推：mail.meoy.top → meoy.top
INSERT INTO subdomains_mr (id, label, root_domain, fqdn, user_id, status, reason, note,
                           expires_at, renewed_at, perpetual, created_at, updated_at,
                           reviewed_at, reviewed_by)
SELECT id, label,
       CASE WHEN instr(fqdn, '.') > 0 THEN substr(fqdn, instr(fqdn, '.') + 1) ELSE '' END,
       fqdn, user_id, status, reason, note,
       expires_at, renewed_at, COALESCE(perpetual, 0),
       created_at, updated_at, reviewed_at, reviewed_by
FROM subdomains
WHERE (SELECT COUNT(*) FROM subdomains_mr) = 0;

-- 原子切换：旧表改名保留（不 DROP，防误删数据），新表转正
DROP TABLE IF EXISTS subdomains_old_mr;
ALTER TABLE subdomains RENAME TO subdomains_old_mr;
ALTER TABLE subdomains_mr RENAME TO subdomains;

-- 重建索引
CREATE INDEX IF NOT EXISTS idx_subdomains_user   ON subdomains(user_id);
CREATE INDEX IF NOT EXISTS idx_subdomains_status ON subdomains(status);
CREATE INDEX IF NOT EXISTS idx_subdomains_root   ON subdomains(root_domain, label);
CREATE INDEX IF NOT EXISTS idx_subdomains_fqdn   ON subdomains(fqdn);

-- ══════════════════════════════════════════════════════════
-- 管理员域名永久化（幂等，可重复执行）
-- ══════════════════════════════════════════════════════════
-- 管理员自身持有的域名一律永久有效（新申请时直接写 perpetual=1，
-- 这里负责回填历史数据）。
UPDATE subdomains
   SET perpetual = 1,
       expires_at = NULL
 WHERE perpetual = 0
   AND user_id IN (SELECT id FROM users WHERE role = 'admin');
