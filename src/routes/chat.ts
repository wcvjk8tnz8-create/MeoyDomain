// ============================================================
//  聊天地（讨论区 / 博客）
//  登录用户可发帖回复；作者本人或管理员可删除。
// ============================================================
import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';

const app = new Hono();

// 显示名取邮箱 @ 前的部分（users 表无 nickname 列，避免给旧库补列）
const DISPLAY_NAME = "substr(u.email, 1, instr(u.email,'@')-1)";

/** 列表 */
app.get('/posts', async (c) => {
  const q = String(c.req.query('q') || '').trim();
  const page = Math.max(Number(c.req.query('page')) || 1, 1);
  const per = Math.min(Math.max(Number(c.req.query('per')) || 20, 1), 50);
  const off = (page - 1) * per;

  let where = '';
  let bind = [];
  if (q) {
    where = 'WHERE (p.title LIKE ? OR p.content LIKE ?)';
    bind = [`%${q}%`, `%${q}%`];
  }

  const sql = `
    SELECT p.id, p.title, p.content, p.pinned, p.locked, p.views, p.created_at, p.updated_at,
           p.user_id,
           ${DISPLAY_NAME} AS author,
           (SELECT COUNT(*) FROM chat_replies r WHERE r.post_id = p.id) AS reply_count,
           (SELECT MAX(r.created_at) FROM chat_replies r WHERE r.post_id = p.id) AS last_reply_at
      FROM chat_posts p JOIN users u ON u.id = p.user_id
      ${where}
     ORDER BY p.pinned DESC, COALESCE((
       SELECT MAX(r.created_at) FROM chat_replies r WHERE r.post_id = p.id
     ), p.created_at) DESC
     LIMIT ? OFFSET ?`;

  const { results } = await c.env.DB.prepare(sql).bind(...bind, per, off).all();
  return ok(c, { items: results || [], page, per });
});

/** 发帖 */
app.post('/posts', async (c) => {
  const u = c.get('user');
  const { title, content } = await c.req.json().catch(() => ({}));
  const t = String(title || '').trim();
  const b = String(content || '').trim();
  if (t.length < 2) return fail(c, '标题至少 2 个字');
  if (b.length < 1) return fail(c, '内容不能为空');
  if (t.length > 120) return fail(c, '标题最多 120 字');
  if (b.length > 8000) return fail(c, '内容最多 8000 字');

  // 简单防刷：30 秒内只能发一帖
  const recent = await c.env.DB.prepare(
    'SELECT id FROM chat_posts WHERE user_id = ? AND created_at > ?'
  ).bind(u.id, Date.now() - 30000).first();
  if (recent) return fail(c, '发帖太频繁，请稍后再试');

  const r = await c.env.DB.prepare(
    'INSERT INTO chat_posts (user_id, title, content, created_at, updated_at) VALUES (?,?,?,?,?)'
  ).bind(u.id, t, b, now(), now()).run();

  await audit(c, u.id, 'chat.post', t.slice(0, 40), '');
  return ok(c, { id: r.meta?.last_row_id, title: t });
});

/** 详情 + 回复 */
app.get('/posts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const post = await c.env.DB.prepare(
    `SELECT p.*, ${DISPLAY_NAME} AS author, u.email AS author_email, u.role AS author_role
       FROM chat_posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`
  ).bind(id).first();
  if (!post) return fail(c, '帖子不存在', 404);

  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.content, r.created_at, r.user_id,
            ${DISPLAY_NAME} AS author, u.role AS author_role
       FROM chat_replies r JOIN users u ON u.id = r.user_id
      WHERE r.post_id = ? ORDER BY r.created_at ASC`
  ).bind(id).all();

  // 浏览量 +1（同一会话不重复计，用简单计数即可）
  await c.env.DB.prepare('UPDATE chat_posts SET views = views + 1 WHERE id = ?').bind(id).run();

  return ok(c, { post, replies: results || [] });
});

/** 回复 */
app.post('/posts/:id/replies', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const post = await c.env.DB.prepare('SELECT id, locked FROM chat_posts WHERE id = ?').bind(id).first();
  if (!post) return fail(c, '帖子不存在', 404);
  if (Number(post.locked) === 1 && u.role !== 'admin') return fail(c, '该帖已锁定，无法回复');

  const { content } = await c.req.json().catch(() => ({}));
  const b = String(content || '').trim();
  if (!b) return fail(c, '回复内容不能为空');
  if (b.length > 3000) return fail(c, '回复最多 3000 字');

  const recent = await c.env.DB.prepare(
    'SELECT id FROM chat_replies WHERE user_id = ? AND created_at > ?'
  ).bind(u.id, Date.now() - 10000).first();
  if (recent) return fail(c, '回复太频繁，请稍后再试');

  const r = await c.env.DB.prepare(
    'INSERT INTO chat_replies (post_id, user_id, content, created_at) VALUES (?,?,?,?)'
  ).bind(id, u.id, b, now()).run();

  return ok(c, { id: r.meta?.last_row_id });
});

/** 删帖（作者本人或管理员） */
app.delete('/posts/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const post = await c.env.DB.prepare('SELECT * FROM chat_posts WHERE id = ?').bind(id).first();
  if (!post) return fail(c, '帖子不存在', 404);
  if (post.user_id !== u.id && u.role !== 'admin') return fail(c, '无权删除', 403);

  await c.env.DB.prepare('DELETE FROM chat_replies WHERE post_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM chat_posts WHERE id = ?').bind(id).run();
  await audit(c, u.id, 'chat.delete', post.title.slice(0, 40), '');
  return ok(c, {});
});

/** 删回复（本人或管理员） */
app.delete('/replies/:id', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const r = await c.env.DB.prepare('SELECT * FROM chat_replies WHERE id = ?').bind(id).first();
  if (!r) return fail(c, '回复不存在', 404);
  if (r.user_id !== u.id && u.role !== 'admin') return fail(c, '无权删除', 403);
  await c.env.DB.prepare('DELETE FROM chat_replies WHERE id = ?').bind(id).run();
  return ok(c, {});
});

/** 管理员：置顶 / 锁定 */
app.post('/posts/:id/flag', async (c) => {
  const u = c.get('user');
  if (u.role !== 'admin') return fail(c, '需要管理员权限', 403);
  const id = Number(c.req.param('id'));
  const { pinned, locked } = await c.req.json().catch(() => ({}));
  const post = await c.env.DB.prepare('SELECT * FROM chat_posts WHERE id = ?').bind(id).first();
  if (!post) return fail(c, '帖子不存在', 404);

  const p = pinned === undefined ? post.pinned : (pinned ? 1 : 0);
  const l = locked === undefined ? post.locked : (locked ? 1 : 0);
  await c.env.DB.prepare('UPDATE chat_posts SET pinned = ?, locked = ? WHERE id = ?').bind(p, l, id).run();
  await audit(c, u.id, 'chat.flag', post.title.slice(0, 40), `置顶=${p} 锁定=${l}`);
  return ok(c, { pinned: p, locked: l });
});

export default app;
