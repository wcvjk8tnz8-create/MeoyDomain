/**
 * 滥用举报（Report Abuse）
 *
 *   POST   /api/abuse                 公开提交（可匿名，带 IP 限流）
 *   GET    /api/abuse                 公开配置（投诉邮箱 / 外部举报入口）
 *   GET    /api/abuse/mine            登录用户自己的举报
 *   GET    /api/abuse/admin           管理员：全部举报（分页 / 状态筛选）
 *   PATCH  /api/abuse/admin/:id       管理员：改状态 + 处理说明
 *   POST   /api/abuse/admin/:id/suspend 管理员：停用本站对应的域名
 *
 * 表由首次请求幂等创建（CREATE TABLE IF NOT EXISTS），不依赖部署脚本。
 * 举报只做记录与转交，不自动处罚；停用域名必须由管理员显式点击。
 */
import { Hono } from 'hono';
import { ok, fail, now, clientIp, audit } from '../lib/util.js';
import { notify } from '../lib/notify.js';

const app = new Hono();

const TYPES = ['phishing', 'malware', 'spam', 'illegal', 'trademark', 'fraud', 'other'];
const TYPE_CN: Record<string, string> = {
  phishing: '钓鱼 / 仿冒',
  malware: '恶意程序 / 木马',
  spam: '垃圾邮件',
  illegal: '赌博 / 色情 / 违法内容',
  trademark: '侵犯商标 / 知识产权',
  fraud: '诈骗',
  other: '其它违规',
};
const STATUSES = ['open', 'investigating', 'resolved', 'dismissed'];
const STATUS_CN: Record<string, string> = {
  open: '待处理', investigating: '处理中', resolved: '已处理', dismissed: '已驳回',
};

const ensured = new WeakSet<object>();
async function ensureTable(env: any) {
  if (ensured.has(env)) return;
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS abuse_reports (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      domain        TEXT NOT NULL,
      type          TEXT NOT NULL,
      description   TEXT NOT NULL,
      evidence_url  TEXT,
      contact_email TEXT,
      user_id       INTEGER,
      ip            TEXT,
      status        TEXT NOT NULL DEFAULT 'open',
      admin_note    TEXT,
      handled_by    INTEGER,
      local_match   INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    )`).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_abuse_status ON abuse_reports(status, created_at DESC)').run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_abuse_domain ON abuse_reports(domain)').run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_abuse_user ON abuse_reports(user_id, created_at DESC)').run();
    ensured.add(env);
  } catch { /* 表已由 schema.sql 建立，或索引重复：不影响查询 */ }
}

function cleanDomain(v: any): string {
  const s = String(v || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  return s.replace(/\.$/, '');
}

function validDomain(s: string): boolean {
  if (!s || s.length > 253 || !s.includes('.')) return false;
  if (/[\s<>"'`\\]/.test(s) || s.includes('@')) return false;
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(s) && !s.split('.').some((p) => !p || p.length > 63 || p.startsWith('-') || p.endsWith('-'));
}

function decorate(row: any) {
  return {
    ...row,
    typeCn: TYPE_CN[row.type] || '其它违规',
    statusCn: STATUS_CN[row.status] || row.status,
  };
}

/** 公开配置：后台填写的投诉邮箱 / 外部举报入口，供举报页展示 */
app.get('/', async (c) => {
  let email = '', url = '';
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT key, value FROM settings WHERE key IN ('abuse_email','abuse_report_url')"
    ).all();
    const s = Object.fromEntries((results || []).map((r: any) => [r.key, r.value]));
    email = String(s.abuse_email || '');
    url = String(s.abuse_report_url || '');
  } catch { /* settings 表尚未建立 */ }
  return ok(c, { abuseEmail: email, abuseReportUrl: url, types: TYPES, typeCn: TYPE_CN, statusCn: STATUS_CN });
});

