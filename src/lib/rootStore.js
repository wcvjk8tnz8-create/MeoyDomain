/**
 * 根域名存储 / 生效列表
 *
 * 三处来源，按优先级合并：
 *   1. 环境变量 ROOT_DOMAINS + CF_ZONE_IDS（或旧的 ROOT_DOMAIN + CF_ZONE_ID）
 *   2. 后台动态添加（Spaceship 导入）：settings.root_domains_extra / cf_zone_ids_extra
 *   3. 后台「移除」产生的屏蔽名单：settings.root_domains_disabled
 *
 * 「移除」分两种，管理员用同一个接口：
 *   · 动态添加的域名 → 直接从 extra 里删掉
 *   · 环境变量里的域名 → 环境变量改不了（需重新部署），改为写入屏蔽名单
 *     中间件合并时把它从列表里剔除；想恢复就再点一次「恢复」
 *
 * 关键陷阱：roots.ts 的 listRoots() 会把 ROOT_DOMAIN 无条件 unshift 回列表里，
 * 所以屏蔽默认根域名时必须同时改掉 ROOT_DOMAIN，否则它会被重新加回来。
 *
 * 安全性：仅管理员可写；域名格式严格校验；去重幂等；不允许删到 0 个。
 */

import { parseRootList, parseZoneMap, normalizeDomain, listRoots } from './roots.js';

const ROOT_KEY = 'root_domains_extra';
const ZONE_KEY = 'cf_zone_ids_extra';
const DISABLED_KEY = 'root_domains_disabled';
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

/** 读取后台配置（动态域名 / zone / 屏蔽名单） */
export async function loadExtra(env) {
  const [rawRoots, rawZones, rawDisabled] = await Promise.all([
    readSetting(env, ROOT_KEY),
    readSetting(env, ZONE_KEY),
    readSetting(env, DISABLED_KEY),
  ]);
  return {
    domains: parseRootList(rawRoots),
    zones: parseZoneMap(rawZones),
    disabled: parseRootList(rawDisabled),
    rawRoots, rawZones, rawDisabled,
  };
}

/** 环境变量里声明的全部根域名（含 ROOT_DOMAIN 这个 fallback） */
function envRootList(env) {
  const out = parseRootList(env.ROOT_DOMAINS);
  const fb = normalizeDomain(env.ROOT_DOMAIN);
  if (fb && !out.includes(fb)) out.push(fb);
  return out;
}

/**
 * 合并所有来源，返回新的 env 对象（不修改原对象）。
 * 无需改动时返回 null，调用方可跳过赋值（零开销）。
 */
export async function mergeRootEnv(env) {
  const extra = await loadExtra(env);
  if (!extra.domains.length && !extra.disabled.length) return null;

  const baseRoots = envRootList(env);
  const baseZones = parseZoneMap(env.CF_ZONE_IDS);
  const fb = normalizeDomain(env.ROOT_DOMAIN);
  const fbZone = String(env.CF_ZONE_ID || '').trim();
  if (fb && fbZone && !baseZones[fb]) baseZones[fb] = fbZone;

  const roots = [...baseRoots];
  for (const d of extra.domains) if (!roots.includes(d)) roots.push(d);

  const zones = { ...baseZones };
  for (const [d, z] of Object.entries(extra.zones)) if (!zones[d]) zones[d] = z;

  // 应用屏蔽名单
  const disabled = new Set(extra.disabled);
  const finalRoots = roots.filter((d) => !disabled.has(d));
  // 防御：不允许把站点搞到没有根域名（API 层也会拦，这里是兜底）
  if (!finalRoots.length) return null;

  const finalZones = Object.fromEntries(
    Object.entries(zones).filter(([d]) => !disabled.has(d))
  );

  // 默认根域名必须指向一个仍然生效的域名，否则 listRoots 会把它塞回来
  const nextDefault = finalRoots.includes(fb) ? fb : finalRoots[0];

  return {
    ...env,
    ROOT_DOMAINS: finalRoots.join(','),
    // CF_ZONE_ID 对应的是旧默认域名；换默认时同步换掉，避免 DNS 写错 Zone
    ROOT_DOMAIN: nextDefault,
    CF_ZONE_ID: finalZones[nextDefault] || '',
    CF_ZONE_IDS: Object.entries(finalZones).map(([d, z]) => `${d}:${z}`).join(','),
  };
}

/** 当前生效的全部根域名（含环境变量与后台导入） */
export async function effectiveRootList(env) {
  const merged = (await mergeRootEnv(env)) || env;
  return listRoots(merged).map((r) => ({ domain: r.domain, zoneId: r.zoneId }));
}

