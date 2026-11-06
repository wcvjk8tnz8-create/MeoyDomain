/**
 * TerraDomain · 全局类型定义
 *
 * 渐进式 TypeScript 迁移的基础设施：
 *  - Env：Worker 的全部绑定（D1 / R2 / ASSETS / Secrets / Vars）
 *  - 数据行：与 schema.sql 一一对应
 *  - Hono 变量：c.get('user') 的类型
 *
 * 存量 .js 文件不受影响（tsconfig 里 checkJs=false）。
 * 新增 / 重写的模块请用 .ts 并 import 这里的类型。
 */

// ────────────────────────────────────────────────────────────
// 1. Worker 绑定
// ────────────────────────────────────────────────────────────
export interface Env {
  /** D1 数据库 */
  DB: D1Database;
  /** R2 存储桶：用户自定义头像（未启用时不存在，运行时需判空） */
  AVATARS?: R2Bucket;
  /** Workers 静态资源 */
  ASSETS?: Fetcher;
  /** Cloudflare Workers AI 绑定（wrangler.toml [ai]）。
   *  自定义网关模式下不存在，运行时必须判空；用最小结构声明，
   *  避免依赖 @cloudflare/workers-types 里 Ai 接口的版本差异。 */
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };

  // ── Secrets（wrangler secret put 写入）──
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
  DNSHE_API_KEY?: string;
  DNSHE_API_SECRET?: string;

  // ── Vars（wrangler.toml [vars] / CI 注入）──
  ROOT_DOMAIN?: string;
  /** 多根域名：逗号分隔的根域名列表 */
  ROOT_DOMAINS?: string;
  /** 多根域名：\`域名:ZoneID\` 逗号分隔 */
  CF_ZONE_IDS?: string;
  DEFAULT_QUOTA?: string;
  ALLOW_SIGNUP?: string;
  REQUIRE_APPROVAL?: string;
  RESERVED_LABELS?: string;
  CF_MOCK?: string;
  R2_PUBLIC_URL?: string;
  AVATAR_MAX_KB?: string;
  ALLOWED_EMAIL_DOMAINS?: string;
  /** 注册邮箱规则默认模式：whitelist_edu（默认）/ whitelist / edu_only / any；后台设置优先 */
  EMAIL_RULE?: string;

  // ── AI 自动审核（密钥走 Secret / 后台设置，不写进代码库）──
  AI_API_KEY?: string;
  AI_API_URL?: string;
  AI_MODEL?: string;
  AI_REVIEW_ENABLED?: string;
  AI_REVIEW_ROOTS?: string;
  /** custom（默认）= 自定义 OpenAI 兼容网关；workers-ai = Cloudflare 内置 */
  AI_PROVIDER?: string;
  DNS_UNLIMITED_ROOTS?: string;
}

// ────────────────────────────────────────────────────────────
// 2. Hono 上下文变量
// ────────────────────────────────────────────────────────────
export interface SessionUser {
  id: number;
  email: string;
  role: 'user' | 'admin';
  /** 会话 token，修改密码时用于保留当前会话 */
  token?: string;
}

export interface HonoVars {
  user?: SessionUser;
}

// ────────────────────────────────────────────────────────────
// 3. 数据行（对应 schema.sql）
// ────────────────────────────────────────────────────────────
export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: 'user' | 'admin';
  status: 'active' | 'banned';
  /** -1 表示不限量 */
  quota: number;
  created_at: number;
  last_login_at: number | null;
  ban_reason?: string | null;
}

export type SubdomainStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'suspended';

export interface SubdomainRow {
  id: number;
  user_id: number;
  label: string;
  fqdn: string;
  status: SubdomainStatus;
  purpose: string | null;
  reason: string | null;
  reserved: number | null;
  created_at: number;
  updated_at: number;
  /** 到期时间戳；perpetual 为 1 时表示永久 */
  expires_at: number | null;
  perpetual: number | null;
}

export interface DnsRecordRow {
  id: number;
  subdomain_id: number;
  cf_record_id: string | null;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: number | null;
  priority: number | null;
  comment: string | null;
  /** 根域名验证锁定：1 表示锁定中，他人不可改删 */
  verify_lock: number | null;
  verify_preset: string | null;
  locked_at: number | null;
  locked_by: number | null;
  created_at: number;
  updated_at: number;
}

export interface UserProfileRow {
  user_id: number;
  uid: string | null;
  avatar: string | null;
  nickname: string | null;
  bio: string | null;
  updated_at: number | null;
}

export type TicketStatus = 'open' | 'pending' | 'answered' | 'closed';

export interface TicketRow {
  id: number;
  user_id: number;
  subject: string;
  status: TicketStatus;
  created_at: number;
  updated_at: number;
}

export interface TicketReplyRow {
  id: number;
  ticket_id: number;
  user_id: number;
  is_admin: number;
  content: string;
  created_at: number;
}

export interface TransferRow {
  id: number;
  subdomain_id: number;
  fqdn: string;
  from_user: number;
  to_user: number;
  to_email: string;
  created_at: number;
}

export interface SettingsRow {
  key: string;
  value: string;
}

// ────────────────────────────────────────────────────────────
// 4. 常用结构
// ────────────────────────────────────────────────────────────
export interface AvatarItem {
  key: string;
  url: string;
}

export interface VerifyPreset {
  key: string;
  host: string;
  label: string;
  hint?: string;
  valueHint?: string;
}

/** 统一的 API 响应体 */
export interface ApiOk<T = unknown> {
  success: true;
  data?: T;
  [k: string]: unknown;
}

export interface ApiFail {
  success: false;
  message: string;
  [k: string]: unknown;
}
