import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';
import { cfDelete, cfErrorMessage } from '../lib/cf.js';
import { UNLIMITED } from '../middleware/auth.js';

const app = new Hono();

// 概览统计
app.get('/stats', async (c) => {
  const q = async (sql, ...b) => (await c.env.DB.prepare(sql).bind(...b).first()) || {};
  const [users, subs, pending, recs, locked] = await Promise.all([
    q('SELECT COUNT(*) AS n FROM users'),
    q("SELECT COUNT(*) AS n FROM subdomains WHERE status = 'approved'"),
    q("SELECT COUNT(*) AS n FROM subdomains WHERE status = 'pending'"),
    q('SELECT COUNT(*) AS n FROM dns_records'),
    q('SELECT COUNT(*) AS n FROM dns_records WHERE verify_lock = 1'),
  ]);
  return ok(c, {
    users: users.n || 0,
    subdomains: subs.n || 0,
    pending: pending.n || 0,
    records: recs.n || 0,
    locked: locked.n || 0,
    rootDomain: c.env.ROOT_DOMAIN,
    mock: c.env.CF_MOCK === '1',
  });
});

// 子域名列表（可按状态过滤）
app.get('/subdomains', async (c) => {
  const status = c.req.query('status') || '';
  const sql =
    `SELECT s.*, u.email AS owner_email, (SELECT COUNT(*) FROM dns_records r WHERE r.subdomain_id = s.id) AS record_count
     FROM subdomains s JOIN users u ON u.id = s.user_id
     ${status ? 'WHERE s.status = ?' : ''}
     ORDER BY s.created_at DESC LIMIT 500`;
  const stmt = status ? c.env.DB.prepare(sql).bind(status) : c.env.DB.prepare(sql);
  const { results } = await stmt.all();
  return ok(c, { items: results });
});

// 审核：通过 / 驳回 / 停用 / 恢复
async function review(c, id, status, reason) {
  const sub = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(id).first();
  if (!sub) return fail(c, '子域名不存在', 404);
  const u = c.get('user');
  await c.env.DB.prepare(
    'UPDATE subdomains SET status = ?, reason = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?'
  )
    .bind(status, reason || null, now(), u.id, now(), id)
    .run();
  await audit(c, u.id, `subdomain.${status}`, sub.fqdn, reason || '');
  return ok(c, { status });
}

app.post('/subdomains/:id/approve', async (c) => review(c, Number(c.req.param('id')), 'approved', ''));
app.post('/subdomains/:id/reject', async (c) => {
  const { reason } = await c.req.json().catch(() => ({}));
  return review(c, Number(c.req.param('id')), 'rejected', String(reason || '').slice(0, 200) || '不符合使用规范');
});
app.post('/subdomains/:id/suspend', async (c) => {
  const { reason } = await c.req.json().catch(() => ({}));
  return review(c, Number(c.req.param('id')), 'suspended', String(reason || '').slice(0, 200) || '违规使用');
});
app.post('/subdomains/:id/restore', async (c) => review(c, Number(c.req.param('id')), 'approved', ''));

// 管理员直接删除子域名（连带清空 DNS）
app.delete('/subdomains/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const sub = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(id).first();
  if (!sub) return fail(c, '子域名不存在', 404);
  const recs = await c.env.DB.prepare('SELECT * FROM dns_records WHERE subdomain_id = ?').bind(id).all();
  for (const r of recs.results) if (r.cf_record_id) await cfDelete(c.env, r.cf_record_id);
  await c.env.DB.prepare('DELETE FROM dns_records WHERE subdomain_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM subdomains WHERE id = ?').bind(id).run();
  await audit(c, u.id, 'admin.subdomain.delete', sub.fqdn);
  return ok(c, {});
});

