import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';
import { cfDelete, cfErrorMessage } from '../lib/cf.js';
import { UNLIMITED } from '../middleware/auth.js';
import { ensurePoints, addPoints } from '../lib/points.js';
import { pointRules } from './points.js';
import { expiryRules, computeExpiry, expiryState, renewExpiry, ensureExpiryColumns, migrateLegacyPerpetual } from '../lib/expiry.js';
import { clearDnsProviderCache, dnsProvider } from '../lib/cf.js';

const app = new Hono();

// 概览统计
app.get('/stats', async (c) => {
  const q = async (sql, ...b) => (await c.env.DB.prepare(sql).bind(...b).first()) || {};
  const [users, subs, pending, recs, locked] = await Promise.all([
    q('SELECT COUNT(*) AS n FROM users'),
    q("SELECT COUNT(*) AS n FROM subdomains WHERE status = 'approved'"),
    q("SELECT COUNT(*) AS n FROM subdomains WHERE status = 'pending'"),
    q('SELECT COUNT(*) AS n FROM dns_records'),
    q('SELECT COUNT(*) AS n FROM dns_records WHERE verify_lock = 1'),
  ]);
  return ok(c, {
    users: users.n || 0,
    subdomains: subs.n || 0,
    pending: pending.n || 0,
    records: recs.n || 0,
    locked: locked.n || 0,
    rootDomain: c.env.ROOT_DOMAIN,
    mock: c.env.CF_MOCK === '1',
  });
});

// 子域名列表（可按状态过滤）
app.get('/subdomains', async (c) => {
  const status = c.req.query('status') || '';
  const sql =
    `SELECT s.*, u.email AS owner_email, (SELECT COUNT(*) FROM dns_records r WHERE r.subdomain_id = s.id) AS record_count
     FROM subdomains s JOIN users u ON u.id = s.user_id
     ${status ? 'WHERE s.status = ?' : ''}
     ORDER BY s.created_at DESC LIMIT 500`;
  const stmt = status ? c.env.DB.prepare(sql).bind(status) : c.env.DB.prepare(sql);
  const { results } = await stmt.all();
  return ok(c, { items: results });
});

// 审核：通过 / 驳回 / 停用 / 恢复
async function review(c, id, status, reason) {
  await ensureExpiryColumns(c.env);
  const sub = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(id).first();
  if (!sub) return fail(c, '子域名不存在', 404);
  const u = c.get('user');
  let extra = '';

  // 批准 → 设置 1 年有效期（永久域名除外）
  if (status === 'approved') {
    const rules = await expiryRules(c.env);
    const exp = Number(sub.perpetual) === 1
      ? null
      : computeExpiry({ perpetual: false, validDays: rules.validDays });
    await c.env.DB.prepare(
      'UPDATE subdomains SET status = ?, reason = ?, expires_at = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?'
    )
      .bind(status, reason || null, exp, now(), u.id, now(), id)
      .run();
    if (exp) extra = `有效期 ${rules.validDays} 天`;

    /* 单域名队列：同一用户短时间内提交多个申请时，只批准这一个，
       其余 pending 自动驳回（防止并发/绕过导致一人占多个待审名额）。 */
    const others = await c.env.DB
      .prepare("SELECT id, fqdn FROM subdomains WHERE user_id = ? AND status = 'pending' AND id <> ?")
      .bind(sub.user_id, id)
      .all();
    const list = others.results || [];
    if (list.length) {
      const msg = '同一时间只能有一个待审核申请，其余已自动驳回';
      for (const o of list) {
        await c.env.DB.prepare(
          "UPDATE subdomains SET status = 'rejected', reason = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?"
        )
          .bind(msg, now(), u.id, now(), o.id)
          .run();
        await audit(c, u.id, 'subdomain.rejected', o.fqdn, msg);
      }
      extra += (extra ? ' · ' : '') + `自动驳回同批 ${list.length} 个申请`;
    }
  } else {
    await c.env.DB.prepare(
      'UPDATE subdomains SET status = ?, reason = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?'
    )
      .bind(status, reason || null, now(), u.id, now(), id)
      .run();
  }

  await audit(c, u.id, `subdomain.${status}`, sub.fqdn, [reason, extra].filter(Boolean).join(' · '));
  return ok(c, { status, extra });
}

