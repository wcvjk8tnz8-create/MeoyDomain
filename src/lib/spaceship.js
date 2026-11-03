/**
 * Spaceship 域名注册商 API 适配
 *
 * 官方规范（docs.spaceship.dev）：
 *   Base URL : https://spaceship.dev/api
 *   认证     : X-Api-Key / X-Api-Secret（两个 Header，不做编码）
 *   域名列表 : GET /v1/domains?take=100&skip=0&orderBy=name
 *   响应     : { items: [{ name, unicodeName, registrationDate, expirationDate, ... }], total }
 *   限流     : 列表 300 次 / 300 秒；take 最大 100
 *
 * 设计原则：
 *   · 只读：本项目只用「列出账号下域名」，不注册、不续费、不改 NS（避免误触资金操作）
 *   · API Key/Secret 只存服务端，后台只回显掩码
 *   · 配置支持「后台设置」与「环境变量」双通道，环境变量优先
 *   · 响应字段做容错解析（不同 SDK 观察到的包装略有差异）
 */

const DEFAULT_BASE = 'https://spaceship.dev/api';

/** 读取配置：环境变量 > 数据库 settings */
export async function spaceshipConfig(env) {
  const row = async (k) => {
    try {
      const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(k).first();
      return String(r?.value || '').trim();
    } catch {
      return '';
    }
  };
  const [url, key, secret] = await Promise.all([
    row('spaceship_api_url'),
    row('spaceship_api_key'),
    row('spaceship_api_secret'),
  ]);
  return {
    base: (String(env.SPACESHIP_API_URL || '').trim() || url || DEFAULT_BASE).replace(/\/+$/, ''),
    apiKey: String(env.SPACESHIP_API_KEY || '').trim() || key,
    apiSecret: String(env.SPACESHIP_API_SECRET || '').trim() || secret,
    fromEnv: !!(String(env.SPACESHIP_API_KEY || '').trim() && String(env.SPACESHIP_API_SECRET || '').trim()),
  };
}

export function spaceshipEnabled(cfg) {
  return !!(cfg && cfg.apiKey && cfg.apiSecret && cfg.base);
}

function normalizeDomain(v) {
  return String(v ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

/** 发起一次请求，返回 { ok, status, data, error } */
async function request(cfg, path) {
  const url = cfg.base + path;
  let r;
  try {
    r = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Api-Key': cfg.apiKey,
        'X-Api-Secret': cfg.apiSecret,
        Accept: 'application/json',
      },
      // 避免上游挂起拖死 Worker
      signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
    });
  } catch (e) {
    return { ok: false, status: 0, error: '无法连接 Spaceship API：' + (e?.message || e) };
  }
  const text = await r.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }

  if (!r.ok) {
    let msg = '';
    if (data && typeof data === 'object') {
      msg = data.detail || data.message || data.title || '';
    }
    const fallback =
      r.status === 401 || r.status === 403 ? 'API Key / Secret 无效或权限不足（需 domains 读取权限）'
      : r.status === 429 ? '请求过于频繁，请稍后再试（Spaceship 限流 300 次 / 300 秒）'
      : r.status === 404 ? 'API 地址不正确（应形如 https://spaceship.dev/api）'
      : `Spaceship 返回 HTTP ${r.status}`;
    return { ok: false, status: r.status, error: String(msg || fallback).slice(0, 220) };
  }
  return { ok: true, status: r.status, data };
}

/** 从各种可能的响应包装里抽出域名数组 */
export function extractDomains(data) {
  if (!data) return [];
  let list = null;
  if (Array.isArray(data)) list = data;
  else if (Array.isArray(data.items)) list = data.items;
  else if (Array.isArray(data.domains)) list = data.domains;
  else if (Array.isArray(data.data)) list = data.data;
  else if (data.result && Array.isArray(data.result.items)) list = data.result.items;
  if (!list) return [];

  const seen = new Set();
  const out = [];
  for (const it of list) {
    if (typeof it === 'string') {
      const d = normalizeDomain(it);
      if (d && !seen.has(d)) { seen.add(d); out.push({ domain: d }); }
      continue;
    }
    if (!it || typeof it !== 'object') continue;
    const d = normalizeDomain(it.name || it.domain || it.domainName || it.unicodeName);
    if (!d || !d.includes('.') || seen.has(d)) continue;
    seen.add(d);
    out.push({
      domain: d,
      unicodeName: String(it.unicodeName || it.name || '').trim(),
      registrationDate: it.registrationDate || it.createdAt || null,
      expirationDate: it.expirationDate || it.expiresAt || null,
      autoRenew: typeof it.autoRenew === 'boolean' ? it.autoRenew : null,
      status: String(it.status || it.lifecycleStatus || '').trim(),
      nameservers: Array.isArray(it.nameservers) ? it.nameservers.map(String) : [],
    });
  }
  return out;
}

/** 从响应里读总数（用于判断是否需要继续翻页） */
function extractTotal(data, pageLen) {
  if (!data || typeof data !== 'object') return pageLen;
  const n = Number(data.total ?? data.totalCount ?? data.count);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * 拉取账号下全部域名（自动翻页，最多 5 页 / 500 个，防止失控）。
 * @returns {{ ok:boolean, domains?:Array, total?:number, error?:string }}
 */
export async function listSpaceshipDomains(env) {
  const cfg = await spaceshipConfig(env);
  if (!spaceshipEnabled(cfg)) {
    return { ok: false, error: '未配置 Spaceship API 凭证，请先在站点设置填写 API Key 与 Secret', notConfigured: true };
  }

  const all = [];
  const seen = new Set();
  let total = null;
  for (let page = 0; page < 5; page++) {
    const skip = page * 100;
    const r = await request(cfg, `/v1/domains?take=100&skip=${skip}&orderBy=name`);
    if (!r.ok) return { ok: false, error: r.error, status: r.status };
    const chunk = extractDomains(r.data);
    for (const d of chunk) {
      if (!seen.has(d.domain)) { seen.add(d.domain); all.push(d); }
    }
    const t = extractTotal(r.data, chunk.length);
    if (t !== null) total = t;
    // 本页不足 100 条，或已拿够总数 → 结束
    if (chunk.length < 100 || (total !== null && all.length >= total)) break;
  }
  return { ok: true, domains: all, total: total ?? all.length, base: cfg.base };
}

/** 轻量连通性测试（只取 1 条） */
export async function testSpaceship(env) {
  const cfg = await spaceshipConfig(env);
  if (!spaceshipEnabled(cfg)) return { ok: false, error: '未配置 API Key / Secret', notConfigured: true };
  const r = await request(cfg, '/v1/domains?take=1&skip=0');
  if (!r.ok) return { ok: false, error: r.error, status: r.status };
  const n = extractTotal(r.data, extractDomains(r.data).length);
  return { ok: true, base: cfg.base, total: n ?? 0 };
}
