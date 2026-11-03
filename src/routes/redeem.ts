// ============================================================
//  兑换码：V-XXX 域名永久化 / PE-XXXXX 配额
//  - 用户在「奖励中心」兑换
//  - 管理员派发（生成 / 列表 / 停用）
// ============================================================
import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';

const app = new Hono();

const TYPE_TEXT = { permanent: '域名永久化', quota: '配额' };

/* 券（coupon）规则：
   一张券 = 一个码，面向所有人发放；
   每个账号限用 1 次（redeem_logs 里按 code + user_id 查重）；
   券本身有总使用量上限，默认 10000 次。 */
const COUPON_MAX_USES = 10000;
const COUPON_MAX_USES_LIMIT = 1000000;

/** 随机码：去掉易混淆的 0/O/1/I/L */
function rand(n) {
  const set = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  for (const b of buf) s += set[b % set.length];
  return s;
}

export function makeCode(type) {
  return type === 'permanent' ? 'V-' + rand(6) : 'PE-' + rand(7);
}

/** 校验并规范化兑换码输入（大小写不敏感） */
function normCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}

/* ---------------- 用户端 ---------------- */

/** 兑换 */
app.post('/redeem', async (c) => {
  const u = c.get('user');
  const { code, subdomainId } = await c.req.json().catch(() => ({}));
  const codeStr = normCode(code);
  if (!codeStr) return fail(c, '请输入兑换码');

  const row = await c.env.DB.prepare('SELECT * FROM redeem_codes WHERE code = ?').bind(codeStr).first();
  if (!row) return fail(c, '兑换码不存在', 404);
  if (row.status !== 'active') return fail(c, '该兑换码已被停用');
  if (row.expires_at && Number(row.expires_at) < Date.now()) return fail(c, '该兑换码已过期');
  // 先查本人是否用过（比「已用完」更贴切，避免本人重复提交时看到误导提示）
  const dup = await c.env.DB.prepare('SELECT id FROM redeem_logs WHERE code = ? AND user_id = ?')
    .bind(codeStr, u.id)
    .first();
  if (dup) return fail(c, '你已经使用过这个兑换码了');

  if (Number(row.used_count) >= Number(row.max_uses)) return fail(c, '该兑换码已被用完');

  let result = {};

  if (row.type === 'permanent') {
    // 域名永久化：必须指定一个自己的域名
    const sid = Number(subdomainId);
    if (!sid) return fail(c, '请先选择要永久化的域名');
    const sub = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(sid).first();
    if (!sub) return fail(c, '域名不存在', 404);
    if (sub.user_id !== u.id && u.role !== 'admin') return fail(c, '无权操作该域名', 403);
    if (sub.status !== 'approved') return fail(c, '只有已注册的域名可以永久化');
    if (Number(sub.perpetual) === 1) return fail(c, '该域名已经是永久有效');

    await c.env.DB.prepare('UPDATE subdomains SET perpetual = 1, expires_at = NULL, updated_at = ? WHERE id = ?')
      .bind(now(), sid)
      .run();
    result = { type: 'permanent', fqdn: sub.fqdn };
  } else if (row.type === 'quota') {
    // 增加配额：-1 表示无限，已是无限则不再叠加
    const add = Number(row.value) || 1;
    const cur = Number(u.quota);
    let next = cur;
    if (cur >= 0 && add < 0) next = -1;                 // 升为无限
    else if (cur >= 0) next = cur + add;                // 普通累加
    await c.env.DB.prepare('UPDATE users SET quota = ? WHERE id = ?').bind(next, u.id).run();
    result = { type: 'quota', before: cur, after: next, added: add };
  } else {
    return fail(c, '未知的兑换码类型');
  }

  await c.env.DB.prepare('UPDATE redeem_codes SET used_count = used_count + 1 WHERE id = ?').bind(row.id).run();
  await c.env.DB.prepare(
    'INSERT INTO redeem_logs (code, user_id, type, subdomain_id, value, created_at) VALUES (?,?,?,?,?,?)'
  )
    .bind(codeStr, u.id, row.type, Number(subdomainId) || null, Number(row.value) || 0, now())
    .run();

  await audit(c, u.id, 'redeem.use', codeStr, `${TYPE_TEXT[row.type] || row.type}${result.fqdn ? ' · ' + result.fqdn : ''}`);
  return ok(c, { code: codeStr, type: row.type, ...result });
});

