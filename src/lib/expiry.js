// ============================================================
//  域名有效期 / 续期
//  - 新申请的域名：默认 1 年（可配置）
//  - 迁移前已注册（approved）的域名：设为永久，不追溯
//  - 到期前 N 天（默认 180）内可续期，每次续 1 年
// ============================================================

const DAY = 24 * 60 * 60 * 1000;

/** 读取有效期相关规则（站点设置可改） */
export async function expiryRules(env) {
  const get = async (k, d) => {
    try {
      const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(k).first();
      const v = String(row?.value ?? '').trim();
      return v === '' ? d : Number(v);
    } catch { return d; }
  };
  const years = Number(await get('domain_valid_days', 365));
  const renewWindow = Number(await get('renew_window_days', 180));
  return {
    validDays: Number.isFinite(years) && years > 0 ? years : 365,
    renewWindowDays: Number.isFinite(renewWindow) && renewWindow >= 0 ? renewWindow : 180,
  };
}

/** 计算到期时间；perpetual 或 validDays<=0 返回 null（永久） */
export function computeExpiry({ perpetual = false, validDays = 365, from = Date.now() } = {}) {
  if (perpetual || !(validDays > 0)) return null;
  return from + validDays * DAY;
}

/**
 * 域名有效期状态
 * @returns { expired, willExpire, canRenew, daysLeft, expiresAt, perpetual }
 */
export function expiryState(row, { renewWindowDays = 180, now = Date.now() } = {}) {
  const perpetual = Number(row?.perpetual) === 1 || !row?.expires_at;
  const expiresAt = row?.expires_at ? Number(row.expires_at) : null;
  if (perpetual || !expiresAt) {
    return { expired: false, willExpire: false, canRenew: false, daysLeft: null, expiresAt: null, perpetual: true };
  }
  const left = expiresAt - now;
  const daysLeft = Math.ceil(left / DAY);
  return {
    expired: left <= 0,
    willExpire: left > 0 && left <= renewWindowDays * DAY,
    canRenew: left > 0 && left <= renewWindowDays * DAY,
    daysLeft: Math.max(0, daysLeft),
    expiresAt,
    perpetual: false,
  };
}

/** 续期：在可续窗口内把到期时间往后推一个周期 */
export function renewExpiry(row, { validDays = 365, now = Date.now() } = {}) {
  if (Number(row?.perpetual) === 1) return { ok: false, message: '该域名为永久有效，无需续期' };
  const base = Number(row?.expires_at) || now;
  // 已过期则从现在起算，未过期则在原到期时间上顺延
  const from = base > now ? base : now;
  return { ok: true, expiresAt: from + validDays * DAY };
}

/**
 * 旧库列补齐：CREATE TABLE IF NOT EXISTS 不会给已存在的表加列，
 * 因此对 2024 之前建的库需要 ALTER TABLE ADD COLUMN。
 * 幂等 —— 先 PRAGMA table_info 检测，已存在则跳过。
 */
let colsChecked = false;
export async function ensureExpiryColumns(env) {
  if (colsChecked) return;
  try {
    const info = await env.DB.prepare('PRAGMA table_info(subdomains)').all();
    const have = new Set((info?.results || []).map((r) => String(r.name)));
    const add = async (col, ddl) => {
      if (have.has(col)) return;
      await env.DB.prepare(`ALTER TABLE subdomains ADD COLUMN ${col} ${ddl}`).run();
    };
    await add('expires_at', 'INTEGER');
    await add('renewed_at', 'INTEGER');
    await add('perpetual', 'INTEGER NOT NULL DEFAULT 0');
    colsChecked = true;
  } catch { /* 表不存在或其它异常：交由建表流程处理 */ }
}

/**
 * 一次性迁移：把迁移前已 approved 的域名设为永久。
 * 幂等 —— migrations 表记录已执行，重复调用不会覆盖后续管理操作。
 */
export async function migrateLegacyPerpetual(env) {
  try {
    await ensureExpiryColumns(env);
    const m = await env.DB.prepare("SELECT applied_at FROM migrations WHERE name = 'legacy_perpetual'").first();
    if (m && Number(m.applied_at) > 0) return { applied: false };
    const r = await env.DB
      .prepare("UPDATE subdomains SET perpetual = 1, expires_at = NULL WHERE status = 'approved' AND (perpetual IS NULL OR perpetual = 0)")
      .run();
    await env.DB
      .prepare("UPDATE migrations SET applied_at = ? WHERE name = 'legacy_perpetual'")
      .bind(Date.now())
      .run();
    return { applied: true, rows: r?.meta?.changes ?? 0 };
  } catch { return { applied: false }; }
}
