// 前端通用工具：接口封装、提示、渲染辅助、壁纸切换
const api = {
  async req(method, path, body) {
    const opt = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) opt.body = JSON.stringify(body);
    let res, data;
    try {
      res = await fetch(path, opt);
      data = await res.json().catch(() => ({}));
    } catch (e) {
      throw new Error('网络请求失败');
    }
    if (res.status === 401) {
      // 公开页（WHOIS / 条款）免登录，401 是正常现象，不能踢去登录页 ——
      // 否则在 whois 子域下会形成 /whois → / → /whois.html 的循环。
      if (window.MEOY_PUBLIC_PAGE) return data;   // 交给调用方自行处理
      if (!['/', '/index'].includes(location.pathname)) location.href = '/';
    }
    if (!data.success) throw new Error(data.message || '请求失败');
    return data;
  },
  get: (p) => api.req('GET', p),
  post: (p, b) => api.req('POST', p, b),
  patch: (p, b) => api.req('PATCH', p, b),
  put: (p, b) => api.req('PUT', p, b),
  del: (p) => api.req('DELETE', p),
};

/* ---------- 樱花飘落（合成器动画，不触发重排） ---------- */
function mountSakura() {
  // 落地页用 DnsNeko 那种清透线条风，不铺樱花
  if (document.body.classList.contains('page-home')) return;
  if (document.getElementById('sakura')) return;
  // 减少动态效果偏好时不开；小屏减少数量省性能
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (reduce) return;
  const narrow = window.innerWidth < 720;
  const n = narrow ? 9 : 16;

  const box = document.createElement('div');
  box.id = 'sakura';
  box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'petal';
    // 随机化：位置、时长、延迟、横向漂移、旋转、大小
    p.style.left = (Math.random() * 100).toFixed(2) + 'vw';
    p.style.setProperty('--dx', (Math.random() * 24 - 12).toFixed(1) + 'vw');
    p.style.setProperty('--rot', (Math.random() * 720 - 360).toFixed(0) + 'deg');
    p.style.animationDuration = (13 + Math.random() * 9).toFixed(1) + 's';
    p.style.animationDelay = (-Math.random() * 18).toFixed(1) + 's';
    p.style.width = p.style.height = (7 + Math.random() * 6).toFixed(1) + 'px';
    p.style.opacity = (0.5 + Math.random() * 0.4).toFixed(2);
    box.appendChild(p);
  }
  document.body.appendChild(box);
}

/* ---------- 猫爪 SVG（站点吉祥物，多处复用） ---------- */
const PAW_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<ellipse cx="7" cy="8.5" rx="2.1" ry="2.6"/>' +
  '<ellipse cx="12" cy="7" rx="2.1" ry="2.7"/>' +
  '<ellipse cx="17" cy="8.5" rx="2.1" ry="2.6"/>' +
  '<path d="M12 12c3.4 0 6 2.1 6 4.6 0 2.2-1.9 3.6-4.2 3.6h-3.6C8 20.2 6 18.8 6 16.6 6 14.1 8.6 12 12 12Z"/>' +
  '</svg>';

/* ---------- 壁纸：樱花猫 ---------- */
const WALLPAPERS = [
  { key: 'sakura1', name: '樱花喵 1', url: '/img/sakura1.jpg' },
  { key: 'sakura2', name: '樱花喵 2', url: '/img/sakura2.jpg' },
];

function applyWallpaper(key) {
  const w = WALLPAPERS.find((x) => x.key === key) || WALLPAPERS[0];
  let el = document.getElementById('bg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bg';
    document.body.prepend(el);
  }
  el.style.setProperty('--bg-img', `url('${w.url}')`);
  try { localStorage.setItem('meoy_wallpaper', w.key); } catch {}
  document.querySelectorAll('.bgswitch button').forEach((b) => b.classList.toggle('on', b.dataset.wp === w.key));
}

function mountWallpaper() {
  let saved = 'sakura1';
  try { saved = localStorage.getItem('meoy_wallpaper') || 'sakura1'; } catch {}
  applyWallpaper(saved);
}

