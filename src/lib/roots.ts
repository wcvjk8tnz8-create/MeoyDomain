/**
 * 多根域名支持（TypeScript）
 *
 * 配置方式：环境变量映射
 *   ROOT_DOMAINS = "meoy.top,foo.com"          —— 允许的根域名列表
 *   CF_ZONE_IDS  = "meoy.top:xxxx,foo.com:yyyy" —— 每个根域名对应的 Cloudflare Zone ID
 *   ROOT_DOMAIN  = "meoy.top"                   —— 默认根域名（缺省值，向后兼容）
 *   CF_ZONE_ID   = "xxxx"                       —— 默认 Zone（缺省值，向后兼容）
 *
 * 向后兼容：
 *   只配了 ROOT_DOMAIN / CF_ZONE_ID 而没配上面两个新变量时，
 *   行为与单根域名时代完全一致。
 *
 * 配额口径：跨根域名共享（配额 5 = 总共 5 个，不按根域名分别计）。
 *   —— 这是刻意的，避免通过多根域名绕过配额。
 */

/** 单个根域名配置 */
export interface RootConfig {
  /** 根域名，小写、无尾点，如 meoy.top */
  domain: string;
  /** 该域名对应的 Cloudflare Zone ID；空串表示未配置 */
  zoneId: string;
}

/** 从环境变量解析出根域名列表（去重、小写、去尾点、去空） */
export function parseRootList(raw: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw || '').split(',')) {
    const d = normalizeDomain(part);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

/** 域名归一化：去空白、转小写、去首尾点 */
export function normalizeDomain(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '');
}

/**
 * 解析 CF_ZONE_IDS（格式 "domain:zoneId,domain2:zoneId2"）
 * 容错：分隔符支持 `:` 与 `=`；缺少 zone 的条目会被忽略（不计入 map）。
 */
export function parseZoneMap(raw: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of String(raw || '').split(',')) {
    const seg = String(part || '').trim();
    if (!seg) continue;
    const idx = seg.search(/[:=]/);
    if (idx <= 0) continue;
    const domain = normalizeDomain(seg.slice(0, idx));
    const zone = seg.slice(idx + 1).trim();
    if (!domain || !zone) continue;
    map[domain] = zone;
  }
  return map;
}

export interface RootEnv {
  ROOT_DOMAIN?: string;
  ROOT_DOMAINS?: string;
  CF_ZONE_ID?: string;
  CF_ZONE_IDS?: string;
  [k: string]: unknown;
}

/**
 * 取得全部根域名配置。
 * 优先级：ROOT_DOMAINS + CF_ZONE_IDS → 回落 ROOT_DOMAIN + CF_ZONE_ID
 */
export function listRoots(env: RootEnv): RootConfig[] {
  const list = parseRootList(env.ROOT_DOMAINS);
  const map = parseZoneMap(env.CF_ZONE_IDS);
  const fallbackDomain = normalizeDomain(env.ROOT_DOMAIN);
  const fallbackZone = String(env.CF_ZONE_ID || '').trim();

  // 没配新变量 → 完全走旧逻辑
  if (!list.length) {
    if (!fallbackDomain) return [];
    return [{ domain: fallbackDomain, zoneId: map[fallbackDomain] || fallbackZone }];
  }

  // 配了 ROOT_DOMAINS：默认域名必须在列表里（否则旧数据找不到归属）
  if (fallbackDomain && !list.includes(fallbackDomain)) list.unshift(fallbackDomain);

  return list.map((d) => ({
    domain: d,
    zoneId: map[d] || (d === fallbackDomain ? fallbackZone : ''),
  }));
}

/** 默认根域名（新申请时使用） */
export function defaultRoot(env: RootEnv): string {
  const fb = normalizeDomain(env.ROOT_DOMAIN);
  if (fb) return fb;
  return listRoots(env)[0]?.domain || '';
}

/** 判断域名是否被允许 */
export function isAllowedRoot(env: RootEnv, domain: string): boolean {
  const d = normalizeDomain(domain);
  if (!d) return false;
  return listRoots(env).some((r) => r.domain === d);
}

/** 取某个根域名的 Zone ID（未配置返回空串） */
export function zoneIdFor(env: RootEnv, domain: string): string {
  const d = normalizeDomain(domain);
  const hit = listRoots(env).find((r) => r.domain === d);
  return hit?.zoneId || '';
}

/**
 * 从任意主机名反推它属于哪个根域名。
 * 用于 WHOIS：用户可能查 foo.meoy.top 或 bar.foo.com。
 * 未命中返回 null。
 */
export function matchRoot(env: RootEnv, host: string): RootConfig | null {
  const h = normalizeDomain(host);
  if (!h) return null;
  const roots = listRoots(env);
  // 长域名优先，避免 a.b.com 误配到 b.com 之前命中 com
  const sorted = [...roots].sort((a, b) => b.domain.length - a.domain.length);
  for (const r of sorted) {
    if (h === r.domain) return r;
    if (h.endsWith('.' + r.domain)) return r;
  }
  return null;
}

/**
 * 拆出二级部分（label）。
 * 例如 labelOf('mail.meoy.top', 'meoy.top') === 'mail'
 * 不匹配或本身就是根域名时返回空串。
 */
export function labelOf(host: string, rootDomain: string): string {
  const h = normalizeDomain(host);
  const r = normalizeDomain(rootDomain);
  if (!h || !r) return '';
  if (h === r) return '';                 // 就是根域名本身，如 @
  if (!h.endsWith('.' + r)) return '';    // 不属于该根域名
  const label = h.slice(0, h.length - r.length - 1);
  // 只允许单层（不允许 a.b.meoy.top 这种多级）
  if (!label || label.includes('.')) return '';
  return label;
}