app.post('/subdomains/:id/approve', async (c) => review(c, Number(c.req.param('id')), 'approved', ''));
app.post('/subdomains/:id/reject', async (c) => {
  const { reason } = await c.req.json().catch(() => ({}));
  return review(c, Number(c.req.param('id')), 'rejected', String(reason || '').slice(0, 200) || '不符合使用规范');
});
app.post('/subdomains/:id/suspend', async (c) => {
  const { reason } = await c.req.json().catch(() => ({}));
  return review(c, Number(c.req.param('id')), 'suspended', String(reason || '').slice(0, 200) || '违规使用');
});
app.post('/subdomains/:id/restore', async (c) => review(c, Number(c.req.param('id')), 'approved', ''));

// 管理员直接删除子域名（连带清空 DNS）
app.delete('/subdomains/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const sub = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(id).first();
  if (!sub) return fail(c, '子域名不存在', 404);
  const recs = await c.env.DB.prepare('SELECT * FROM dns_records WHERE subdomain_id = ?').bind(id).all();
  for (const r of recs.results) if (r.cf_record_id) await cfDelete(c.env, r.cf_record_id);
  await c.env.DB.prepare('DELETE FROM dns_records WHERE subdomain_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM subdomains WHERE id = ?').bind(id).run();
  await audit(c, u.id, 'admin.subdomain.delete', sub.fqdn);
  return ok(c, {});
});

// 用户列表
app.get('/users', async (c) => {
  await ensureExpiryColumns(c.env);
  await migrateLegacyPerpetual(c.env);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.status, u.quota, u.ban_reason, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM subdomains s WHERE s.user_id = u.id AND s.status <> 'rejected') AS sub_count,
            (SELECT COUNT(*) FROM subdomains s WHERE s.user_id = u.id AND s.status = 'rejected') AS rejected_count,
            (SELECT points FROM user_points p WHERE p.user_id = u.id) AS points
     FROM users u ORDER BY u.created_at DESC LIMIT 500`
  ).all();
  const items = results.map((r) => ({
    ...r,
    quotaUnlimited: r.role === 'admin' || Number(r.quota) < 0,
    points: r.role === 'admin' ? -1 : (r.points ?? null),
  }));
  return ok(c, { items });
});

// 调整用户积分（delta 为增减，或设置 setPoints；-1 表示无限）
app.post('/users/:id/points', async (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  const { delta, set: setValue, reason } = await c.req.json().catch(() => ({}));

  const target = await c.env.DB.prepare('SELECT id, email, role FROM users WHERE id = ?').bind(id).first();
  if (!target) return fail(c, '用户不存在', 404);
  if (target.role === 'admin') return fail(c, '管理员积分不限，无需调整');

  const rules = await pointRules(c.env);
  let after;
  if (setValue !== undefined && setValue !== null && setValue !== '') {
    const n = Number(setValue);
    if (!Number.isFinite(n) && n !== -1) return fail(c, '积分数值不合法');
    const cur = await ensurePoints(c.env.DB, id, rules);
    after = await addPoints(c.env.DB, id, n - cur, 'admin_set', String(reason || '管理员设置'));
  } else {
    const d = Number(delta);
    if (!Number.isFinite(d)) return fail(c, '请提供 delta 或 set');
    await ensurePoints(c.env.DB, id, rules);
    after = await addPoints(c.env.DB, id, Math.trunc(d), 'admin_adjust', String(reason || '管理员调整'));
  }
  await audit(c, me.id, 'admin.points', target.email, `调整为 ${after}`);
  return ok(c, { points: after });
});

// 封禁 / 解封
app.post('/users/:id/ban', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const { reason, purgeDns } = await c.req.json().catch(() => ({}));
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!target) return fail(c, '用户不存在', 404);
  if (target.role === 'admin') return fail(c, '不能封禁管理员');

  await c.env.DB.prepare('UPDATE users SET status = ?, ban_reason = ? WHERE id = ?')
    .bind('banned', String(reason || '违规使用').slice(0, 300), id)
    .run();
  // 踢下线
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  // 停用其全部子域名
  await c.env.DB.prepare("UPDATE subdomains SET status = 'suspended', reason = ?, updated_at = ? WHERE user_id = ?")
    .bind(String(reason || '账号已封禁').slice(0, 200), now(), id)
    .run();

  let purged = 0;
  if (purgeDns) {
    const subs = await c.env.DB.prepare('SELECT id FROM subdomains WHERE user_id = ?').bind(id).all();
    for (const s of subs.results) {
      const recs = await c.env.DB.prepare('SELECT * FROM dns_records WHERE subdomain_id = ?').bind(s.id).all();
      for (const r of recs.results) {
        if (r.cf_record_id) {
          const res = await cfDelete(c.env, r.cf_record_id);
          if (!res.ok) continue;
        }
        purged++;
      }
      await c.env.DB.prepare('DELETE FROM dns_records WHERE subdomain_id = ?').bind(s.id).run();
    }
  }
  await audit(c, u.id, 'user.ban', target.email, `${reason || ''}｜清空DNS:${purged}`);
  return ok(c, { purged });
});

app.post('/users/:id/unban', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare("UPDATE users SET status = 'active', ban_reason = NULL WHERE id = ?").bind(id).run();
  await c.env.DB.prepare(
    "UPDATE subdomains SET status = 'approved', reason = NULL, updated_at = ? WHERE user_id = ? AND status = 'suspended'"
  )
    .bind(now(), id)
    .run();
  await audit(c, u.id, 'user.unban', String(id));
  return ok(c, {});
});

// 调整配额 / 提权
app.post('/users/:id/quota', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const { quota, role } = await c.req.json().catch(() => ({}));
  if (quota !== undefined) {
    const q = Number(quota);
    // -1 表示不限量
    if (!Number.isFinite(q) || q < -1 || q > 500) return fail(c, '配额需在 -1（不限）到 500 之间');
    await c.env.DB.prepare('UPDATE users SET quota = ? WHERE id = ?').bind(q === -1 ? -1 : Math.floor(q), id).run();
  }
  if (role !== undefined) {
    if (!['user', 'admin'].includes(role)) return fail(c, '角色不合法');
    await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id).run();
    // 提为管理员时自动给不限量；降为普通用户时若原本是不限量，恢复默认配额
    if (role === 'admin') {
      await c.env.DB.prepare('UPDATE users SET quota = ? WHERE id = ?').bind(UNLIMITED, id).run();
    } else {
      const cur = await c.env.DB.prepare('SELECT quota FROM users WHERE id = ?').bind(id).first();
      if (cur && Number(cur.quota) < 0) {
        await c.env.DB.prepare('UPDATE users SET quota = ? WHERE id = ?')
          .bind(Number(c.env.DEFAULT_QUOTA || 5), id)
          .run();
      }
    }
  }
  await audit(c, u.id, 'user.update', String(id), `quota=${quota} role=${role}`);
  return ok(c, {});
});

// 全部处于锁定状态的验证记录
app.get('/locks', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, s.fqdn, s.status AS sub_status, u.email AS owner_email
     FROM dns_records r
     JOIN subdomains s ON s.id = r.subdomain_id
     JOIN users u ON u.id = r.locked_by
     WHERE r.verify_lock = 1 ORDER BY r.locked_at DESC`
  ).all();
  return ok(c, { items: results });
});

