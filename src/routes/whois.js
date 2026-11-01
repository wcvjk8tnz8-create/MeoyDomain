import { Hono } from 'hono';
import { ok, fail } from '../lib/util.js';
import { lookupLabel } from './subdomains.js';
import { UNLIMITED_POINTS, ensurePoints, domainCost } from '../lib/points.js';
import { pointRules } from './points.js';
import { lookupExternal, isValidDomain, isDnsheDomain, getCached, getCachedAny, setCached } from '../lib/whoisExt.js';

const app = new Hono();

const STATUS_TEXT = {
  pending: '审核中',
  approved: '已注册',
  rejected: '已驳回',
  suspended: '已停用',
  reserved: '系统保留',
  available: '可注册',
};

/** 邮箱脱敏：ab***@gmail.com */
function maskEmail(e) {
  const s = String(e || '');
  const at = s.indexOf('@');
  if (at < 1) return '***';
  const name = s.slice(0, at);
  const keep = Math.min(2, name.length);
  return name.slice(0, keep) + '***' + s.slice(at);
}

/** whois_holder: masked（默认，脱敏）| none（不显示）| full（完整，需谨慎） */
async function holderMode(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'whois_holder'").first();
  const v = String(row?.value || 'masked').toLowerCase();
  return ['masked', 'none', 'full'].includes(v) ? v : 'masked';
}

/**
 * WHOIS 查询：公开接口，任何人都可查询某个子域名的注册状态。
 * 用法： /api/whois?name=me   或  /api/whois?name=me.meoy.top
 */
app.get('/whois', async (c) => {
  const raw = String(c.req.query('name') || c.req.query('q') || c.req.query('fqdn') || '').trim().toLowerCase();
  if (!raw) return fail(c, '请输入要查询的域名');

  const root = String(c.env.ROOT_DOMAIN || '').toLowerCase().replace(/\.+$/, '');

  // 归一化：允许写完整域名或只写标签
  let label = raw.replace(/\.+$/, '');
  if (label.endsWith('.' + root)) label = label.slice(0, -(root.length + 1));

  // 仍带点 → 外部域名（可查任意域名，含 DNSHE / .com 等）
  if (label.includes('.')) return externalWhois(c, label, root);

  const r = await lookupLabel(c, label);
  if (!r.ok) return ok(c, { found: false, query: raw, label, fqdn: `${label}.${root}`, available: false, statusText: r.message, message: r.message });

  const u = c.get('user');
  const isAdmin = !!(u && u.role === 'admin');
  const isMine = !!(u && r.row && r.row.user_id === u.id);

  // 持有人可见性
  const mode = await holderMode(c.env);
  let holder = null;
  if (r.row && r.row.holder_email) {
    if (isAdmin || isMine) holder = r.row.holder_email;
    else if (mode === 'full') holder = r.row.holder_email;
    else if (mode === 'masked') holder = maskEmail(r.row.holder_email);
  }

  return ok(c, {
    query: raw,
    label,
    fqdn: r.fqdn,
    found: !!r.exists,
    exists: !!r.exists,
    available: r.available,
    status: r.status,
    statusText: STATUS_TEXT[r.status] || r.status,
    message: r.message,
    registeredAt: r.row?.created_at || null,
    recordCount: r.row?.record_count || 0,
    reason: r.row?.reason || '',
    holder,
    mine: isMine,
    canApply: r.available,
    reclaimable: !!r.reclaimable,
    rootDomain: root,
    ...(await (async () => {
      // 未登录时给出价格，登录后附带自己的余额
      const rules = await pointRules(c.env);
      const { cost, short } = domainCost(
        label,
        { domainCost: rules.domainCost, shortCost: rules.shortCost, shortLen: rules.shortLen },
        isAdmin
      );
      const pts = u && !isAdmin ? await ensurePoints(c.env.DB, u.id, rules) : null;
      return {
        cost: isAdmin ? 0 : cost,
        short,
        points: pts === null ? null : pts,
        unlimited: isAdmin,
        enough: isAdmin || pts === null || pts < 0 || pts >= cost,
        needLogin: !u,
      };
    })()),
  });
});

/* ---------------- 外部域名（可查任意域名） ---------------- */
async function externalWhois(c, domain, root) {
  if (!isValidDomain(domain)) return fail(c, '域名格式不正确');

  const dnshe = isDnsheDomain(domain);
  const cacheKey = domain;

  // 命中缓存直接返回（限流时的救命稻草）
  const hit = await getCached(c.env.DB, cacheKey);
  if (hit) {
    return ok(c, {
      external: true,
      source: hit.source || (dnshe ? 'dnshe' : 'rdap'),
      query: domain,
      domain,
      rootDomain: root,
      ...hit,
      externalLinks: externalLinks(domain),
    });
  }

  const r = await lookupExternal(domain, c.env);
  if (!r.ok) {
    // 上游失败时，若有过期缓存也先用着
    const stale = await getCachedAny(c.env.DB, cacheKey);
    return ok(c, {
      external: true,
      source: r.source,
      query: domain,
      domain,
      rootDomain: root,
      registered: null,
      error: r.error,
      rateLimited: !!r.rateLimited,
      stale: stale || null,
      externalLinks: externalLinks(domain),
    });
  }

  await setCached(c.env.DB, cacheKey, r);
  return ok(c, {
    external: true,
    source: r.source,
    query: domain,
    domain,
    rootDomain: root,
    ...r,
    externalLinks: externalLinks(domain),
  });
}

/** 第三方查询站直达链接 */
function externalLinks(domain) {
  const d = encodeURIComponent(domain);
  return [
    { name: 'whois.com', url: `https://www.whois.com/whois/${d}` },
    { name: 'whois.dnshe.com', url: `https://whois.dnshe.com/?domain=${d}` },
    { name: 'ICANN Lookup', url: `https://lookup.icann.org/en/lookup?name=${d}` },
  ];
}

export default app;
