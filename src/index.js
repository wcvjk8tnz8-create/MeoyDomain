import { Hono } from 'hono';
import { attachUser, requireAuth, requireAdmin } from './middleware/auth.js';
import { ok, fail } from './lib/util.js';
import { RECORD_TYPES, TTL_CHOICES, VERIFY_PRESETS, TYPE_NAMES } from './lib/records.js';
import authRoutes from './routes/auth.js';
import termsRoutes from './routes/terms.js';
import whoisRoutes from './routes/whois.js';
import delegationRoutes from './routes/delegation.js';
import subdomainRoutes from './routes/subdomains.js';
import recordRoutes from './routes/records.js';
import adminRoutes from './routes/admin.js';

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

app.use('*', attachUser);

// 健康检查
app.get('/api/health', (c) =>
  ok(c, { ok: true, root: c.env.ROOT_DOMAIN, mock: c.env.CF_MOCK === '1', time: new Date().toISOString() })
);

// 前端初始化配置
// 公开配置（含站点品牌，登录页也要用）
app.get('/api/config', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('site_name','logo_url','favicon_url')"
  ).all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return ok(c, {
    rootDomain: c.env.ROOT_DOMAIN,
    allowSignup: c.env.ALLOW_SIGNUP !== '0',
    requireApproval: c.env.REQUIRE_APPROVAL === '1',
    recordTypes: TYPE_NAMES.map((k) => ({ key: k, ...RECORD_TYPES[k] })),
    ttlChoices: TTL_CHOICES,
    verifyPresets: VERIFY_PRESETS,
    siteName: s.site_name || 'Meoy',
    logoUrl: s.logo_url || '/img/logo.jpg',
    faviconUrl: s.favicon_url || '/favicon.ico',
  });
});

// 认证
app.route('/api/auth', authRoutes);
app.route('/api', termsRoutes);
// WHOIS 公开查询（无需登录）
app.route('/api', whoisRoutes);

// 需要登录的接口
app.use('/api/subdomains/*', requireAuth);
app.use('/api/delegation/*', requireAuth);
app.use('/api/records/*', requireAuth);
app.use('/api/soa', requireAuth);
app.use('/api/admin/*', requireAuth, requireAdmin);

app.route('/api', recordRoutes);
app.route('/api/subdomains', subdomainRoutes);
// NS 委派：/api/delegation/providers 与 /api/subdomains/:id/delegation
app.route('/api/delegation', delegationRoutes);
app.route('/api/subdomains', delegationRoutes);
app.route('/api/admin', adminRoutes);

// API 兜底
app.all('/api/*', (c) => fail(c, '接口不存在', 404));
app.notFound((c) => fail(c, '页面不存在', 404));

export default app;
