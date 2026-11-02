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


/* ---------- v2：SVG 精灵（猫脸头像 / 猫娘吉祥物） ---------- */
const NEKO_SPRITE = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="catface" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="var(--bg,#cfe4ff)"/>
    <circle cx="20" cy="22" r="3" fill="#fff" opacity=".7"/><circle cx="82" cy="30" r="2.2" fill="#fff" opacity=".8"/><circle cx="76" cy="80" r="3.5" fill="#fff" opacity=".5"/>
    <path d="M18 46 L20 16 Q21 12 25 14 L44 28 Z" fill="var(--fur,#fff)" stroke="var(--line,#5a6aa0)" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M82 46 L80 16 Q79 12 75 14 L56 28 Z" fill="var(--fur,#fff)" stroke="var(--line,#5a6aa0)" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M24 38 L25 22 L37 31 Z" fill="var(--ear,#ffb6d1)"/>
    <path d="M76 38 L75 22 L63 31 Z" fill="var(--ear,#ffb6d1)"/>
    <ellipse cx="50" cy="60" rx="35" ry="30" fill="var(--fur,#fff)" stroke="var(--line,#5a6aa0)" stroke-width="2.5"/>
    <ellipse cx="36" cy="60" rx="6" ry="7.5" fill="var(--eye,#3b4a7a)"/><ellipse cx="64" cy="60" rx="6" ry="7.5" fill="var(--eye,#3b4a7a)"/>
    <circle cx="38" cy="57" r="2.4" fill="#fff"/><circle cx="66" cy="57" r="2.4" fill="#fff"/>
    <circle cx="35" cy="63" r="1.2" fill="#fff"/><circle cx="63" cy="63" r="1.2" fill="#fff"/>
    <ellipse cx="26" cy="72" rx="6" ry="3.5" fill="#ff9ab8" opacity=".6"/><ellipse cx="74" cy="72" rx="6" ry="3.5" fill="#ff9ab8" opacity=".6"/>
    <path d="M44 72 Q47 76 50 72 Q53 76 56 72" fill="none" stroke="var(--line,#5a6aa0)" stroke-width="2" stroke-linecap="round"/>
    <path d="M12 62 L22 64 M12 70 L22 69 M88 62 L78 64 M88 70 L78 69" stroke="var(--line,#5a6aa0)" stroke-width="1.6" stroke-linecap="round" opacity=".6"/>
    <path d="M50 28 q-3 -6 0 -10 q3 4 0 10z" fill="var(--accent,#ff8fbf)"/>
  </symbol>
  <symbol id="neko" viewBox="0 0 140 150">
    <path d="M100 118 Q138 112 128 82 Q124 70 116 78" fill="none" stroke="#5a6aa0" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="68" cy="116" rx="38" ry="28" fill="#fff" stroke="#5a6aa0" stroke-width="3"/>
    <path d="M52 112 q6 8 0 16 M84 112 q-6 8 0 16" fill="none" stroke="#cfe0ff" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="48" cy="138" rx="13" ry="8" fill="#fff" stroke="#5a6aa0" stroke-width="3"/><ellipse cx="88" cy="138" rx="13" ry="8" fill="#fff" stroke="#5a6aa0" stroke-width="3"/>
    <circle cx="44" cy="139" r="2" fill="#ffb6d1"/><circle cx="52" cy="139" r="2" fill="#ffb6d1"/><circle cx="84" cy="139" r="2" fill="#ffb6d1"/><circle cx="92" cy="139" r="2" fill="#ffb6d1"/>
    <path d="M20 62 L24 18 Q25 12 31 15 L56 34 Z" fill="#fff" stroke="#5a6aa0" stroke-width="3" stroke-linejoin="round"/>
    <path d="M116 62 L112 18 Q111 12 105 15 L80 34 Z" fill="#fff" stroke="#5a6aa0" stroke-width="3" stroke-linejoin="round"/>
    <path d="M28 52 L30 26 L47 39 Z" fill="#ffb6d1"/><path d="M108 52 L106 26 L89 39 Z" fill="#ffb6d1"/>
    <ellipse cx="68" cy="72" rx="48" ry="38" fill="#fff" stroke="#5a6aa0" stroke-width="3"/>
    <path d="M68 36 q-4 -9 0 -14 q4 5 0 14z" fill="#7cb8ff"/>
    <path d="M44 40 q-6 8 -2 14 M92 40 q6 8 2 14" fill="none" stroke="#cfe0ff" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="48" cy="74" rx="8" ry="10" fill="#3b4a7a"/><ellipse cx="88" cy="74" rx="8" ry="10" fill="#3b4a7a"/>
    <circle cx="51" cy="70" r="3.4" fill="#fff"/><circle cx="91" cy="70" r="3.4" fill="#fff"/>
    <circle cx="46" cy="78" r="1.8" fill="#fff"/><circle cx="86" cy="78" r="1.8" fill="#fff"/>
    <ellipse cx="34" cy="88" rx="8" ry="4.5" fill="#ff9ab8" opacity=".6"/><ellipse cx="102" cy="88" rx="8" ry="4.5" fill="#ff9ab8" opacity=".6"/>
    <path d="M61 88 Q65 94 68 88 Q71 94 75 88" fill="none" stroke="#5a6aa0" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M16 76 L30 79 M16 86 L30 85 M120 76 L106 79 M120 86 L106 85" stroke="#5a6aa0" stroke-width="2" stroke-linecap="round" opacity=".55"/>
  </symbol>
</svg>`;

/* 闪光装饰（位置固定，纯装饰） */
const SPARKS = [
  { l: '30%', t: '14%', fs: 18, d: 0 },
  { l: '62%', t: '8%',  fs: 12, d: 1 },
  { l: '86%', t: '36%', fs: 20, d: .5 },
  { l: '44%', t: '70%', fs: 14, d: 1.6 },
  { l: '92%', t: '78%', fs: 12, d: 2 },
];

/** 挂载 v2 装饰：精灵图 / 闪光 / 猫娘吉祥物（只挂载一次） */
function mountDecor() {
  if (document.getElementById('nekoSprite')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = NEKO_SPRITE +
    SPARKS.map((p) => `<span class="spark" style="left:${p.l};top:${p.t};font-size:${p.fs}px;animation-delay:${p.d}s">✦</span>`).join('') +
    `<div class="bubble" id="nekoBubble"></div>` +
    `<svg class="mascot" id="nekoMascot" viewBox="0 0 140 150" aria-label="吉祥物"><use href="#neko"/></svg>`;
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

  const m = document.getElementById('nekoMascot');
  const b = document.getElementById('nekoBubble');
  const TALK = ['喵～', '摸摸头～', '今天也辛苦啦', '要不要喝杯奶茶？', '喵呜 ♪', '(๑•̀ㅂ•́)و✧'];
  let timer = 0;
  function say(t) {
    if (!b) return;
    b.textContent = t;
    b.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => b.classList.remove('show'), 2200);
  }
  if (m) m.onclick = () => say(TALK[Math.floor(Math.random() * TALK.length)]);
  window.MeoyNekoSay = say;
}

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
  // 猫脸头像配色：按邮箱稳定取一套（同一账号永远同一只猫）
  const AV_SETS = [
    { bg: '#ffd3e6', fur: '#fff', eye: '#3b4a7a', accent: '#ff8fbf' },
    { bg: '#fff0b8', fur: '#fffdf3', eye: '#7a5a2b', accent: '#ffb148' },
    { bg: '#ffc9c9', fur: '#fff', eye: '#8a2f3f', accent: '#ff6b8a' },
    { bg: '#cfe4ff', fur: '#fff', eye: '#2f4f8a', accent: '#4f9bff' },
    { bg: '#e1d6ff', fur: '#f6f1ff', eye: '#5a3f9a', accent: '#a897ff' },
    { bg: '#cdf3e2', fur: '#fff', eye: '#2f7a5a', accent: '#4cc38a' },
    { bg: '#ffe0c2', fur: '#ffe9d2', eye: '#7a4a2b', accent: '#ff9a4d' },
    { bg: '#d6d9e6', fur: '#eceef6', eye: '#3b4258', accent: '#8b97b5' },
  ];
  let _hs = 0;
  const _mail = String((me && me.email) || '');
  for (let i = 0; i < _mail.length; i++) _hs = (_hs * 31 + _mail.charCodeAt(i)) >>> 0;
  const _av = AV_SETS[_hs % AV_SETS.length];
  const catStyle = `--bg:${_av.bg};--fur:${_av.fur};--eye:${_av.eye};--accent:${_av.accent}`;

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
        <button class="iconbtn" id="bellBtn" title="通知" aria-label="通知">
          <svg viewBox="0 0 24 24">${SHELL_ICON.bell}</svg>
          <b id="bellCount" hidden></b>
        </button>
        <div class="user-chip" id="userChip" title="${esc(me.email)}" style="display:flex;align-items:center;gap:0;background:none;border:none;padding:0;box-shadow:none">
          <svg class="top-av" viewBox="0 0 100 100" style="${catStyle}"><use href="#catface"/></svg>
        </div>
        <div class="user-menu" id="userMenu">
          <div class="um-head">
            <svg class="top-av" viewBox="0 0 100 100" style="width:38px;height:38px;${catStyle}"><use href="#catface"/></svg>
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

  mountDecor();

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
