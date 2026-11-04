import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';
import { validateLabel } from '../lib/records.js';
import { cfDelete, cfErrorMessage } from '../lib/cf.js';
import { UNLIMITED_POINTS, ensurePoints, addPoints, domainCost } from '../lib/points.js';
import { pointRules } from './points.js';
import { expiryRules, computeExpiry, expiryState, renewExpiry, migrateLegacyPerpetual, ensureExpiryColumns } from '../lib/expiry.js';
import { defaultRoot, isAllowedRoot, listRoots } from '../lib/roots.js';
import { applyGate } from '../lib/applyGate.js';
import { aiReviewDetailed } from '../lib/aiReview.js';

const app = new Hono();

// 取一条子域名并校验归属（管理员可跨用户操作）
export async function loadSubdomain(c, id, { admin = false } = {}) {
  const row = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(id).first();
  if (!row) return { error: '子域名不存在' };
  const u = c.get('user');
  if (!admin && row.user_id !== u.id) return { error: '无权操作该子域名' };
  return { row };
}

/**
 * 查询某个名称的可用性，返回详细信息。
 * 关键：结果必须与「真正提交申请」时的判定一致，否则会出现
 * “页面显示可注册、点申请却说已被注册”的不一致。
 */
export async function lookupLabel(c, rawLabel, rootOverride) {
  const v = validateLabel(rawLabel);
  if (!v.ok) return { ok: false, fqdn: '', available: false, message: v.error };

  // 多根域名：未指定时用默认根域名
  const root = String(rootOverride || defaultRoot(c.env)).toLowerCase().replace(/\.+$/, '');
  const fqdn = `${v.label}.${root}`;
  const u = c.get('user');
  const isAdmin = !!(u && u.role === 'admin');
  const myId = u ? u.id : null;

  const row = await c.env.DB.prepare(
    `SELECT s.id, s.label, s.fqdn, s.status, s.user_id, s.created_at, s.reason,
            (SELECT COUNT(*) FROM dns_records r WHERE r.subdomain_id = s.id) AS record_count,
            u.email AS holder_email
     FROM subdomains s LEFT JOIN users u ON u.id = s.user_id
     WHERE s.fqdn = ?`
  )
    .bind(fqdn)
    .first();

  const reserved = String(c.env.RESERVED_LABELS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const isReserved = reserved.includes(v.label);

  // 1) 已存在且不是「被驳回」→ 占用
  if (row && row.status !== 'rejected') {
    return {
      ok: true, fqdn, available: false, message: '该子域名已被注册',
      status: row.status, exists: true, row, isAdmin, isMine: myId && row.user_id === myId,
    };
  }
  // 2) 存在但是被驳回的：只有本人（或管理员）可以重新申请，其他人视为占用
  //    —— 这里必须与提交申请时的判定保持一致
  if (row && row.status === 'rejected') {
    const mine = myId && row.user_id === myId;
    if (mine || isAdmin) {
      return {
        ok: true, fqdn, available: true, message: '你此前申请的该名称被驳回，可重新申请',
        status: 'rejected', exists: true, row, isAdmin, isMine: mine, reclaimable: true,
      };
    }
    return {
      ok: true, fqdn, available: false, message: '该子域名暂不可用（原申请人正在处理）',
      status: 'rejected', exists: true, row, isAdmin, isMine: false,
    };
  }
  // 3) 保留域名
  if (isReserved && !isAdmin) {
    return { ok: true, fqdn, available: false, message: '该名称为系统保留，不可申请', status: 'reserved', exists: false, isAdmin };
  }
  return {
    ok: true, fqdn, available: true,
    message: isReserved ? '保留域名 · 管理员可用' : '可以注册',
    status: 'available', exists: false, isAdmin,
  };
}

// 可用性检查
app.get('/check', async (c) => {
  const r = await lookupLabel(c, c.req.query('label'), c.req.query('root'));
  const u = c.get('user');
  const isAdmin = !!(u && u.role === 'admin');
  const rules = await pointRules(c.env);
  const label = String(c.req.query('label') || '').toLowerCase();
  const { cost, short, rootOverride } = domainCost(
    label,
    { domainCost: rules.domainCost, shortCost: rules.shortCost, shortLen: rules.shortLen, rootCosts: rules.rootCosts },
    isAdmin,
    String(c.req.query('root') || '')
  );
  let points = UNLIMITED_POINTS;
  if (u && !isAdmin) points = await ensurePoints(c.env.DB, u.id, rules);
  const gate = await applyGate(c.env);
  return ok(c, {
    available: r.available,
    applyPaused: gate.paused && !isAdmin,
    applyPausedMessage: gate.message,
    message: r.message,
    fqdn: r.fqdn,
    status: r.status,
    cost: isAdmin ? 0 : cost,
    short,
    rootOverride: !!rootOverride,
    points,
    isAdmin: !!isAdmin,
    unlimited: isAdmin || u === null ? isAdmin : false,
    enough: isAdmin || !u || points < 0 || points >= cost,
  });
});

// 计入配额的状态：被驳回（rejected）不占额度
export const QUOTA_STATUSES = "('pending','approved','suspended')";

// 我的子域名列表（同时兼容 /api/subdomains 与 /api/subdomains/）
const listMine = async (c) => {
  const u = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM dns_records r WHERE r.subdomain_id = s.id) AS record_count
     FROM subdomains s WHERE s.user_id = ?
     ORDER BY (s.status = 'rejected'), s.created_at DESC`
  )
    .bind(u.id)
    .all();
  // 被驳回的不计入已用额度
  const used = results.filter((s) => s.status !== 'rejected').length;
  const rejected = results.length - used;

  // 一次性迁移：迁移前已注册的域名设为永久（不追溯 1 年有效期）
  await ensureExpiryColumns(c.env);
  await migrateLegacyPerpetual(c.env);
  const rules = await expiryRules(c.env);
  const pending = await c.env.DB
    .prepare("SELECT id, fqdn FROM subdomains WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1")
    .bind(u.id)
    .first();

  return ok(c, {
    items: results.map((s) => ({
      ...s,
      countsTowardQuota: s.status !== 'rejected',
      expiry: expiryState(s, { renewWindowDays: rules.renewWindowDays }),
    })),
    quota: u.quota,
    quotaUnlimited: !!u.quotaUnlimited,
    used,
    rejected,
    // 单域名队列：前端据此禁用申请入口
    pendingApplication: pending ? { id: pending.id, fqdn: pending.fqdn } : null,
    validDays: rules.validDays,
    renewWindowDays: rules.renewWindowDays,
  });
};

app.get('/', listMine);

// 申请子域名
const createMine = async (c) => {
  const u = c.get('user');
  await ensureExpiryColumns(c.env);

  /* 后台可暂停新申请（维护 / 防滥用）。管理员自建不受限：
     管理员是「开通」而非「申请」，停掉它会连后台都无法补发域名。 */
  const gate = await applyGate(c.env);
  if (gate.paused && u.role !== 'admin') return fail(c, gate.message, 403, { applyPaused: true });

  const { label, note, root: rootReq } = await c.req.json().catch(() => ({}));
  const v = validateLabel(label);
  if (!v.ok) return fail(c, v.error);

  const isAdmin = u.role === 'admin';
  const reserved = String(c.env.RESERVED_LABELS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const isReserved = reserved.includes(v.label);

  // 与 /check、/api/whois 使用同一套判定，避免「显示可注册、提交却说已注册」
  // 根域名：body.root 指定或取默认；非法则报错（提前声明，下面多处复用）
  const reqRoot = String(rootReq || defaultRoot(c.env)).toLowerCase().replace(/\.+$/, '');
  if (rootReq && !isAllowedRoot(c.env, reqRoot))
    return fail(c, `根域名 ${reqRoot} 未配置，可选：${listRoots(c.env).map((r) => r.domain).join('、')}`);

  const lk = await lookupLabel(c, v.label, reqRoot);
  if (!lk.ok) return fail(c, lk.message);
  if (!lk.available) return fail(c, lk.message, 409);

  // 需要清理的旧记录：仅「本人/管理员重新申请此前被驳回的名称」
  const dup = lk.reclaimable && lk.row ? lk.row : null;

  /* 单域名队列：同一时间只能有一个待审核申请。
     管理员申请是即时开通（不产生 pending），因此不受此限制。 */
  if (!isAdmin) {
    const pending = await c.env.DB.prepare(
      "SELECT id, fqdn, created_at FROM subdomains WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1"
    )
      .bind(u.id)
      .first();
    if (pending) {
      return fail(
        c,
        `你已有一个待审核的申请（${pending.fqdn}），同一时间只能申请一个域名。请等待审核完成，或被驳回后再申请。`,
        409,
        { pendingId: pending.id, pendingFqdn: pending.fqdn }
      );
    }
  }

  // 配额检查（被驳回的不计入），必须在清理旧记录之前，避免校验失败却已删数据
  const used = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM subdomains WHERE user_id = ? AND status IN ${QUOTA_STATUSES}`
  )
    .bind(u.id)
    .first();
  // 管理员（或 quota 为 -1 的用户）不受配额限制
  if (u.quota >= 0 && (used?.n || 0) >= u.quota)
    return fail(c, `已达上限，每个账号最多持有 ${u.quota} 个子域名`);

  // 积分校验：普通域名一个价，单字域名更贵；可按根域名覆盖（含 0 免费）；管理员不消耗
  const rules = await pointRules(c.env);
  const { cost, short, rootOverride } = domainCost(
    v.label,
    { domainCost: rules.domainCost, shortCost: rules.shortCost, shortLen: rules.shortLen, rootCosts: rules.rootCosts },
    isAdmin,
    reqRoot
  );
  let points = UNLIMITED_POINTS;
  if (!isAdmin) {
    points = await ensurePoints(c.env.DB, u.id, rules);
    if (points >= 0 && points < cost) {
      return fail(
        c,
        `积分不足：${short ? '单字域名' : '该子域名'}需要 ${cost} 分，当前 ${points} 分`,
        402,
        { need: cost, have: points, short }
      );
    }
  }

  // 清掉此前被驳回的同名记录（连同其 DNS），再重新申请
  if (dup) {
    const oldRecs = await c.env.DB.prepare('SELECT id, cf_record_id FROM dns_records WHERE subdomain_id = ?')
      .bind(dup.id)
      .all();
    for (const r of oldRecs.results || []) {
      if (r.cf_record_id) await cfDelete(c.env, r.cf_record_id);
    }
    await c.env.DB.prepare('DELETE FROM dns_records WHERE subdomain_id = ?').bind(dup.id).run();
    await c.env.DB.prepare('DELETE FROM subdomains WHERE id = ?').bind(dup.id).run();
    await audit(c, u.id, 'subdomain.reapply', `${v.label}.${reqRoot}`, '清除此前被驳回的同名记录');
  }

  // 多根域名：允许 body.root 指定，必须是已配置的根域名之一
  const fqdn = `${v.label}.${reqRoot}`;

  // AI 自动审核：只要配置生效就尝试，不再绑死 REQUIRE_APPROVAL。
  // 之前若 CI 变量把 REQUIRE_APPROVAL 设成 0，AI 会被整段跳过 —— 这是
  // 「AI 没有自动审核」最常见的原因。现在即使全局免审核，AI 仍能驳回违规申请。
  // 失败时返回带原因的诊断，前端与审计日志都会写明为什么没自动审核。
  let ai = null;
  let aiDiag: any = null;
  if (!isAdmin) {
    try {
      const out = await aiReviewDetailed(c.env, {
        fqdn, label: v.label, root: reqRoot, note: String(note || ''),
      });
      ai = out.verdict;
      aiDiag = out.diag;
    } catch { /* 失败即降级，不卡申请 */ }
  }
  const aiApproved = !!ai?.approve;
  const aiRejected = !!ai && !ai.approve;

  // 免审核：全局关闭审核 / 管理员 / AI 判定通过
  const autoApprove = c.env.REQUIRE_APPROVAL !== '1' || isAdmin || aiApproved;
  const status = aiRejected ? 'rejected' : autoApprove ? 'approved' : 'pending';
  const statusReason = aiRejected ? String(ai.reason || 'AI 审核未通过').slice(0, 200) : '';

  // 有效期：管理员的域名永久有效；其余即时开通的现在起算，待审核的等批准时再起算
  const expRules = await expiryRules(c.env);
  const isPerpetual = isAdmin ? 1 : 0;
  const expiresAt = isAdmin ? null : (autoApprove ? computeExpiry({ validDays: expRules.validDays }) : null);

  let res;
  try {
    res = await c.env.DB.prepare(
      `INSERT INTO subdomains (label, root_domain, fqdn, user_id, status, note, reason, expires_at, perpetual, created_at, updated_at, reviewed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
      .bind(
        v.label, reqRoot, fqdn, u.id, status, String(note || '').slice(0, 300), statusReason,
        expiresAt, isPerpetual, now(), now(), (autoApprove || aiRejected) ? now() : null
      )
      .run();
  } catch (e) {
    // 并发：同一瞬间被别人抢先注册（label / fqdn 唯一约束兜底）
    const msg = String(e && e.message ? e.message : e);
    if (/UNIQUE|constraint/i.test(msg))
      return fail(c, '手慢一步，该子域名刚刚被他人注册，请换一个名称', 409);
    throw e;
  }

  // 扣除积分（管理员不扣；AI 驳回视为未受理，不扣）
  let pointsAfter = UNLIMITED_POINTS;
  if (!isAdmin && !aiRejected && cost > 0) {
    pointsAfter = await addPoints(
      c.env.DB,
      u.id,
      -cost,
      'apply',
      `${fqdn}${short ? '（单字域名）' : ''}`
    );
  }

  const detail = [status];
  if (isAdmin) detail.push('管理员免审核，AI 不触发');
  else if (ai) detail.push(`AI 自动审核：${aiApproved ? '通过' : '驳回'} · 模型 ${ai.model || '自动探测'} · ${ai.reason}`);
  else detail.push(`AI 未触发：${aiDiag?.skipText || '审核模块异常，已回落人工审核'}${aiDiag?.attempts?.length ? ' · ' + aiDiag.attempts.join(' | ').slice(0, 240) : ''}`);
  if (!isAdmin && !aiRejected) {
    if (cost === 0) detail.push(rootOverride ? `${reqRoot} 单独设为 0 分（免费）` : '积分为 0，免费开通');
    else detail.push(`消耗 ${cost} 分${short && !rootOverride ? '（单字域名）' : ''}`);
  }
  if (isReserved) detail.push('保留域名');
  await audit(c, u.id, 'subdomain.create', fqdn, detail.join(' · '));
  // 注意：创建子域名时不会写入任何 DNS 记录，用户需要时再自行添加
  return ok(c, {
    id: res.meta?.last_row_id,
    fqdn,
    status,
    aiReviewed: !!ai,
    aiReason: ai ? String(ai.reason || '') : '',
    aiModel: ai ? String(ai.model || '') : '',
    aiSkip: isAdmin ? 'admin' : ai ? null : (aiDiag?.skipReason || 'unavailable'),
    aiSkipText: isAdmin ? '管理员免审核' : (aiDiag?.skipText || ''),
    aiAttempts: aiDiag?.attempts || [],
    reserved: isReserved,
    cost: isAdmin ? 0 : (aiRejected ? 0 : cost),
    short,
    points: pointsAfter,
  });
};

app.post('/', createMine);

// 子域名详情（含 DNS 记录）
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const { row, error } = await loadSubdomain(c, id);
  if (error) return fail(c, error, 404);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM dns_records WHERE subdomain_id = ? ORDER BY verify_lock DESC, type, host, id'
  )
    .bind(id)
    .all();
  return ok(c, { subdomain: row, records: results });
});

// 编辑备注
app.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const { row, error } = await loadSubdomain(c, id);
  if (error) return fail(c, error, 404);
  const { note } = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare('UPDATE subdomains SET note = ?, updated_at = ? WHERE id = ?')
    .bind(String(note || '').slice(0, 300), now(), id)
    .run();
  return ok(c, {});
});

/* ---------- 续期 ----------
   仅在到期前 renewWindowDays 天内可续；每次续一个周期（默认 1 年）。
   永久域名无需续期。 */
app.post('/:id/renew', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const sub = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(id).first();
  if (!sub) return fail(c, '子域名不存在', 404);
  if (sub.user_id !== u.id && u.role !== 'admin') return fail(c, '无权操作', 403);

  if (sub.status !== 'approved') return fail(c, '只有已注册的域名可以续期');

  const rules = await expiryRules(c.env);
  const st = expiryState(sub, { renewWindowDays: rules.renewWindowDays });
  if (st.perpetual) return fail(c, '该域名为永久有效，无需续期');
  if (st.expired) return fail(c, '域名已过期，无法续期。请重新申请。', 410);
  if (!st.canRenew) {
    return fail(
      c,
      `当前不在续期窗口内：仅在到期前 ${rules.renewWindowDays} 天内可续期（还剩 ${st.daysLeft} 天）`
    );
  }

  const r = renewExpiry(sub, { validDays: rules.validDays });
  if (!r.ok) return fail(c, r.message);

  await c.env.DB.prepare('UPDATE subdomains SET expires_at = ?, renewed_at = ?, updated_at = ? WHERE id = ?')
    .bind(r.expiresAt, now(), now(), id)
    .run();
  await audit(c, u.id, 'subdomain.renew', sub.fqdn, `续期 ${rules.validDays} 天，新到期 ${new Date(r.expiresAt).toISOString().slice(0, 10)}`);

  const fresh = await c.env.DB.prepare('SELECT * FROM subdomains WHERE id = ?').bind(id).first();
  return ok(c, {
    id,
    fqdn: sub.fqdn,
    expiresAt: r.expiresAt,
    expiry: expiryState(fresh, { renewWindowDays: rules.renewWindowDays }),
  });
});

// 释放子域名（同时把其在 Cloudflare 上的记录全部删除）
app.delete('/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const { row, error } = await loadSubdomain(c, id);
  if (error) return fail(c, error, 404);

  const recs = await c.env.DB.prepare('SELECT * FROM dns_records WHERE subdomain_id = ?').bind(id).all();
  const errs = [];
  for (const r of recs.results) {
    if (r.cf_record_id) {
      const res = await cfDelete(c.env, r.cf_record_id);
      if (!res.ok) errs.push(`${r.name}/${r.type}: ${cfErrorMessage(res)}`);
    }
  }
  if (recs.results.length) await c.env.DB.prepare('DELETE FROM dns_records WHERE subdomain_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM subdomains WHERE id = ?').bind(id).run();
  await audit(c, u.id, 'subdomain.delete', row.fqdn, errs.join(' | '));
  return ok(c, { warnings: errs });
});

export default app;
