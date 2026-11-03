import { listRoots } from './lib/roots.js';
import { mergeRootEnv } from './lib/rootStore.js';
import { DEFAULT_MESSAGE } from './lib/applyGate.js';
import { Hono } from 'hono';
import { attachUser, requireAuth, requireAdmin } from './middleware/auth.js';
import { ok, fail } from './lib/util.js';
import { RECORD_TYPES, TTL_CHOICES, VERIFY_PRESETS, TYPE_NAMES } from './lib/records.js';
import authRoutes from './routes/auth.js';
import termsRoutes from './routes/terms.js';
import whoisRoutes from './routes/whois.js';
import delegationRoutes from './routes/delegation.js';
import pointRoutes from './routes/points.js';
import subdomainRoutes from './routes/subdomains.js';
import recordRoutes from './routes/records.js';
import adminRoutes from './routes/admin.js';
import redeemRoutes from './routes/redeem.js';
import chatRoutes from './routes/chat.js';
import notificationRoutes from './routes/notifications.js';
import profileRoutes from './routes/profile.js';
import ticketRoutes from './routes/tickets.js';
import transferRoutes from './routes/transfer.js';

const app = new Hono();

// /api/xxx/ 与 /api/xxx 等价（去掉结尾斜杠后重新分发）
app.use('/api/*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.pathname.length > 1 && url.pathname.endsWith('/') && !c.req.header('x-rewrite')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
    const headers = new Headers(c.req.raw.headers);
    headers.set('x-rewrite', '1');
    const req = new Request(url.toString(), { method: c.req.method, headers, body: c.req.raw.body });
    return app.fetch(req, c.env, c.executionCtx);
  }
  return next();
});

/**
 * whois.<根域名> 服务端重定向（不依赖前端 JS，最可靠）
 *  - /            → /whois.html
 *  - /google      → /whois.html?name=google
 *
 * 铁律：WHOIS 页本身（/whois.html、/whois、带查询串）永不被重定向，
 * 且不受任何登录态影响。下面的白名单在任何其它判断之前生效。
 */
app.use('*', async (c, next) => {
  let u;
  try { u = new URL(c.req.url); } catch { return next(); }
  const p = u.pathname;

  // ① WHOIS 页与接口、静态资源：绝对放行，任何 host 都不重定向
  if (/^\/whois(\.html)?$/i.test(p)) return next();
  if (p.startsWith('/api/')) return next();
  if (/\.(css|js|png|jpg|jpeg|ico|svg|json|txt|woff2?)$/i.test(p)) return next();

  const seg = u.hostname.toLowerCase().split('.');
  if (seg.length < 3 || seg[0] !== 'whois') return next();

  // ② 只接管入口页（/ 与 /index.html）
  const root = p.replace(/^\/+|\/+$/g, '');
  if (root === '' || root === 'index.html') {
    return c.redirect('/whois.html', 302);
  }

  // ③ whois.<域>/<名称> 直接查询：仅限单一路径段且不是任何已知页面
  const KNOWN = new Set(['whois', 'whois.html', 'dashboard', 'dashboard.html',
    'admin', 'admin.html', 'domain', 'domain.html', 'terms', 'terms.html', 'index.html']);
  if (!KNOWN.has(root.toLowerCase()) && !/[./]/.test(root) && !u.search) {
    return c.redirect(`/whois.html?name=${encodeURIComponent(root)}`, 302);
  }
  return next();
});

app.use('*', attachUser);

/**
 * 动态根域名：把后台「Spaceship 导入」添加的域名合并进本次请求的 env。
 * 这样 roots.ts（纯函数）与所有既有调用点都不用改，配置保存后下一个请求即生效。
 * 无动态配置时不做任何赋值，零开销。
 */
app.use('*', async (c, next) => {
  try {
    const merged = await mergeRootEnv(c.env);
    if (merged) c.env = merged;   // Hono Context.env 是普通属性，可安全替换
  } catch { /* settings 表尚未建立等异常：降级走原环境变量，不影响站点 */ }
  return next();
});

// 健康检查
app.get('/api/health', (c) =>
  ok(c, { ok: true, root: c.env.ROOT_DOMAIN, mock: c.env.CF_MOCK === '1', time: new Date().toISOString() })
);

