/**
 * 站内通知（铃铛）
 *   GET    /api/notifications          列表（?filter=all|unread|read）
 *   GET    /api/notifications/unread   未读数量
 *   POST   /api/notifications/read     标记单条已读
 *   POST   /api/notifications/read-all 全部已读
 *   DELETE /api/notifications/:id      删除单条
 */
import { Hono } from 'hono';
import { ok, fail } from '../lib/util.js';
import { unreadCount } from '../lib/notify.js';

const app = new Hono();

app.get('/', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const filter = String(c.req.query('filter') || 'all');
  const where = filter === 'unread' ? ' AND read = 0' : filter === 'read' ? ' AND read = 1' : '';
  const { results } = await c.env.DB.prepare(
    `SELECT id, type, title, body, tag, link, read, created_at FROM notifications
     WHERE user_id = ?${where} ORDER BY id DESC LIMIT 100`
  )
    .bind(u.id)
    .all();
  return ok(c, { items: results, unread: await unreadCount(c.env, u.id) });
});

app.get('/unread', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  return ok(c, { unread: await unreadCount(c.env, u.id) });
});

app.post('/read', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const { id } = await c.req.json().catch(() => ({}));
  if (!id) return fail(c, '缺少通知 id');
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?')
    .bind(Number(id), u.id)
    .run();
  return ok(c, { unread: await unreadCount(c.env, u.id) });
});

app.post('/read-all', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').bind(u.id).run();
  return ok(c, { unread: 0 });
});

app.delete('/:id', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  await c.env.DB.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?')
    .bind(Number(c.req.param('id')), u.id)
    .run();
  return ok(c, { unread: await unreadCount(c.env, u.id) });
});

export default app;
