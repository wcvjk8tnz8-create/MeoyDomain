/**
 * AI 待审域名批量审核（TerraDomain）
 *
 * 触发方式，三条路径共用同一个 runAiReviewBatch()：
 *   1. Cron：wrangler.toml [triggers] crons = ["0 * * * *"]，每小时整点扫一次
 *   2. 新申请：提交后 c.executionCtx.waitUntil(...) 立即审核「所有」待审域名
 *   3. 后台按钮：/api/admin/ai-review-run（支持 reset 清除失败计数）
 *
 * 设计要点：
 *   - 只处理 status='pending' 且根域名在 AI 名单内的记录；名单外的留给人工审核。
 *   - 原子领取（ai_claim_at + 条件 UPDATE）防止 cron / waitUntil / 手动按钮并发重复调用模型。
 *   - 失败不驳回、不扣状态，只累计 ai_attempts；超过上限转人工，不再无限消耗 API 额度。
 *   - 驳回时退还本次申请已扣的积分，与「提交时同步 AI 驳回不扣分」语义一致。
 *   - 批准时按现有规则设置有效期并通知申请人，reviewed_by 留空（AI 不是用户）。
 *
 * 历史坑：以前 AI 只在「提交那一刻」同步判定，网关一超时就永久停在 pending，
 * 除非管理员手动点通过。现在任何一次新申请或整点 cron 都会把积压的 pending 重新过一遍。
 */

import { aiReviewDetailed, loadAiConfig, rootInAiList } from './aiReview.js';
import { computeExpiry, expiryRules } from './expiry.js';
import { addPoints } from './points.js';
import { notify } from './notify.js';

/** 单次最多处理多少条，避免 cron 一次跑太久 / 打爆网关 */
export const BATCH_LIMIT = 20;
/** 单个域名累计失败多少次后不再自动重试（保留 pending 交人工） */
export const MAX_AI_ATTEMPTS = 5;
/** 领取锁的有效期：Worker 崩溃后 5 分钟自动释放 */
const CLAIM_TTL_MS = 5 * 60 * 1000;
/** 候选集上限（只用于过滤名单，真正送审不超过 BATCH_LIMIT） */
const SCAN_LIMIT = 200;

export interface BatchResult {
  trigger: string;
  scanned: number;      // 本轮实际尝试领取的条数
  approved: number;
  rejected: number;
  failed: number;       // AI 调用失败，仍保持 pending
  skipped: number;      // 名单外 / 超过重试次数 / 已被别的批次领取
  noConfig: boolean;
  reason: string;
  details: string[];
  elapsedMs: number;
}

function blank(trigger: string, reason: string, noConfig = false): BatchResult {
  return {
    trigger, scanned: 0, approved: 0, rejected: 0, failed: 0, skipped: 0,
    noConfig, reason, details: [], elapsedMs: 0,
  };
}

/** 从 fqdn 反推根域名：lol.v-1.top → v-1.top。
 *  不依赖 root_domain 列（早期库可能没有该列），与「我的域名」页口径一致。 */
export function rootFromFqdn(fqdn: string): string {
  const s = String(fqdn || '').trim().toLowerCase().replace(/\.+$/, '');
  const i = s.indexOf('.');
  return i > 0 ? s.slice(i + 1) : '';
}

/** 旧库列补齐：CREATE TABLE IF NOT EXISTS 不会给已存在的表加列。
 *  幂等 —— PRAGMA 检测后逐列 ALTER，模块级缓存避免每次 cron 都查。 */
let colsChecked = false;
export async function ensureAiColumns(env: any): Promise<void> {
  if (colsChecked) return;
  try {
    const info = await env.DB.prepare('PRAGMA table_info(subdomains)').all();
    const have = new Set((info?.results || []).map((r: any) => String(r.name)));
    const add = async (col: string, ddl: string) => {
      if (have.has(col)) return;
      await env.DB.prepare(`ALTER TABLE subdomains ADD COLUMN ${col} ${ddl}`).run();
      have.add(col);
    };
    // 本次申请扣除的积分：AI 事后驳回时据此退还
    await add('apply_cost', 'INTEGER');
    await add('ai_attempts', 'INTEGER NOT NULL DEFAULT 0');
    await add('ai_last_error', 'TEXT');
    await add('ai_last_try_at', 'INTEGER');
    // 并发领取锁；NULL 表示未被领取
    await add('ai_claim_at', 'INTEGER');
    colsChecked = true;
  } catch { /* 表未建好 / 权限异常：后续查询会自然失败，不阻断其它功能 */ }
}

