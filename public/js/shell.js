/* ============================================================
   站点骨架：紫蓝渐变顶栏 + 左侧功能导航
   用法：页面里调 mountShell('domains') 即可，无需各自写导航。
   active 取值：domains | checkin | rewards | whois | chat | admin
   ============================================================ */

const SHELL_NAV = [
  { key: 'domains', name: '域名管理', icon: 'globe', href: '/dashboard.html', group: '控制台' },
  { key: 'whois', name: 'WHOIS 查询', icon: 'search', href: '/whois.html', group: '资源管理' },
  { key: 'transfer', name: '域名转移', icon: 'swap', href: '/transfer.html', group: '资源管理' },
  { key: 'checkin', name: '签到地', icon: 'calendar', href: '/checkin.html', group: '用户中心' },
  { key: 'rewards', name: '奖励中心', icon: 'gift', href: '/rewards.html', group: '用户中心' },
  { key: 'chat', name: '聊天地', icon: 'chat', href: '/chat.html', group: '用户中心' },
  { key: 'tickets', name: '工单系统', icon: 'ticket', href: '/tickets.html', group: '用户中心' },
  { key: 'profile', name: '个人资料', icon: 'user', href: '/profile.html', group: '用户中心' },
  { key: 'home', name: '站点首页', icon: 'home', href: '/home.html', group: '用户中心' },
];

const SHELL_ICON = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
  gift: '<path d="M20 7h-2.2A3 3 0 0 0 12 3.2 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3h8V8h2v3h8V8a1 1 0 0 0-1-1ZM4 13v7a1 1 0 0 0 1 1h6v-8H4Zm9 8h6a1 1 0 0 0 1-1v-7h-7v8Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.5-4.5"/>',
  chat: '<path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1Z"/><path d="M8 9h8M8 13h5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  ticket: '<path d="M4 5h16a1 1 0 0 1 1 1v4a2 2 0 0 0 0 4v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a2 2 0 0 0 0-4V6a1 1 0 0 1 1-1Z"/><path d="M9 9v6"/>',
  home: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8h5Z"/>',
  swap: '<path d="M7 4 3 8l4 4V9h9a2 2 0 0 1 2 2v1h2v-1a4 4 0 0 0-4-4H7V4Zm10 12 4-4-4-4v3H8a2 2 0 0 0-2 2v1H4v-1a4 4 0 0 1 4-4h9v3Z"/>',
  admin: '<path d="M12 3 4 6v6c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V6l-8-3Z"/><path d="M9.5 12l1.8 1.8L15 10"/>',
  terms: '<path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M10.5 20a2 2 0 0 0 3 0"/>',
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
  // 品牌 logo 现在在侧栏（顶栏改为面包屑）
  document.querySelectorAll('.side-brand img').forEach((li) => {
    if (li.getAttribute('src') !== b.logoUrl) li.src = b.logoUrl;
  });
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

