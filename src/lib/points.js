// ============================================================
//  积分
//  - 每日签到领取（默认 +5）
//  - 申请子域名消耗（普通 5 分，单字域名 35 分）
//  - 管理员无限（points = -1）
//  - 老用户的已有子域名不追溯扣分
// ============================================================

export const UNLIMITED_POINTS = -1;

/** 读取用户积分；从未初始化则按 initial_points 初始化 */
export async function getPoints(db, userId, initial = 10) {
  const row = await db.prepare('SELECT points FROM user_points WHERE user_id = ?').bind(userId).first();
  if (row) return row.points;
  await db
    .prepare('INSERT INTO user_points (user_id, points, updated_at) VALUES (?,?,?)')
    .bind(userId, initial, Date.now())
    .run();
  return initial;
}

/**
 * 首次初始化积分时给老用户补偿：
 * 按其「已有的、计入额度」的子域名数 × 单个域名价格发放，
 * 保证老用户升级后资产不缩水（已有域名不会被扣分或回收）。
 * 新用户（0 个域名）拿到的是 initial_points。
 */
export async function ensurePoints(db, userId, { initial = 10, domainCost = 5 } = {}) {
  const row = await db.prepare('SELECT points FROM user_points WHERE user_id = ?').bind(userId).first();
  if (row) return row.points;
  const cnt = await db
    .prepare("SELECT COUNT(*) AS n FROM subdomains WHERE user_id = ? AND status <> 'rejected'")
    .bind(userId)
    .first();
  const granted = Math.max(initial, (cnt?.n || 0) * domainCost);
  await db
    .prepare('INSERT INTO user_points (user_id, points, updated_at) VALUES (?,?,?)')
    .bind(userId, granted, Date.now())
    .run();
  await db
    .prepare(
      'INSERT INTO point_logs (user_id, delta, balance, reason, detail, created_at) VALUES (?,?,?,?,?,?)'
    )
    .bind(userId, granted, granted, 'grant', '开通积分：新用户初始额度 / 老用户按已有域名补偿', Date.now())
    .run();
  return granted;
}

/** 直接设置余额（管理员用；-1 表示无限） */
export async function setPoints(db, userId, points) {
  await db
    .prepare(
      `INSERT INTO user_points (user_id, points, updated_at) VALUES (?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET points = excluded.points, updated_at = excluded.updated_at`
    )
    .bind(userId, points, Date.now())
    .run();
}

/**
 * 增减积分并记录流水。
 * @returns {number} 变动后的余额
 */
export async function addPoints(db, userId, delta, reason, detail = '') {
  const cur = await getPoints(db, userId);
  if (cur === UNLIMITED_POINTS) return UNLIMITED_POINTS; // 无限额度不做变动
  const next = Math.max(0, cur + delta);
  await db
    .prepare(
      `INSERT INTO user_points (user_id, points, updated_at) VALUES (?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET points = excluded.points, updated_at = excluded.updated_at`
    )
    .bind(userId, next, Date.now())
    .run();
  await db
    .prepare(
      'INSERT INTO point_logs (user_id, delta, balance, reason, detail, created_at) VALUES (?,?,?,?,?,?)'
    )
    .bind(userId, delta, next, reason, String(detail || '').slice(0, 300), Date.now())
    .run();
  return next;
}

/** 站点时区下的今天 YYYY-MM-DD */
export function todayStr(tzOffsetMinutes = 480) {
  // 默认 UTC+8（中国 / 香港）
  const now = new Date(Date.now() + tzOffsetMinutes * 60000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function hasCheckedIn(db, userId, day) {
  const r = await db
    .prepare('SELECT id FROM checkins WHERE user_id = ? AND day = ?')
    .bind(userId, day)
    .first();
  return !!r;
}

/** 签到记录（幂等：同一天只有一个） */
export async function recordCheckin(db, userId, day, points) {
  await db
    .prepare('INSERT INTO checkins (user_id, day, points, created_at) VALUES (?,?,?,?)')
    .bind(userId, day, points, Date.now())
    .run();
}

/**
 * 域名消耗：单字（长度 <= shortLen）用高价，其余用普通价。
 * 管理员返回 0（不消耗）。
 */
export function domainCost(label, { domainCost = 5, shortCost = 35, shortLen = 1 } = {}, isAdmin = false) {
  if (isAdmin) return { cost: 0, short: false };
  const short = String(label || '').length <= Number(shortLen);
  return { cost: short ? Number(shortCost) : Number(domainCost), short };
}