/** 系统审计（不依赖 Hono Context，cron 里也能写） */
async function systemAudit(env: any, userId: number | null, action: string, target: string, detail = '') {
  try {
    await env.DB.prepare(
      'INSERT INTO audit_log (user_id, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?)'
    )
      .bind(userId ?? null, action, String(target).slice(0, 200), String(detail).slice(0, 1000), 'system', Date.now())
      .run();
  } catch { /* 审计失败不影响审核结果 */ }
}

/** 取本次申请实际扣掉的积分：优先读 apply_cost，旧记录回退查积分流水。 */
async function refundableCost(env: any, row: any): Promise<number> {
  const n = Number(row?.apply_cost);
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  try {
    const log = await env.DB.prepare(
      `SELECT delta FROM point_logs WHERE user_id = ? AND reason = 'apply' AND detail LIKE ?
       ORDER BY id DESC LIMIT 1`
    )
      .bind(row.user_id, String(row.fqdn) + '%')
      .first();
    const d = Number(log?.delta);
    if (Number.isFinite(d) && d < 0) return -d;
  } catch { /* 无流水可查 */ }
  return 0;
}

const clearAi = 'ai_claim_at = NULL, ai_attempts = ai_attempts + 1, ai_last_error = NULL, ai_last_try_at = ?';

/** 批准：与后台「通过」一致，设置有效期、写 reviewed_at、通知申请人。
 *  WHERE status='pending' 是二次保险：管理员同时手动审核时不会覆盖其决定。 */
async function approveRow(env: any, row: any, verdict: any): Promise<boolean> {
  const rules = await expiryRules(env);
  const exp = Number(row.perpetual) === 1 ? null : computeExpiry({ validDays: rules.validDays });
  const ts = Date.now();
  const res = await env.DB.prepare(
    `UPDATE subdomains SET status = 'approved', reason = NULL, expires_at = ?, reviewed_at = ?,
       reviewed_by = NULL, updated_at = ?, ${clearAi}
     WHERE id = ? AND status = 'pending'`
  )
    .bind(exp, ts, ts, ts, row.id)
    .run();
  if (!(res?.meta?.changes > 0)) return false;
  // 文案与后台「通过」完全一致，英文模式可直接命中既有句式翻译。
  // AI 来源写在审计日志（subdomain.ai-approved）里，不塞进通知正文。
  await notify(
    env, row.user_id, 'domain_approved', '域名审核已通过',
    `你的域名 ${row.fqdn} 已审核通过并开通${exp ? `，有效期 ${rules.validDays} 天` : '（永久有效）'}。快去添加 DNS 记录吧。`,
    '/domain.html?id=' + row.id
  );
  await systemAudit(env, row.user_id, 'subdomain.ai-approved', row.fqdn,
    `AI 自动审核通过 · 模型 ${verdict?.model || '自动探测'} · ${verdict?.reason || ''}`.slice(0, 400));
  return true;
}

/** 驳回：退还积分（与提交时同步驳回不扣分保持一致），通知并留审计。 */
async function rejectRow(env: any, row: any, reason: string): Promise<boolean> {
  const ts = Date.now();
  const why = String(reason || '不符合使用规范').slice(0, 200);
  const res = await env.DB.prepare(
    `UPDATE subdomains SET status = 'rejected', reason = ?, reviewed_at = ?,
       reviewed_by = NULL, updated_at = ?, ${clearAi}
     WHERE id = ? AND status = 'pending'`
  )
    .bind(why, ts, ts, ts, row.id)
    .run();
  if (!(res?.meta?.changes > 0)) return false;

  const cost = await refundableCost(env, row);
  if (cost > 0) {
    await addPoints(env.DB, row.user_id, cost, 'refund', `${row.fqdn} · AI 审核驳回自动退还积分`);
  }
  // 退还积分记在积分流水里，通知正文沿用后台「驳回」的既有句式
  await notify(
    env, row.user_id, 'domain_approved', '域名申请被驳回',
    `你的域名 ${row.fqdn} 未通过审核。${why ? '原因：' + why : ''}如有疑问可提交工单。`,
    '/dashboard.html'
  );
  await systemAudit(env, row.user_id, 'subdomain.ai-rejected', row.fqdn,
    `AI 自动审核驳回 · ${why}${cost > 0 ? ` · 退还 ${cost} 积分` : ''}`);
  return true;
}

