import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';
import { cfCreate, cfDelete, cfErrorMessage, cfList } from '../lib/cf.js';
import {
  DELEGATION_PROVIDERS,
  findProvider,
  normalizeNs,
  resolveNs,
  createZoneAtProvider,
  checkDelegationAtProvider,
} from '../lib/delegation.js';
import { loadSubdomain } from './subdomains.js';

const app = new Hono();

const shape = (d) => ({
  id: d.id,
  subdomain_id: d.subdomain_id,
  provider: d.provider,
  providerName: (findProvider(d.provider) || {}).name || d.provider,
  zone_name: d.zone_name,
  ns: safeJson(d.ns_list, []),
  provider_zone: d.provider_zone || '',
  created_at: d.created_at,
  updated_at: d.updated_at,
});

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

// 服务商列表
app.get('/providers', (c) => ok(c, { items: DELEGATION_PROVIDERS }));

// 当前委派状态
app.get('/:id/delegation', async (c) => {
  const id = Number(c.req.param('id'));
  const { row: sub, error } = await loadSubdomain(c, id);
  if (error) return fail(c, error, 404);
  const d = await c.env.DB.prepare('SELECT * FROM delegations WHERE subdomain_id = ?').bind(id).first();
  return ok(c, { delegated: !!d, delegation: d ? shape(d) : null, fqdn: sub.fqdn });
});

/**
 * 托管：写入 NS 记录，把子域名的解析权交给服务商
 * body: { provider, customNs?: string[], apiToken?: string, keepRecords?: boolean }
 */
