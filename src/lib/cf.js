// ============================================================
//  DNS API 封装（自动选择后端）
//  1) 自定义提供商：站点设置里填了 API URL → 用它（可突破 200 条记录限制）
//  2) Cloudflare    ：默认，调用 https://api.cloudflare.com/client/v4
//  3) Mock（CF_MOCK=1）：内存模拟，方便本地跑通全部流程
// ============================================================

const BASE = 'https://api.cloudflare.com/client/v4';

/* ---------- 自定义 DNS 提供商配置 ----------
   站点设置键：dns_api_url / dns_api_key / dns_api_secret
   URL 支持占位符 {zone}（替换为 CF_ZONE_ID）；为空则用 Cloudflare。 */
let customCache = null;
let customAt = 0;

export async function dnsProvider(env) {
  const url = String(env.DNS_API_URL || '').trim();
  if (url) {
    return {
      custom: true,
      base: url.replace(/\/$/, ''),
      zone: String(env.CF_ZONE_ID || '').trim(),
      auth: { key: String(env.DNS_API_KEY || '').trim(), secret: String(env.DNS_API_SECRET || '').trim() },
    };
  }
  // 未设环境变量则查 D1（每次部署只查一次，结果缓存 60 秒）
  const nowTs = Date.now();
  if (customCache && nowTs - customAt < 60000) return customCache;
  let cfg = { custom: false, base: BASE, zone: String(env.CF_ZONE_ID || '').trim(), auth: null };
  try {
    const rows = await env.DB
      .prepare("SELECT key, value FROM settings WHERE key IN ('dns_api_url','dns_api_key','dns_api_secret')")
      .all();
    const m = Object.fromEntries((rows?.results || []).map((r) => [r.key, String(r.value || '').trim()]));
    if (m.dns_api_url) {
      cfg = {
        custom: true,
        base: m.dns_api_url.replace(/\/$/, ''),
        zone: String(env.CF_ZONE_ID || '').trim(),
        auth: { key: m.dns_api_key || '', secret: m.dns_api_secret || '' },
      };
    }
  } catch { /* 忽略，回落 Cloudflare */ }
  customCache = cfg;
  customAt = nowTs;
  return cfg;
}

/** 后台改了配置后清空缓存，使其立即生效 */
export function clearDnsProviderCache() {
  customCache = null;
  customAt = 0;
}

/** 按提供商构造请求头：有 key/secret 用 X-API-Key/Secret，否则沿用 Bearer */
function authHeaders(env, p) {
  const h = { 'Content-Type': 'application/json' };
  if (p.custom && p.auth && (p.auth.key || p.auth.secret)) {
    if (p.auth.key) h['X-API-Key'] = p.auth.key;
    if (p.auth.secret) h['X-API-Secret'] = p.auth.secret;
  } else {
    h.Authorization = `Bearer ${env.CF_API_TOKEN}`;
  }
  return h;
}

/** 记录集合路径：自定义提供商优先用 /dns_records?zone=，兼容 {zone} 占位 */
function recordsPath(p) {
  if (!p.custom) return `${BASE}/zones/${p.zone}/dns_records`;
  if (p.base.includes('{zone}')) return p.base.replace('{zone}', encodeURIComponent(p.zone));
  return `${p.base}/dns_records`;
}

// ---- mock 存储 ----
const mockStore = new Map();
let mockSeq = 1000;

function mockId() {
  return 'mock' + String(++mockSeq);
}

async function mockCreate(payload) {
  const id = mockId();
  mockStore.set(id, {
    id,
    type: payload.type,
    name: payload.name,
    content: payload.content || '',
    data: payload.data || null,
    ttl: payload.ttl ?? 1,
    proxied: Boolean(payload.proxied),
    priority: payload.priority ?? null,
  });
  return { ok: true, result: mockStore.get(id) };
}

export async function cfCreate(env, payload) {
  if (env.CF_MOCK === '1' || env.CF_MOCK === 'true') return mockCreate(payload);
  const p = await dnsProvider(env);
  const r = await fetch(recordsPath(p), {
    method: 'POST',
    headers: authHeaders(env, p),
    body: JSON.stringify(p.custom ? { ...payload, zone_id: p.zone } : payload),
  });
  return cfParse(r);
}

export async function cfUpdate(env, id, payload) {
  if (env.CF_MOCK === '1' || env.CF_MOCK === 'true') {
    const old = mockStore.get(id);
    if (!old) return { ok: false, errors: [{ message: '记录不存在（mock）' }] };
    Object.assign(old, {
      type: payload.type,
      name: payload.name,
      content: payload.content || '',
      data: payload.data || null,
      ttl: payload.ttl ?? 1,
      proxied: Boolean(payload.proxied),
      priority: payload.priority ?? null,
    });
    return { ok: true, result: old };
  }
  const p = await dnsProvider(env);
  const r = await fetch(`${recordsPath(p)}/${id}`, {
    method: 'PATCH',
    headers: authHeaders(env, p),
    body: JSON.stringify(payload),
  });
  return cfParse(r);
}

export async function cfDelete(env, id) {
  if (env.CF_MOCK === '1' || env.CF_MOCK === 'true') {
    mockStore.delete(id);
    return { ok: true, result: { id } };
  }
  const p = await dnsProvider(env);
  const r = await fetch(`${recordsPath(p)}/${id}`, {
    method: 'DELETE',
    headers: authHeaders(env, p),
  });
  return cfParse(r);
}

export async function cfList(env, params = {}) {
  if (env.CF_MOCK === '1' || env.CF_MOCK === 'true') {
    return { ok: true, result: [...mockStore.values()] };
  }
  const p = await dnsProvider(env);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, v);
  if (p.custom) qs.set('zone', p.zone);
  const r = await fetch(`${recordsPath(p)}?${qs.toString()}`, {
    headers: authHeaders(env, p),
  });
  return cfParse(r);
}

// 拉取区域 SOA（Cloudflare 自动生成，只读）
export async function cfSoa(env) {
  if (env.CF_MOCK === '1' || env.CF_MOCK === 'true') {
    return {
      ok: true,
      result: [{
        name: env.ROOT_DOMAIN,
        data: {
          mname: `ns1.cloudflare.com`,
          rname: `dns.cloudflare.com`,
          serial: 2380000000,
          refresh: 10000,
          retry: 2400,
          expire: 604800,
          minimum: 1800,
        },
      }],
    };
  }
  const p = await dnsProvider(env);
  const r = await fetch(`${recordsPath(p)}?type=SOA${p.custom ? '&zone=' + encodeURIComponent(p.zone) : ''}`, {
    headers: authHeaders(env, p),
  });
  return cfParse(r);
}

async function cfParse(resp) {
  let json;
  try {
    json = await resp.json();
  } catch {
    return { ok: false, errors: [{ message: `DNS 接口返回无法解析的内容（HTTP ${resp.status}）` }] };
  }
  if (!resp.ok || !json.success) {
    const msgs = (json.errors || []).map((e) => e.message).filter(Boolean);
    return { ok: false, errors: json.errors || [], message: msgs.join('；') || `DNS API 错误 ${resp.status}` };
  }
  return { ok: true, result: json.result };
}

export function cfErrorMessage(res) {
  if (res.message) return res.message;
  return (res.errors || []).map((e) => e.message || e.code).join('；') || 'DNS API 调用失败';
}