function wallpaperSwitchHtml() {
  return `<span class="bgswitch">${WALLPAPERS.map(
    (w) => `<button data-wp="${w.key}" title="切换背景：${w.name}">${w.name}</button>`
  ).join('')}</span>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest?.('.bgswitch button');
  if (b) applyWallpaper(b.dataset.wp);
});

/* ---------- 站点品牌（站点名 / Logo，管理员可在后台改） ---------- */
const DEFAULT_BRAND = { siteName: 'Meoy', logoUrl: '/img/logo.jpg', faviconUrl: '/favicon.ico' };
let brandPromise = null;

function loadBranding() {
  if (!brandPromise) {
    brandPromise = api
      .get('/api/config')
      .then((d) => ({
        siteName: d.siteName || DEFAULT_BRAND.siteName,
        logoUrl: d.logoUrl || DEFAULT_BRAND.logoUrl,
        faviconUrl: d.faviconUrl || DEFAULT_BRAND.faviconUrl,
        fontBody: d.fontBody || 'zcool',
        fontDisplay: d.fontDisplay || 'zcool',
      }))
      .catch(() => ({ ...DEFAULT_BRAND }));
  }
  return brandPromise;
}

/** 应用站点名与 favicon */
/* ---------- 全局中文字体（后台可配，全站生效） ----------
   key: system | noto | lxgw | zcool
   拉丁与数字始终由 Redaction 35 接管，这里只决定中文字符用哪个字体。 */
const CN_FONTS = {
  system: "'ZCOOL KuaiLe', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  noto: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  lxgw: "'LXGW WenKai TC', 'LXGW WenKai', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  zcool: "'ZCOOL KuaiLe', 'PingFang SC', 'Microsoft YaHei', sans-serif",
};

function applyFonts(fontBody, fontDisplay) {
  const root = document.documentElement;
  const body = CN_FONTS[fontBody] || CN_FONTS.system;
  const disp = CN_FONTS[fontDisplay] || CN_FONTS.zcool;
  // 覆盖 CSS 变量 → 所有页面（前台 / WHOIS / 后台 / 条款）立即全局生效
  root.style.setProperty('--cn-body', body);
  root.style.setProperty('--cn-display', disp);
}

function applyBranding(b) {
  if (b.fontBody || b.fontDisplay) applyFonts(b.fontBody, b.fontDisplay);
  document.title = (document.title || '').replace(/^[^·]*·\s*/, b.siteName + ' · ');
  let f = document.querySelector('link[rel="icon"]');
  if (!f) {
    f = document.createElement('link');
    f.rel = 'icon';
    document.head.appendChild(f);
  }
  f.href = b.faviconUrl;
  document.querySelectorAll('[data-site-name]').forEach((el) => (el.textContent = b.siteName));
  document.querySelectorAll('[data-logo-img]').forEach((el) => (el.src = b.logoUrl));
}

/** 生成 Logo 图片 HTML（size 为像素） */
function logoHtml(b, size, cls = '') {
  return `<img src="${esc(b.logoUrl)}" alt="${esc(b.siteName)}" class="${cls}"
    style="width:${size}px;height:${size}px;object-fit:contain;border-radius:${Math.round(size * 0.22)}px">`;
}

/* ---------- 提示 ---------- */
function toast(msg, type = 'ok', ms = 2600) {
  let box = document.getElementById('toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    document.body.appendChild(box);
  }
  const d = document.createElement('div');
  d.className = 'toast ' + (type === 'err' ? 'err' : '');
  d.textContent = msg;
  box.appendChild(d);
  setTimeout(() => d.remove(), ms);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(Number(ts));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 只显示日期：2026-11-01 */
function fmtDate(ts) {
  if (!ts) return '-';
  const d = new Date(Number(ts));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function copyText(t) {
  navigator.clipboard?.writeText(t).then(() => toast('已复制'), () => toast('复制失败', 'err'));
}

/** 配额显示：负数（或管理员）显示 ∞ */
function quotaText(quota, unlimited) {
  if (unlimited || Number(quota) < 0) return '<span class="badge inf">∞ 不限</span>';
  return String(quota);
}

const STATUS_MAP = {
  pending: { cls: 'warn', text: '待审核' },
  approved: { cls: 'ok', text: '已开通' },
  rejected: { cls: 'danger', text: '已驳回' },
  suspended: { cls: 'danger', text: '已停用' },
};

function statusBadge(s) {
  const m = STATUS_MAP[s] || { cls: '', text: s };
  return `<span class="badge ${m.cls}">${m.text}</span>`;
}

/* ---------- 顶部导航 ---------- */
/**
 * 挂载导航。
 * @param active 当前页签
 * @param opts.optional 为 true 时未登录也不跳转（用于服务条款等公开页）
 */
async function mountNav(active, opts = {}) {
  const nav = document.getElementById('nav');
  if (!nav) return null;
  let user = null;
  try {
    user = (await api.get('/api/auth/me')).user;
  } catch {
    if (!opts.optional) { location.href = '/'; return null; }
  }
  if (!user) {
    const b0 = await loadBranding();
    nav.innerHTML = `
      <div class="logo">
        <img src="${esc(b0.logoUrl)}" alt="${esc(b0.siteName)}" style="width:30px;height:30px;object-fit:contain;border-radius:3px">
        <span class="logo-text">${esc(b0.siteName)}</span>
      </div>
      <div class="spacer"></div>
      <div class="links">
        <a class="navlink ${active === 'whois' ? 'active' : ''}" href="/whois.html">WHOIS</a>
        <a class="navlink ${active === 'terms' ? 'active' : ''}" href="/terms.html">条款</a>
        ${wallpaperSwitchHtml()}
        <span class="sep"></span>
        <a class="btn sm primary" href="/">登录 / 注册</a>
      </div>`;
    document.querySelectorAll('.bgswitch button').forEach((btn) => {
      btn.onclick = () => applyWallpaper(btn.dataset.wp);
    });
    return null;
  }
  const isAdmin = user.role === 'admin';
  const b = await loadBranding();
  let rootHost = '';
  try { rootHost = (await api.get('/api/config')).rootDomain || ''; } catch {}
  nav.innerHTML = `
    <div class="logo">
      <img src="${esc(b.logoUrl)}" alt="${esc(b.siteName)}" style="width:30px;height:30px;object-fit:contain;border-radius:3px">
      <span class="logo-text">${esc(b.siteName)}<em>${esc(rootHost || 'subdomain')}</em></span>
    </div>
    <div class="spacer"></div>
    <div class="links">
      <a class="navlink ${active === 'dash' ? 'active' : ''}" href="/dashboard">我的域名</a>
      <a class="navlink ${active === 'whois' ? 'active' : ''}" href="/whois.html">WHOIS</a>
      ${isAdmin ? `<a class="navlink ${active === 'admin' ? 'active' : ''}" href="/admin">管理后台</a>` : ''}
      ${wallpaperSwitchHtml()}
      <span class="sep"></span>
      <span class="badge" style="font-weight:400">${esc(user.email)}</span>
      <button class="btn sm ghost" id="btnLogout">退出</button>
    </div>`;
  document.getElementById('btnLogout').onclick = async () => {
    await api.post('/api/auth/logout', {});
    location.href = '/?login=1';   // 带 login=1，避免被「已登录直入控制台」的逻辑带走
  };
  document.querySelectorAll('.bgswitch button').forEach((b) => {
    b.onclick = () => applyWallpaper(b.dataset.wp);
  });
  return user;
}

function openModal(title, html) {
  const m = document.getElementById('modal');
  if (!m) return;
  // 兼容两种结构：旧页 <div class="box">，新页 <div class="modal-card" id="modalCard">
  const box = m.querySelector('.modal-card') || m.querySelector('.box');
  if (!box) return;
  box.innerHTML = `<h2>${esc(title)}</h2>${html}`;
  m.classList.add('show');
}
function closeModal() {
  document.getElementById('modal').classList.remove('show');
}
window.closeModal = closeModal;

document.addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

/* ---------- WHOIS 子域名跳转 ----------
   已由 Worker 服务端中间件处理（见 src/index.js），前端不再做任何跳转。
   此前前端也做一份，结果在 /dashboard 上又把它踢去 /whois.html?name=dashboard，
   与「已登录 → 控制台」逻辑互相抢夺，形成来回跳转。此处只保留清理旧计数的逻辑。 */
try { sessionStorage.removeItem('meoy_whois_n'); } catch {}

mountWallpaper();
// 樱花飘落：等首屏内容就绪再挂，不抢占渲染
if (document.readyState === 'complete') setTimeout(mountSakura, 400);
else window.addEventListener('load', () => setTimeout(mountSakura, 400), { once: true });


/* ══════════════════════════════════════════════════════════════
   全站底部署名：MeoyDomain + GitHub 链接
   所有页面都引入了本文件，因此注入一次即可全站生效。
   - 追加到 body 末尾（静态流，不用 fixed，避免遮挡内容）
   - 页面已有 .site-foot 或 <footer> 时不重复注入
   - 控制台页（.main）会把左偏移对齐侧栏
   ══════════════════════════════════════════════════════════════ */
(function mountSiteFooter() {
  var REPO = 'https://github.com/wcvjk8tnz8-create/MeoyDomain';
  function inject() {
    try {
      if (document.querySelector('.site-foot') || document.querySelector('footer')) return;
      var f = document.createElement('footer');
      f.className = 'site-foot';
      f.innerHTML =
        '<div class="site-foot-in">' +
        '<span class="sf-brand">MeoyDomain</span>' +
        '<a class="sf-link" href="' + REPO + '" target="_blank" rel="noopener noreferrer">' +
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.07-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.15 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.995 7.995 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>' +
        '<span>GitHub</span></a>' +
        '</div>';
      document.body.appendChild(f);
    } catch (e) { /* 底部署名失败不影响页面 */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();


/* ══════════════════════════════════════════════════════════════
   数字滚动 + 元素入场（全站通用）
   ══════════════════════════════════════════════════════════════ */
(function motion() {
  var reduced = false;
  try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /** 数字从 0 滚到目标值，只动 textContent（不触发重排） */
  function countUp(el) {
    if (reduced || el.dataset.counted === '1') return;
    var raw = String(el.textContent || '').trim();
    var target = parseFloat(raw.replace(/[^\d.]/g, ''));
    if (!isFinite(target) || target === 0) return;
    el.dataset.counted = '1';
    var suffix = raw.replace(/[\d.]/g, '');
    var decimals = (raw.split('.')[1] || '').length;
    var start = performance.now();
    var dur = 620;
    (function step(t) {
      var p = Math.min(1, (t - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);           // easeOutCubic
      var v = target * eased;
      el.textContent = (decimals ? v.toFixed(decimals) : Math.round(v)) + suffix;
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = raw;                     // 收尾精确还原原文本
    })(start);
  }

  /** 给统计数字加上滚动效果 */
  function scanCountUp() {
    var sels = ['.stat-card .sc-num', '.stat-num', '.point-num', '[data-count]'];
    sels.forEach(function (s) {
      document.querySelectorAll(s).forEach(countUp);
    });
  }

  /** 观察新插入的行，让它们逐条淡入（配合 CSS 的 rowIn） */
  function observeRows() {
    if (reduced || typeof MutationObserver === 'undefined') return;
    var mo = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        (m.addedNodes || []).forEach(function (n) {
          if (n.nodeType !== 1) return;
          var rows = n.matches && n.matches('tr') ? [n] : n.querySelectorAll ? n.querySelectorAll('tbody tr') : [];
          Array.prototype.forEach.call(rows, function (r, i) {
            r.style.animation = 'none';
            // 强制回流后再挂动画，保证每次重新插入都会播放
            void r.offsetWidth;
            r.style.animation = '';
            r.style.animationDelay = Math.min(i * 0.03, 0.24) + 's';
          });
        });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('tbody, .tablewrap'), function (t) {
      mo.observe(t, { childList: true, subtree: true });
    });
  }

  /** 顶栏滚动加影 */
  function topbarShadow() {
    var bar = document.querySelector('.topbar') || document.querySelector('.home-top');
    if (!bar) return;
    var onScroll = function () {
      bar.classList.toggle('is-scrolled', window.scrollY > 4);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function boot() {
    scanCountUp();
    observeRows();
    topbarShadow();
    // 异步渲染的统计卡（等数据回来后再扫一次）
    setTimeout(scanCountUp, 700);
    setTimeout(scanCountUp, 1600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
