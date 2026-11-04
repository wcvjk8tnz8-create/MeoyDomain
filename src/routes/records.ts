import { matchRoot } from '../lib/roots.js';
import { dnsUnlimited } from '../lib/aiReview.js';

/**
 * 取某条子域名所属的根域名，用于选择对应的 Cloudflare Zone。
 * 优先用库里的 root_domain 列，缺失时从 fqdn 反推。
 */
function rootOf(c, sub) {
  if (!sub) return '';
  return String(sub.root_domain || matchRoot(c.env, sub.fqdn)?.domain || '').trim();
}
import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';
import { buildRecord, resolveHost, RECORD_TYPES, VERIFY_PRESETS, formatDisplay } from '../lib/records.js';
import { cfCreate, cfUpdate, cfDelete, cfSoa, cfErrorMessage } from '../lib/cf.js';
import { loadSubdomain } from './subdomains.js';

const app = new Hono();
const MAX_RECORDS_PER_SUBDOMAIN = 50;

async function loadRecord(c, id) {
  const rec = await c.env.DB.prepare('SELECT * FROM dns_records WHERE id = ?').bind(id).first();
  if (!rec) return { error: '记录不存在' };
  const sub = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(rec.subdomain_id).first();
  if (!sub) return { error: '记录不存在' };
  const u = c.get('user');
  if (sub.user_id !== u.id && u.role !== 'admin') return { error: '无权操作该记录' };
  return { rec, sub };
}

function requireActive(sub) {
  if (sub.status === 'pending') return '子域名仍在审核中，审核通过后才能添加 DNS 记录';
  if (sub.status === 'rejected') return '子域名申请已被驳回';
  if (sub.status === 'suspended') return '子域名已被停用，无法操作 DNS 记录';
  return null;
}

function shape(r) {
  return {
    id: r.id,
    subdomain_id: r.subdomain_id,
    type: r.type,
    host: r.host,
    name: r.name,
    content: r.content,
    data: typeof r.data === 'string' && r.data ? JSON.parse(r.data) : r.data,
    ttl: r.ttl,
    proxied: !!r.proxied,
    priority: r.priority,
    comment: r.comment,
    verify_lock: !!r.verify_lock,
    verify_preset: r.verify_preset,
    locked_at: r.locked_at,
    cf_record_id: r.cf_record_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    display: formatDisplay(r),
  };
}

// ---------- 列表 ----------
app.get('/subdomains/:id/records', async (c) => {
  const id = Number(c.req.param('id'));
  const { row, error } = await loadSubdomain(c, id);
  if (error) return fail(c, error, 404);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM dns_records WHERE subdomain_id = ? ORDER BY verify_lock DESC, type, host, id'
  )
    .bind(id)
    .all();
  return ok(c, { records: results.map(shape) });
});

