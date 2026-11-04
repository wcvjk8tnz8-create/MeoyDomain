import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';
import {
  UNLIMITED_POINTS,
  getPoints,
  ensurePoints,
  addPoints,
  todayStr,
  hasCheckedIn,
  recordCheckin,
  domainCost,
  parseRootCosts,
} from '../lib/points.js';

const app = new Hono();

/** 读取积分规则设置 */
export async function pointRules(env) {
  const rows = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN
     ('checkin_points','domain_cost','short_domain_cost','short_domain_len','initial_points','root_point_costs')`
  ).all();
  const m = {};
  for (const r of rows.results || []) m[r.key] = r.value;
  const num = (k, d) => {
    const n = Number(m[k]);
    return Number.isFinite(n) && m[k] !== undefined && m[k] !== '' ? n : d;
  };
  return {
    checkin: Math.max(0, num('checkin_points', 5)),
    domainCost: Math.max(0, num('domain_cost', 5)),
    shortCost: Math.max(0, num('short_domain_cost', 35)),
    shortLen: Math.max(1, num('short_domain_len', 1)),
    initial: Math.max(0, num('initial_points', 10)),
    rootCosts: parseRootCosts(m.root_point_costs),
  };
}

/** 我的积分概览（登录即可访问） */
app.get('/me', async (c) => {
  const u = c.get('user');
  const rules = await pointRules(c.env);
  const isAdmin = u.role === 'admin';
  const points = isAdmin ? UNLIMITED_POINTS : await ensurePoints(c.env.DB, u.id, rules);
  const day = todayStr();
  const checked = await hasCheckedIn(c.env.DB, u.id, day);

  const { results: logs } = await c.env.DB.prepare(
    'SELECT delta, balance, reason, detail, created_at FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 20'
  )
    .bind(u.id)
    .all();

  return ok(c, {
    points,
    unlimited: isAdmin,
    rules,
    today: day,
    checkedIn: checked,
    canCheckIn: !checked,
    logs: logs || [],
  });
});

/** 每日签到 */
app.post('/checkin', async (c) => {
  const u = c.get('user');
  const rules = await pointRules(c.env);
  const day = todayStr();

  if (await hasCheckedIn(c.env.DB, u.id, day)) return fail(c, '今天已经签到过了，明天再来');

  const isAdmin = u.role === 'admin';
  const before = isAdmin ? UNLIMITED_POINTS : await ensurePoints(c.env.DB, u.id, rules);

  // 先记签到（唯一索引兜底并发），再入账
  try {
    await recordCheckin(c.env.DB, u.id, day, rules.checkin);
  } catch (e) {
    const msg = String(e?.message || e);
    if (/UNIQUE|constraint/i.test(msg)) return fail(c, '今天已经签到过了');
    throw e;
  }

  const after = isAdmin
    ? UNLIMITED_POINTS
    : await addPoints(c.env.DB, u.id, rules.checkin, 'checkin', `每日签到 ${day}`);

  await audit(c, u.id, 'points.checkin', `+${rules.checkin}`, day);
  return ok(c, {
    gained: isAdmin ? 0 : rules.checkin,
    points: after,
    unlimited: isAdmin,
    before,
    day,
  });
});

/** 预查询：申请某名称需要多少积分（前端实时提示） */
app.get('/cost', async (c) => {
  const u = c.get('user');
  const rules = await pointRules(c.env);
  const label = String(c.req.query('label') || '').toLowerCase();
  if (!label) return fail(c, '缺少 label');
  const isAdmin = u.role === 'admin';
  const { cost, short } = domainCost(
    label,
    { domainCost: rules.domainCost, shortCost: rules.shortCost, shortLen: rules.shortLen },
    isAdmin
  );
  const points = isAdmin ? UNLIMITED_POINTS : await ensurePoints(c.env.DB, u.id, rules);
  return ok(c, {
    label,
    cost,
    short,
    points,
    unlimited: isAdmin,
    enough: isAdmin || points >= cost,
    shortCost: rules.shortCost,
    domainCost: rules.domainCost,
  });
});

export default app;
