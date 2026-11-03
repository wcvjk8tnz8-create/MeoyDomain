/**
 * Spaceship DNS 记录写入适配
 *
 * 官方 API（docs.spaceship.dev / OpenAPI）：
 *   认证     : X-Api-Key + X-Api-Secret
 *   列出     : GET  /v1/dns/records/{domain}?take=500&skip=0
 *   保存     : PUT  /v1/dns/records/{domain}   body {"items":[records]}
 *   删除     : DELETE /v1/dns/records/{domain} body [records]
 *
 * 两个第三方资料对路径写法不一致（/v1/dns/records/ 与 /v1/dns-records/），
 * 对请求体包装也不一致（{"items":[...]} 与裸数组）。这里做**自动探测 + 降级**：
 * 首次调用依次尝试，成功后把可用写法缓存到当前 Worker 实例，后续直接用。
 *
 * 关键安全点：**绝不使用 force:true**。带 force 的 PUT 会用本次 items 覆盖
 * 整个域名的记录集，会清空用户已有的 MX / 验证 TXT 等记录。
 * 不加 force 时 PUT 是增量（additive），只新增/更新同名同类型记录。
 *
 * 字段映射（按 Spaceship 记录 schema，逐类型不同）：
 *   A/AAAA → address   CNAME → cname   NS → nameserver
 *   TXT    → value     MX    → exchange + preference
 * 其余类型暂不映射，明确拒绝，避免把错误字段写进 DNS。
 */

import { spaceshipConfig, spaceshipEnabled, spaceshipRequest } from './spaceship.js';

/** 本 Worker 实例内缓存：探测成功的路径写法与请求体写法 */
let pathStyle = null;   // 'slash' | 'dash'
let bodyStyle = null;   // 'items' | 'bare'
let deleteBodyStyle = null;

const pathFor = (domain, style) => {
  const d = encodeURIComponent(String(domain || '').toLowerCase());
  return style === 'dash'
    ? `/v1/dns-records/${d}`
    : `/v1/dns/records/${d}`;
};

/** 按类型把内部（Cloudflare 风格）payload 转成 Spaceship 记录对象 */
export function toSpaceshipRecord(payload, rootDomain) {
  const type = String(payload?.type || '').toUpperCase();
  const name = relativeName(payload?.name, rootDomain);
  const ttl = Number(payload?.ttl) === 1 ? 3600 : Number(payload?.ttl) || 3600;
  const content = String(payload?.content ?? '').trim();

  const base = { type, name, ttl };
  switch (type) {
    case 'A':
    case 'AAAA':
      if (!content) return { ok: false, error: 'A/AAAA 记录值不能为空' };
      return { ok: true, record: { ...base, address: content } };
    case 'CNAME':
      if (!content) return { ok: false, error: 'CNAME 记录值不能为空' };
      return { ok: true, record: { ...base, cname: content.replace(/\.+$/, '') } };
    case 'NS':
      if (!content) return { ok: false, error: 'NS 记录值不能为空' };
      return { ok: true, record: { ...base, nameserver: content.replace(/\.+$/, '') } };
    case 'TXT':
      if (!content) return { ok: false, error: 'TXT 记录值不能为空' };
      return { ok: true, record: { ...base, value: content } };
    case 'MX':
      if (!content) return { ok: false, error: 'MX 记录值不能为空' };
      return {
        ok: true,
        record: {
          ...base,
          exchange: content.replace(/\.+$/, ''),
          preference: Number(payload?.priority ?? 10),
        },
      };
    default:
      return {
        ok: false,
        error: `Spaceship DNS 暂不支持 ${type} 记录（可用 A / AAAA / CNAME / TXT / MX / NS），请改用 Cloudflare 后端`,
      };
  }
}

/** 完整记录名 → Spaceship 相对名；根域名本身 → @ */
export function relativeName(name, rootDomain) {
  const n = String(name || '').trim().toLowerCase().replace(/\.+$/, '');
  const r = String(rootDomain || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!n || !r || n === r) return '@';
  if (n.endsWith('.' + r)) return n.slice(0, n.length - r.length - 1);
  return n; // 不属于该根域名：原样交给 Spaceship
}

/** Spaceship 相对名 → 完整记录名 */
function absoluteName(name, rootDomain) {
  const n = String(name || '').trim().toLowerCase().replace(/\.+$/, '');
  const r = String(rootDomain || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!n || n === '@') return r;
  if (!r || n.endsWith('.' + r)) return n;
  return `${n}.${r}`;
}

/** Spaceship 记录对象 → 内部统一格式（供列表/匹配用） */
export function fromSpaceshipRecord(rec, rootDomain) {
  const content = rec.address ?? rec.cname ?? rec.nameserver ?? rec.value ?? rec.exchange ?? '';
  return {
    id: spRecordId(rootDomain, rec),
    type: String(rec.type || '').toUpperCase(),
    name: absoluteName(rec.name, rootDomain),
    content: String(content),
    ttl: Number(rec.ttl) || 3600,
    priority: rec.preference ?? null,
  };
}