// 审计日志
app.get('/audit', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC LIMIT 200`
  ).all();
  return ok(c, { items: results });
});

// 手动对账：从 Cloudflare 拉取某子域名的记录，清理本地孤儿记录
app.post('/reconcile/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const sub = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(id).first();
  if (!sub) return fail(c, '子域名不存在', 404);
  const errs = [];
  const recs = await c.env.DB.prepare('SELECT * FROM dns_records WHERE subdomain_id = ?').bind(id).all();
  for (const r of recs.results) {
    if (!r.cf_record_id) {
      await c.env.DB.prepare('DELETE FROM dns_records WHERE id = ?').bind(r.id).run();
      errs.push(`${r.name} 缺少 Cloudflare ID，已清理本地记录`);
    }
  }
  await audit(c, u.id, 'admin.reconcile', sub.fqdn, errs.join(' | '));
  return ok(c, { warnings: errs });
});

// 按 IP 聚合账号（用于发现同一网络下的批量注册）
app.get('/ips', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.ip AS ip,
            COUNT(DISTINCT r.user_id) AS accounts,
            MAX(r.created_at) AS last_at,
            GROUP_CONCAT(DISTINCT u.email) AS emails,
            SUM(CASE WHEN u.status = 'banned' THEN 1 ELSE 0 END) AS banned_count
     FROM registrations r LEFT JOIN users u ON u.id = r.user_id
     WHERE r.ip IS NOT NULL AND r.ip <> ''
     GROUP BY r.ip
     ORDER BY accounts DESC, last_at DESC LIMIT 300`
  ).all();
  const limitRow = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'max_accounts_per_ip'").first();
  const bannedIps = await c.env.DB.prepare('SELECT ip, reason FROM ip_bans').all();
  const bannedMap = Object.fromEntries((bannedIps.results || []).map((b) => [b.ip, b.reason]));
  return ok(c, {
    items: results.map((r) => ({
      ...r,
      emails: r.emails || '',
      overLimit: r.accounts > Number(limitRow?.value || 2),
      ipBanned: bannedMap[r.ip] !== undefined,
      ipBanReason: bannedMap[r.ip] || '',
    })),
    limit: Number(limitRow?.value || 2),
  });
});

