/**
 * 用户资料：昵称 / 头像（内置头像库）/ 简介 / UID
 * 独立表 user_profiles，不动 users 结构（避免已存在表补列失败）。
 */
import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';
import { AVATARS } from '../lib/avatars.js';

const app = new Hono();

const DEFAULT_AVATAR = '/img/avatar/_default.svg';

/** 生成对外展示的 UID：不暴露自增 id */
function makeUid(userId) {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符
  let n = userId * 7919 + 104729;
  let s = '';
  for (let i = 0; i < 7; i++) {
    s += ALPHABET[n % ALPHABET.length];
    n = Math.floor(n / ALPHABET.length) + 31;
  }
  return 'VX' + s;
}

/** 头像合法性：只接受站内头像库或 http(s) 外链 */
function safeAvatar(v) {
  const s = String(v || '').trim();
  if (!s) return DEFAULT_AVATAR;
  if (AVATARS.some((a) => a.url === s)) return s;
  if (/^https:\/\/[^\s"']+\.(png|jpe?g|gif|webp|svg)(\?[^\s"']*)?$/i.test(s)) return s.slice(0, 500);
  return null; // 非法
}

/** 读取（不存在则自动创建初始资料） */
async function loadProfile(env, userId) {
  let p = await env.DB.prepare('SELECT * FROM user_profiles WHERE user_id = ?').bind(userId).first();
  if (!p) {
    const uid = makeUid(userId);
    await env.DB.prepare(
      'INSERT INTO user_profiles (user_id, uid, avatar, nickname, bio, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(userId, uid, DEFAULT_AVATAR, '', '', now())
      .run();
    p = { user_id: userId, uid, avatar: DEFAULT_AVATAR, nickname: '', bio: '' };
  }
  return p;
}

/** GET /api/profile —— 我的资料 + 头像库 */
app.get('/', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const p = await loadProfile(c.env, u.id);
  const full = await c.env.DB.prepare('SELECT created_at, last_login_at FROM users WHERE id = ?').bind(u.id).first();
  const dom = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM subdomains WHERE user_id = ? AND status IN ('pending','approved','suspended')"
  )
    .bind(u.id)
    .first();
  const rec = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM dns_records r
     JOIN subdomains s ON s.id = r.subdomain_id
     WHERE s.user_id = ?`
  )
    .bind(u.id)
    .first();

  return ok(c, {
    profile: {
      uid: p.uid,
      avatar: p.avatar || DEFAULT_AVATAR,
      nickname: p.nickname || '',
      bio: p.bio || '',
    },
    email: u.email,
    role: u.role,
    createdAt: full?.created_at || null,
    lastLoginAt: full?.last_login_at || null,
    domains: dom?.n || 0,
    records: rec?.n || 0,
    avatars: AVATARS,
  });
});

/** PUT /api/profile —— 更新昵称/头像/简介 */
app.put('/', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const body = await c.req.json().catch(() => ({}));

  const nickname = String(body.nickname ?? '').trim().slice(0, 24);
  const bio = String(body.bio ?? '').trim().slice(0, 160);
  const avatar = safeAvatar(body.avatar);
  if (body.avatar !== undefined && avatar === null) {
    return fail(c, '头像地址不合法：请选择内置头像，或填写 https 图片链接');
  }

  await loadProfile(c.env, u.id); // 确保有记录
  const sets = [];
  const vals = [];
  if (body.nickname !== undefined) { sets.push('nickname = ?'); vals.push(nickname); }
  if (body.bio !== undefined) { sets.push('bio = ?'); vals.push(bio); }
  if (body.avatar !== undefined) { sets.push('avatar = ?'); vals.push(avatar); }
  if (!sets.length) return fail(c, '没有要更新的内容');
  sets.push('updated_at = ?');
  vals.push(now(), u.id);

  await c.env.DB.prepare(`UPDATE user_profiles SET ${sets.join(', ')} WHERE user_id = ?`)
    .bind(...vals)
    .run();

  await audit(c, u.id, 'user.profile', u.email, sets.filter((s) => !s.startsWith('updated_at')).join(','));
  const p = await loadProfile(c.env, u.id);
  return ok(c, {
    profile: { uid: p.uid, avatar: p.avatar || DEFAULT_AVATAR, nickname: p.nickname || '', bio: p.bio || '' },
  });
});

export default app;