// 头像读取代理（未配置 R2 公开域名时走这里；已配置则可直连 R2）
app.get('/api/avatar/:key', async (c) => {
  const key = String(c.req.param('key') || '');
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(key)) return c.text('bad key', 400);
  // 与上传一致：未显式启用（AVATAR_ENABLED=1）时一律当作未配置
  if (!c.env.AVATARS || String(c.env.AVATAR_ENABLED || '').trim() !== '1') {
    return c.text('avatar storage not configured', 404);
  }
  const obj = await c.env.AVATARS.get(key);
  if (!obj) return c.text('not found', 404);
  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/png');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(obj.body, { headers });
});

// 前端初始化配置
// 公开配置（含站点品牌，登录页也要用）
app.get('/api/config', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('site_name','logo_url','favicon_url','font_body','font_display','mail_verify_required','mail_provider','mail_from','apply_paused','apply_paused_message')"
  ).all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  // 注册是否需要邮箱验证码（后台开启且邮件服务已配置时才真正启用）
  const mailOk = !!(String(s.mail_provider || c.env.MAIL_PROVIDER || '').trim()
    && String(c.env.MAIL_API_KEY || '').trim());
  const verifyRequired =
    String(c.env.MAIL_VERIFY_REQUIRED || s.mail_verify_required || '0').trim() === '1';
  return ok(c, {
    rootDomain: c.env.ROOT_DOMAIN,
    rootDomains: listRoots(c.env).map((r) => r.domain),
    allowSignup: c.env.ALLOW_SIGNUP !== '0',
    requireApproval: c.env.REQUIRE_APPROVAL === '1',
    applyPaused: String(c.env.APPLY_PAUSED || s.apply_paused || '').trim() === '1',
    applyPausedMessage: String(s.apply_paused_message || '').trim() || DEFAULT_MESSAGE,
    recordTypes: TYPE_NAMES.map((k) => ({ key: k, ...RECORD_TYPES[k] })),
    ttlChoices: TTL_CHOICES,
    verifyPresets: VERIFY_PRESETS,
    siteName: s.site_name || 'Meoy',
    logoUrl: s.logo_url || '/img/logo.jpg',
    faviconUrl: s.favicon_url || '/favicon.ico',
    fontBody: s.font_body || 'zcool',
    fontDisplay: s.font_display || 'zcool',
    // 邮箱验证码：mailOk 表示邮件服务已配置（可发送），verifyRequired 表示后台开了注册验证
    mailOk,
    mailVerifyRequired: verifyRequired,
    verifyRequired: verifyRequired && mailOk,
  });
});

// 认证
app.route('/api/auth', authRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api', termsRoutes);
// WHOIS 公开查询（无需登录）
app.route('/api', whoisRoutes);

// 需要登录的接口
app.use('/api/subdomains/*', requireAuth);
app.use('/api/points/*', requireAuth);
app.use('/api/delegation/*', requireAuth);
app.use('/api/records/*', requireAuth);
app.use('/api/soa', requireAuth);
app.use('/api/admin/*', requireAuth, requireAdmin);
app.use('/api/redeem/*', requireAuth);
app.use('/api/chat/*', requireAuth);
app.use('/api/profile/*', requireAuth);
app.use('/api/tickets/*', requireAuth);
app.use('/api/transfer/*', requireAuth);

app.route('/api', recordRoutes);
app.route('/api/profile', profileRoutes);
app.route('/api/tickets', ticketRoutes);
app.route('/api/transfer', transferRoutes);
app.route('/api/points', pointRoutes);
app.route('/api/subdomains', subdomainRoutes);
// NS 委派：/api/delegation/providers 与 /api/subdomains/:id/delegation
app.route('/api/delegation', delegationRoutes);
app.route('/api/subdomains', delegationRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/redeem', redeemRoutes);
app.route('/api/chat', chatRoutes);

// API 兜底
app.all('/api/*', (c) => fail(c, '接口不存在', 404));

// 静态资源：run_worker_first = true 时由 Worker 回落到 ASSETS
// 注意：不要自己改写路径（补 index.html、去 .html 等）。
// ASSETS 自带规范化（/xxx.html ⇄ /xxx），Worker 再改一次就会形成自指 307 循环。
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

app.notFound((c) => fail(c, '页面不存在', 404));

export default app;