// 一键封禁：该 IP 下的全部账号（并可选加入 IP 封禁名单）
app.post('/ips/ban', async (c) => {
  const u = c.get('user');
  const { ip, reason, banIp, purgeDns } = await c.req.json().catch(() => ({}));
  const target = String(ip || '').trim();
  if (!target) return fail(c, '缺少 IP');

  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT r.user_id AS id, u.email FROM registrations r
     JOIN users u ON u.id = r.user_id WHERE r.ip = ? AND u.role <> 'admin'`
  )
    .bind(target)
    .all();

  const list = rows.results || [];
  if (!list.length) return fail(c, '该 IP 下没有可封禁的账号');

  const why = String(reason || '').trim() || `同一 IP 注册账号超限（${list.length} 个）`;
  let purged = 0;

  for (const row of list) {
    await c.env.DB.prepare("UPDATE users SET status = 'banned', ban_reason = ? WHERE id = ?")
      .bind(why, row.id)
      .run();
    // 踢下线
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id).run();
    // 停用其全部子域名
    await c.env.DB.prepare("UPDATE subdomains SET status = 'suspended', reason = ? WHERE user_id = ?")
      .bind(why, row.id)
      .run();

    if (purgeDns) {
      const recs = await c.env.DB.prepare(
        `SELECT r.id, r.cf_record_id FROM dns_records r
         JOIN subdomains s ON s.id = r.subdomain_id WHERE s.user_id = ?`
      )
        .bind(row.id)
        .all();
      for (const r of recs.results || []) {
        await cfDelete(c.env, r.cf_record_id);
        await c.env.DB.prepare('DELETE FROM dns_records WHERE id = ?').bind(r.id).run();
        purged++;
      }
    }
    await audit(c, row.id, 'user.ban', row.email, why);
  }

  if (banIp !== false) {
    await c.env.DB.prepare(
      'INSERT INTO ip_bans (ip, reason, created_by, created_at) VALUES (?,?,?,?) ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason'
    )
      .bind(target, why, u.id, now())
      .run();
  }

  await audit(c, u.id, 'admin.ip_ban', target, `封禁 ${list.length} 个账号 · ${why}${purgeDns ? ` · 清空 ${purged} 条 DNS` : ''}`);
  return ok(c, { banned: list.length, emails: list.map((x) => x.email), purged });
});

// 解除 IP 封禁
app.post('/ips/unban', async (c) => {
  const u = c.get('user');
  const { ip } = await c.req.json().catch(() => ({}));
  const target = String(ip || '').trim();
  if (!target) return fail(c, '缺少 IP');
  await c.env.DB.prepare('DELETE FROM ip_bans WHERE ip = ?').bind(target).run();
  await audit(c, u.id, 'admin.ip_unban', target, '');
  return ok(c, {});
});

// 站点设置：站点名 / Logo / 公告
app.get('/settings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT key, value FROM settings').all();
  const raw = Object.fromEntries(results.map((r) => [r.key, r.value]));

  // 敏感项：不回传明文，只回传「是否已配置 + 尾号」，前端显示为占位符
  const SENSITIVE = ['dnshe_api_key', 'dnshe_api_secret', 'dns_api_key', 'dns_api_secret'];
  const items = { ...raw };
  for (const k of SENSITIVE) delete items[k];

  const mask = (v) => {
    const s = String(v || '');
    if (!s) return '';
    return '••••••••' + s.slice(-4);
  };

  // 自定义 DNS 提供商状态（URL 可回显，Key/Secret 只给掩码）
  const prov = await dnsProvider(c.env);
  const envDnsUrl = String(c.env.DNS_API_URL || '').trim();
  const envDnsKey = String(c.env.DNS_API_KEY || '').trim();
  const envDnsSecret = String(c.env.DNS_API_SECRET || '').trim();
  const envKey = String(c.env.DNSHE_API_KEY || '').trim();
  const envSecret = String(c.env.DNSHE_API_SECRET || '').trim();
  return ok(c, {
    items,
    dnsProvider: {
      custom: prov.custom,
      url: prov.custom ? prov.base : '',
      fromEnv: !!envDnsUrl,
      keySet: !!(raw.dns_api_key || envDnsKey),
      secretSet: !!(raw.dns_api_secret || envDnsSecret),
      keyMasked: mask(raw.dns_api_key || envDnsKey),
      secretMasked: mask(raw.dns_api_secret || envDnsSecret),
    },
    secrets: {
      dnsheApiKeySet: !!(raw.dnshe_api_key || envKey),
      dnsheApiSecretSet: !!(raw.dnshe_api_secret || envSecret),
      dnsheApiKeyMasked: mask(raw.dnshe_api_key || envKey),
      dnsheApiSecretMasked: mask(raw.dnshe_api_secret || envSecret),
      fromEnv: !!(envKey && envSecret),   // 来自环境变量时后台不可改
      expiry: await expiryRules(c.env),
    },
  });
});

app.post('/settings', async (c) => {
  const u = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const set = async (k, v) => {
    if (v === undefined) return;
    await c.env.DB.prepare(
      'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
      .bind(k, String(v))
      .run();
  };
  const name = String(body.siteName ?? '').trim().slice(0, 40);
  const logo = String(body.logoUrl ?? '').trim().slice(0, 500);
  const favicon = String(body.faviconUrl ?? '').trim().slice(0, 500);
  const anno = String(body.announcement ?? '').trim().slice(0, 300);

  if (name) await set('site_name', name);
  await set('logo_url', logo || '/img/logo.jpg');
  await set('favicon_url', favicon || '/favicon.ico');
  if (body.announcement !== undefined) await set('announcement', anno);

  // 同 IP 账号上限
  if (body.maxAccountsPerIp !== undefined && body.maxAccountsPerIp !== '') {
    const n = Number(body.maxAccountsPerIp);
    if (!Number.isFinite(n) || n < 1 || n > 50) return fail(c, '单 IP 账号数需在 1-50 之间');
    await set('max_accounts_per_ip', String(Math.floor(n)));
  }

  // 域名有效期规则
  if (body.domainValidDays !== undefined) await set('domain_valid_days', String(body.domainValidDays || '').trim());
  if (body.renewWindowDays !== undefined) await set('renew_window_days', String(body.renewWindowDays || '').trim());

  // 自定义 DNS 提供商（填了 URL 就走它，可突破 Cloudflare 200 条记录限制；留空用 Cloudflare）
  if (body.dnsApiUrl !== undefined) {
    await set('dns_api_url', String(body.dnsApiUrl || '').trim());
    clearDnsProviderCache();   // 清缓存，立即生效
  }
  if (body.dnsApiKey !== undefined) await set('dns_api_key', String(body.dnsApiKey || '').trim());
  if (body.dnsApiSecret !== undefined) await set('dns_api_secret', String(body.dnsApiSecret || '').trim());

  // DNSHE API 凭证（用于查询 DNSHE 系域名；留空则退回公开模式）
  if (body.dnsheApiKey !== undefined) await set('dnshe_api_key', String(body.dnsheApiKey || '').trim());
  if (body.dnsheApiSecret !== undefined) await set('dnshe_api_secret', String(body.dnsheApiSecret || '').trim());

  // 积分规则
  const numRule = async (key, val, min, max, label) => {
    if (val === undefined || val === '') return true;
    const n = Number(val);
    if (!Number.isFinite(n) || n < min || n > max) {
      c.__ruleErr = `${label}需在 ${min}-${max} 之间`;
      return false;
    }
    await set(key, String(Math.floor(n)));
    return true;
  };
  if (!(await numRule('checkin_points', body.checkinPoints, 0, 1000, '每日签到积分'))) return fail(c, c.__ruleErr);
  if (!(await numRule('domain_cost', body.domainCost, 0, 10000, '域名消耗积分'))) return fail(c, c.__ruleErr);
  if (!(await numRule('short_domain_cost', body.shortDomainCost, 0, 100000, '单字域名消耗积分'))) return fail(c, c.__ruleErr);
  if (!(await numRule('short_domain_len', body.shortDomainLen, 1, 10, '单字域名长度上限'))) return fail(c, c.__ruleErr);
  if (!(await numRule('initial_points', body.initialPoints, 0, 10000, '新用户初始积分'))) return fail(c, c.__ruleErr);

  // WHOIS 持有人显示策略
  if (body.whoisHolder !== undefined) {
    const m = String(body.whoisHolder).toLowerCase();
    if (!['masked', 'none', 'full'].includes(m)) return fail(c, 'WHOIS 显示方式不合法');
    await set('whois_holder', m);
  }

  await audit(c, u.id, 'admin.settings', 'site', `name=${name} logo=${logo || '(默认)'}`);
  return ok(c, {});
});

// 恢复默认 Logo（重新指向内置图片）
app.post('/settings/reset-logo', async (c) => {
  const u = c.get('user');
  for (const [k, v] of [['logo_url', '/img/logo.jpg'], ['favicon_url', '/favicon.ico']]) {
    await c.env.DB.prepare(
      'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
      .bind(k, v)
      .run();
  }
  await audit(c, u.id, 'admin.settings', 'site', '恢复默认 Logo');
  return ok(c, {});
});

export default app;
