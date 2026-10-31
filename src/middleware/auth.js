import { randomToken } from '../lib/crypto.js';
import { now, clientIp, fail } from '../lib/util.js';

export const COOKIE = 'sh_session';
export const UNLIMITED = -1; // quota 为 -1 表示不限量
const TTL_MS = 30 * 24 * 3600 * 1000; // 30 天

export async function createSession(c, userId) {
  const token = randomToken(32);
  const expires = now() + TTL_MS;
  await c.env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, created_at, ip, ua) VALUES (?,?,?,?,?,?)'
  )
    .bind(token, userId, expires, now(), clientIp(c), (c.req.header('user-agent') || '').slice(0, 200))
    .run();
  return { token, expires };
}

export function setSessionCookie(c, token) {
  const secure = new URL(c.req.url).protocol === 'https:' ? 'Secure; ' : '';
  c.header(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=${TTL_MS / 1000}`,
    { append: true }
  );
}

export function clearSessionCookie(c) {
  const secure = new URL(c.req.url).protocol === 'https:' ? 'Secure; ' : '';
  c.header('Set-Cookie', `${COOKIE}=; HttpOnly; ${secure}SameSite=Lax; Path=/; Max-Age=0`, { append: true });
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

// 解析登录态，把 user 挂到上下文（不强制）
export async function attachUser(c, next) {
  c.set('user', null);
  const token = parseCookies(c.req.header('cookie'))[COOKIE];
  if (!token) return next();
  const row = await c.env.DB.prepare(
    `SELECT s.user_id, s.expires_at, u.email, u.role, u.status, u.quota, u.ban_reason
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  )
    .bind(token)
    .first();
  if (!row || row.expires_at < now()) return next();
  // quota < 0 表示不限量；管理员始终不限量
  const quota = row.role === 'admin' ? UNLIMITED : row.quota;
  c.set('user', {
    id: row.user_id,
    email: row.email,
    role: row.role,
    status: row.status,
    quota,
    quotaUnlimited: quota < 0 || row.role === 'admin',
    ban_reason: row.ban_reason,
    token,
  });
  return next();
}

export async function requireAuth(c, next) {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  if (u.status === 'banned') return fail(c, `账号已被封禁：${u.ban_reason || '违规使用'}`, 403, { banned: true });
  return next();
}

export async function requireAdmin(c, next) {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  if (u.role !== 'admin') return fail(c, '需要管理员权限', 403);
  return next();
}

export async function destroySession(c, token) {
  await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}