/** 把「域名 + 记录内容」编码进 cf_record_id，删除时无需改表结构即可还原 */
export function spRecordId(domain, record) {
  return 'sp:' + encodeURIComponent(domain) + ':' + encodeURIComponent(JSON.stringify(record));
}

/** 解析 cf_record_id；非 Spaceship 记录返回 null */
export function parseSpRecordId(id) {
  const s = String(id || '');
  if (!s.startsWith('sp:')) return null;
  const parts = s.split(':');
  if (parts.length < 3) return null;
  try {
    const domain = decodeURIComponent(parts[1]);
    const record = JSON.parse(decodeURIComponent(parts.slice(2).join(':')));
    if (!domain || !record || typeof record !== 'object') return null;
    return { domain, record };
  } catch {
    return null;
  }
}

/** 通用：尝试所有路径/请求体写法，成功后缓存 */
async function withFallback(cfg, domain, method, records) {
  const styles = pathStyle ? [pathStyle] : ['slash', 'dash'];
  let lastErr = '';
  for (const ps of styles) {
    const path = pathFor(domain, ps) + (method === 'GET' ? '?take=500&skip=0' : '');
    if (method === 'GET') {
      const r = await spaceshipRequest(cfg, path, { method: 'GET' });
      if (r.ok) { pathStyle = ps; return r; }
      if (r.status !== 404 && r.status !== 405 && r.status !== 0) return r;
      lastErr = r.error;
      continue;
    }

    const bodies = method === 'DELETE'
      ? (deleteBodyStyle ? [deleteBodyStyle] : ['bare', 'items'])
      : (bodyStyle ? [bodyStyle] : ['items', 'bare']);
    for (const bs of bodies) {
      // PUT：官方 schema 要求 force 字段（必填）。force:false = 增量写入，
      // 只新增/更新本次记录，绝不清空用户已有的 MX / 验证 TXT。
      // 兼容写法仍保留给第三方代理，但优先带 force。
      const body = method === 'PUT'
        ? (bs === 'items' ? { force: false, items: records } : records)
        : (bs === 'items' ? { items: records } : records);
      const r = await spaceshipRequest(cfg, path, { method, body });
      if (r.ok) {
        pathStyle = ps;
        if (method === 'DELETE') deleteBodyStyle = bs;
        else bodyStyle = bs;
        return r;
      }
      lastErr = r.error;
      // 404/405 → 换路径；400/422 → 换请求体写法；其它错误直接返回
      if (r.status === 404 || r.status === 405) break;
      if (r.status !== 400 && r.status !== 422 && r.status !== 0) return r;
    }
  }
  return { ok: false, status: 404, error: lastErr || 'Spaceship DNS 接口不可用' };
}

/** 配置检查：Spaceship DNS 需要 dnsrecords:read / dnsrecords:write 权限 */
async function ready(env) {
  const cfg = await spaceshipConfig(env);
  if (!spaceshipEnabled(cfg)) {
    return { cfg: null, error: '该域名使用 Spaceship DNS，但未配置 API Key / Secret（后台 → 站点设置 → Spaceship）' };
  }
  return { cfg, error: null };
}

/** 新增/更新记录（增量 PUT，绝不带 force） */
export async function spDnsSave(env, domain, records) {
  const { cfg, error } = await ready(env);
  if (error) return { ok: false, errors: [{ message: error }], message: error };
  const r = await withFallback(cfg, domain, 'PUT', records);
  if (!r.ok) return { ok: false, errors: [{ message: r.error }], message: r.error };
  return { ok: true, result: { id: spRecordId(domain, records[0]), saved: records.length } };
}

/** 删除记录（DELETE 需要完整的记录对象，按 name + type + 值匹配） */
export async function spDnsDelete(env, domain, records) {
  const { cfg, error } = await ready(env);
  if (error) return { ok: false, errors: [{ message: error }], message: error };
  const r = await withFallback(cfg, domain, 'DELETE', records);
  if (!r.ok) return { ok: false, errors: [{ message: r.error }], message: r.error };
  return { ok: true, result: { id: records[0] ? spRecordId(domain, records[0]) : '' } };
}

/** 列出记录 */
export async function spDnsList(env, domain) {
  const { cfg, error } = await ready(env);
  if (error) return { ok: false, errors: [{ message: error }], message: error };
  const r = await withFallback(cfg, domain, 'GET');
  if (!r.ok) return { ok: false, errors: [{ message: r.error }], message: r.error };
  const items = Array.isArray(r.data?.items) ? r.data.items
    : Array.isArray(r.data) ? r.data : [];
  return { ok: true, result: items.map((x) => fromSpaceshipRecord(x, domain)) };
}

/** 仅供测试：重置探测缓存 */
export function resetSpDnsProbe() {
  pathStyle = null;
  bodyStyle = null;
  deleteBodyStyle = null;
}