/** 提交举报（公开，匿名可用） */
app.post('/', async (c) => {
  await ensureTable(c.env);
  const u = c.get('user');
  const body = await c.req.json().catch(() => ({}) as any);
  const domain = cleanDomain(body?.domain);
  const type = String(body?.type || '').trim();
  const description = String(body?.description || '').trim();
  const evidenceUrl = String(body?.evidenceUrl || '').trim().slice(0, 500);
  const contactEmail = String(body?.contactEmail || '').trim().slice(0, 160);
  const ip = clientIp(c);

  if (!domain) return fail(c, '请填写被举报域名');
  if (!validDomain(domain)) return fail(c, '域名格式不正确，请填写完整域名');
  if (!TYPES.includes(type)) return fail(c, '请选择滥用类型');
  if (description.length < 10) return fail(c, '请填写详细描述（至少 10 个字）');
  if (description.length > 3000) return fail(c, '详细描述最多 3000 字');
  if (evidenceUrl && !/^https?:\/\//i.test(evidenceUrl)) return fail(c, '证据链接需以 https:// 开头');
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) return fail(c, '联系邮箱格式不正确');

  // 限流：同一 IP 60 秒最多 3 条；同一 IP + 域名 24 小时内不重复
  const t = now();
  try {
    const recent = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM abuse_reports WHERE ip = ? AND created_at > ?'
    ).bind(ip, String(t - 60_000)).first();
    if (Number(recent?.n || 0) >= 3) return fail(c, '提交过于频繁，请稍后再试', 429);
    const dup = await c.env.DB.prepare(
      "SELECT id FROM abuse_reports WHERE ip = ? AND domain = ? AND status != 'dismissed' AND created_at > ? LIMIT 1"
    ).bind(ip, domain, String(t - 86_400_000)).first();
    if (dup) return fail(c, '你已举报过该域名', 429);
  } catch { /* 表刚建好，查询失败不阻断提交 */ }

  // 是否命中本站分配的域名（管理员可直接停用）
  let localMatch = 0;
  try {
    const hit = await c.env.DB.prepare('SELECT id FROM subdomains WHERE lower(fqdn) = ? LIMIT 1').bind(domain).first();
    localMatch = hit ? 1 : 0;
  } catch { /* ignore */ }

  const ts = t;   // 与站内其它表一致：毫秒时间戳，前端 fmtTime 直接可用
  let id: number | null = null;
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO abuse_reports (domain, type, description, evidence_url, contact_email, user_id, ip, status, local_match, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'open',?,?,?)`
    ).bind(domain, type, description, evidenceUrl || null, contactEmail || null, u?.id || null, ip, localMatch, ts, ts).run();
    id = r.meta?.last_row_id ?? null;
  } catch {
    return fail(c, '举报失败，请稍后再试', 500);
  }

  // 通知全部在册管理员（失败不阻断）
  try {
    const { results: admins } = await c.env.DB.prepare(
      "SELECT id FROM users WHERE role = 'admin' AND status = 'active'"
    ).all();
    for (const a of admins || []) {
      await notify(c.env, (a as any).id, 'abuse_new', '新的滥用举报',
        `有新的滥用举报待处理，请前往管理后台查看。域名：${domain}`, '/report');
    }
  } catch { /* ignore */ }

  await audit(c, u?.id || null, 'abuse.report', domain, `${TYPE_CN[type]} · ${description.slice(0, 80)}`);
  return ok(c, { id, status: 'open', localMatch: !!localMatch, message: '举报提交成功，我们会尽快处理' });
});

/** 我的举报 */
app.get('/mine', async (c) => {
  await ensureTable(c.env);
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM abuse_reports WHERE user_id = ? ORDER BY id DESC LIMIT 50'
  ).bind(u.id).all();
  return ok(c, { items: (results || []).map(decorate), total: (results || []).length });
});

/** 管理员列表 */
app.get('/admin', async (c) => {
  await ensureTable(c.env);
  const u = c.get('user');
  if (u?.role !== 'admin') return fail(c, '需要管理员权限', 403);
  const status = String(c.req.query('status') || '').trim();
  const page = Math.max(1, Number(c.req.query('page') || 1) || 1);
  const size = 10;
  const where = status && STATUSES.includes(status) ? 'WHERE status = ?' : '';
  const binds = status && STATUSES.includes(status) ? [status] : [];
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM abuse_reports ${where}`).bind(...binds).first();
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, u.email AS user_email FROM abuse_reports r
     LEFT JOIN users u ON u.id = r.user_id
     ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`
  ).bind(...binds, size, (page - 1) * size).all();
  return ok(c, {
    items: (results || []).map(decorate),
    total: Number(total?.n || 0), page, size,
    pages: Math.max(1, Math.ceil(Number(total?.n || 0) / size)),
    statusCn: STATUS_CN, typeCn: TYPE_CN,
  });
});

/** 管理员改状态 */
app.patch('/admin/:id', async (c) => {
  await ensureTable(c.env);
  const u = c.get('user');
  if (u?.role !== 'admin') return fail(c, '需要管理员权限', 403);
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}) as any);
  const status = String(body?.status || '').trim();
  const adminNote = String(body?.adminNote || '').trim().slice(0, 500);
  if (!STATUSES.includes(status)) return fail(c, '处理状态不合法');
  const row = await c.env.DB.prepare('SELECT id FROM abuse_reports WHERE id = ?').bind(id).first();
  if (!row) return fail(c, '举报记录不存在', 404);
  await c.env.DB.prepare(
    'UPDATE abuse_reports SET status = ?, admin_note = ?, handled_by = ?, updated_at = ? WHERE id = ?'
  ).bind(status, adminNote || null, u.id, now(), id).run();
  await audit(c, u.id, 'abuse.handle', id, `${STATUS_CN[status]}${adminNote ? ' · ' + adminNote.slice(0, 80) : ''}`);
  return ok(c, { message: '举报处理已更新' });
});

/** 管理员停用本站对应域名 */
app.post('/admin/:id/suspend', async (c) => {
  await ensureTable(c.env);
  const u = c.get('user');
  if (u?.role !== 'admin') return fail(c, '需要管理员权限', 403);
  const id = Number(c.req.param('id'));
  const row: any = await c.env.DB.prepare('SELECT * FROM abuse_reports WHERE id = ?').bind(id).first();
  if (!row) return fail(c, '举报记录不存在', 404);
  const sub: any = await c.env.DB.prepare(
    'SELECT id, fqdn, user_id, status FROM subdomains WHERE lower(fqdn) = ? LIMIT 1'
  ).bind(row.domain).first();
  if (!sub) return fail(c, '该域名在本站不存在对应记录', 404);
  await c.env.DB.prepare(
    "UPDATE subdomains SET status = 'suspended', reason = ?, updated_at = ? WHERE id = ?"
  ).bind('违规使用', now(), sub.id).run();
  await c.env.DB.prepare(
    'UPDATE abuse_reports SET local_match = 1, status = ?, handled_by = ?, updated_at = ? WHERE id = ?'
  ).bind('resolved', u.id, now(), id).run();
  try {
    await notify(c.env, sub.user_id, 'system', '域名已被停用',
      `你的域名 ${sub.fqdn} 已被管理员停用。原因：违规使用如有疑问可提交工单。`, '/dashboard');
  } catch { /* ignore */ }
  await audit(c, u.id, 'abuse.suspend', sub.fqdn, `举报 #${id} 触发停用`);
  return ok(c, { message: '域名已停用', fqdn: sub.fqdn });
});

export default app;
