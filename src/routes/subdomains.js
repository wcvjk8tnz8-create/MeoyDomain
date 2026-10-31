import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';
import { validateLabel } from '../lib/records.js';
import { cfDelete, cfErrorMessage } from '../lib/cf.js';

const app = new Hono();

// 取一条子域名并校验归属（管理员可跨用户操作）
export async function loadSubdomain(c, id, { admin = false } = {}) {
  const row = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(id).first();
  if (!row) return { error: '子域名不存在' };
  const u = c.get('user');
  if (!admin && row.user_id !== u.id) return { error: '无权操作该子域名' };
  return { row };
}

// 可用性检查
app.get('/check', async (c) => {
  const v = validateLabel(c.req.query('label'));
  if (!v.ok) return ok(c, { available: false, message: v.error });
  const fqdn = `${v.label}.${c.env.ROOT_DOMAIN}`;
  const u = c.get('user');
  const isAdmin = u && u.role === 'admin';
  const exists = await c.env.DB.prepare('SELECT id, status FROM subdomains WHERE label = ?').bind(v.label).first();
  const reserved = String(c.env.RESERVED_LABELS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (exists) return ok(c, { available: false, message: '该子域名已被占用', fqdn });
  // 管理员可申请保留域名
  if (!isAdmin && reserved.includes(v.label))
    return ok(c, { available: false, message: '该名称为系统保留，不可申请', fqdn });
  return ok(c, {
    available: true,
    message: isAdmin && reserved.includes(v.label) ? '保留域名 · 管理员可用' : '可以使用',
    fqdn,
  });
});

// 我的子域名列表（同时兼容 /api/subdomains 与 /api/subdomains/）
const listMine = async (c) => {
  const u = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM dns_records r WHERE r.subdomain_id = s.id) AS record_count
     FROM subdomains s WHERE s.user_id = ? ORDER BY s.created_at DESC`
  )
    .bind(u.id)
    .all();
  return ok(c, {
    items: results,
    quota: u.quota,
    quotaUnlimited: !!u.quotaUnlimited,
    used: results.length,
  });
};

app.get('/', listMine);

// 申请子域名
const createMine = async (c) => {
  const u = c.get('user');
  const { label, note } = await c.req.json().catch(() => ({}));
  const v = validateLabel(label);
  if (!v.ok) return fail(c, v.error);

  const isAdmin = u.role === 'admin';
  const reserved = String(c.env.RESERVED_LABELS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const isReserved = reserved.includes(v.label);
  // 管理员可申请保留域名，普通用户不行
  if (!isAdmin && isReserved) return fail(c, '该名称为系统保留，不可申请');

  const dup = await c.env.DB.prepare('SELECT id FROM subdomains WHERE label = ?').bind(v.label).first();
  if (dup) return fail(c, '该子域名已被占用');

  const used = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM subdomains WHERE user_id = ? AND status IN ('pending','approved','suspended')"
  )
    .bind(u.id)
    .first();
  // 管理员（或 quota 为 -1 的用户）不受配额限制
  if (u.quota >= 0 && (used?.n || 0) >= u.quota)
    return fail(c, `已达上限，每个账号最多持有 ${u.quota} 个子域名`);

  // 免审核：全局关闭审核，或管理员申请（管理员自建即开通，含保留域名）
  const autoApprove = c.env.REQUIRE_APPROVAL !== '1' || isAdmin;
  const status = autoApprove ? 'approved' : 'pending';
  const fqdn = `${v.label}.${c.env.ROOT_DOMAIN}`;
  const res = await c.env.DB.prepare(
    `INSERT INTO subdomains (label, fqdn, user_id, status, note, created_at, updated_at, reviewed_at)
     VALUES (?,?,?,?,?,?,?,?)`
  )
    .bind(v.label, fqdn, u.id, status, String(note || '').slice(0, 300), now(), now(), autoApprove ? now() : null)
    .run();

  const detail = [status];
  if (isAdmin) detail.push('管理员免审核');
  if (isReserved) detail.push('保留域名');
  await audit(c, u.id, 'subdomain.create', fqdn, detail.join(' · '));
  // 注意：创建子域名时不会写入任何 DNS 记录，用户需要时再自行添加
  return ok(c, { id: res.meta?.last_row_id, fqdn, status, reserved: isReserved });
};

app.post('/', createMine);

// 子域名详情（含 DNS 记录）
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const { row, error } = await loadSubdomain(c, id);
  if (error) return fail(c, error, 404);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM dns_records WHERE subdomain_id = ? ORDER BY verify_lock DESC, type, host, id'
  )
    .bind(id)
    .all();
  return ok(c, { subdomain: row, records: results });
});

// 编辑备注
app.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const { row, error } = await loadSubdomain(c, id);
  if (error) return fail(c, error, 404);
  const { note } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare('UPDATE subdomains SET note = ?, updated_at = ? WHERE id = ?')
    .bind(String(note || '').slice(0, 300), now(), id)
    .run();
  return ok(c, {});
});

// 释放子域名（同时把其在 Cloudflare 上的记录全部删除）
app.delete('/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const { row, error } = await loadSubdomain(c, id);
  if (error) return fail(c, error, 404);

  const recs = await c.env.DB.prepare('SELECT * FROM dns_records WHERE subdomain_id = ?').bind(id).all();
  const errs = [];
  for (const r of recs.results) {
    if (r.cf_record_id) {
      const res = await cfDelete(c.env, r.cf_record_id);
      if (!res.ok) errs.push(`${r.name}/${r.type}: ${cfErrorMessage(res)}`);
    }
  }
  if (recs.results.length) await c.env.DB.prepare('DELETE FROM dns_records WHERE subdomain_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM subdomains WHERE id = ?').bind(id).run();
  await audit(c, u.id, 'subdomain.delete', row.fqdn, errs.join(' | '));
  return ok(c, { warnings: errs });
});

export default app;