/** 点猫爪 → 冒几个小爱心（纯装饰，走 transform 动画） */
function pawBurst(anchor) {
  for (let i = 0; i < 5; i++) {
    const h = document.createElement('i');
    h.className = 'heart';
    h.textContent = '♥';
    h.style.setProperty('--hx', ((Math.random() * 40) - 20).toFixed(0) + 'px');
    h.style.setProperty('--hy', (-24 - Math.random() * 26).toFixed(0) + 'px');
    h.style.animationDelay = (i * 0.055).toFixed(3) + 's';
    anchor.appendChild(h);
    setTimeout(() => h.remove(), 950);
  }
  anchor.classList.remove('tapped');
  void anchor.offsetWidth;
  anchor.classList.add('tapped');
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
  // 面包屑当前页名
  const EXTRA_NAME = { admin: '管理后台', terms: '服务条款', domain: '域名详情' };
  const _all = [...SHELL_NAV, { key: 'admin', name: '管理后台' }];
  const _cur = _all.find((x) => x.key === active);
  const curName = (opt.title || (_cur && _cur.name) || EXTRA_NAME[active] || '控制台');

  // 头像用邮箱首字符（圆形色块），比堆一长串邮箱更好看
  const initial = me ? (me.email || '?').trim().charAt(0).toUpperCase() : '';
  // 去掉 @ 域名部分，只显示用户名，避免手机上顶栏被撑爆
  const shortName = me ? String(me.email || '').split('@')[0] : '';

  host.innerHTML = `
    <div class="topbar-in">
      <button class="side-toggle" id="sideToggle" aria-label="菜单">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>

      <div class="crumb">首页<span>/</span><b>${esc(curName)}</b></div>

      <button class="top-search" id="topSearch" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:15px;height:15px"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.5-4.5"/></svg>
        <span>搜索</span><kbd>Ctrl K</kbd>
      </button>

      ${me ? `
        <button class="bell" id="bellBtn" title="通知" aria-label="通知">
          <svg viewBox="0 0 24 24">${SHELL_ICON.bell}</svg>
          <b id="bellCount" hidden></b>
        </button>
        <div class="user-chip" id="userChip" title="${esc(me.email)}" style="display:flex;align-items:center;gap:0;background:none;border:none;padding:0;box-shadow:none">
          <span class="avatar">${esc(initial)}</span>
        </div>
        <div class="user-menu" id="userMenu">
          <div class="um-head">
            <span class="avatar">${esc(initial)}</span>
            <div>
              <div class="um-name">${esc(shortName)}</div>
              <div class="um-mail">${esc(me.email)}</div>
            </div>
          </div>
          <div class="um-body">
            <a href="/dashboard.html">我的域名</a>
            <a href="/rewards.html">奖励中心</a>
            ${isAdmin ? '<a href="/admin.html">管理后台</a>' : ''}
            <a href="/terms.html">服务条款</a>
          </div>
          <div class="um-foot">
            <button class="btn sm ghost" id="btnLogout">退出登录</button>
          </div>
        </div>
      ` : `<a class="btn sm" href="/">登录</a>`}
    </div>`;

  const items = [...SHELL_NAV, { key: 'admin', name: '管理后台', icon: 'admin', href: '/admin.html', group: '系统' }];
  const visible = items.filter((it) => it.key !== 'admin' || isAdmin);
  // 按 group 顺序分组渲染（参照后台面板模板）
  const groups = [];
  visible.forEach((it) => {
    let g = groups.find((x) => x.name === it.group);
    if (!g) { g = { name: it.group, items: [] }; groups.push(g); }
    g.items.push(it);
  });

  side.innerHTML = `
    <div class="side-brand">
      <img src="${esc(brand.logoUrl)}" alt="">
      <b data-brand-name>${esc(brand.siteName)}</b>
    </div>
    <div class="side-in">
      ${groups.map((g) => `
        <div class="side-group">
          <div class="side-gtitle">${esc(g.name)}</div>
          ${g.items.map((it) => shellItem(it, active, isAdmin)).join('')}
        </div>`).join('')}
      <div class="side-group">
        <div class="side-gtitle">其它</div>
        <a class="side-item" href="/terms.html"><span class="side-ico"><svg viewBox="0 0 24 24">${SHELL_ICON.terms}</svg></span><span class="side-txt">服务条款</span></a>
        ${me ? `<a class="side-item" href="#" id="sideLogout"><span class="side-ico"><svg viewBox="0 0 24 24">${SHELL_ICON.logout}</svg></span><span class="side-txt">退出登录</span></a>` : ''}
      </div>
    </div>`;

  const tg = document.getElementById('sideToggle');
  const setSide = (open) => document.body.classList.toggle('side-open', open);
  if (tg) tg.onclick = () => setSide(!document.body.classList.contains('side-open'));
  // 移动端：点遮罩关闭、Esc 关闭、点菜单项后自动关闭（此前只能再点汉堡，容易「卡住」）
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('side-open')) return;
    if (e.target.closest?.('#sideToggle') || e.target.closest?.('.sidebar')) {
      if (e.target.closest?.('.side-item')) setSide(false);   // 选中导航后收起
      return;
    }
    setSide(false);   // 点遮罩/其它区域 → 关闭
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { setSide(false); const mm = document.getElementById('userMenu'); if (mm) { mm.classList.remove('on'); document.getElementById('userChip')?.classList.remove('on'); } }
  });

  /* 用户菜单：点 chip 展开，点外部或按 Esc 关闭 */
  const chip = document.getElementById('userChip');
  const menu = document.getElementById('userMenu');
  const setMenu = (open) => {
    if (!chip || !menu) return;
    chip.classList.toggle('on', open);
    menu.classList.toggle('on', open);
  };
  if (chip && menu) {
    chip.onclick = (e) => {
      e.stopPropagation();
      setMenu(!menu.classList.contains('on'));
    };
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => setMenu(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  }

  /* 顶栏猫爪：点一下放个小爱心 */
  const pawBtn = document.getElementById('pawBtn');
  if (pawBtn) pawBtn.onclick = () => pawBurst(pawBtn);

  const out = async () => {
    clearUserCache();
    try { await api.post('/api/auth/logout', {}); } catch {}
    location.href = '/?login=1';
  };
  const bl = document.getElementById('btnLogout');
  if (bl) bl.onclick = out;
  const sl = document.getElementById('sideLogout');
  if (sl) sl.onclick = (e) => { e.preventDefault(); out(); };

  /* 铃铛：未读消息数（失败静默） */
  const bellCount = document.getElementById('bellCount');
  const bellBtn = document.getElementById('bellBtn');
  if (bellBtn) {
    bellBtn.onclick = () => { location.href = '/tickets.html'; };
    api.get('/api/tickets/unread').then((r) => {
      const n = (r && (r.count ?? r.unread)) | 0;
      if (bellCount && n > 0) { bellCount.textContent = n > 99 ? '99+' : n; bellCount.hidden = false; }
    }).catch(() => {});
  }
  /* 搜索框：Ctrl+K 聚焦页面内的域名搜索，聚焦不到就跳域名管理页 */
  const ts = document.getElementById('topSearch');
  if (ts) ts.onclick = () => {
    const el = document.getElementById('label') || document.getElementById('qName') || document.getElementById('whoisName');
    if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else location.href = '/dashboard.html';
  };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      const el = document.getElementById('label') || document.getElementById('qName') || document.getElementById('whoisName');
      if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else location.href = '/dashboard.html';
    }
  });

  /* 公告条：后台可配置，未配置则不渲染 */
  try {
    const cfg = await api.get('/api/config');
    const notice = String(cfg.notice || cfg.announcement || '').trim();
    const main = document.querySelector('.main');
    if (notice && main && !document.getElementById('shellNotice')) {
      const n = document.createElement('div');
      n.id = 'shellNotice';
      n.className = 'notice';
      n.innerHTML = '<span class="n-ico"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z"/></svg></span><span>' + esc(notice) + '</span>';
      const first = main.querySelector('.main-in') || main.firstElementChild;
      if (first) main.insertBefore(n, first);
      else main.insertBefore(n, main.firstChild);
    }
  } catch {}

  /* 页脚 */
  try {
    const main = document.querySelector('.main');
    if (main && !document.getElementById('shellFoot')) {
      const f = document.createElement('footer');
      f.id = 'shellFoot';
      f.className = 'main-foot';
      f.innerHTML = '<b>MeoyDomain</b> · 二级域名分发与 DNS 管理 · <a href="https://github.com/wcvjk8tnz8-create/MeoyDomain" target="_blank" rel="noopener noreferrer" style="color:inherit">GitHub</a>';
      main.appendChild(f);
    }
  } catch {}

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
