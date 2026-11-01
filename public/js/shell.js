/* ============================================================
   站点骨架：紫蓝渐变顶栏 + 左侧功能导航
   用法：页面里调 mountShell('domains') 即可，无需各自写导航。
   active 取值：domains | checkin | rewards | whois | chat | admin
   ============================================================ */

const SHELL_NAV = [
  { key: 'domains', name: '域名管理', icon: 'globe', href: '/dashboard.html' },
  { key: 'checkin', name: '签到地', icon: 'calendar', href: '/checkin.html' },
  { key: 'rewards', name: '奖励中心', icon: 'gift', href: '/rewards.html' },
  { key: 'whois', name: 'WHOIS 查询', icon: 'search', href: '/whois.html' },
  { key: 'chat', name: '聊天地', icon: 'chat', href: '/chat.html' },
];

const SHELL_ICON = {
  globe: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2c1.3 0 2.6 2 3.2 5H8.8C9.4 6 10.7 4 12 4ZM4.3 9h3.1c-.1 1-.2 2.1-.2 3s.1 2 .2 3H4.3a8 8 0 0 1 0-6Zm1.1 8h3.4c.6 3 1.9 5 3.2 5-2.5 0-4.8-2-6.6-5Zm4.6 0h7.9c-1.8 3-4.1 5-6.6 5 1.3 0 2.6-2 3.2-5h-4.5Zm8.6-2c.1-1 .2-2.1.2-3s-.1-2-.2-3h3.1a8 8 0 0 1 0 6h-3.1Z"/>',
  calendar: '<path d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7Zm12 8v9H5v-9h14ZM8 12h3v3H8v-3Z"/>',
  gift: '<path d="M20 7h-2.2A3 3 0 0 0 12 3.2 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3h8V8h2v3h8V8a1 1 0 0 0-1-1ZM4 13v7a1 1 0 0 0 1 1h6v-8H4Zm9 8h6a1 1 0 0 0 1-1v-7h-7v8Z"/>',
  search: '<path d="M10 2a8 8 0 1 0 4.9 14.3l4.4 4.4 1.4-1.4-4.4-4.4A8 8 0 0 0 10 2Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z"/>',
  chat: '<path d="M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8l-4 4V4a1 1 0 0 1 1-1Zm2 4v2h12V7H6Zm0 4v2h9v-2H6Z"/>',
  admin: '<path d="M12 2 3 6v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V6l-9-4Zm0 2.2 7 3.1V12c0 4-2.9 7.5-7 8-4.1-.5-7-4-7-8V7.3l7-3.1Zm-1 4v2H8v2h3v2h2v-2h3v-2h-3V8.2h-2Z"/>',
  terms: '<path d="M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 2v4h4l-4-4ZM8 11h8v2H8v-2Zm0 4h8v2H8v-2Z"/>',
  logout: '<path d="M5 3h9a1 1 0 0 1 1 1v4h-2V5H6v14h7v-3h2v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm9.6 4.6 1.4 1.4L18 11H9v2h9l-2 2-1.4 1.4L19.2 11l-4.6-4.6Z"/>',
};

/* ---------- 品牌信息缓存（避免每次切页都等一个网络往返） ---------- */
const BRAND_KEY = 'meoy_brand';
const BRAND_TTL = 5 * 60 * 1000;   // 5 分钟

function readBrandCache() {
  try {
    const raw = sessionStorage.getItem(BRAND_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || Date.now() - o.t > BRAND_TTL) return null;
    return o.v;
  } catch { return null; }
}

function writeBrandCache(v) {
  try { sessionStorage.setItem(BRAND_KEY, JSON.stringify({ t: Date.now(), v })); } catch {}
}

/** 就地更新品牌（顶栏 logo / 站点名 / 标题） */
function applyBrand(b) {
  document.querySelectorAll('[data-brand-name]').forEach((el) => (el.textContent = b.siteName));
  const li = document.getElementById('topLogo');
  if (li && li.src !== b.logoUrl) li.src = b.logoUrl;
  const t = document.title;
  const i = t.lastIndexOf(' · ');
  if (i > 0) document.title = t.slice(0, i) + ' · ' + b.siteName;
}

/* ---------- 链接预取：hover / 空闲时把目标页 HTML 拉进缓存 ---------- */
const prefetched = new Set();
function prefetch(url) {
  if (!url || prefetched.has(url)) return;
  prefetched.add(url);
  try {
    const l = document.createElement('link');
    l.rel = 'prefetch';
    l.as = 'document';
    l.href = url;
    document.head.appendChild(l);
  } catch {}
}

/** 侧栏链接 hover 即预取，点击时几乎瞬时 */
function bindPrefetch(root) {
  (root || document).querySelectorAll('#sidebar a[href], .top-brand[href]').forEach((a) => {
    const h = a.getAttribute('href') || '';
    if (!h || h.charAt(0) !== '/' || h.indexOf('.html') < 0) return;
    const go = () => prefetch(h);
    a.addEventListener('mouseenter', go, { once: true, passive: true });
    a.addEventListener('touchstart', go, { once: true, passive: true });
  });
}

