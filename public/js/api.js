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
      if (!['/', '/index'].includes(location.pathname)) location.href = '/';
    }
    if (!data.success) throw new Error(data.message || '请求失败');
    return data;
  },
  get: (p) => api.req('GET', p),
  post: (p, b) => api.req('POST', p, b),
  patch: (p, b) => api.req('PATCH', p, b),
  del: (p) => api.req('DELETE', p),
};

/* ---------- 壁纸：初音未来 / GUMI ---------- */
const WALLPAPERS = [
  { key: 'miku', name: 'Miku', url: '/img/miku.jpg' },
  { key: 'gumi', name: 'GUMI', url: '/img/gumi.jpg' },
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
  let saved = 'miku';
  try { saved = localStorage.getItem('meoy_wallpaper') || 'miku'; } catch {}
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
const DEFAULT_BRAND = { siteName: 'Meoy', logoUrl: '/img/logo.jpg', faviconUrl: '/img/favicon.png' };
let brandPromise = null;

function loadBranding() {
  if (!brandPromise) {
    brandPromise = api
      .get('/api/config')
      .then((d) => ({
        siteName: d.siteName || DEFAULT_BRAND.siteName,
        logoUrl: d.logoUrl || DEFAULT_BRAND.logoUrl,
        faviconUrl: d.faviconUrl || DEFAULT_BRAND.faviconUrl,
      }))
      .catch(() => ({ ...DEFAULT_BRAND }));
  }
  return brandPromise;
}

/** 应用站点名与 favicon */
function applyBranding(b) {
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
async function mountNav(active) {
  const nav = document.getElementById('nav');
  if (!nav) return null;
  let user = null;
  try {
    user = (await api.get('/api/auth/me')).user;
  } catch {
    location.href = '/';
    return null;
  }
  const isAdmin = user.role === 'admin';
  const b = await loadBranding();
  nav.innerHTML = `
    <div class="logo">
      <img src="${esc(b.logoUrl)}" alt="${esc(b.siteName)}" style="width:34px;height:34px;object-fit:contain;border-radius:8px">
      <span class="logo-text">${esc(b.siteName)}<em>子域名分发</em></span>
    </div>
    <div class="spacer"></div>
    <div class="links">
      <a class="navlink ${active === 'dash' ? 'active' : ''}" href="/dashboard">我的域名</a>
      ${isAdmin ? `<a class="navlink ${active === 'admin' ? 'active' : ''}" href="/admin">管理后台</a>` : ''}
      ${wallpaperSwitchHtml()}
      <span class="sep"></span>
      <span class="badge" style="font-weight:400">${esc(user.email)}</span>
      <button class="btn sm ghost" id="btnLogout">退出</button>
    </div>`;
  document.getElementById('btnLogout').onclick = async () => {
    await api.post('/api/auth/logout', {});
    location.href = '/';
  };
  document.querySelectorAll('.bgswitch button').forEach((b) => {
    b.onclick = () => applyWallpaper(b.dataset.wp);
  });
  return user;
}

function openModal(title, html) {
  const m = document.getElementById('modal');
  m.querySelector('.box').innerHTML = `<h2>${esc(title)}</h2>${html}`;
  m.classList.add('show');
}
function closeModal() {
  document.getElementById('modal').classList.remove('show');
}
window.closeModal = closeModal;

document.addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

mountWallpaper();