// 用户列表
app.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.status, u.quota, u.ban_reason, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM subdomains s WHERE s.user_id = u.id) AS sub_count
     FROM users u ORDER BY u.created_at DESC LIMIT 500`
  ).all();
  const items = results.map((r) => ({ ...r, quotaUnlimited: r.role === 'admin' || Number(r.quota) < 0 }));
  return ok(c, { items });
});

// 封禁 / 解封
app.post('/users/:id/ban', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const { reason, purgeDns } = await c.req.json().catch(() => ({}));
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!target) return fail(c, '用户不存在', 404);
  if (target.role === 'admin') return fail(c, '不能封禁管理员');

  await c.env.DB.prepare('UPDATE users SET status = ?, ban_reason = ? WHERE id = ?')
    .bind('banned', String(reason || '违规使用').slice(0, 300), id)
    .run();
  // 踢下线
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  // 停用其全部子域名
  await c.env.DB.prepare("UPDATE subdomains SET status = 'suspended', reason = ?, updated_at = ? WHERE user_id = ?")
    .bind(String(reason || '账号已封禁').slice(0, 200), now(), id)
    .run();

  let purged = 0;
  if (purgeDns) {
    const subs = await c.env.DB.prepare('SELECT id FROM subdomains WHERE user_id = ?').bind(id).all();
    for (const s of subs.results) {
      const recs = await c.env.DB.prepare('SELECT * FROM dns_records WHERE subdomain_id = ?').bind(s.id).all();
      for (const r of recs.results) {
        if (r.cf_record_id) {
          const res = await cfDelete(c.env, r.cf_record_id);
          if (!res.ok) continue;
        }
        purged++;
      }
      await c.env.DB.prepare('DELETE FROM dns_records WHERE subdomain_id = ?').bind(s.id).run();
    }
  }
  await audit(c, u.id, 'user.ban', target.email, `${reason || ''}｜清空DNS:${purged}`);
  return ok(c, { purged });
});

app.post('/users/:id/unban', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare("UPDATE users SET status = 'active', ban_reason = NULL WHERE id = ?").bind(id).run();
  await c.env.DB.prepare(
    "UPDATE subdomains SET status = 'approved', reason = NULL, updated_at = ? WHERE user_id = ? AND status = 'suspended'"
  )
    .bind(now(), id)
    .run();
  await audit(c, u.id, 'user.unban', String(id));
  return ok(c, {});
});

// 调整配额 / 提权
app.post('/users/:id/quota', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const { quota, role } = await c.req.json().catch(() => ({}));
  if (quota !== undefined) {
    const q = Number(quota);
    // -1 表示不限量
    if (!Number.isFinite(q) || q < -1 || q > 500) return fail(c, '配额需在 -1（不限）到 500 之间');
    await c.env.DB.prepare('UPDATE users SET quota = ? WHERE id = ?').bind(q === -1 ? -1 : Math.floor(q), id).run();
  }
  if (role !== undefined) {
    if (!['user', 'admin'].includes(role)) return fail(c, '角色不合法');
    await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id).run();
    // 提为管理员时自动给不限量；降为普通用户时若原本是不限量，恢复默认配额
    if (role === 'admin') {
      await c.env.DB.prepare('UPDATE users SET quota = ? WHERE id = ?').bind(UNLIMITED, id).run();
    } else {
      const cur = await c.env.DB.prepare('SELECT quota FROM users WHERE id = ?').bind(id).first();
      if (cur && Number(cur.quota) < 0) {
        await c.env.DB.prepare('UPDATE users SET quota = ? WHERE id = ?')
          .bind(Number(c.env.DEFAULT_QUOTA || 5), id)
          .run();
      }
    }
  }
  await audit(c, u.id, 'user.update', String(id), `quota=${quota} role=${role}`);
  return ok(c, {});
});

// 全部处于锁定状态的验证记录
app.get('/locks', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, s.fqdn, s.status AS sub_status, u.email AS owner_email
     FROM dns_records r
     JOIN subdomains s ON s.id = r.subdomain_id
     JOIN users u ON u.id = r.locked_by
     WHERE r.verify_lock = 1 ORDER BY r.locked_at DESC`
  ).all();
  return ok(c, { items: results });
});

// 审计日志
app.get('/audit', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC LIMIT 200`
  ).all();
  return ok(c, { items: results });
});

// 手动对账：从 Cloudflare 拉取某子域名的记录，清理本地孤儿记录
app.post('/reconcile/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const sub = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(id).first();
  if (!sub) return fail(c, '子域名不存在', 404);
  const errs = [];
  const recs = await c.env.DB.prepare('SELECT * FROM dns_records WHERE subdomain_id = ?').bind(id).all();
  for (const r of recs.results) {
    if (!r.cf_record_id) {
      await c.env.DB.prepare('DELETE FROM dns_records WHERE id = ?').bind(r.id).run();
      errs.push(`${r.name} 缺少 Cloudflare ID，已清理本地记录`);
    }
  }
  await audit(c, u.id, 'admin.reconcile', sub.fqdn, errs.join(' | '));
  return ok(c, { warnings: errs });
});

// 站点设置：站点名 / Logo / 公告
app.get('/settings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT key, value FROM settings').all();
  return ok(c, { items: Object.fromEntries(results.map((r) => [r.key, r.value])) });
});

app.post('/settings', async (c) => {
  const u = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const set = async (k, v) => {
    if (v === undefined) return;
    await c.env.DB.prepare(
      'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
      .bind(k, String(v))
      .run();
  };
  const name = String(body.siteName ?? '').trim().slice(0, 40);
  const logo = String(body.logoUrl ?? '').trim().slice(0, 500);
  const favicon = String(body.faviconUrl ?? '').trim().slice(0, 500);
  const anno = String(body.announcement ?? '').trim().slice(0, 300);

  if (name) await set('site_name', name);
  await set('logo_url', logo || '/img/logo.jpg');
  await set('favicon_url', favicon || '/img/favicon.png');
  if (body.announcement !== undefined) await set('announcement', anno);

  await audit(c, u.id, 'admin.settings', 'site', `name=${name} logo=${logo || '(默认)'}`);
  return ok(c, {});
});

// 恢复默认 Logo（重新指向内置图片）
app.post('/settings/reset-logo', async (c) => {
  const u = c.get('user');
  for (const [k, v] of [['logo_url', '/img/logo.jpg'], ['favicon_url', '/favicon.ico']]) {
    await c.env.DB.prepare(
      'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
      .bind(k, v)
      .run();
  }
  await audit(c, u.id, 'admin.settings', 'site', '恢复默认 Logo');
  return ok(c, {});
});

export default app;
