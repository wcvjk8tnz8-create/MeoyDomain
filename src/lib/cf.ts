// ============================================================
//  DNS API 封装（自动选择后端）
//  1) 自定义提供商：站点设置里填了 API URL → 用它（可突破 200 条记录限制）
//  2) Cloudflare    ：默认，调用 https://api.cloudflare.com/client/v4
//  3) Mock（CF_MOCK=1）：内存模拟，方便本地跑通全部流程
// ============================================================

import { zoneIdFor, matchRoot, parseRootList, parseZoneMap, normalizeDomain } from './roots.js';
import {
  spDnsSave, spDnsDelete, spDnsList,
  toSpaceshipRecord, spRecordId, parseSpRecordId,
} from './spaceshipDns.js';

const BASE = 'https://api.cloudflare.com/client/v4';

/** 根域名 → DNS 后端（"domain:spaceship,other.com:cloudflare"） */
function parseBackendMap(raw) {
  const map = {};
  for (const seg of String(raw || '').split(',')) {
    const i = String(seg || '').search(/[:=]/);
    if (i <= 0) continue;
    const d = normalizeDomain(seg.slice(0, i));
    const v = String(seg.slice(i + 1)).trim().toLowerCase();
    if (d && (v === 'spaceship' || v === 'cloudflare')) map[d] = v;
  }
  return map;
}

/**
 * 取得某个域名对应的 Zone ID。
 * 支持多根域名：优先按域名查 CF_ZONE_IDS 映射，查不到再回落默认 CF_ZONE_ID。
 * @param {any} env
 * @param {string} [domain] 域名或 FQDN，如 meoy.top / mail.meoy.top
 */
export function zoneFor(env, domain) {
  const fallback = String(env.CF_ZONE_ID || '').trim();
  if (!domain) return fallback;
  const direct = zoneIdFor(env, domain);
  if (direct) return direct;
  const root = matchRoot(env, domain);
  if (root?.zoneId) return root.zoneId;
  // 只有「默认根域名本身或其子域」才回落到 CF_ZONE_ID。
  // 以前无条件回落会把新导入的域名写进默认 Zone —— 记录看起来创建成功，
  // 实际落在了别人的域名下，而且 Spaceship 域名因此永远走不到自己的后端。
  const d = normalizeDomain(domain);
  const fb = normalizeDomain(env.ROOT_DOMAIN);
  if (fb && (d === fb || d.endsWith('.' + fb))) return fallback;
  return '';
}

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
      backends: {}, dynamicRoots: [], extraZones: {},
    };
  }
  // 未设环境变量则查 D1（每次部署只查一次，结果缓存 60 秒）
  const nowTs = Date.now();
  // 15 秒：后台写入会主动 clearDnsProviderCache()，这里只是兜底 ——
  // Worker 有多个 isolate，别的实例上的旧快照最多残留 15 秒。
  if (customCache && nowTs - customAt < 15000) return customCache;
  const zone = String(env.CF_ZONE_ID || '').trim();
  let cfg = {
    custom: false, base: BASE, zone, auth: null,
    backends: {}, dynamicRoots: [], extraZones: {},
  };
  try {
    const rows = await env.DB
      .prepare(`SELECT key, value FROM settings WHERE key IN
        ('dns_api_url','dns_api_key','dns_api_secret',
         'root_dns_backends','root_domains_extra','cf_zone_ids_extra','root_domains_disabled')`)
      .all();
    const m = Object.fromEntries((rows?.results || []).map((r) => [r.key, String(r.value || '').trim()]));
    const disabled = new Set(parseRootList(m.root_domains_disabled));
    cfg.backends = parseBackendMap(m.root_dns_backends);
    cfg.dynamicRoots = parseRootList(m.root_domains_extra).filter((d) => !disabled.has(d));
    cfg.extraZones = parseZoneMap(m.cf_zone_ids_extra);
    if (m.dns_api_url) {
      cfg.custom = true;
      cfg.base = m.dns_api_url.replace(/\/$/, '');
      cfg.auth = { key: m.dns_api_key || '', secret: m.dns_api_secret || '' };
    }
  } catch { /* 忽略，回落 Cloudflare */ }
  customCache = cfg;
  customAt = nowTs;
  return cfg;
}

/**
 * 决定某个根域名用哪个 DNS 后端。
 * 优先级：后台显式配置 > 自动推断 > Cloudflare。
 *
 * 自动推断：从 Spaceship 导入（root_domains_extra）且没有任何 Cloudflare Zone
 * 的根域名 → 直接用 Spaceship DNS API 写记录。这正是「导入了域名却新增不了
 * DNS 记录」的场景：以前它会带着空的 Zone 去请求 Cloudflare，必然失败。
 */
export function backendFor(env, p, domain) {
  const d = normalizeDomain(domain);
  if (!d) return p.custom ? 'custom' : 'cloudflare';
  const explicit = p.backends?.[d];
  if (explicit === 'spaceship' || explicit === 'cloudflare') return explicit;
  const hasZone = !!(p.extraZones?.[d] || zoneFor(env, d));
  if (p.dynamicRoots?.includes(d) && !hasZone) return 'spaceship';
  return p.custom ? 'custom' : 'cloudflare';
}

