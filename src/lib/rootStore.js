/**
 * 动态根域名存储
 *
 * 背景：根域名原先只能由环境变量 ROOT_DOMAINS / CF_ZONE_IDS 配置，
 * 改一次要重新部署。接入 Spaceship 后，管理员可以在后台「拉取账号下的域名 →
 * 勾选添加」，无需改环境变量。
 *
 * 做法：把动态添加的域名存进 settings 表的两行：
 *   root_domains_extra  = "foo.com,bar.net"
 *   cf_zone_ids_extra   = "foo.com:zoneId1,bar.net:zoneId2"
 * 每个请求进来时，中间件把它们合并进 c.env 的 ROOT_DOMAINS / CF_ZONE_IDS，
 * 这样 roots.ts（纯函数）与所有既有调用点一行都不用改。
 *
 * 安全性：
 *   · 仅管理员可写（调用方必须挂 requireAdmin）
 *   · 域名格式严格校验，防止注入 / 非法值污染根域名判断
 *   · 去重，幂等（重复添加不会产生重复项）
 */

import { parseRootList, parseZoneMap, normalizeDomain, listRoots } from './roots.js';

const ROOT_KEY = 'root_domains_extra';
const ZONE_KEY = 'cf_zone_ids_extra';
const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const ZONE_RE = /^[A-Za-z0-9_-]{1,64}$/;

async function readSetting(env, key) {
  try {
    const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
    return String(r?.value || '').trim();
  } catch {
    return '';
  }
}

async function writeSetting(env, key, value) {
  await env.DB.prepare(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
    .bind(key, String(value || ''))
    .run();
}

/** 读取当前动态根域名（返回解析后的数组与 zone map） */
export async function loadExtra(env) {
  const [rawRoots, rawZones] = await Promise.all([
    readSetting(env, ROOT_KEY),
    readSetting(env, ZONE_KEY),
  ]);
  return { domains: parseRootList(rawRoots), zones: parseZoneMap(rawZones), rawRoots, rawZones };
}

/**
 * 合并环境变量与动态根域名，返回新的 env 对象（不修改原对象）。
 * 若无动态配置则返回 null，调用方可跳过赋值。
 */
export async function mergeRootEnv(env) {
  const extra = await loadExtra(env);
  if (!extra.domains.length) return null;

  const baseRoots = parseRootList(env.ROOT_DOMAINS);
  const baseZones = parseZoneMap(env.CF_ZONE_IDS);

  const roots = [...baseRoots];
  for (const d of extra.domains) if (!roots.includes(d)) roots.push(d);

  const zones = { ...baseZones };
  for (const [d, z] of Object.entries(extra.zones)) if (!zones[d]) zones[d] = z;

  return {
    ...env,
    ROOT_DOMAINS: roots.join(','),
    CF_ZONE_IDS: Object.entries(zones).map(([d, z]) => `${d}:${z}`).join(','),
  };
}

/** 当前生效的全部根域名（含环境变量） */
export async function effectiveRootList(env) {
  const merged = (await mergeRootEnv(env)) || env;
  return listRoots(merged).map((r) => ({ domain: r.domain, zoneId: r.zoneId }));
}

/**
 * 添加域名（管理员操作）。
 * @param {Array<{domain:string, zoneId?:string}>} entries
 * @returns {{ added:string[], skipped:string[], invalid:string[], roots:Array }}
 */
export async function addExtraRoots(env, entries) {
  const extra = await loadExtra(env);
  const envRoots = listRoots(env).map((r) => r.domain);
  const domains = [...extra.domains];
  const zones = { ...extra.zones };
  const added = [], skipped = [], invalid = [];

  for (const e of Array.isArray(entries) ? entries : []) {
    const d = normalizeDomain(e?.domain);
    const z = String(e?.zoneId || '').trim();
    if (!DOMAIN_RE.test(d)) { invalid.push(String(e?.domain || '').slice(0, 60)); continue; }
    if (envRoots.includes(d) || domains.includes(d)) { skipped.push(d); continue; }
    if (z && !ZONE_RE.test(z)) { invalid.push(d + '（Zone ID 格式不正确）'); continue; }
    domains.push(d);
    if (z) zones[d] = z;
    added.push(d);
  }

  if (added.length) {
    await writeSetting(env, ROOT_KEY, domains.join(','));
    await writeSetting(env, ZONE_KEY, Object.entries(zones).map(([d, z]) => `${d}:${z}`).join(','));
  }
  const merged = (await mergeRootEnv(env)) || env;
  return { added, skipped, invalid, roots: listRoots(merged).map((r) => r.domain) };
}

/** 移除一个动态根域名（不触碰环境变量里的） */
export async function removeExtraRoot(env, domain) {
  const d = normalizeDomain(domain);
  const extra = await loadExtra(env);
  if (!d || !extra.domains.includes(d)) return { removed: false };
  const domains = extra.domains.filter((x) => x !== d);
  const zones = { ...extra.zones };
  delete zones[d];
  await writeSetting(env, ROOT_KEY, domains.join(','));
  await writeSetting(env, ZONE_KEY, Object.entries(zones).map(([k, v]) => `${k}:${v}`).join(','));
  return { removed: true, roots: domains };
}