app.post('/:id/delegation', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const { row: sub, error } = await loadSubdomain(c, id);
  if (error) return fail(c, error, 404);
  if (sub.status === 'pending') return fail(c, '子域名仍在审核中', 403);
  if (sub.status === 'rejected') return fail(c, '子域名申请已被驳回', 403);
  if (sub.status === 'suspended') return fail(c, '子域名已被停用', 403);

  const body = await c.req.json().catch(() => ({}));
  const provider = findProvider(String(body.provider || ''));
  if (!provider) return fail(c, '未知的服务商');

  const customNs = Array.isArray(body.customNs)
    ? body.customNs
    : String(body.customNs || '').split(/[\n,\s]+/).filter(Boolean);

  // 已托管则先撤销，避免残留多条 NS
  const old = await c.env.DB.prepare('SELECT * FROM delegations WHERE subdomain_id = ?').bind(id).first();
  if (old) {
    const oldNs = safeJson(old.ns_list, []);
    for (const ns of oldNs) await deleteNsRecord(c.env, sub.fqdn, ns);
    await c.env.DB.prepare('DELETE FROM delegations WHERE subdomain_id = ?').bind(id).run();
  }

  // 1) 若服务商支持 API 且给了 token → 在服务商侧创建 zone 并取回官方 NS
  let apiNs = [];
  let providerZone = '';
  let apiNote = '';
  const token = String(body.apiToken || '').trim();
  if (token && provider.api) {
    const r = await createZoneAtProvider(provider, token, sub.fqdn);
    if (r.ok) {
      apiNs = r.ns || [];
      providerZone = r.zoneId || '';
      apiNote = apiNs.length ? '已在服务商创建解析区域，使用其返回的官方 NS' : '已在服务商创建解析区域，但未返回 NS，改用默认 NS';
    } else if (!r.skipped) {
      // API 失败不阻断：降级为「只写 NS + 面板指引」
      apiNote = `服务商 API 未成功（${r.error}），已按默认 NS 写入，请到面板确认。`;
    }
  }

  const nsList = resolveNs(provider, customNs, apiNs);
  if (provider.requireCustomNs && !normalizeNs(customNs).length)
    return fail(c, '该服务商需要填写专属 NS 主机名');
  if (nsList.length < 1) return fail(c, '没有可用的 NS 地址');
  if (nsList.length < 2)
    return fail(c, '建议至少填写 2 个 NS（多数注册局要求 2 个以上），如确定只需 1 个请联系管理员');

  // 2) 在父区域写 NS 记录（同时清理同名的旧 NS，避免残留）
  const written = [];
  const errs = [];
  for (const ns of nsList) {
    const r = await cfCreate(c.env, {
      type: 'NS',
      name: sub.fqdn,
      content: ns,
      ttl: 1,
      comment: `NS delegation → ${provider.name}`,
    }, sub.fqdn || sub.root_domain);
    if (r.ok) written.push({ ns, cfId: r.result.id });
    else errs.push(`${ns}: ${cfErrorMessage(r)}`);
  }
  if (!written.length)
    return fail(c, `Cloudflare 写入 NS 失败：${errs.join(' | ')}`, 502, { errors: errs });

  // 3) 记录到数据库（连同 Cloudflare 记录 id，便于撤销）
  await c.env.DB.prepare(
    `INSERT INTO delegations (subdomain_id, provider, zone_name, ns_list, provider_zone, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  )
    .bind(
      id,
      provider.key,
      sub.fqdn,
      JSON.stringify(written.map((w) => w.ns)),
      providerZone,
      u.id,
      now(),
      now()
    )
    .run();

  await audit(c, u.id, 'delegation.create', sub.fqdn, `${provider.key} · ${written.map((w) => w.ns).join(', ')}`);
  const d = await c.env.DB.prepare('SELECT * FROM delegations WHERE subdomain_id = ?').bind(id).first();
  return ok(c, {
    delegation: shape(d),
    apiNote,
    warnings: errs.length ? errs : undefined,
    panel: provider.panel || '',
    needManualAdd: !providerZone && provider.key !== 'custom',
  });
});

/**
 * 取消托管：删除 NS 记录，恢复由本站（Cloudflare）解析
 * body: { deleteRecords?: boolean }  是否同时清空该子域名下的 DNS 记录
 */
app.delete('/:id/delegation', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const { row: sub, error } = await loadSubdomain(c, id);
  if (error) return fail(c, error, 404);

  const d = await c.env.DB.prepare('SELECT * FROM delegations WHERE subdomain_id = ?').bind(id).first();
  if (!d) return fail(c, '该子域名当前未托管到外部 DNS', 404);

  const nsList = safeJson(d.ns_list, []);
  const errs = [];
  for (const ns of nsList) {
    const r = await deleteNsRecord(c.env, sub.fqdn, ns);
    if (r && !r.ok) errs.push(`${ns}: ${cfErrorMessage(r)}`);
  }
  await c.env.DB.prepare('DELETE FROM delegations WHERE subdomain_id = ?').bind(id).run();
  await audit(c, u.id, 'delegation.remove', sub.fqdn, nsList.join(', '));
  return ok(c, { removed: nsList.length, warnings: errs.length ? errs : undefined });
});

// 检查委派是否生效（DNSHE 走其 API；其余只返回本地记录）
app.post('/:id/delegation/check', async (c) => {
  const id = Number(c.req.param('id'));
  const { row: sub, error } = await loadSubdomain(c, id);
  if (error) return fail(c, error, 404);
  const d = await c.env.DB.prepare('SELECT * FROM delegations WHERE subdomain_id = ?').bind(id).first();
  if (!d) return fail(c, '该子域名当前未托管到外部 DNS', 404);

  const body = await c.req.json().catch(() => ({}));
  const token = String(body.apiToken || '').trim();
  const provider = findProvider(d.provider);
  if (!provider || !provider.api) {
    return ok(c, {
      supported: false,
      message: `${provider ? provider.name : '该服务商'} 未提供公开的委派检查接口，请到其面板查看状态。`,
      ns: safeJson(d.ns_list, []),
    });
  }
  if (!token) return fail(c, '该服务商的委派检查需要 API Token');
  const r = await checkDelegationAtProvider(provider, token, d.provider_zone);
  return ok(c, { supported: true, ...r, ns: safeJson(d.ns_list, []) });
});

/** 从父区域删除某条 NS 记录（按 name + content 精确匹配） */
async function deleteNsRecord(env, fqdn, ns) {
  const list = await cfList(env, { type: 'NS', name: fqdn }, fqdn);
  if (!list.ok) return null;
  const arr = Array.isArray(list.result) ? list.result : [];
  const target = arr.find((r) => String(r.content || '').toLowerCase().replace(/\.+$/, '') === String(ns).toLowerCase());
  if (!target) return null;
  return cfDelete(env, target.id, fqdn);
}

export default app;