/** 未显式传 domain 时，从记录名反推根域名（NS 委派等旧调用点没传） */
function resolveDomain(env, domain, nameHint) {
  if (domain) return normalizeDomain(domain);
  return matchRoot(env, nameHint || '')?.domain || normalizeDomain(env.ROOT_DOMAIN);
}

/**
 * 与 dnsProvider 相同，但把 zone 换成「指定域名」对应的 Zone ID（多根域名），
 * 并附带 backend 与 root。未传 domain 时行为与 dnsProvider 基本一致。
 */
export async function dnsProviderFor(env, domain) {
  const p = await dnsProvider(env);
  if (!domain) return { ...p, backend: p.custom ? 'custom' : 'cloudflare', root: '' };
  return { ...p, zone: zoneFor(env, domain), backend: backendFor(env, p, domain), root: normalizeDomain(domain) };
}

function noBackendError(domain) {
  const msg = `根域名 ${domain || '（未指定）'} 未配置可用的 DNS 后端：请在后台「根域名管理」把它设为 Spaceship，或填写对应的 Cloudflare Zone ID`;
  return { ok: false, errors: [{ message: msg }], message: msg };
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

export async function cfCreate(env, payload, domain) {
  if (env.CF_MOCK === '1' || env.CF_MOCK === 'true') return mockCreate(payload);
  const d = resolveDomain(env, domain, payload?.name);
  const p = await dnsProviderFor(env, d);
  if (p.backend === 'spaceship') {
    const conv = toSpaceshipRecord(payload, d);
    if (!conv.ok) return { ok: false, errors: [{ message: conv.error }], message: conv.error };
    const r = await spDnsSave(env, d, [conv.record]);
    if (!r.ok) return r;
    return { ok: true, result: { id: spRecordId(d, conv.record) } };
  }
  if (!p.zone) return noBackendError(d);
  const r = await fetch(recordsPath(p), {
    method: 'POST',
    headers: authHeaders(env, p),
    body: JSON.stringify(p.custom ? { ...payload, zone_id: p.zone } : payload),
  });
  return cfParse(r);
}

export async function cfUpdate(env, id, payload, domain) {
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
  // Spaceship 的 cf_record_id 自带域名，旧调用点没传 domain 也能还原
  const spOld = parseSpRecordId(id);
  const d = resolveDomain(env, spOld?.domain || domain, payload?.name);
  const p = await dnsProviderFor(env, d);
  if (p.backend === 'spaceship') {
    const conv = toSpaceshipRecord(payload, d);
    if (!conv.ok) return { ok: false, errors: [{ message: conv.error }], message: conv.error };
    // PUT 是增量的：先删旧记录，否则改了值会留下同名同类型的两条
    if (spOld) {
      const del = await spDnsDelete(env, spOld.domain, [spOld.record]);
      if (!del.ok) return del;
    }
    const r = await spDnsSave(env, d, [conv.record]);
    if (!r.ok) return r;
    return { ok: true, result: { id: spRecordId(d, conv.record) } };
  }
  if (!p.zone) return noBackendError(d);
  const r = await fetch(`${recordsPath(p)}/${id}`, {
    method: 'PATCH',
    headers: authHeaders(env, p),
    body: JSON.stringify(payload),
  });
  return cfParse(r);
}

export async function cfDelete(env, id, domain) {
  if (env.CF_MOCK === '1' || env.CF_MOCK === 'true') {
    mockStore.delete(id);
    return { ok: true, result: { id } };
  }
  const spOld = parseSpRecordId(id);
  if (spOld) return spDnsDelete(env, spOld.domain, [spOld.record]);
  const d = resolveDomain(env, domain, '');
  const p = await dnsProviderFor(env, d);
  if (p.backend === 'spaceship') {
    // 历史数据：域名后来切到了 Spaceship，但旧记录 id 是 Cloudflare 的。
    // 无法凭 id 构造删除对象，不阻断本地删除，只提示远端可能残留。
    return { ok: true, result: { id }, warning: '该记录原由 Cloudflare 创建，Spaceship 侧可能仍有残留' };
  }
  if (!p.zone) return noBackendError(d);
  const r = await fetch(`${recordsPath(p)}/${id}`, {
    method: 'DELETE',
    headers: authHeaders(env, p),
  });
  return cfParse(r);
}

export async function cfList(env, params = {}, domain) {
  if (env.CF_MOCK === '1' || env.CF_MOCK === 'true') {
    return { ok: true, result: [...mockStore.values()] };
  }
  const d = resolveDomain(env, domain, params?.name);
  const p = await dnsProviderFor(env, d);
  if (p.backend === 'spaceship') {
    const r = await spDnsList(env, d);
    if (!r.ok) return r;
    let arr = r.result || [];
    if (params.type) arr = arr.filter((x) => x.type === String(params.type).toUpperCase());
    if (params.name) arr = arr.filter((x) => x.name === normalizeDomain(params.name));
    return { ok: true, result: arr };
  }
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
  const d = normalizeDomain(env.ROOT_DOMAIN);
  const p = await dnsProviderFor(env, d);
  // Spaceship DNS 不暴露 SOA 记录接口，返回空结果即可（前端只做展示）
  if (p.backend === 'spaceship') return { ok: true, result: [] };
  if (!p.zone) return noBackendError(d);
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