// ---------- 添加记录 ----------
app.post('/subdomains/:id/records', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const { row: sub, error } = await loadSubdomain(c, id);
  if (error) return fail(c, error, 404);
  const block = requireActive(sub);
  if (block) return fail(c, block, 403);

  const body = await c.req.json().catch(() => ({}));
  const type = String(body.type || '').toUpperCase();
  if (!RECORD_TYPES[type]) return fail(c, '不支持的记录类型');

  // 按根域名豁免：dns_unlimited_roots 里列出的根域名（默认 v-1.top）不限记录数。
  // 读配置失败时按「不豁免」处理，保持原有安全上限。
  let unlimited = false;
  try { unlimited = await dnsUnlimited(c.env, rootOf(c, sub)); } catch { /* 回落原限制 */ }
  if (!unlimited) {
    const cnt = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM dns_records WHERE subdomain_id = ?').bind(id).first();
    if ((cnt?.n || 0) >= MAX_RECORDS_PER_SUBDOMAIN)
      return fail(c, `单个子域名最多 ${MAX_RECORDS_PER_SUBDOMAIN} 条记录`);
  }

  const hostRes = resolveHost(body.host, sub.fqdn, sub.label);
  if (!hostRes.ok) return fail(c, hostRes.error);

  const built = buildRecord(type, body, sub.fqdn);
  if (!built.ok) return fail(c, built.error);

  // 该记录名是否已被根域名验证锁占用
  const locked = await c.env.DB.prepare(
    'SELECT id FROM dns_records WHERE name = ? AND type = ? AND verify_lock = 1'
  )
    .bind(hostRes.name, type)
    .first();
  if (locked) return fail(c, '该记录正在被「根域名验证」占用，请先完成认证并解除锁定');

  const payload = { ...built.payload, name: hostRes.name };
  const cf = await cfCreate(c.env, payload, rootOf(c, sub));
  if (!cf.ok) return fail(c, `DNS 写入失败：${cfErrorMessage(cf)}`, 502, { cf: cf.errors });

  const res = await c.env.DB.prepare(
    `INSERT INTO dns_records
     (subdomain_id, cf_record_id, type, host, name, content, data, ttl, proxied, priority, comment,
      verify_lock, verify_preset, locked_at, locked_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      id,
      cf.result.id,
      type,
      hostRes.host,
      hostRes.name,
      built.content || '',
      built.data ? JSON.stringify(built.data) : null,
      built.ttl,
      built.proxied,
      built.priority,
      body.comment ? String(body.comment).slice(0, 200) : null,
      0,
      null,
      null,
      null,
      now(),
      now()
    )
    .run();

  await audit(c, u.id, 'record.create', hostRes.name, `${type} ${built.display}`);
  const rec = await c.env.DB.prepare('SELECT * FROM dns_records WHERE id = ?').bind(res.meta?.last_row_id).first();
  return ok(c, { record: shape(rec) }, 201);
});

// ---------- 编辑记录 ----------
app.patch('/records/:id', async (c) => {
  const u = c.get('user');
  const rid = Number(c.req.param('id'));
  const { rec, sub, error } = await loadRecord(c, rid);
  if (error) return fail(c, error, 404);
  if (rec.verify_lock) return fail(c, '该记录已被「根域名验证」锁定，请先点击“确认认证完成”解除锁定', 403);
  const block = requireActive(sub);
  if (block) return fail(c, block, 403);

  const body = await c.req.json().catch(() => ({}));
  const type = String(body.type || rec.type).toUpperCase();
  if (!RECORD_TYPES[type]) return fail(c, '不支持的记录类型');

  const hostRes = resolveHost(body.host ?? rec.host, sub.fqdn, sub.label);
  if (!hostRes.ok) return fail(c, hostRes.error);

  const built = buildRecord(type, body.content !== undefined ? body : { ...body, content: body.content ?? rec.content }, sub.fqdn);
  if (!built.ok) return fail(c, built.error);

  const locked = await c.env.DB.prepare(
    'SELECT id FROM dns_records WHERE name = ? AND type = ? AND verify_lock = 1 AND id != ?'
  )
    .bind(hostRes.name, type, rid)
    .first();
  if (locked) return fail(c, '目标记录名正在被「根域名验证」占用');

  const payload = { ...built.payload, name: hostRes.name };
  const cf = await cfUpdate(c.env, rec.cf_record_id, payload, rootOf(c, sub));
  if (!cf.ok) return fail(c, `DNS 更新失败：${cfErrorMessage(cf)}`, 502, { cf: cf.errors });

  // Spaceship 后端的记录 id 内含「域名 + 记录内容」，改值后 id 会变，
  // 必须写回数据库，否则下次删除会拿旧对象去删、删不掉。
  const newRemoteId = cf.result?.id && cf.result.id !== rec.cf_record_id ? cf.result.id : null;
  await c.env.DB.prepare(
    `UPDATE dns_records SET type=?, host=?, name=?, content=?, data=?, ttl=?, proxied=?, priority=?, comment=?, updated_at=?, cf_record_id=?
     WHERE id=?`
  )
    .bind(
      type,
      hostRes.host,
      hostRes.name,
      built.content || '',
      built.data ? JSON.stringify(built.data) : null,
      built.ttl,
      built.proxied,
      built.priority,
      body.comment !== undefined ? String(body.comment).slice(0, 200) : rec.comment,
      now(),
      newRemoteId || rec.cf_record_id,
      rid
    )
    .run();

  await audit(c, u.id, 'record.update', hostRes.name, `${type} ${built.display}`);
  const fresh = await c.env.DB.prepare('SELECT * FROM dns_records WHERE id = ?').bind(rid).first();
  return ok(c, { record: shape(fresh) });
});

// ---------- 删除记录 ----------
app.delete('/records/:id', async (c) => {
  const u = c.get('user');
  const rid = Number(c.req.param('id'));
  const { rec, sub, error } = await loadRecord(c, rid);
  if (error) return fail(c, error, 404);
  if (rec.verify_lock) return fail(c, '该记录已被「根域名验证」锁定，请先点击“确认认证完成”解除锁定', 403);
  const block = requireActive(sub);
  if (block && sub.status !== 'rejected') return fail(c, block, 403);

  const cf = await cfDelete(c.env, rec.cf_record_id, rootOf(c, sub));
  if (!cf.ok) return fail(c, `DNS 删除失败：${cfErrorMessage(cf)}`, 502, { cf: cf.errors });
  await c.env.DB.prepare('DELETE FROM dns_records WHERE id = ?').bind(rid).run();
  await audit(c, u.id, 'record.delete', rec.name, `${rec.type}`);
  return ok(c, {});
});

// ---------- 根域名验证：创建锁定 TXT ----------
app.post('/subdomains/:id/verify', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const { row: sub, error } = await loadSubdomain(c, id);
  if (error) return fail(c, error, 404);
  const block = requireActive(sub);
  if (block) return fail(c, block, 403);

  const body = await c.req.json().catch(() => ({}));
  const presetKey = String(body.preset || 'custom');
  const preset = VERIFY_PRESETS.find((p) => p.key === presetKey);
  let host = String(body.host || (preset ? preset.host : '')).trim().toLowerCase().replace(/\.+$/, '');
  const value = String(body.value || '').trim();

  if (!host) return fail(c, '请填写验证记录的主机名（如 _vercel）');
  if (!value) return fail(c, '请粘贴平台给出的验证值');
  if (value.length > 2048) return fail(c, '验证值过长');

  // 作用域：root = 根域名（_vercel.meoy.top），sub = 当前子域名（_vercel.xxx.meoy.top）
  const scope = String(body.scope || 'root') === 'sub' ? 'sub' : 'root';
  // 多根域名：用该子域名所属的根域名（而非全局默认），否则会把记录写到错误的 zone
  const rootDomain = String(sub.root_domain || matchRoot(c.env, sub.fqdn)?.domain || c.env.ROOT_DOMAIN || '')
    .toLowerCase().replace(/\.+$/, '');
  if (scope === 'root' && !rootDomain) return fail(c, '未配置根域名，无法在根域名下写入验证记录');
  const base = scope === 'root' ? rootDomain : sub.fqdn;
  const baseLabel = scope === 'root' ? '' : sub.label;

  const hostRes = resolveHost(host, base, baseLabel);
  if (!hostRes.ok) return fail(c, hostRes.error);
  // 根域名作用域下不允许直接占用根域名本身（@ / 空）
  if (scope === 'root' && hostRes.host === '@') return fail(c, '根域名验证请填写具体主机名，如 _vercel');

  // 同一记录名上已存在锁定的验证记录 → 拒绝抢占
  const locked = await c.env.DB.prepare(
    'SELECT * FROM dns_records WHERE name = ? AND type = ? AND verify_lock = 1'
  )
    .bind(hostRes.name, 'TXT')
    .first();
  if (locked) {
    const owner = await c.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(locked.locked_by).first();
    return fail(
      c,
      `该验证记录已被占用（${hostRes.name}），请先由发起者点击“确认认证完成”，或联系管理员强制解锁。发起人：${owner?.email || '未知'}`,
      409
    );
  }

  const cf = await cfCreate(c.env, {
    type: 'TXT',
    name: hostRes.name,
    content: value,
    ttl: 1,
    comment: 'root-domain verification (locked)',
  }, rootOf(c, sub));
  if (!cf.ok) return fail(c, `DNS 写入失败：${cfErrorMessage(cf)}`, 502, { cf: cf.errors });

  const res = await c.env.DB.prepare(
    `INSERT INTO dns_records
     (subdomain_id, cf_record_id, type, host, name, content, data, ttl, proxied, priority, comment,
      verify_lock, verify_preset, locked_at, locked_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      id,
      cf.result.id,
      'TXT',
      hostRes.host,
      hostRes.name,
      value,
      null,
      1,
      0,
      null,
      `根域名验证：${preset ? preset.label : '自定义'}（${scope === 'root' ? '根域名' : '子域名'}）`,
      1,
      presetKey,
      now(),
      u.id,
      now(),
      now()
    )
    .run();

  await audit(c, u.id, 'verify.start', hostRes.name, `${presetKey} scope=${scope}`);
  const rec = await c.env.DB.prepare('SELECT * FROM dns_records WHERE id = ?').bind(res.meta?.last_row_id).first();
  return ok(c, { record: shape(rec) }, 201);
});