/* ---------- 用户信息缓存：切页时侧栏立即渲染，不等网络 ---------- */
const USER_KEY = 'meoy_user';

function readUserCache() {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeUserCache(u) {
  try { sessionStorage.setItem(USER_KEY, JSON.stringify(u)); } catch {}
}

// 注意：shell.js 以普通 <script> 加载，不能用 export 语法
function clearUserCache() {
  try { sessionStorage.removeItem(USER_KEY); } catch {}
}

/** 生成侧边栏一项 */
function shellItem(it, active, isAdmin) {
  if (it.key === 'admin' && !isAdmin) return '';
  const on = it.key === active;
  return `<a class="side-item${on ? ' on' : ''}" href="${it.href}" data-key="${it.key}">
    <span class="side-ico"><svg viewBox="0 0 24 24">${SHELL_ICON[it.icon] || SHELL_ICON.globe}</svg></span>
    <span class="side-txt">${it.name}</span>
  </a>`;
}

/**
 * 挂载骨架
 * @param {string} active  当前页签
 * @param {object} opt     { optional: 未登录也允许停留 }
 */
async function mountShell(active, opt = {}) {
  const host = document.getElementById('topbar');
  const side = document.getElementById('sidebar');
  if (!host || !side) return;

  // 品牌 + 用户信息都走 sessionStorage 缓存，命中时不等待任何网络往返 —— 切页零阻塞
  let brand = readBrandCache() || { siteName: 'Meoy', logoUrl: '/img/logo.jpg' };
  let me = readUserCache();

  // 无缓存时才等网络（首次进入 / 硬刷新）
  if (!me || !me.id) {
    try {
      const r = await api.get('/api/auth/me');
      me = (r && r.user) || r || null;   // 接口返回 { success, user }
      if (me && me.id) writeUserCache(me);
    } catch { me = null; }
  }
  if (!me || !me.id) {
    if (!opt.optional) { location.href = '/'; return; }
    me = null;
  }

  document.querySelectorAll('[data-brand-name]').forEach((el) => (el.textContent = brand.siteName));
  // 后台刷新品牌（不阻塞渲染），拿到后再就地更新
  api.get('/api/config').then((cfg) => {
    const b = { siteName: cfg.siteName || cfg.site_name || 'Meoy', logoUrl: cfg.logoUrl || cfg.logo_url || '/img/logo.jpg' };
    writeBrandCache(b);
    if (b.siteName !== brand.siteName || b.logoUrl !== brand.logoUrl) applyBrand(b);
  }).catch(() => {});

  const isAdmin = me && me.role === 'admin';

  host.innerHTML = `
    <div class="topbar-in">
      <button class="side-toggle" id="sideToggle" aria-label="菜单">
        <svg viewBox="0 0 24 24"><path d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z"/></svg>
      </button>
      <a class="top-brand" href="/dashboard.html">
        <img id="topLogo" src="${esc(brand.logoUrl)}" alt="">
        <span data-brand-name>${esc(brand.siteName)}</span>
      </a>
      <div class="top-right">
        ${me
          ? `<span class="top-user" title="${esc(me.email)}">
               ${esc(me.email)}
               ${isAdmin ? '<span class="badge inf">管理员</span>' : ''}
             </span>
             <button class="btn sm ghost" id="btnLogout">退出</button>`
          : `<a class="btn sm primary" href="/">登录</a>`}
      </div>
    </div>`;

  const items = [...SHELL_NAV, { key: 'admin', name: '管理后台', icon: 'admin', href: '/admin.html' }];
  side.innerHTML = `
    <div class="side-in">
      <div class="side-group">
        ${items.map((it) => shellItem(it, active, isAdmin)).join('')}
      </div>
      <div class="side-group">
        <a class="side-item" href="/terms.html"><span class="side-ico"><svg viewBox="0 0 24 24">${SHELL_ICON.terms}</svg></span><span class="side-txt">服务条款</span></a>
        ${me ? `<a class="side-item" href="#" id="sideLogout"><span class="side-ico"><svg viewBox="0 0 24 24">${SHELL_ICON.logout}</svg></span><span class="side-txt">退出登录</span></a>` : ''}
      </div>
    </div>`;

  const tg = document.getElementById('sideToggle');
  if (tg) tg.onclick = () => document.body.classList.toggle('side-open');

  const out = async () => {
    clearUserCache();
    try { await api.post('/api/auth/logout', {}); } catch {}
    location.href = '/?login=1';
  };
  const bl = document.getElementById('btnLogout');
  if (bl) bl.onclick = out;
  const sl = document.getElementById('sideLogout');
  if (sl) sl.onclick = (e) => { e.preventDefault(); out(); };

  bindPrefetch(side);
  // 空闲时预取其余常用页（不抢占当前页资源）
  idle(() => ['/dashboard.html', '/whois.html', '/checkin.html', '/rewards.html', '/chat.html'].forEach(prefetch));

  // 入场动画
  document.body.classList.add('shell-ready');
  return me;
}

/** requestIdleCallback 兜底 */
function idle(fn) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 2500 });
  else setTimeout(fn, 1200);
}
