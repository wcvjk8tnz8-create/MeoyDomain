/**
 * 域名转移：把自己的子域名转给另一个本站账号。
 * 不可逆 —— 前端四步确认，后端做最终校验并留痕。
 */
import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';

const app = new Hono();

/** 转移须知（前端第一步展示，后端也存一份口径） */
app.get('/notice', async (c) => {
  return ok(c, {
    irreversible: true,
    lines: [
      '域名转移成功后无法撤销，该域名及其全部 DNS 记录将归接收方所有。',
      '转移后你将失去对该域名的管理权限，包括修改解析、续期与释放。',
      '请确保接收方账号邮箱填写正确；转错账号本站无法协助找回。',
      '若该域名处于验证锁定状态，需先完成验证再转移。',
    ],
  });
});

/** 校验接收方账号是否存在可用 */
app.post('/check', async (c) => {
  const u = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!email) return fail(c, '请填写接收账号邮箱');
  if (email === String(u.email).toLowerCase()) return fail(c, '不能转给自己');

  const target = await c.env.DB.prepare('SELECT id, email, status FROM users WHERE email = ?')
    .bind(email)
    .first();
  if (!target) return fail(c, '该账号不存在，请确认邮箱是否正确');
  if (target.status === 'banned') return fail(c, '该账号已被封禁，无法接收');

  return ok(c, { id: target.id, email: target.email });
});

/** 确认信息（第三步）：回显即将转移的域名与接收方，供用户核对 */
app.post('/preview', async (c) => {
  const u = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const sid = Number(body.subdomainId);
  const email = String(body.toEmail ?? '').trim().toLowerCase();
  if (!sid) return fail(c, '请选择要转移的域名');
  if (!email) return fail(c, '请填写接收账号邮箱');

  const s = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(sid).first();
  if (!s) return fail(c, '域名不存在', 404);
  if (s.user_id !== u.id && u.role !== 'admin') return fail(c, '无权转移该域名', 403);
  if (s.status !== 'approved') return fail(c, '仅已开通的域名可转移');

  const target = await c.env.DB.prepare('SELECT id, email, status FROM users WHERE email = ?')
    .bind(email)
    .first();
  if (!target) return fail(c, '该账号不存在，请确认邮箱是否正确');
  if (target.status === 'banned') return fail(c, '该账号已被封禁，无法接收');
  if (target.id === s.user_id) return fail(c, '不能转给自己');

  const recCount = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM dns_records WHERE subdomain_id = ?'
  )
    .bind(sid)
    .first();

  const locked = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM dns_records WHERE subdomain_id = ? AND verify_lock = 1'
  )
    .bind(sid)
    .first();
  if (locked?.n) return fail(c, '该域名存在验证锁定记录，请先完成验证再转移');

  return ok(c, {
    fqdn: s.fqdn,
    subdomainId: s.id,
    toEmail: target.email,
    recordCount: recCount?.n || 0,
  });
});

/** 提交转移（第四步） */
app.post('/commit', async (c) => {
  const u = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const sid = Number(body.subdomainId);
  const email = String(body.toEmail ?? '').trim().toLowerCase();
  const agreed = Boolean(body.agreed);
  if (!agreed) return fail(c, '请先勾选确认已知悉转移不可逆');
  if (!sid || !email) return fail(c, '信息不完整');

  const s = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(sid).first();
  if (!s) return fail(c, '域名不存在', 404);
  if (s.user_id !== u.id && u.role !== 'admin') return fail(c, '无权转移该域名', 403);
  if (s.status !== 'approved') return fail(c, '仅已开通的域名可转移');

  const target = await c.env.DB.prepare('SELECT id, email, status FROM users WHERE email = ?')
    .bind(email)
    .first();
  if (!target) return fail(c, '该账号不存在');
  if (target.status === 'banned') return fail(c, '该账号已被封禁，无法接收');
  if (target.id === s.user_id) return fail(c, '不能转给自己');

  const locked = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM dns_records WHERE subdomain_id = ? AND verify_lock = 1'
  )
    .bind(sid)
    .first();
  if (locked?.n) return fail(c, '该域名存在验证锁定记录，请先完成验证再转移');

  const ts = now();
  // 转移：改归属
  await c.env.DB.prepare('UPDATE subdomains SET user_id = ? WHERE id = ?')
    .bind(target.id, sid)
    .run();

  // 留痕
  await c.env.DB.prepare(
    'INSERT INTO transfers (subdomain_id, fqdn, from_user, to_user, to_email, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(sid, s.fqdn, u.id, target.id, target.email, ts)
    .run();

  await audit(c, u.id, 'domain.transfer', s.fqdn, `${u.email} → ${target.email}`);
  return ok(c, { fqdn: s.fqdn, toEmail: target.email });
});

/** 我的转移记录 */
app.get('/mine', async (c) => {
  const u = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT t.*,
           uf.email AS from_email
     FROM transfers t
     JOIN users uf ON uf.id = t.from_user
     WHERE t.from_user = ? OR t.to_user = ?
     ORDER BY t.created_at DESC
     LIMIT 30`
  )
    .bind(u.id, u.id)
    .all();
  return ok(c, { items: results });
});

export default app;