/**
 * 带来源的根域名清单（后台展示用）
 * @returns {{items:Array<{domain,zoneId,source,hasZone}>, disabled:string[]}}
 */
export async function rootSources(env) {
  const extra = await loadExtra(env);
  const active = await effectiveRootList(env);
  const dyn = new Set(extra.domains);
  return {
    items: active.map((r) => ({
      ...r,
      source: dyn.has(r.domain) ? 'dynamic' : 'env',
      hasZone: !!r.zoneId,
    })),
    // 被移除但可恢复（环境变量域名 + 已不在生效列表里的屏蔽项）
    disabled: extra.disabled.filter((d) => !active.some((r) => r.domain === d)),
  };
}

/**
 * 添加域名（管理员操作）。
 * @param {Array<{domain:string, zoneId?:string}>} entries
 */
export async function addExtraRoots(env, entries) {
  const extra = await loadExtra(env);
  const current = (await effectiveRootList(env)).map((r) => r.domain);
  const domains = [...extra.domains];
  const zones = { ...extra.zones };
  const disabled = [...extra.disabled];
  const added = [], skipped = [], invalid = [];

  for (const e of Array.isArray(entries) ? entries : []) {
    const d = normalizeDomain(e?.domain);
    const z = String(e?.zoneId || '').trim();
    if (!DOMAIN_RE.test(d)) { invalid.push(String(e?.domain || '').slice(0, 60)); continue; }
    if (current.includes(d) || domains.includes(d)) { skipped.push(d); continue; }
    if (z && !ZONE_RE.test(z)) { invalid.push(d + '（Zone ID 格式不正确）'); continue; }
    domains.push(d);
    if (z) zones[d] = z;
    added.push(d);
  }

  if (added.length) {
    // 重新添加同名域名时，顺便把它从屏蔽名单里摘掉，否则加了也不生效
    const nextDisabled = disabled.filter((d) => !added.includes(d));
    await writeSetting(env, ROOT_KEY, domains.join(','));
    await writeSetting(env, ZONE_KEY, Object.entries(zones).map(([d, z]) => `${d}:${z}`).join(','));
    await writeSetting(env, DISABLED_KEY, nextDisabled.join(','));
  }
  return {
    added, skipped, invalid,
    roots: (await effectiveRootList(env)).map((r) => r.domain),
  };
}

/**
 * 移除一个根域名（管理员操作，统一入口）。
 * 动态导入的 → 物理删除；环境变量的 → 加入屏蔽名单。
 * 不允许删到 0 个。
 */
export async function removeRoot(env, domain) {
  const d = normalizeDomain(domain);
  if (!d || !DOMAIN_RE.test(d)) return { removed: false, reason: '域名格式不正确' };

  const extra = await loadExtra(env);
  const active = (await effectiveRootList(env)).map((r) => r.domain);
  if (!active.includes(d)) return { removed: false, reason: '该根域名不存在或已被移除' };
  if (active.length <= 1) {
    return { removed: false, reason: '至少要保留一个根域名；如要全面停止，请使用「暂停新域名申请」' };
  }

  if (extra.domains.includes(d)) {
    // 动态导入：真删除，同时清掉它的 zone
    const domains = extra.domains.filter((x) => x !== d);
    const zones = { ...extra.zones };
    delete zones[d];
    await writeSetting(env, ROOT_KEY, domains.join(','));
    await writeSetting(env, ZONE_KEY, Object.entries(zones).map(([k, v]) => `${k}:${v}`).join(','));
  } else {
    // 环境变量：加入屏蔽名单（无需重新部署）
    const disabled = [...extra.disabled];
    if (!disabled.includes(d)) disabled.push(d);
    await writeSetting(env, DISABLED_KEY, disabled.join(','));
  }

  return {
    removed: true,
    mode: extra.domains.includes(d) ? 'deleted' : 'disabled',
    roots: (await effectiveRootList(env)).map((r) => r.domain),
  };
}

/** 恢复一个被屏蔽的根域名（仅对环境变量域名有意义） */
export async function restoreRoot(env, domain) {
  const d = normalizeDomain(domain);
  const extra = await loadExtra(env);
  if (!d || !extra.disabled.includes(d)) return { restored: false };
  await writeSetting(env, DISABLED_KEY, extra.disabled.filter((x) => x !== d).join(','));
  return {
    restored: true,
    roots: (await effectiveRootList(env)).map((r) => r.domain),
  };
}

/** 兼容旧调用：移除动态导入的根域名 */
export async function removeExtraRoot(env, domain) {
  return removeRoot(env, domain);
}