/** 失败：保留 pending，累计次数并记下具体原因，等下次 cron / 新申请再试。 */
async function failRow(env: any, row: any, errText: string): Promise<void> {
  const ts = Date.now();
  const msg = String(errText || 'AI 调用失败').slice(0, 300);
  try {
    await env.DB.prepare(
      `UPDATE subdomains SET ai_claim_at = NULL, ai_attempts = ai_attempts + 1,
         ai_last_error = ?, ai_last_try_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`
    )
      .bind(msg, ts, ts, row.id)
      .run();
  } catch { /* 状态保持 pending，不影响其它记录 */ }
}

/** 手动按钮可选：把所有 pending 的失败计数清零，让之前「转人工」的记录重新送审 */
async function resetAttempts(env: any): Promise<void> {
  try {
    await env.DB.prepare(
      "UPDATE subdomains SET ai_attempts = 0, ai_last_error = NULL, ai_claim_at = NULL WHERE status = 'pending'"
    ).run();
  } catch { /* 忽略 */ }
}

/** 记录本轮结果，后台「队列状态」据此显示上次运行时间与统计 */
async function saveLastRun(env: any, r: BatchResult): Promise<void> {
  try {
    const put = async (k: string, v: string) => {
      await env.DB.prepare(
        'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).bind(k, v).run();
    };
    await put('ai_batch_last_run', String(Date.now()));
    await put('ai_batch_last_result', JSON.stringify({
      trigger: r.trigger, scanned: r.scanned, approved: r.approved, rejected: r.rejected,
      failed: r.failed, skipped: r.skipped, reason: r.reason, elapsedMs: r.elapsedMs,
    }));
  } catch { /* settings 写入失败不影响审核 */ }
}

/**
 * 审核所有待审域名。
 * @param trigger cron | new-request | manual
 * @param opts.reset 手动按钮可清除失败计数，重新送审所有 pending
 */
export async function runAiReviewBatch(
  env: any,
  trigger = 'cron',
  opts: { reset?: boolean; limit?: number } = {},
): Promise<BatchResult> {
  const t0 = Date.now();
  const r = blank(trigger, '');
  try {
    await ensureAiColumns(env);
    const cfg = await loadAiConfig(env).catch(() => null);
    if (!cfg || !cfg.enabled || !cfg.configured) {
      r.noConfig = true;
      r.reason = !cfg ? 'AI 配置读取失败'
        : !cfg.enabled ? '自动审核开关未开启'
          : (cfg.provider === 'workers-ai' ? 'Workers AI 未绑定' : '未配置 API Key');
      r.elapsedMs = Date.now() - t0;
      await saveLastRun(env, r);
      return r;
    }
    if (opts.reset) await resetAttempts(env);

    const { results } = await env.DB.prepare(
      `SELECT id, fqdn, label, note, user_id, perpetual, apply_cost, ai_attempts, ai_claim_at
       FROM subdomains WHERE status = 'pending' ORDER BY id ASC LIMIT ${SCAN_LIMIT}`
    ).all();
    const all = results || [];

    // 单域名队列：同一用户本批次已经批准过一个，其余直接驳回（与后台审核一致）
    const approvedUsers = new Set<number>();
    const limit = Math.max(1, Math.min(Number(opts.limit) || BATCH_LIMIT, 100));

    for (const row of all) {
      if (r.scanned >= limit) break;
      const root = rootFromFqdn(row.fqdn);
      if (!rootInAiList(cfg, root)) { r.skipped++; continue; }
      if (Number(row.ai_attempts || 0) >= MAX_AI_ATTEMPTS) {
        r.skipped++;
        r.details.push(`${row.fqdn}：已失败 ${row.ai_attempts} 次，转人工审核（后台可点「重试全部」清零）`);
        continue;
      }

      // 原子领取：并发的 cron / waitUntil / 手动按钮只有一个能拿到
      const claimAt = Date.now();
      const claimed = await env.DB.prepare(
        `UPDATE subdomains SET ai_claim_at = ?
         WHERE id = ? AND status = 'pending' AND (ai_claim_at IS NULL OR ai_claim_at < ?)`
      )
        .bind(claimAt, row.id, claimAt - CLAIM_TTL_MS)
        .run();
      if (!(claimed?.meta?.changes > 0)) { r.skipped++; continue; }
      r.scanned++;

      if (approvedUsers.has(Number(row.user_id))) {
        const okReject = await rejectRow(env, row, '同一时间只能有一个待审核申请，其余已自动驳回');
        if (okReject) r.rejected++;
        continue;
      }

      let verdict: any = null;
      let errText = '';
      try {
        const out = await aiReviewDetailed(env, {
          fqdn: String(row.fqdn), label: String(row.label || ''),
          root, note: String(row.note || ''),
        });
        verdict = out.verdict;
        if (!verdict) errText = out.diag?.skipText || 'AI 未给出结论';
      } catch (e) {
        errText = '审核异常：' + String((e as Error)?.message || e).slice(0, 160);
      }

      if (!verdict) {
        await failRow(env, row, errText);
        r.failed++;
        r.details.push(`${row.fqdn}：${errText}`);
        continue;
      }

      if (verdict.approve) {
        const okApprove = await approveRow(env, row, verdict);
        if (okApprove) { r.approved++; approvedUsers.add(Number(row.user_id)); }
      } else {
        const okReject = await rejectRow(env, row, String(verdict.reason || 'AI 审核未通过'));
        if (okReject) r.rejected++;
      }
    }
    r.reason = r.scanned
      ? `本轮审核 ${r.scanned} 个：通过 ${r.approved} · 驳回 ${r.rejected} · 待重试 ${r.failed}`
      : '没有需要 AI 处理的待审域名';
  } catch (e) {
    r.reason = '批量审核异常：' + String((e as Error)?.message || e).slice(0, 200);
  }
  r.elapsedMs = Date.now() - t0;
  await saveLastRun(env, r);
  return r;
}

/** 把一次批处理挂到 waitUntil，不让 HTTP 请求干等模型推理。 */
export function startAiBatch(
  c: any, trigger: string, opts: { reset?: boolean; limit?: number } = {},
): boolean {
  try {
    const p = runAiReviewBatch(c.env, trigger, opts).catch(() => null);
    if (c?.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil(p);
      return true;
    }
    // 某些测试环境没有 executionCtx：仍然尽力跑，但不 await
    void p;
    return false;
  } catch {
    return false;
  }
}

/** 新申请提交后调用：立即审核所有待审域名，不拖慢接口响应。 */
export function queueAiBatch(c: any, trigger = 'new-request'): boolean {
  return startAiBatch(c, trigger);
}

/** 后台「队列状态」：待审总数、名单内可审数、转人工数、上次运行结果。 */
export async function aiBatchStatus(env: any): Promise<Record<string, unknown>> {
  await ensureAiColumns(env);
  const cfg = await loadAiConfig(env).catch(() => null);
  let rows: any[] = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, fqdn, ai_attempts, ai_last_error, ai_last_try_at
       FROM subdomains WHERE status = 'pending' ORDER BY id ASC LIMIT ${SCAN_LIMIT}`
    ).all();
    rows = results || [];
  } catch { /* 表未就绪 */ }

  const covered = rows.filter((x) => cfg && rootInAiList(cfg, rootFromFqdn(x.fqdn)));
  const exhausted = rows.filter((x) => Number(x.ai_attempts || 0) >= MAX_AI_ATTEMPTS);
  let last: any = null;
  let lastRun = 0;
  try {
    const { results } = await env.DB.prepare(
      "SELECT key, value FROM settings WHERE key IN ('ai_batch_last_run','ai_batch_last_result')"
    ).all();
    const m = Object.fromEntries((results || []).map((x: any) => [x.key, x.value]));
    lastRun = Number(m.ai_batch_last_run || 0);
    try { last = JSON.parse(String(m.ai_batch_last_result || '')); } catch { last = null; }
  } catch { /* 忽略 */ }

  return {
    pendingTotal: rows.length,
    aiCovered: covered.length,
    manualOnly: rows.length - covered.length,
    exhausted: exhausted.length,
    maxAttempts: MAX_AI_ATTEMPTS,
    batchLimit: BATCH_LIMIT,
    cron: '每小时整点（0 * * * *）',
    onNewRequest: true,
    configured: !!cfg?.configured,
    enabled: !!cfg?.enabled,
    provider: cfg?.provider || 'custom',
    roots: cfg?.roots || [],
    lastRunAt: lastRun || null,
    lastResult: last,
    items: rows.slice(0, 30).map((x) => ({
      fqdn: x.fqdn,
      attempts: Number(x.ai_attempts || 0),
      covered: !!(cfg && rootInAiList(cfg, rootFromFqdn(x.fqdn))),
      lastError: String(x.ai_last_error || '').slice(0, 160),
      lastTryAt: Number(x.ai_last_try_at || 0) || null,
    })),
  };
}
