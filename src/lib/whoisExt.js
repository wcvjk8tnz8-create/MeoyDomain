// ============================================================
//  外部域名 WHOIS（可查任意域名，含 DNSHE）
//  - DNSHE 系后缀 → DNSHE 公开 WHOIS（免认证，官方限制 2 次/分钟/IP）
//  - 其它后缀     → RDAP（rdap.org 自动跳转到对应注册局，免 key）
//  结果按 6 小时缓存，避免触发上游限流
// ============================================================

/** DNSHE 开放的后缀（其子域名由 DNSHE 自己管理，RDAP 查不到） */
export const DNSHE_SUFFIXES = [
  'de5.net', 'us.ci', 'cc.cd', 'ccwu.cc', 'bot.cd', 'dnshe.com',
];

export function isDnsheDomain(domain) {
  const d = String(domain || '').toLowerCase().replace(/\.+$/, '');
  return DNSHE_SUFFIXES.some((s) => d === s || d.endsWith('.' + s));
}

/** 基本域名格式校验 */
export function isValidDomain(domain) {
  const d = String(domain || '').toLowerCase().replace(/\.+$/, '');
  if (!d || d.length > 253) return false;
  if (d.includes('/') || d.includes('\\') || d.includes(':')) return false;
  const parts = d.split('.');
  if (parts.length < 2) return false;
  return parts.every((p) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(p) && p.length <= 63);
}

async function fetchJson(url, { headers = {}, timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      headers: { Accept: 'application/rdap+json, application/json', ...headers },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = null; }
    return { status: r.status, ok: r.ok, data, text };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- DNSHE 公开 WHOIS ---------------- */
export async function dnsheWhois(domain) {
  const url =
    'https://api005.dnshe.com/index.php?m=domain_hub&endpoint=whois&domain=' +
    encodeURIComponent(domain);
  let res;
  try {
    res = await fetchJson(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    return { source: 'dnshe', ok: false, error: 'DNSHE 请求失败：' + String(e.message || e).slice(0, 120) };
  }
  if (res.status === 429 || (res.data && res.data.error_code === 'rate_limit_exceeded')) {
    return { source: 'dnshe', ok: false, rateLimited: true, error: 'DNSHE 限流（2 次/分钟），请稍后再试' };
  }
  const d = res.data;
  if (!d || d.success !== true) {
    return { source: 'dnshe', ok: false, error: (d && d.message) || `DNSHE 返回 HTTP ${res.status}` };
  }
  const registered = d.registered !== false && d.status !== 'unregistered';
  return {
    source: 'dnshe',
    ok: true,
    domain: d.domain || domain,
    registered,
    status: d.status ? [String(d.status)] : [],
    registrar: 'DNSHE',
    createdAt: d.registered_at || null,
    expiresAt: d.expires_at || null,
    updatedAt: null,
    nameservers: Array.isArray(d.nameservers) ? d.nameservers : (d.name_servers || []),
    registrant: d.privacy_enabled ? null : { email: d.registrant_email || null },
    privacy: !!d.privacy_enabled,
    rateLimit: d.rate_limit || null,
  };
}

/* ---------------- RDAP（任意注册域名） ---------------- */
function vcardFn(vcardArray) {
  try {
    const arr = Array.isArray(vcardArray) ? vcardArray[1] : null;
    if (!Array.isArray(arr)) return null;
    const hit = arr.find((f) => Array.isArray(f) && f[0] === 'fn');
    return hit ? String(hit[3] || '').trim() || null : null;
  } catch { return null; }
}

function pickEntity(entities, role) {
  for (const e of entities || []) {
    const roles = e.roles || [];
    if (roles.includes(role)) return e;
  }
  return null;
}

export async function rdapWhois(domain) {
  const url = 'https://rdap.org/domain/' + encodeURIComponent(domain);
  let res;
  try {
    res = await fetchJson(url);
  } catch (e) {
    return { source: 'rdap', ok: false, error: 'RDAP 请求失败：' + String(e.message || e).slice(0, 120) };
  }

  // 404 = 注册局没有该记录，通常意味着未注册
  if (res.status === 404) {
    return { source: 'rdap', ok: true, domain, registered: false, status: [], nameservers: [] };
  }
  if (res.status === 429) {
    return { source: 'rdap', ok: false, rateLimited: true, error: 'RDAP 限流，请稍后再试' };
  }
  const d = res.data;
  if (!d || d.objectClassName !== 'domain') {
    return { source: 'rdap', ok: false, error: `RDAP 返回异常（HTTP ${res.status}）` };
  }

  const events = {};
  for (const e of d.events || []) if (e && e.eventAction) events[e.eventAction] = e.eventDate || null;

  const registrar = pickEntity(d.entities, 'registrar');
  const registrarName = vcardFn(registrar && registrar.vcardArray);
  const ianaId = (() => {
    const pid = registrar && Array.isArray(registrar.publicIds) ? registrar.publicIds : [];
    const hit = pid.find((p) => /IANA/i.test(String(p.type || '')));
    return hit ? String(hit.identifier) : null;
  })();

  const ns = (d.nameservers || [])
    .map((n) => String((n && n.ldhName) || '').toLowerCase())
    .filter(Boolean);

  return {
    source: 'rdap',
    ok: true,
    domain: String(d.ldhName || domain).toLowerCase(),
    registered: true,
    status: Array.isArray(d.status) ? d.status.map(String) : [],
    registrar: registrarName || null,
    registrarIanaId: ianaId,
    createdAt: events.registration || null,
    expiresAt: events.expiration || null,
    updatedAt: events['last changed'] || events['last update of RDAP database'] || null,
    nameservers: ns,
    registrant: null,   // GDPR 下绝大多数注册局已脱敏，不再尝试解析
    privacy: true,
  };
}

/** 自动选择数据源：DNSHE 系走 DNSHE，其余走 RDAP */
export async function lookupExternal(domain) {
  if (isDnsheDomain(domain)) {
    const r = await dnsheWhois(domain);
    // DNSHE 查不到（比如不是它管的名）时再兜一次 RDAP
    if (r.ok) return r;
    const fb = await rdapWhois(domain);
    if (fb.ok) return fb;
    return r;
  }
  return rdapWhois(domain);
}

/* ---------------- 缓存（D1） ---------------- */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function getCached(db, domain) {
  try {
    const row = await db
      .prepare('SELECT data, fetched_at FROM whois_cache WHERE domain = ?')
      .bind(domain)
      .first();
    if (!row) return null;
    if (Date.now() - Number(row.fetched_at || 0) > CACHE_TTL_MS) return null;
    const data = JSON.parse(row.data);
    return { ...data, cached: true, cachedAt: Number(row.fetched_at) };
  } catch { return null; }
}

/** 忽略过期时间的读取（上游失败时兜底展示旧数据） */
export async function getCachedAny(db, domain) {
  try {
    const row = await db
      .prepare('SELECT data, fetched_at FROM whois_cache WHERE domain = ?')
      .bind(domain)
      .first();
    if (!row) return null;
    return { ...JSON.parse(row.data), cached: true, cachedAt: Number(row.fetched_at) };
  } catch { return null; }
}

export async function setCached(db, domain, data) {
  try {
    await db
      .prepare(
        `INSERT INTO whois_cache (domain, data, fetched_at) VALUES (?,?,?)
         ON CONFLICT(domain) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`
      )
      .bind(domain, JSON.stringify(data), Date.now())
      .run();
  } catch { /* 缓存失败不影响查询 */ }
}