/** 我的兑换记录 */
app.get('/mine', async (c) => {
  const u = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, s.fqdn
       FROM redeem_logs l LEFT JOIN subdomains s ON s.id = l.subdomain_id
      WHERE l.user_id = ? ORDER BY l.created_at DESC LIMIT 50`
  )
    .bind(u.id)
    .all();
  return ok(c, { items: results || [] });
});

/** 兑换前预览：这个码是什么类型（不消耗） */
app.get('/preview', async (c) => {
  const codeStr = normCode(c.req.query('code'));
  if (!codeStr) return fail(c, '请输入兑换码');
  const row = await c.env.DB.prepare('SELECT code, type, value, status, expires_at, used_count, max_uses FROM redeem_codes WHERE code = ?')
    .bind(codeStr)
    .first();
  if (!row) return fail(c, '兑换码不存在', 404);
  const expired = row.expires_at && Number(row.expires_at) < Date.now();
  const exhausted = Number(row.used_count) >= Number(row.max_uses);
  return ok(c, {
    code: row.code,
    type: row.type,
    typeText: TYPE_TEXT[row.type] || row.type,
    value: row.value,
    usable: row.status === 'active' && !expired && !exhausted,
    reason: row.status !== 'active' ? '已停用' : expired ? '已过期' : exhausted ? '已被用完' : '',
  });
});

/* ---------------- 管理员端 ---------------- */

function requireAdmin(c) {
  const u = c.get('user');
  if (!u || u.role !== 'admin') return fail(c, '需要管理员权限', 403);
  return null;
}

/** 批量生成 */
app.post('/admin/generate', async (c) => {
  const bad = requireAdmin(c);
  if (bad) return bad;
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const type = String(b.type || '').trim();
  if (!['permanent', 'quota'].includes(type)) return fail(c, '类型必须是 permanent 或 quota');
  const count = Math.min(Math.max(Number(b.count) || 1, 1), 200);
  const value = type === 'quota' ? Math.min(Math.max(Number(b.value) || 1, 1), 999) : 1;
  // 券的总使用量：留空/0 即用默认 10000
  const maxUses = Math.min(
    Math.max(Number(b.maxUses) || COUPON_MAX_USES, 1),
    COUPON_MAX_USES_LIMIT
  );
  const note = String(b.note || '').slice(0, 200);
  const days = Number(b.days) || 0;
  const expiresAt = days > 0 ? Date.now() + days * 86400000 : null;

  const codes = [];
  for (let i = 0; i < count; i++) {
    let code;
    let tries = 0;
    do {
      code = makeCode(type);
      const ex = await c.env.DB.prepare('SELECT id FROM redeem_codes WHERE code = ?').bind(code).first();
      if (!ex) break;
      tries++;
    } while (tries < 10);

    try {
      await c.env.DB.prepare(
        `INSERT INTO redeem_codes (code, type, value, max_uses, used_count, status, note, expires_at, created_by, created_at)
         VALUES (?,?,?,?,0,'active',?,?,?,?)`
      )
        .bind(code, type, value, maxUses, note || null, expiresAt, u.id, now())
        .run();
      codes.push(code);
    } catch { /* 极罕见的撞码，跳过 */ }
  }

  await audit(c, u.id, 'redeem.generate', `${codes.length} 张`, `${TYPE_TEXT[type]} · ${note || '无备注'}`);
  return ok(c, { codes, count: codes.length, type, value });
});

/** 列表 */
app.get('/admin/list', async (c) => {
  const bad = requireAdmin(c);
  if (bad) return bad;
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, u.email AS creator
       FROM redeem_codes r LEFT JOIN users u ON u.id = r.created_by
      ORDER BY r.created_at DESC LIMIT 300`
  ).all();
  return ok(c, { items: results || [] });
});

/** 停用 / 启用 */
app.post('/admin/:id/toggle', async (c) => {
  const bad = requireAdmin(c);
  if (bad) return bad;
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM redeem_codes WHERE id = ?').bind(id).first();
  if (!row) return fail(c, '兑换码不存在', 404);
  const next = row.status === 'active' ? 'disabled' : 'active';
  await c.env.DB.prepare('UPDATE redeem_codes SET status = ? WHERE id = ?').bind(next, id).run();
  await audit(c, c.get('user').id, 'redeem.toggle', row.code, next === 'active' ? '启用' : '停用');
  return ok(c, { status: next });
});

/** 清空全部券（可选连同兑换记录一起清） */
app.delete('/admin/all', async (c) => {
  const bad = requireAdmin(c);
  if (bad) return bad;
  const u = c.get('user');

  // 安全闸门：必须显式确认，防止误触
  const body = await c.req.json().catch(() => ({}));
  const confirm = String(c.req.query('confirm') || body.confirm || '');
  if (confirm !== '1' && confirm !== 'true') {
    const cnt = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM redeem_codes').first();
    return fail(c, `此操作会删除全部 ${cnt?.n || 0} 张券，且不可恢复。请带上确认参数重试。`);
  }

  const keepLogs = body.keepLogs !== false;   // 默认保留兑换记录（便于追溯谁用过）
  const before = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM redeem_codes').first();
  await c.env.DB.prepare('DELETE FROM redeem_codes').run();
  let logCleared = 0;
  if (!keepLogs) {
    const lb = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM redeem_logs').first();
    logCleared = lb?.n || 0;
    await c.env.DB.prepare('DELETE FROM redeem_logs').run();
  }

  await audit(c, u.id, 'redeem.purge', '全部券', `删除 ${before?.n || 0} 张${keepLogs ? '（保留兑换记录）' : `，并清空 ${logCleared} 条记录`}`);
  return ok(c, { deleted: before?.n || 0, logCleared });
});

/** 删除 */
app.delete('/admin/:id', async (c) => {
  const bad = requireAdmin(c);
  if (bad) return bad;
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT code FROM redeem_codes WHERE id = ?').bind(id).first();
  if (!row) return fail(c, '兑换码不存在', 404);
  await c.env.DB.prepare('DELETE FROM redeem_codes WHERE id = ?').bind(id).run();
  await audit(c, c.get('user').id, 'redeem.delete', row.code, '');
  return ok(c, {});
});

export default app;
