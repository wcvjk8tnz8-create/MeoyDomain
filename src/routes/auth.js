import { Hono } from 'hono';
import { hashPassword, verifyPassword, randomToken } from '../lib/crypto.js';
import { ok, fail, now, audit, clientIp } from '../lib/util.js';
import { createSession, setSessionCookie, clearSessionCookie, destroySession, UNLIMITED } from '../middleware/auth.js';

const app = new Hono();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 允许的邮箱域名（默认 Gmail / QQ 邮箱），可用 ALLOWED_EMAIL_DOMAINS 覆盖 */
function allowedDomains(env) {
  return String(env.ALLOWED_EMAIL_DOMAINS || 'gmail.com,googlemail.com,qq.com,foxmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** 同 IP 允许的账号数 */
async function maxPerIp(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'max_accounts_per_ip'").first();
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2;
}

function publicUser(u) {
  return { id: u.id, email: u.email, role: u.role, status: u.status, quota: u.quota, created_at: u.created_at };
}

// 注册
app.post('/register', async (c) => {
  const env = c.env;
  if (env.ALLOW_SIGNUP === '0') return fail(c, '当前未开放注册', 403);
  const { email, password, agreeTerms } = await c.req.json().catch(() => ({}));
  const mail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) return fail(c, '请填写有效的邮箱地址');
  if (!password || String(password).length < 8) return fail(c, '密码至少 8 位');
  if (String(password).length > 128) return fail(c, '密码过长');

  // 邮箱域名白名单：仅 Gmail / QQ 邮箱（含 googlemail.com、foxmail.com）
  const domain = mail.split('@')[1] || '';
  const allow = allowedDomains(env);
  if (!allow.includes(domain))
    return fail(c, `当前仅支持 ${allow.map((d) => d.split('.')[0]).join(' / ')} 邮箱注册，你填写的是 ${domain || '未知域名'}`);

  // 必须同意服务条款
  if (!agreeTerms) return fail(c, '请先阅读并同意《服务条款与免责声明》', 400, { needAgree: true });

  const ip = clientIp(c);

  // IP 封禁名单
  if (ip) {
    const banned = await env.DB.prepare('SELECT reason FROM ip_bans WHERE ip = ?').bind(ip).first();
    if (banned) return fail(c, `该网络环境已被封禁：${banned.reason || '违规注册'}`, 403);
  }

  // 同一 IP 注册数量限制
  if (ip) {
    const limit = await maxPerIp(env);
    const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM registrations WHERE ip = ?').bind(ip).first();
    if ((cnt?.n || 0) >= limit)
      return fail(
        c,
        `同一网络最多注册 ${limit} 个账号，你已注册 ${cnt.n} 个。超出限制的账号一经发现将被全部封禁。`,
        403,
        { limit, current: cnt.n }
      );
  }

  const exist = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(mail).first();
  if (exist) return fail(c, '该邮箱已注册');

  // 第一位注册者自动成为管理员
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const role = count && count.n === 0 ? 'admin' : 'user';

  const hash = await hashPassword(String(password));
  // 管理员不限量，普通用户用默认配额
  const quota = role === 'admin' ? UNLIMITED : Number(env.DEFAULT_QUOTA || 5);
  const res = await env.DB.prepare(
    'INSERT INTO users (email, password_hash, role, status, quota, created_at) VALUES (?,?,?,?,?,?)'
  )
    .bind(mail, hash, role, 'active', quota, now())
    .run();

  const userId = res.meta?.last_row_id;
  // 记录注册来源（IP / UA / 条款同意）
  await env.DB.prepare(
    'INSERT INTO registrations (user_id, ip, ua, agreed_terms, created_at) VALUES (?,?,?,?,?)'
  )
    .bind(userId, ip, (c.req.header('user-agent') || '').slice(0, 300), 1, now())
    .run();

  await audit(
    c,
    userId,
    'user.register',
    mail,
    (role === 'admin' ? '首位用户，自动设为管理员（不限配额）' : '') || `ip=${ip || '未知'}`
  );
  const { token } = await createSession(c, userId);
  setSessionCookie(c, token);
  return ok(c, {
    user: { id: userId, email: mail, role, status: 'active', quota, quotaUnlimited: quota < 0 },
    isFirstAdmin: role === 'admin',
  });
});

// 登录
app.post('/login', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  const mail = String(email || '').trim().toLowerCase();
  if (!mail || !password) return fail(c, '请输入邮箱和密码');

  const ip = clientIp(c);
  if (ip) {
    const banned = await c.env.DB.prepare('SELECT reason FROM ip_bans WHERE ip = ?').bind(ip).first();
    if (banned) return fail(c, `该网络环境已被封禁：${banned.reason || '违规注册'}`, 403);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(mail).first();
  if (!user) return fail(c, '邮箱或密码错误');
  const pass = await verifyPassword(String(password), user.password_hash);
  if (!pass) return fail(c, '邮箱或密码错误');
  if (user.status === 'banned') return fail(c, `账号已被封禁：${user.ban_reason || '违规使用'}`, 403);

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), user.id).run();
  // 老账号补记注册来源，便于同 IP 判定
  if (ip) {
    const reg = await c.env.DB.prepare('SELECT id FROM registrations WHERE user_id = ?').bind(user.id).first();
    if (!reg) {
      await c.env.DB.prepare(
        'INSERT INTO registrations (user_id, ip, ua, agreed_terms, created_at) VALUES (?,?,?,?,?)'
      )
        .bind(user.id, ip, (c.req.header('user-agent') || '').slice(0, 300), 1, now())
        .run();
    }
  }
  const { token } = await createSession(c, user.id);
  setSessionCookie(c, token);
  await audit(c, user.id, 'user.login', mail);
  return ok(c, { user: publicUser(user) });
});

// 登出
app.post('/logout', async (c) => {
  const u = c.get('user');
  if (u) {
    await destroySession(c, u.token);
    await audit(c, u.id, 'user.logout', u.email);
  }
  clearSessionCookie(c);
  return ok(c, {});
});

// 当前登录信息
app.get('/me', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '未登录', 401, { needLogin: true });
  const full = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first();
  const used = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM subdomains WHERE user_id = ? AND status IN ('pending','approved','suspended')"
  )
    .bind(u.id)
    .first();
  return ok(c, { user: publicUser(full), used: used?.n || 0 });
});

// 修改密码
app.post('/password', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const { oldPassword, newPassword } = await c.req.json().catch(() => ({}));
  if (!newPassword || String(newPassword).length < 8) return fail(c, '新密码至少 8 位');
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first();
  if (!(await verifyPassword(String(oldPassword || ''), user.password_hash))) return fail(c, '原密码不正确');
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(await hashPassword(String(newPassword)), u.id)
    .run();
  // 改密后踢掉其它会话
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(u.id, u.token).run();
  await audit(c, u.id, 'user.password', u.email);
  return ok(c, {});
});

// 刷新令牌（防止忘记 password hash 时手工重置，仅管理员在控制台调用）
app.post('/reset-token', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const token = randomToken(16);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind('reset:' + token, u.id).run();
  return ok(c, { token });
});

export default app;
