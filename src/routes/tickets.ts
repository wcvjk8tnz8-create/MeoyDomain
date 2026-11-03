/**
 * 工单系统：用户提交、追问；管理员回复、关闭。
 * 状态：open 待处理 / pending 处理中 / answered 有回复 / closed 已关闭
 */
import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';

const app = new Hono();

const STATUSES = ['open', 'pending', 'answered', 'closed'];
const STATUS_CN = {
  open: '待处理',
  pending: '处理中',
  answered: '有回复',
  closed: '已关闭',
};

/** 列表：管理员看全部，普通用户只看自己的 */
app.get('/', async (c) => {
  const u = c.get('user');
  const status = String(c.req.query('status') || '').trim();
  const page = Math.max(1, Number(c.req.query('page') || 1));
  const size = 10;

  const where = [];
  const binds = [];
  if (u.role !== 'admin') { where.push('t.user_id = ?'); binds.push(u.id); }
  if (status && STATUSES.includes(status)) { where.push('t.status = ?'); binds.push(status); }
  const wSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM tickets t ${wSql}`)
    .bind(...binds)
    .first();

  const { results } = await c.env.DB.prepare(
    `SELECT t.*,
            (SELECT COUNT(*) FROM ticket_replies r WHERE r.ticket_id = t.id) AS reply_count,
            (SELECT MAX(r.created_at) FROM ticket_replies r WHERE r.ticket_id = t.id) AS last_reply_at
     FROM tickets t ${wSql}
     ORDER BY t.updated_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...binds, size, (page - 1) * size)
    .all();

  // 附邮箱，便于管理员识别
  const ids = results.map((r) => r.user_id);
  let emails = {};
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const { results: us } = await c.env.DB.prepare(
      `SELECT id, email FROM users WHERE id IN (${ph})`
    )
      .bind(...ids)
      .all();
    emails = Object.fromEntries(us.map((x) => [x.id, x.email]));
  }

  return ok(c, {
    items: results.map((t) => ({
      ...t,
      statusCn: STATUS_CN[t.status] || t.status,
      userEmail: emails[t.user_id] || '',
    })),
    total: total?.n || 0,
    page,
    size,
    pages: Math.max(1, Math.ceil((total?.n || 0) / size)),
    statusCn: STATUS_CN,
    isAdmin: u.role === 'admin',
  });
});

/** 详情含回复 */
app.get('/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const t = await c.env.DB.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
  if (!t) return fail(c, '工单不存在', 404);
  if (u.role !== 'admin' && t.user_id !== u.id) return fail(c, '无权查看', 403);

  const { results } = await c.env.DB.prepare(
    `SELECT r.*, u.email FROM ticket_replies r
     JOIN users u ON u.id = r.user_id
     WHERE r.ticket_id = ? ORDER BY r.id ASC`
  )
    .bind(id)
    .all();

  return ok(c, {
    ticket: { ...t, statusCn: STATUS_CN[t.status] || t.status },
    replies: results,
    isAdmin: u.role === 'admin',
  });
});

/** 提交工单 */
app.post('/', async (c) => {
  const u = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const subject = String(body.subject ?? '').trim().slice(0, 120);
  const content = String(body.content ?? '').trim().slice(0, 4000);
  if (!subject) return fail(c, '请填写工单标题');
  if (!content) return fail(c, '请填写工单内容');

  // 简单防刷：30 秒内只能提交 1 个
  const recent = await c.env.DB.prepare(
    'SELECT id FROM tickets WHERE user_id = ? AND created_at > ?'
  )
    .bind(u.id, now() - 30_000)
    .first();
  if (recent) return fail(c, '提交太频繁，请稍后再试');

  const ts = now();
  const ins = await c.env.DB.prepare(
    'INSERT INTO tickets (user_id, subject, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(u.id, subject, 'open', ts, ts)
    .run();

  const tid = ins.meta?.last_row_id;
  await c.env.DB.prepare(
    'INSERT INTO ticket_replies (ticket_id, user_id, is_admin, content, created_at) VALUES (?, ?, 0, ?, ?)'
  )
    .bind(tid, u.id, content, ts)
    .run();

  await audit(c, u.id, 'ticket.create', '#' + tid, subject);
  return ok(c, { id: tid });
});

/** 回复 / 追加追问 */
app.post('/:id/reply', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const content = String(body.content ?? '').trim().slice(0, 4000);
  if (!content) return fail(c, '回复内容不能为空');

  const t = await c.env.DB.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
  if (!t) return fail(c, '工单不存在', 404);
  if (u.role !== 'admin' && t.user_id !== u.id) return fail(c, '无权回复', 403);
  if (t.status === 'closed') return fail(c, '工单已关闭，无法追加回复');

  const isAdmin = u.role === 'admin' ? 1 : 0;
  const ts = now();
  await c.env.DB.prepare(
    'INSERT INTO ticket_replies (ticket_id, user_id, is_admin, content, created_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, u.id, isAdmin, content, ts)
    .run();

  // 管理员回复 → 有回复；用户追问 → 处理中
  const next = isAdmin ? 'answered' : 'pending';
  await c.env.DB.prepare('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?')
    .bind(next, ts, id)
    .run();

  await audit(c, u.id, 'ticket.reply', '#' + id, (isAdmin ? '管理员回复 · ' : '用户追问 · ') + content.slice(0, 40));
  return ok(c, { status: next });
});

/** 关闭工单（发起者或管理员） */
app.post('/:id/close', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const t = await c.env.DB.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
  if (!t) return fail(c, '工单不存在', 404);
  if (u.role !== 'admin' && t.user_id !== u.id) return fail(c, '无权关闭', 403);

  await c.env.DB.prepare('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?')
    .bind('closed', now(), id)
    .run();
  await audit(c, u.id, 'ticket.close', '#' + id);
  return ok(c, {});
});

export default app;