// ---------- 确认认证完成：唯一解锁入口 ----------
app.post('/records/:id/verify-confirm', async (c) => {
  const u = c.get('user');
  const rid = Number(c.req.param('id'));
  const { rec, sub, error } = await loadRecord(c, rid);
  if (error) return fail(c, error, 404);
  if (!rec.verify_lock) return fail(c, '该记录未被锁定');

  const body = await c.req.json().catch(() => ({}));
  const keep = Boolean(body.keep);

  if (!keep) {
    const cf = await cfDelete(c.env, rec.cf_record_id, rootOf(c, sub));
    if (!cf.ok) return fail(c, `DNS 删除失败：${cfErrorMessage(cf)}`, 502, { cf: cf.errors });
    await c.env.DB.prepare('DELETE FROM dns_records WHERE id = ?').bind(rid).run();
  } else {
    await c.env.DB.prepare(
      'UPDATE dns_records SET verify_lock = 0, locked_at = NULL, locked_by = NULL, comment = ?, updated_at = ? WHERE id = ?'
    )
      .bind('根域名验证已完成（已解除锁定）', now(), rid)
      .run();
  }
  await audit(c, u.id, 'verify.confirm', rec.name, keep ? '保留记录' : '删除记录并释放占位');
  return ok(c, { released: !keep });
});

