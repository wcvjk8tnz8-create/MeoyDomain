/**
 * 站内切页预取：点链接的那一瞬间就并行发起目标页首屏接口，
 * 目标页控制器再读缓存直接渲染 —— 不再「切过去 → 空壳 → 一个个串行等接口」。
 *
 * 只做同源只读 GET：不抛错、不触发 401 跳转、不写任何状态。
 * 失败或非 success 的响应不入缓存，交给页面自己走正常请求处理。
 */
const TTL = 6000;

/** 路由 → 首屏 GET 清单。动态参数从目标 URL 上取，取不到就不预取那条。 */
const ROUTE_DATA: Record<string, (u: URL) => string[]> = {
  '/': () => ['/api/config'],
  '/index.html': () => ['/api/config'],
  '/home': () => ['/api/config'],
  '/home.html': () => ['/api/config'],
  '/login': () => ['/api/config'],
  '/login.html': () => ['/api/config'],
  '/dashboard': () => [
    '/api/subdomains', '/api/config', '/api/points/me', '/api/auth/me', '/api/profile',
  ],
  '/dashboard.html': () => [
    '/api/subdomains', '/api/config', '/api/points/me', '/api/auth/me', '/api/profile',
  ],
  '/domain': (u) => {
    const id = u.searchParams.get('id') || u.searchParams.get('sub') || '';
    return ['/api/config', '/api/delegation/providers', '/api/subdomains',
      ...(id ? ['/api/subdomains/' + encodeURIComponent(id)] : [])];
  },
  '/domain.html': (u) => ROUTE_DATA['/domain'](u),
  '/register': () => ['/api/config', '/api/rules', '/api/auth/me'],
  '/register.html': () => ['/api/config', '/api/rules', '/api/auth/me'],
  '/whois': (u) => {
    const name = u.searchParams.get('name') || '';
    return ['/api/config', '/api/auth/me',
      ...(name ? ['/api/whois?name=' + encodeURIComponent(name)] : [])];
  },
  '/whois.html': (u) => ROUTE_DATA['/whois'](u),
  '/admin': (u) => {
    const pending = u.searchParams.get('status') === 'pending';
    return ['/api/config', '/api/admin/stats',
      '/api/admin/subdomains' + (pending ? '?status=pending' : ''),
      '/api/admin/settings'];
  },
  '/admin.html': (u) => ROUTE_DATA['/admin'](u),
  '/checkin': () => ['/api/config', '/api/points/me'],
  '/checkin.html': () => ['/api/config', '/api/points/me'],
  '/rewards': () => ['/api/config', '/api/redeem/mine', '/api/subdomains'],
  '/rewards.html': () => ['/api/config', '/api/redeem/mine', '/api/subdomains'],
  '/chat': () => ['/api/config', '/api/chat/posts?page=1&q='],
  '/chat.html': () => ['/api/config', '/api/chat/posts?page=1&q='],
  '/tickets': () => ['/api/config', '/api/tickets?status='],
  '/tickets.html': () => ['/api/config', '/api/tickets?status='],
  '/transfer': () => ['/api/config', '/api/transfer/notice', '/api/transfer/mine', '/api/subdomains'],
  '/transfer.html': () => ['/api/config', '/api/transfer/notice', '/api/transfer/mine', '/api/subdomains'],
  '/profile': () => ['/api/config', '/api/profile', '/api/auth/me'],
  '/profile.html': () => ['/api/config', '/api/profile', '/api/auth/me'],
  '/terms': () => ['/api/terms', '/api/auth/me'],
  '/terms.html': () => ['/api/terms', '/api/auth/me'],
  '/report': () => ['/api/config', '/api/auth/me', '/api/abuse/mine'],
  '/report.html': () => ['/api/config', '/api/auth/me', '/api/abuse/mine'],
  '/abuse': () => ROUTE_DATA['/report'](new URL(location.href)),
  '/abuse.html': () => ROUTE_DATA['/report'](new URL(location.href)),
};

type Entry = { at: number; ok: boolean; data: any; promise: Promise<any> };
const cache = new Map<string, Entry>();

function canonical(pathname: string): string {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (ROUTE_DATA[p]) return p;
  if (ROUTE_DATA[p + '.html']) return p + '.html';
  return '/';
}

function prefetchOne(path: string): Promise<any> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL) return hit.promise;
  const promise = fetch(path, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Lang': document.documentElement.getAttribute('data-lang') || 'zh' },
    credentials: 'same-origin',
  })
    .then((r) => r.json().catch(() => ({})))
    .then((data: any) => {
      const ok = !!(data && data.success);
      cache.set(path, { at: Date.now(), ok, data, promise });
      return data;
    })
    .catch(() => { cache.delete(path); return {}; });
  cache.set(path, { at: Date.now(), ok: false, data: null, promise });
  return promise;
}

/** 点击链接 / 后退时立刻调用；返回的 Promise 在「首屏数据都到手」时 resolve。 */
export function prefetchRoute(href: string): Promise<void> {
  try {
    const u = new URL(href, location.href);
    const paths = (ROUTE_DATA[canonical(u.pathname)] || (() => []))(u);
    return Promise.all(paths.map(prefetchOne)).then(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

/** api.get 优先消费预取结果；一次性，命中后不重复用旧数据。 */
export function takePrefetched(path: string): any | null {
  const e = cache.get(path);
  if (!e) return null;
  cache.delete(path);
  if (!e.ok || Date.now() - e.at > TTL) return null;
  return e.data;
}

/** 页面内写入数据后清掉相关预取，避免下次切回看到旧值。 */
export function invalidatePrefetch(prefix = '') {
  if (!prefix) { cache.clear(); return; }
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}
