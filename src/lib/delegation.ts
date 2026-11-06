// ============================================================
//  NS 委派（把子域名托管到第三方 DNS 服务商）
//  原理：在父区域（根域名）写入 NS 记录，把 xxx.meoy.top 的解析权交给服务商
// ============================================================

/**
 * 服务商预设。
 *  - ns       已知的默认 NS 列表（未走 API 时使用）
 *  - api      有公开 REST API 的服务商，可自动创建 zone 并取回官方 NS
 *  - panel    控制台地址（用于「去服务商完成剩余步骤」）
 * 新增服务商只需往这里加一项。
 */
export const DELEGATION_PROVIDERS = [
  {
    key: 'anyns',
    name: 'anyns.io',
    desc: 'n.ht 社区的免费权威 DNS，25 个 anycast 节点，支持分线解析 / DDNS / ACME',
    ns: ['ns1.anyns.io', 'ns2.anyns.io'],
    nsAlt: ['ns3.anyns.io', 'ns4.anyns.io'],
    panel: 'https://anyns.io/panel',
    addPath: '/panel/zone/add',
    // anyns.io 未公开稳定的 REST API 端点，故不做自动创建，只做委派 + 指引
    api: null,
    note: 'anyns.io 未公开稳定的 REST API，托管后请到其面板手动添加该域名（会自动识别已有委派）。',
  },
  {
    key: 'dnshe',
    name: 'DNSHE',
    desc: '免费域名注册 + DNS 解析（托管服务 dnshe.org），Global Anycast，开放 REST API',
    // 托管服务主域是 dnshe.org；在其注册分发的后缀才是 .com。
    // NS 与 API 是官方技术端点，仍沿用 .com，改掉会直接调不通。
    ns: ['ns1.dnshe.com', 'ns2.dnshe.com'],
    panel: 'https://my.dnshe.org',
    addPath: '',
    api: {
      // 官方 DNS API：https://api005.dnshe.com/index.php?m=dns&api_route=/v1/...
      base: 'https://api005.dnshe.com/index.php?m=dns&api_route=',
      authHeader: 'Authorization',
      createZone: { method: 'POST', path: '/v1/zones', bodyKey: 'zone_name' },
      // 官方提醒：不要硬编码 NS，要用 API 返回的 nameservers
      nsFromResponse: (data) => {
        const z = data?.zone || data?.data?.zone || data;
        const list = z?.nameservers || z?.ns || z?.name_servers || z?.nameserver;
        if (Array.isArray(list)) return list.map(String).filter(Boolean);
        if (typeof list === 'string') return list.split(/[,\s]+/).filter(Boolean);
        return [];
      },
      delegationCheck: { method: 'GET', path: '/v1/zones/{id}/delegation' },
    },
    note: '填写 DNSHE 的 API Token 可自动创建解析区域并取回官方 NS；不填则用默认 NS 并自行到面板添加。',
  },
  {
    key: 'cloudflare',
    name: 'Cloudflare',
    desc: '把子域名交给 Cloudflare 全权解析（需在 CF 添加站点后取得分配的两个 NS）',
    ns: [],
    panel: 'https://dash.cloudflare.com',
    addPath: '',
    api: null,
    requireCustomNs: true,
    note: 'Cloudflare 为每个站点分配专属 NS（xxx.ns.cloudflare.com），请在下方自定义 NS 里填写你在 CF 看到的地址。',
  },
  {
    key: 'custom',
    name: '自定义 NS',
    desc: '任意第三方 DNS 服务商',
    ns: [],
    panel: '',
    addPath: '',
    api: null,
    requireCustomNs: true,
    note: '每行一个 NS 主机名，至少 2 个。',
  },
];

export function findProvider(key) {
  return DELEGATION_PROVIDERS.find((p) => p.key === key) || null;
}

/** 归一化 NS 主机名：去根点、小写、去重 */
export function normalizeNs(list) {
  const out = [];
  for (const raw of list || []) {
    let s = String(raw || '').trim().toLowerCase().replace(/\.+$/, '');
    if (!s) continue;
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** 调 DNSHE API 创建 zone，返回 { ok, ns, zoneId, raw, error } */
async function dnsheCreateZone(provider, token, zoneName) {
  const cfg = provider.api;
  const url = cfg.base + cfg.createZone.path;
  const body = { [cfg.createZone.bodyKey]: zoneName };
  try {
    const r = await fetch(url, {
      method: cfg.createZone.method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) {
      const msg =
        data?.error?.message || data?.message || data?.detail || (typeof data?.error === 'string' ? data.error : '') ||
        `HTTP ${r.status}`;
      return { ok: false, error: `DNSHE 返回 ${r.status}：${String(msg).slice(0, 200)}` };
    }
    const zone = data?.zone || data?.data?.zone || data;
    const ns = normalizeNs(cfg.nsFromResponse(data));
    return {
      ok: true,
      ns,
      zoneId: zone?.id != null ? String(zone.id) : '',
      raw: data,
    };
  } catch (e) {
    return { ok: false, error: `调用 DNSHE 失败：${String(e.message || e).slice(0, 200)}` };
  }
}

/** 查询 DNSHE 委派检查结果 */
async function dnsheDelegation(provider, token, zoneId) {
  const cfg = provider.api;
  if (!zoneId || !cfg.delegationCheck) return { ok: false, error: '缺少 zone id' };
  const url = cfg.base + cfg.delegationCheck.path.replace('{id}', zoneId);
  try {
    const r = await fetch(url, {
      method: cfg.delegationCheck.method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
    if (!r.ok) return { ok: false, error: `DNSHE 返回 ${r.status}`, raw: data };
    return { ok: true, raw: data };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
}

/**
 * 在服务商处创建解析区域（若支持 API 且提供了 token）。
 * 不抛异常，失败时返回 error 由调用方决定如何提示。
 */
export async function createZoneAtProvider(provider, token, zoneName) {
  if (!provider || !provider.api) return { ok: false, skipped: true };
  if (!token) return { ok: false, skipped: true, error: '未提供 API Token' };
  if (provider.key === 'dnshe') return dnsheCreateZone(provider, token, zoneName);
  return { ok: false, skipped: true };
}

export async function checkDelegationAtProvider(provider, token, zoneId) {
  if (!provider || !provider.api || !token) return { ok: false, error: '该服务商不支持委派检查' };
  if (provider.key === 'dnshe') return dnsheDelegation(provider, token, zoneId);
  return { ok: false, error: '该服务商不支持委派检查' };
}

/** 解析出最终使用的 NS 列表 */
export function resolveNs(provider, customNs, apiNs) {
  if (Array.isArray(apiNs) && apiNs.length) return normalizeNs(apiNs);
  const custom = normalizeNs(customNs);
  if (custom.length) return custom;
  return normalizeNs(provider?.ns || []);
}