// ---------- 管理员强制解锁 ----------
app.post('/records/:id/force-unlock', async (c) => {
  const u = c.get('user');
  if (u.role !== 'admin') return fail(c, '需要管理员权限', 403);
  const rid = Number(c.req.param('id'));
  const rec = await c.env.DB.prepare('SELECT * FROM dns_records WHERE id = ?').bind(rid).first();
  if (!rec) return fail(c, '记录不存在', 404);
  const body = await c.req.json().catch(() => ({}));
  if (body.delete !== false) {
    const owner = await c.env.DB.prepare('SELECT root_domain, fqdn FROM subdomains WHERE id = ?').bind(rec.subdomain_id).first();
    await cfDelete(c.env, rec.cf_record_id, rootOf(c, owner));
    await c.env.DB.prepare('DELETE FROM dns_records WHERE id = ?').bind(rid).run();
  } else {
    await c.env.DB.prepare(
      'UPDATE dns_records SET verify_lock = 0, locked_at = NULL, locked_by = NULL, updated_at = ? WHERE id = ?'
    )
      .bind(now(), rid)
      .run();
  }
  await audit(c, u.id, 'verify.force_unlock', rec.name, body.reason || '');
  return ok(c, {});
});

// ---------- 区域 SOA（只读） ----------
app.get('/soa', async (c) => {
  const res = await cfSoa(c.env);
  if (!res.ok) return fail(c, cfErrorMessage(res), 502);
  const list = Array.isArray(res.result) ? res.result : [];
  return ok(c, { soa: list[0] || null, note: RECORD_TYPES.SOA.note });
});

export default app;
