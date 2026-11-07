/**
 * TerraDomain 前端运行时（TypeScript）
 * 由旧 api.js / shell.js 合并迁移而来，保留全部工具函数与骨架注入逻辑。
 * React 负责路由与页面组件；骨架与页面交互仍由这里的控制器驱动，
 * 后续可按页面逐步改成 hooks，不影响其它页面。
 */
import type { LegacyCtx } from './types';
import { startI18n, currentLang, translateText } from './i18n';
import { takePrefetched, invalidatePrefetch } from './prefetch';

/* SPA 切页清理注册表：document / window 事件与定时器都登记在这里 */
let cleanups: Array<() => void> = [];
export function cleanupPage() {
  for (const f of cleanups) { try { f(); } catch {} }
  cleanups = [];
}
function track(target: any, type: string, fn: any, opts?: any) {
  target.addEventListener(type, fn, opts);
  cleanups.push(() => { try { target.removeEventListener(type, fn, opts); } catch {} });
}
const __docOn = (type: string, fn: any, opts?: any) => track(document, type, fn, opts);
/** 供各页面控制器注册 document 级事件：随 SPA 切页自动注销，避免重复监听累积 */
export const onDoc = __docOn;
const __winOn = (type: string, fn: any, opts?: any) => track(window, type, fn, opts);
const __setInterval = (fn: any, ms?: number) => {
  const id = setInterval(fn, ms);
  cleanups.push(() => clearInterval(id));
  return id;
};

/* 全局符号表：legacy 控制器从这里解构，页面之间互不干扰 */
export const RUNTIME_KEYS = [
  'api','esc','fmtTime','fmtDate','toast','openModal','closeModal','loadBranding','applyBranding',
  'applyFonts','STATUS_MAP','statusBadge','copyText','quotaText','mountNav','mountShell',
  'mountSiteFooter','logoHtml','wallpaperSwitchHtml','applyWallpaper','mountWallpaper','mountSakura',
  'DEFAULT_BRAND','CN_FONTS','WALLPAPERS','PAW_SVG','SHELL_NAV','SHELL_ICON','prefetch',
  'readUserCache','writeUserCache','clearUserCache','idle','renderAvatars','catFaceFallback',
  'mountDecor','mountMotion','applyBrand','pawBurst','shellItem','MeoyRenderAvatars',
  'MeoyRenderCatFaces','refreshRuntime','cleanupPage','navigate',
] as const;

/* SPA 导航（供 legacy 脚本里的跳转使用，不刷新整页） */
export function navigate(path: string) {
  if (!path) return;
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/* ────────────────────────────────────────────────────────────────
   首屏「一次性就绪」门控
   ────────────────────────────────────────────────────────────────
   同一个 GET 常被好几处同时要（侧栏 / 欢迎卡 / 统计卡 / 顶栏头像），
   过去各自发请求、各自 .then 写 DOM，页面就会「先出 0，再补 4，
   最后补 ∞」分三阶段慢慢吐出来。这里做两件事：
   1) 在飞的同路径 GET 合并成一次；刚结算的结果留很短时间给同页复用。
   2) 统计仍在飞的首屏 GET，全部结算后才允许宣告页面就绪。
   写操作立刻清缓存，不会让「签到 / 释放域名」读到旧值。
   ──────────────────────────────────────────────────────────────── */
const SHARED_TTL = 1500;
const sharedGet = new Map<string, { at: number; promise: Promise<any> }>();
let pageFetches = 0;
const pageIdleWaiters: Array<() => void> = [];

function pageFetchStart() { pageFetches++; }
function pageFetchEnd() {
  pageFetches = Math.max(0, pageFetches - 1);
  if (pageFetches === 0) pageIdleWaiters.splice(0).forEach((f) => f());
}
function whenPageFetchesIdle(): Promise<void> {
  if (pageFetches === 0) return Promise.resolve();
  // 某个接口挂死也不能把整页藏住：2.5s 后照常放出，页面自带的失败兜底会显示占位
  return Promise.race([
    new Promise<void>((r) => pageIdleWaiters.push(r)),
    new Promise<void>((r) => window.setTimeout(r, 2500)),
  ]);
}
export function clearSharedGet() { sharedGet.clear(); }

/* 每次切页后重新扫描动效/装饰/页脚/主题按钮/语言 */
export function refreshRuntime() {
  try { syncTopbarState(); } catch {}
  try { applyLayoutPrefs(); } catch {}
  try { mountDecor(); } catch {}
  try { mountMotion(); } catch {}
  try { mountSiteFooter(); } catch {}
  try { (window as any).MeoyTheme?.remount?.(); } catch {}
  // 动效已由 mountMotion() 统一为全局单例，不再叠加第二套引擎
  // 语言常驻监听只需启动一次；每次切页补挂顶栏切换器并翻译新 DOM
  try { startI18n(); } catch (e) { console.warn('[i18n]', e); }
  // 「资料到齐 + 整屏写完」才算就绪。fire-and-forget 控制器里仍在飞的
  // GET 会继续改 DOM，不能让过渡层在第一波数据后就收起。
  // 就绪时统一把页面从隐藏态放出：所有卡片、数字、头像同一帧出现。
  void whenPageFetchesIdle().then(() => {
    const fire = () => {
      try {
        document.querySelectorAll('.page-root[data-ready="0"]').forEach((el) => {
          (el as HTMLElement).dataset.ready = '1';
        });
      } catch {}
      try { window.dispatchEvent(new CustomEvent('td:page-ready')); } catch {}
    };
    // rAF 让 .then 链里最后一波 DOM 写入落地；后台标签页 rAF 不触发时有定时器兜底
    requestAnimationFrame(fire);
    window.setTimeout(fire, 60);
  });
}

// 前端通用工具：接口封装、提示、渲染辅助、壁纸切换
export const api = {
  async req(method, path, body = undefined) {
    // 带上界面语言：后端统一响应出口据此把 message / 通知 / 条款等
    // 服务端生成的中文换成英文。不传时后端默认中文。
    const opt: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Lang': currentLang() },
      credentials: 'same-origin',
    };
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
      // 根路径现在是主页，登录页独立在 /login；登录页自身的 401 也不能再跳，避免循环
      const p = location.pathname.replace(/\/+$/, '') || '/';
      if (!['/', '/index', '/index.html', '/login', '/login.html', '/home', '/home.html'].includes(p)) location.href = '/login';
    }
    if (!data.success) throw new Error(data.message || '请求失败');
    // 写过数据就丢掉预取缓存，避免切回页面时看到旧值
    if (method !== 'GET') { invalidatePrefetch(); clearSharedGet(); }
    return data;
  },
  // 切页预取的结果优先用：点击链接时接口就已并行发出，页面挂载瞬间就有数据。
  // 同路径在飞请求合并成一次，并把首屏 GET 计入就绪门控。
  get: (p) => {
    const hit = sharedGet.get(p);
    if (hit && Date.now() - hit.at < SHARED_TTL) return hit.promise;
    const promise = (async () => {
      const pre = takePrefetched(p);
      if (pre !== null) return pre;
      pageFetchStart();
      try { return await api.req('GET', p); }
      finally { pageFetchEnd(); }
    })();
    sharedGet.set(p, { at: Date.now(), promise });
    // 失败不留缓存，下一次重试必须真的发请求（401 / 网络抖动不吞掉）；
    // 只删自己这条，别误删期间新建的同路径请求
    promise.catch(() => {
      if (sharedGet.get(p)?.promise === promise) sharedGet.delete(p);
    });
    return promise;
  },
  post: (p, b) => api.req('POST', p, b),
  patch: (p, b) => api.req('PATCH', p, b),
  put: (p, b) => api.req('PUT', p, b),
  del: (p) => api.req('DELETE', p),
};

/* ---------- 樱花飘落（合成器动画，不触发重排） ---------- */
export function mountSakura() {
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
export const PAW_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<ellipse cx="7" cy="8.5" rx="2.1" ry="2.6"/>' +
  '<ellipse cx="12" cy="7" rx="2.1" ry="2.7"/>' +
  '<ellipse cx="17" cy="8.5" rx="2.1" ry="2.6"/>' +
  '<path d="M12 12c3.4 0 6 2.1 6 4.6 0 2.2-1.9 3.6-4.2 3.6h-3.6C8 20.2 6 18.8 6 16.6 6 14.1 8.6 12 12 12Z"/>' +
  '</svg>';

/* ---------- 壁纸：花束 Miku 为控制台默认 ----------
   历史遗留：components.css 末尾曾把 #bg 整体 display:none，切换器形同虚设。
   现在由 liquid-glass.css 末尾的「花束重构层」在控制台页重新启用 #bg，
   且每张壁纸可带独立的深色版与缩略图，CSS 按变量自动取用。 */
export const WALLPAPERS = [
  {
    key: 'bouquet', name: '花与 Miku', url: '/img/wallpaper/miku-bouquet.webp',
    dark: '/img/wallpaper/miku-bouquet-dark.webp',
    thumb: '/img/wallpaper/miku-bouquet-thumb.webp',
    haze: '/img/wallpaper/miku-bouquet-haze.webp',
  },
  { key: 'sakura1', name: '樱花喵 1', url: '/img/sakura1.jpg' },
  { key: 'sakura2', name: '樱花喵 2', url: '/img/sakura2.jpg' },
  { key: 'miku', name: 'Miku', url: '/img/miku.jpg' },
  { key: 'gumi', name: 'GUMI', url: '/img/gumi.jpg' },
];

let wpSeq = 0;
export function applyWallpaper(key) {
  const w = WALLPAPERS.find((x) => x.key === key) || WALLPAPERS[0];
  let el = document.getElementById('bg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bg';
    document.body.prepend(el);
  }
  const node = el as HTMLElement;
  node.style.setProperty('--bg-img', `url('${w.url}')`);
  node.style.setProperty('--bg-img-dark', `url('${w.dark || w.url}')`);
  node.style.setProperty('--bg-haze', `url('${w.haze || w.url}')`);
  node.dataset.wp = w.key;
  // 先用 5.8KB 的 haze 氛围图顶上，高清主图解码完成再淡入。
  // 以前 CSS 直接引用 179KB 主图，切页时要等它下载+解码，观感就是「东西加载慢」。
  node.dataset.wpLoaded = '0';
  const seq = ++wpSeq;
  const mark = () => {
    if (seq === wpSeq && node.dataset.wp === w.key) node.dataset.wpLoaded = '1';
  };
  [w.url, w.dark].filter(Boolean).forEach((src) => {
    const img = new Image();
    img.src = src;
    if (typeof img.decode === 'function') img.decode().then(mark, mark);
    else { img.onload = mark; img.onerror = mark; }
  });
  document.documentElement.setAttribute('data-wallpaper', w.key);
  try { localStorage.setItem('meoy_wallpaper', w.key); } catch {}
  document.querySelectorAll('.bgswitch button').forEach((b) => b.classList.toggle('on', b.dataset.wp === w.key));
}

export function mountWallpaper() {
  let saved = 'bouquet';
  try {
    // 花束重构版上线时，把旧存档一次性升级到新默认；之后仍完全尊重用户选择
    if (!localStorage.getItem('meoy_wallpaper_v2')) {
      localStorage.setItem('meoy_wallpaper_v2', '1');
      localStorage.setItem('meoy_wallpaper', 'bouquet');
    }
    saved = localStorage.getItem('meoy_wallpaper') || 'bouquet';
  } catch {}
  applyWallpaper(saved);
}

export function wallpaperSwitchHtml() {
  return `<span class="bgswitch" data-no-i18n aria-label="控制台壁纸">${WALLPAPERS.map(
    (w) => `<button data-wp="${w.key}" title="切换背景：${w.name}" aria-label="${w.name}"
      style="${w.thumb ? `--wp-thumb:url('${w.thumb}')` : `--wp-thumb:url('${w.url}')`}"><i></i><span>${w.name}</span></button>`
  ).join('')}</span>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest?.('.bgswitch button');
  if (b) applyWallpaper(b.dataset.wp);
});

/* ---------- 站点品牌（站点名 / Logo，管理员可在后台改） ---------- */
export const DEFAULT_BRAND = { siteName: 'TerraDomain', logoUrl: '/img/logo.jpg', faviconUrl: '/favicon.ico' };
export let brandPromise = null;
/* stale-while-revalidate：切页先用上一次的值立刻渲染，网络刷新放后台。
   以前每个页面都 await 一次 /api/config，接口一慢整页就卡在骨架上。 */
let brandValue = null;
let brandRefreshing = false;

function normalizeBrand(d) {
  return {
    siteName: d.siteName || DEFAULT_BRAND.siteName,
    logoUrl: d.logoUrl || DEFAULT_BRAND.logoUrl,
    faviconUrl: d.faviconUrl || DEFAULT_BRAND.faviconUrl,
    fontBody: d.fontBody || 'system',
    fontDisplay: d.fontDisplay || 'system',
  };
}

export function loadBranding() {
  if (brandValue) {
    if (!brandRefreshing) {
      brandRefreshing = true;
      api.get('/api/config')
        .then((d) => { brandValue = normalizeBrand(d); })
        .catch(() => { /* 保留旧值，不打断渲染 */ })
        .finally(() => { brandRefreshing = false; });
    }
    return Promise.resolve(brandValue);
  }
  if (!brandPromise) {
    brandPromise = api
      .get('/api/config')
      .then((d) => { brandValue = normalizeBrand(d); return brandValue; })
      .catch(() => {
        brandPromise = null;   // 失败清缓存，下一次切页自动重试
        return { ...DEFAULT_BRAND };
      });
  }
  return brandPromise;
}

/**
 * 清除品牌配置缓存，下一次 loadBranding() 会重新请求 /api/config。
 * 后台保存站点名 / Logo 后调用，避免刷新整页才能看到新值。
 * 注意：ES 模块的 import 绑定只读，外部不能直接给 brandPromise 赋值，
 * 必须走这个函数（admin.ts 曾因直接赋值而抛 ReferenceError）。
 */
export function resetBranding() {
  brandPromise = null;
  brandValue = null;
}

/** 应用站点名与 favicon */
/* ---------- 全局中文字体（后台可配，全站生效） ----------
   key: system | noto | lxgw | zcool
   拉丁与数字始终由 Redaction 35 接管，这里只决定中文字符用哪个字体。 */
export const CN_FONTS = {
  system: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  noto: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  lxgw: "'LXGW WenKai TC', 'LXGW WenKai', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  zcool: "'ZCOOL KuaiLe', 'PingFang SC', 'Microsoft YaHei', sans-serif",
};

export function applyFonts(fontBody, fontDisplay) {
  const root = document.documentElement;
  const body = CN_FONTS[fontBody] || CN_FONTS.system;
  const disp = CN_FONTS[fontDisplay] || CN_FONTS.zcool;
  // 覆盖 CSS 变量 → 所有页面（前台 / WHOIS / 后台 / 条款）立即全局生效。
  // --sans 现在引用 --cn-body，所以正文、表单、侧栏、表格都会跟着换字体。
  root.style.setProperty('--cn-body', body);
  root.style.setProperty('--cn-display', disp);
  // Zerexa 的衬线标题走 --td-serif；显式选了非系统字体时让它一起跟随，
  // 否则「选了霞鹜文楷，标题仍是 Noto Serif」会看起来像没生效。
  // 选 system 时移除内联覆盖，恢复 Georgia / 宋体的高雅衬线。
  if (fontBody && fontBody !== 'system' && fontBody !== 'default') {
    root.style.setProperty('--td-serif', body);
  } else {
    root.style.removeProperty('--td-serif');
  }
}

/** 写入站点名：长名自动缩字号并保留 title 全文，避免侧栏被截成「TerraD…」 */
export function setBrandName(el, name) {
  if (!el) return;
  const n = String(name || '');
  el.textContent = n;
  try { el.title = n; } catch (e) {}
  // 按字符数分档（中英混排 / emoji 都按字符计），最长两行折行由 CSS 负责
  const len = Array.from(n).length;
  const size = len > 24 ? '12.5px' : len > 18 ? '14px' : len > 13 ? '15.5px' : '';
  try { el.style.fontSize = size; } catch (e) {}
}

export function applyBranding(b) {
  if (b.fontBody || b.fontDisplay) applyFonts(b.fontBody, b.fontDisplay);
  document.title = (document.title || '').replace(/^[^·]*·\s*/, b.siteName + ' · ');
  let f = document.querySelector('link[rel="icon"]');
  if (!f) {
    f = document.createElement('link');
    f.rel = 'icon';
    document.head.appendChild(f);
  }
  f.href = b.faviconUrl;
  document.querySelectorAll('[data-site-name],[data-brand-name]').forEach((el) => setBrandName(el, b.siteName));
  document.querySelectorAll('[data-logo-img]').forEach((el) => (el.src = b.logoUrl));
}

/** 生成 Logo 图片 HTML（size 为像素） */
export function logoHtml(b, size, cls = '') {
  return `<img src="${esc(b.logoUrl)}" alt="${esc(b.siteName)}" class="${cls}"
    style="width:${size}px;height:${size}px;object-fit:contain;border-radius:${Math.round(size * 0.22)}px">`;
}

/* ---------- 提示 ---------- */
export function toast(msg, type = 'ok', ms = 2600) {
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
  // 先播退出动画再移除，别让提示「啪」地消失
  setTimeout(() => {
    if (!d.isConnected) return;
    d.classList.add('out');
    setTimeout(() => d.remove(), 240);
  }, ms);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(Number(ts));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 只显示日期：2026-11-01 */
export function fmtDate(ts) {
  if (!ts) return '-';
  const d = new Date(Number(ts));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function copyText(t) {
  navigator.clipboard?.writeText(t).then(() => toast('已复制'), () => toast('复制失败', 'err'));
}

/** 配额显示：负数（或管理员）显示 ∞ */
export function quotaText(quota, unlimited) {
  if (unlimited || Number(quota) < 0) return '<span class="badge inf">∞ 不限</span>';
  return String(quota);
}

export const STATUS_MAP = {
  pending: { cls: 'warn', text: '待审核' },
  approved: { cls: 'ok', text: '已开通' },
  rejected: { cls: 'danger', text: '已驳回' },
  suspended: { cls: 'danger', text: '已停用' },
};

export function statusBadge(s) {
  const m = STATUS_MAP[s] || { cls: '', text: s };
  return `<span class="badge ${m.cls}">${m.text}</span>`;
}

/* ---------- 顶部导航 ---------- */
/**
 * 挂载导航。
 * @param active 当前页签
 * @param opts.optional 为 true 时未登录也不跳转（用于服务条款等公开页）
 */
export async function mountNav(active, opts = {}) {
  const nav = document.getElementById('nav');
  if (!nav) return null;
  let user = null;
  try {
    user = (await api.get('/api/auth/me')).user;
  } catch {
    if (!opts.optional) { location.href = '/login'; return null; }
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
        <a class="navlink ${active === 'whois' ? 'active' : ''}" href="/whois">WHOIS</a>
        <a class="navlink ${active === 'terms' ? 'active' : ''}" href="/terms">条款</a>
        ${wallpaperSwitchHtml()}
        <span class="sep"></span>
        <a class="btn sm primary" href="/login">登录 / 注册</a>
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
      <a class="navlink ${active === 'whois' ? 'active' : ''}" href="/whois">WHOIS</a>
      ${isAdmin ? `<a class="navlink ${active === 'admin' ? 'active' : ''}" href="/admin">管理后台</a>` : ''}
      ${wallpaperSwitchHtml()}
      <span class="sep"></span>
      <span class="badge" style="font-weight:400">${esc(user.email)}</span>
      <button class="btn sm ghost" id="btnLogout">退出</button>
    </div>`;
  document.getElementById('btnLogout').onclick = async () => {
    await api.post('/api/auth/logout', {});
    location.href = '/login';
  };
  document.querySelectorAll('.bgswitch button').forEach((b) => {
    b.onclick = () => applyWallpaper(b.dataset.wp);
  });
  return user;
}

export function openModal(title, html) {
  const m = document.getElementById('modal');
  if (!m) return;
  // 兼容两种结构：旧页 <div class="box">，新页 <div class="modal-card" id="modalCard">
  const box = m.querySelector('.modal-card') || m.querySelector('.box');
  if (!box) return;
  box.innerHTML = `<h2>${esc(title)}</h2>${html}`;
  // 上一次关闭动画可能还没走完，先复位再打开；
  // 同时作废旧的延时回调，否则它会在 240ms 后把这个新弹窗一起关掉。
  m.classList.remove('closing');
  delete (m as HTMLElement).dataset.closeToken;
  m.classList.add('show');
}
export function closeModal() {
  const m = document.getElementById('modal');
  if (!m || !m.classList.contains('show') || m.classList.contains('closing')) return;
  // 保留 .show 直到退出动画播完：直接移除会触发 display:none，弹窗是硬切消失
  m.classList.add('closing');
  const token = String(Date.now()) + Math.random().toString(36).slice(2, 7);
  (m as HTMLElement).dataset.closeToken = token;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  setTimeout(() => {
    if ((m as HTMLElement).dataset.closeToken !== token) return;  // 期间又打开了新弹窗
    m.classList.remove('show', 'closing');
    delete (m as HTMLElement).dataset.closeToken;
  }, reduced ? 0 : 240);
}
(window as any).closeModal = closeModal;

/**
 * 结果弹窗：替代底部的黑色药丸 toast。
 * 文案按当前语言直接给出，并标记 data-no-i18n，避免运行时翻译再改写一次。
 * 找不到 #modal 时降级为 toast，保证后台任何页面都不会静默无反馈。
 */
export function showDialog(opts: {
  title?: string;
  message: string;
  detail?: string;
  tone?: 'ok' | 'err';
  okText?: string;
  reloadText?: string;
  onReload?: () => void;
}) {
  const m = document.getElementById('modal');
  const box = m && (m.querySelector('.modal-card') || m.querySelector('.box'));
  if (!m || !box) {
    toast(opts.message, opts.tone === 'err' ? 'err' : 'ok');
    return;
  }
  const en = currentLang() === 'en';
  const tr = (s: string) => en ? translateText(s, 'en') : s;
  const title = tr(opts.title || (opts.tone === 'err' ? '操作失败' : '操作完成'));
  const message = tr(opts.message);
  const detail = opts.detail ? tr(opts.detail) : '';
  const okText = opts.okText || (en ? 'Done' : '知道了');
  const reloadText = opts.reloadText || (en ? 'Refresh page' : '刷新页面');
  const icon = opts.tone === 'err' ? '!' : '✓';
  box.innerHTML = `<h2>${esc(title)}</h2>
    <div class="dlg ${opts.tone === 'err' ? 'err' : 'ok'}" data-no-i18n>
      <div class="dlg-icon" aria-hidden="true">${icon}</div>
      <div class="dlg-msg">${esc(message)}</div>
    </div>
    ${detail ? `<div class="dlg-sub" data-no-i18n>${esc(detail)}</div>` : ''}
    <div class="modal-foot" data-no-i18n>
      ${opts.onReload ? `<button class="btn ghost" id="dlgReload" type="button">${esc(reloadText)}</button>` : ''}
      <button class="btn primary" id="dlgOk" type="button">${esc(okText)}</button>
    </div>`;
  m.classList.add('show');
  const ok = document.getElementById('dlgOk');
  if (ok) {
    ok.onclick = () => closeModal();
    (ok as HTMLButtonElement).focus();
  }
  const reload = document.getElementById('dlgReload');
  if (reload && opts.onReload) {
    reload.onclick = () => { closeModal(); opts.onReload!(); };
  }
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const m = document.getElementById('modal');
    if (m && m.classList.contains('show')) closeModal();
  }
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
   全站底部署名：TerraDomain + GitHub 链接
   所有页面都引入了本文件，因此注入一次即可全站生效。
   - 追加到 body 末尾（静态流，不用 fixed，避免遮挡内容）
   - 页面已有 .site-foot 或 <footer> 时不重复注入
   - 控制台页（.main）会把左偏移对齐侧栏
   ══════════════════════════════════════════════════════════════ */
export function mountSiteFooter() {
  var REPO = 'https://github.com/wcvjk8tnz8-create/MeoyDomain';
  function inject() {
    try {
      if (document.querySelector('.site-foot') || document.querySelector('footer')) return;
      var f = document.createElement('footer');
      f.className = 'site-foot';
      f.innerHTML =
        '<div class="site-foot-in">' +
        '<span class="sf-brand">TerraDomain</span>' +
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
}


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


/* ══════════════════════════════════════════════════════════════
   主题切换（浅色 = DnsNeko 蓝白网格 / 深色 = 雪岭深蓝云雾）
   - 最早执行：避免刷新时白/黑闪屏
   - 记忆在 localStorage；首次跟随系统 prefers-color-scheme
   - 顶栏自动挂按钮（控制台 / 落地页 / 登录页都生效）
   ══════════════════════════════════════════════════════════════ */
(function theme() {
  var KEY = 'meoy_theme';

  /** 读取当前应生效的主题 */
  function current() {
    try {
      var v = localStorage.getItem(KEY);
      if (v === 'dark' || v === 'light') return v;
    } catch (e) {}
    try {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {}
    return 'light';
  }

  /** 应用主题（只切 data-theme，样式全由 CSS 令牌接管） */
  function apply(t, animate) {
    var html = document.documentElement;
    if (animate) {
      html.classList.add('theme-anim');
      setTimeout(function () { html.classList.remove('theme-anim'); }, 320);
    }
    if (t === 'dark') html.setAttribute('data-theme', 'dark');
    else html.removeAttribute('data-theme');
    // 同步浏览器 UI（地址栏/滚动条）配色
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0a1220' : '#ffffff');
    document.querySelectorAll('.theme-btn').forEach(function (b) {
      b.title = t === 'dark' ? '切换到浅色' : '切换到深色';
      b.setAttribute('aria-label', b.title);
    });
  }

  // ★ 立即应用（本文件在 <head> 之后、body 渲染前已加载，避免闪屏）
  apply(current(), false);

  var SUN = '<svg class="i-sun" viewBox="0 0 24 24"><path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m11.32 0 1.41 1.41M4.93 4.93l1.41 1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
  var MOON = '<svg class="i-moon" viewBox="0 0 24 24"><path d="M20.7 14.3A9 9 0 0 1 9.7 3.3 9 9 0 1 0 20.7 14.3Z"/></svg>';

  function makeBtn() {
    var b = document.createElement('button');
    b.className = 'theme-btn';
    b.type = 'button';
    b.innerHTML = MOON + SUN;
    b.onclick = function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch (e) {}
      apply(next, true);
    };
    return b;
  }

  /** 把按钮插到顶栏（控制台/落地页各自的容器） */
  function mount() {
    if (document.querySelector('.theme-btn')) return;
    var host =
      document.querySelector('.topbar-in') ||
      document.querySelector('.home-top-in .home-nav');
    if (!host) return;
    var b = makeBtn();
    // 放到右侧图标组（铃铛 / 搜索 / 头像前）。历史上找的是 .bell，
    // 但真实节点是 #bellBtn，于是永远落回 firstChild —— 顶栏面包屑左边
    // 多出一个孤立按钮，与预览图不一致。
    var bell = host.querySelector('#bellBtn');
    var search = host.querySelector('#topSearch');
    var chip = host.querySelector('#userChip');
    if (bell) host.insertBefore(b, bell);
    else if (search) host.insertBefore(b, search);
    else if (chip) host.insertBefore(b, chip);
    else host.appendChild(b);
    apply(current(), false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  // 顶栏可能是异步渲染的（shell.js），补两次
  setTimeout(mount, 300);
  setTimeout(mount, 1200);

  // 用户没手动选过时，跟随系统变化
  try {
    var mq = matchMedia('(prefers-color-scheme: dark)');
    var onChange = function (e) {
      var saved = null;
      try { saved = localStorage.getItem(KEY); } catch (err) {}
      if (!saved) apply(e.matches ? 'dark' : 'light', true);
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch (e) {}

  window.MeoyTheme = { remount: mount, get: current, set: function (t) { try { localStorage.setItem(KEY, t); } catch (e) {} apply(t, true); } };
})();


/* ═══ shell.js ═══ */
/* ============================================================
   站点骨架：紫蓝渐变顶栏 + 左侧功能导航
   用法：页面里调 mountShell('domains') 即可，无需各自写导航。
   active 取值：domains | checkin | rewards | whois | chat | admin
   ============================================================ */

export const SHELL_NAV = [
  { key: 'domains', name: '域名管理', icon: 'globe', href: '/dashboard', group: '控制台' },
  { key: 'register', name: '注册域名', icon: 'plus', href: '/register', group: '控制台' },
  { key: 'whois', name: 'WHOIS 查询', icon: 'search', href: '/whois', group: '资源管理' },
  { key: 'transfer', name: '域名转移', icon: 'swap', href: '/transfer', group: '资源管理' },
  { key: 'checkin', name: '签到地', icon: 'calendar', href: '/checkin', group: '用户中心' },
  { key: 'rewards', name: '奖励中心', icon: 'gift', href: '/rewards', group: '用户中心' },
  { key: 'chat', name: '聊天地', icon: 'chat', href: '/chat', group: '用户中心' },
  { key: 'tickets', name: '工单系统', icon: 'ticket', href: '/tickets', group: '用户中心' },
  { key: 'profile', name: '个人资料', icon: 'user', href: '/profile', group: '用户中心' },
  { key: 'report', name: '举报滥用', icon: 'flag', href: '/report', group: '用户中心' },
  { key: 'home', name: '站点首页', icon: 'home', href: '/home', group: '用户中心' },
];

export const SHELL_ICON = {
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
  plus: '<path d="M12 5v14M5 12h14"/>',
  flag: '<path d="M5 21V4h13l-2.5 4L18 12H5"/>',
};


/* ---------- v2：SVG 精灵（猫脸头像 / 猫娘吉祥物） ---------- */
export const NEKO_SPRITE = `
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

</svg>`;

/* 闪光装饰（位置固定，纯装饰） */
export const SPARKS = [
  { l: '30%', t: '14%', fs: 18, d: 0 },
  { l: '62%', t: '8%',  fs: 12, d: 1 },
  { l: '86%', t: '36%', fs: 20, d: .5 },
  { l: '44%', t: '70%', fs: 14, d: 1.6 },
  { l: '92%', t: '78%', fs: 12, d: 2 },
];

/** 挂载 v2 装饰：精灵图 / 闪光 / 猫娘吉祥物（只挂载一次）
    当前主题下跳过闪光与吉祥物：它们已被样式层隐藏，
    再插入 DOM 只是白白增加节点。 */
export function mountDecor() {
  if (document.getElementById('nekoSprite')) return;
  const plain = document.documentElement.getAttribute('data-skin') === 'doc';
  const wrap = document.createElement('div');
  wrap.innerHTML = NEKO_SPRITE + (plain ? '' :
    SPARKS.map((p) => `<span class="spark" style="left:${p.l};top:${p.t};font-size:${p.fs}px;animation-delay:${p.d}s">✦</span>`).join(''));
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
}

/* ══════════════════════════════════════════════════════════
   动效引擎（全局单例）
   - 顶部 2px 滚动进度条
   - 元素滚动到视口才播入场（IntersectionObserver）
   - 表格行错峰淡入
   历史上有 shell 版与 standalone 版两套引擎，refreshRuntime() 每次切页
   把它们都调一遍；standalone 用裸 addEventListener，不随切页注销，
   滚动监听会一直累积。这里收口成一份：进度条 / scroll / IO 只建一次，
   每次切页只重新扫描 DOM。只动 transform / opacity，不触发重排。
   ══════════════════════════════════════════════════════════ */
let __motionBoot: { io: IntersectionObserver | null; reduced: boolean } | null = null;

/* ── 顶栏自动缩走 ──
   向下滚先收成窄胶囊，继续滚则滑出视口；上滑立刻回来，回到顶部完全展开。
   只切 body class，过渡交给 CSS（减少动态时自动不播动画）。
   全局只注册一次监听，切页由 refreshRuntime() 重算一次当前状态。 */
let __lastTopbarY = 0;
function syncTopbarState() {
  const y = Math.max(window.scrollY || 0, 0);
  // 自动「滑出视口」已移除：滚动只把顶栏收成悬浮胶囊，始终可见（参考图）。
  // 彻底隐藏只由用户点「收起顶栏」触发，存在 localStorage，刷新/切页都保持；
  // 顶部会留一个小把手随时唤回，不会再也找不到导航。
  document.body.classList.toggle('topbar-compact', y > 24);
  __lastTopbarY = y;
}

/* ── 侧栏 / 顶栏收起偏好 ──
   两个状态都只认用户点击，不再和滚动方向绑定；手机端侧栏本来就是抽屉，
   不套用折叠宽度，避免把抽屉挤成 76px。 */
const SIDE_KEY = 'td_side_collapsed';
const TOPBAR_KEY = 'td_topbar_hidden';
let __layoutBoot = false;

function setSideCollapsed(on) {
  const narrow = window.innerWidth <= 700;
  const val = !!on && !narrow;
  document.body.classList.toggle('side-collapsed', val);
  try { if (val) localStorage.setItem(SIDE_KEY, '1'); else localStorage.removeItem(SIDE_KEY); } catch {}
  syncLayoutButtons(val);
}

function syncLayoutButtons(collapsed: boolean) {
  // 文案全部交给 i18n 静态翻译，这里只切状态：动态改写文本节点会被
  // MutationObserver 当成「新原文」，切回中文时可能停在英文上。
  const b = document.getElementById('sideCollapse');
  if (b) b.setAttribute('aria-pressed', String(collapsed));
}

function setTopbarHidden(on) {
  const val = !!on;
  document.body.classList.toggle('topbar-hidden', val);
  try { if (val) localStorage.setItem(TOPBAR_KEY, '1'); else localStorage.removeItem(TOPBAR_KEY); } catch {}
}

export function applyLayoutPrefs() {
  const narrow = window.innerWidth <= 700;
  // 公共页（home-top）没有控制台顶栏，不该被上一页残留的隐藏状态影响
  const shell = !!document.getElementById('topbar');
  let side = false, top = false;
  try {
    side = localStorage.getItem(SIDE_KEY) === '1';
    top = localStorage.getItem(TOPBAR_KEY) === '1';
  } catch {}
  const collapsed = side && !narrow && shell;
  document.body.classList.toggle('side-collapsed', collapsed);
  // 手机顶栏是唯一入口（汉堡、搜索、通知都在里面），不允许被记忆状态隐藏
  document.body.classList.toggle('topbar-hidden', top && shell && !narrow);
  syncLayoutButtons(collapsed);
  if (!__layoutBoot) {
    __layoutBoot = true;
    window.addEventListener('resize', () => { try { applyLayoutPrefs(); } catch {} }, { passive: true });
  }
}

function bootMotion() {
  if (__motionBoot) return __motionBoot;
  window.addEventListener('scroll', syncTopbarState, { passive: true });
  syncTopbarState();
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let io: IntersectionObserver | null = null;
  if (!reduced) {
    let bar = document.getElementById('docProgress') as HTMLElement | null;
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'docProgress';
      bar.setAttribute('aria-hidden', 'true');
      document.body.appendChild(bar);
    }
    const el = bar;
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      el.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add('in');
          io && io.unobserve(e.target);
        });
      }, { threshold: .06, rootMargin: '0px 0px -28px 0px' });
    }
  }
  __motionBoot = { io, reduced };
  return __motionBoot;
}

export function mountMotion() {
  const { io } = bootMotion();
  const play = (root?) => {
    const scope = root || document;
    scope.querySelectorAll('tbody').forEach((tb) => {
      Array.prototype.forEach.call(tb.rows, (tr, j) => {
        tr.style.transitionDelay = (j * 55) + 'ms';
      });
      tb.classList.add('in');
    });
    const reveal = scope.querySelectorAll('.reveal');
    reveal.forEach((el, i) => {
      if (el.classList.contains('in')) return;
      // 首屏元素直接显示：只靠 IntersectionObserver 回调时，若回调被浏览器
      // 延后或元素卡在阈值边缘，.reveal{opacity:0} 会让标题整块消失。
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * .95) { el.classList.add('in'); return; }
      el.style.transitionDelay = (i * 45) + 'ms';
      if (io) io.observe(el);
      else el.classList.add('in');
    });
  };

  play(document);
  // 内容异步渲染后（列表/表格晚于骨架出现），延迟再扫一遍
  setTimeout(() => play(document), 400);
  setTimeout(() => play(document), 1200);
}


/* ---------- 头像：顶栏与个人资料页必须一致 ----------
   优先级：用户自定义头像（URL） > 猫脸 SVG（按邮箱哈希，同一账号恒定）
   customUrl 从 /api/profile 读取，与个人资料页同源。 */
/* 未选择头像时默认用初音未来（Q版）。内置头像库见 /api/profile 返回的 avatars。 */
export const DEFAULT_AVATAR = '/img/avatar/miku-headset.webp';

/* 图片加载失败时的兜底：自绘猫脸 SVG，避免头像位置空白 */
export function catFaceFallback() {
  document.querySelectorAll('.top-av-wrap').forEach((el) => {
    const size = el.dataset.size ? `width:${el.dataset.size}px;height:${el.dataset.size}px;` : '';
    el.innerHTML = `<svg class="top-av" viewBox="0 0 100 100" style="${size}${el.dataset.catstyle || ''}"><use href="#catface"/></svg>`;
  });
}

export function renderAvatars(customUrl) {
  const safe = (u) => (/^(https?:\/\/|\/|data:image\/)/i.test(String(u || '')) ? String(u) : '');
  const url = safe(customUrl) || DEFAULT_AVATAR;
  document.querySelectorAll('.top-av-wrap').forEach((el) => {
    const size = el.dataset.size ? `width:${el.dataset.size}px;height:${el.dataset.size}px;` : '';
    el.innerHTML = `<img class="top-av" src="${url.replace(/"/g, '&quot;')}" alt="头像" style="${size}" onerror="window.MeoyRenderCatFaces&&window.MeoyRenderCatFaces()">`;
  });
}
window.MeoyRenderAvatars = renderAvatars;
window.MeoyRenderCatFaces = catFaceFallback;

/* ---------- 品牌信息缓存（避免每次切页都等一个网络往返） ---------- */
export const BRAND_KEY = 'meoy_brand';
export const BRAND_TTL = 5 * 60 * 1000;   // 5 分钟

export function readBrandCache() {
  try {
    const raw = sessionStorage.getItem(BRAND_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || Date.now() - o.t > BRAND_TTL) return null;
    return o.v;
  } catch { return null; }
}

export function writeBrandCache(v) {
  try { sessionStorage.setItem(BRAND_KEY, JSON.stringify({ t: Date.now(), v })); } catch {}
}

/** 就地更新品牌（顶栏 logo / 站点名 / 标题） */
export function applyBrand(b) {
  document.querySelectorAll('[data-brand-name]').forEach((el) => setBrandName(el, b.siteName));
  // 品牌 logo 现在在侧栏（顶栏改为面包屑）
  document.querySelectorAll('.side-brand img').forEach((li) => {
    if (li.getAttribute('src') !== b.logoUrl) li.src = b.logoUrl;
  });
  const t = document.title;
  const i = t.lastIndexOf(' · ');
  if (i > 0) document.title = t.slice(0, i) + ' · ' + b.siteName;
}

/* ---------- 链接预取：hover / 空闲时把目标页 HTML 拉进缓存 ---------- */
export const prefetched = new Set();
export function prefetch(url) {
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
export function bindPrefetch(root) {
  (root || document).querySelectorAll('#sidebar a[href], .top-brand[href]').forEach((a) => {
    const h = a.getAttribute('href') || '';
    if (!h || h.charAt(0) !== '/' || h.indexOf('.html') < 0) return;
    const go = () => prefetch(h);
    a.addEventListener('mouseenter', go, { once: true, passive: true });
    a.addEventListener('touchstart', go, { once: true, passive: true });
  });
}

/* ---------- 用户信息缓存：切页时侧栏立即渲染，不等网络 ---------- */
export const USER_KEY = 'meoy_user';

export function readUserCache() {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function writeUserCache(u) {
  try { sessionStorage.setItem(USER_KEY, JSON.stringify(u)); } catch {}
}

// 注意：shell.js 以普通 <script> 加载，不能用 export 语法
export function clearUserCache() {
  try { sessionStorage.removeItem(USER_KEY); } catch {}
}

/** 点猫爪 → 冒几个小爱心（纯装饰，走 transform 动画） */
export function pawBurst(anchor) {
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
export function shellItem(it, active, isAdmin) {
  if (it.key === 'admin' && !isAdmin) return '';
  const on = it.key === active;
  return `<a class="side-item${on ? ' on' : ''}" href="${it.href}" data-key="${it.key}" title="${esc(it.name)}" data-tip="${esc(it.name)}">
    <span class="side-ico"><svg viewBox="0 0 24 24">${SHELL_ICON[it.icon] || SHELL_ICON.globe}</svg></span>
    <span class="side-txt">${it.name}</span>
  </a>`;
}

/**
 * 挂载骨架
 * @param {string} active  当前页签
 * @param {object} opt     { optional: 未登录也允许停留 }
 */
export async function mountShell(active, opt: {
  optional?: boolean;
  title?: string;
  deferAvatar?: boolean;
  avatar?: string;
} = {}) {
  const host = document.getElementById('topbar');
  const side = document.getElementById('sidebar');
  if (!host || !side) return;

  // 品牌 + 用户信息都走 sessionStorage 缓存，命中时不等待任何网络往返 —— 切页零阻塞
  let brand = readBrandCache() || { siteName: 'TerraDomain', logoUrl: '/img/logo.jpg' };
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
    if (!opt.optional) { location.href = '/login'; return; }
    me = null;
  }

  document.querySelectorAll('[data-brand-name]').forEach((el) => (el.textContent = brand.siteName));
  // 后台刷新品牌（不阻塞渲染），拿到后再就地更新
  api.get('/api/config').then((cfg) => {
    const b = { siteName: cfg.siteName || cfg.site_name || 'TerraDomain', logoUrl: cfg.logoUrl || cfg.logo_url || '/img/logo.jpg' };
    writeBrandCache(b);
    if (b.siteName !== brand.siteName || b.logoUrl !== brand.logoUrl) applyBrand(b);
  }).catch(() => {});

  const isAdmin = me && me.role === 'admin';
  // 兜底猫脸配色：仅当角色头像图片加载失败时才用到，按邮箱稳定取一套
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
  const EXTRA_NAME = { admin: '管理后台', terms: '服务条款', domain: '域名详情', register: '注册域名', report: '举报滥用' };
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
          <span class="top-av-wrap" id="topAvWrap" data-catstyle="${catStyle}"></span>
        </div>
        <div class="user-menu" id="userMenu">
          <div class="um-head">
            <span class="top-av-wrap" data-size="38" data-catstyle="${catStyle}"></span>
            <div>
              <div class="um-name">${esc(shortName)}</div>
              <div class="um-mail">${esc(me.email)}</div>
            </div>
          </div>
          <div class="um-body">
            <a href="/dashboard">我的域名</a>
            <a href="/rewards">奖励中心</a>
            ${isAdmin ? '<a href="/admin">管理后台</a>' : ''}
            <a href="/terms">服务条款</a>
          </div>
          <div class="um-foot">
            <button class="btn sm ghost" id="btnLogout">退出登录</button>
          </div>
        </div>
      ` : `<a class="btn sm" href="/login">登录</a>`}
      <button class="tb-stow" id="tbStow" type="button" title="收起顶栏" aria-label="收起顶栏">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>
      </button>
    </div>`;

  // 顶栏收起后的唤回把手：独立于顶栏挂载，顶栏滑出后仍可一键展开
  let reveal = document.getElementById('tbReveal');
  if (!reveal) {
    reveal = document.createElement('button');
    reveal.id = 'tbReveal';
    reveal.className = 'topbar-reveal';
    reveal.type = 'button';
    reveal.title = '展开顶栏';
    reveal.setAttribute('aria-label', '展开顶栏');
    reveal.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    document.body.appendChild(reveal);
    reveal.addEventListener('click', () => setTopbarHidden(false));
  }
  const stow = document.getElementById('tbStow');
  if (stow) stow.onclick = () => setTopbarHidden(true);

  const items = [...SHELL_NAV, { key: 'admin', name: '管理后台', icon: 'admin', href: '/admin', group: '系统' }];
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
        <a class="side-item" href="/terms" title="服务条款" data-tip="服务条款"><span class="side-ico"><svg viewBox="0 0 24 24">${SHELL_ICON.terms}</svg></span><span class="side-txt">服务条款</span></a>
        ${me ? `<a class="side-item" href="#" id="sideLogout" title="退出登录" data-tip="退出登录"><span class="side-ico"><svg viewBox="0 0 24 24">${SHELL_ICON.logout}</svg></span><span class="side-txt">退出登录</span></a>` : ''}
      </div>
    </div>
    <button class="side-collapse" id="sideCollapse" type="button" title="收起 / 展开侧边栏" aria-label="收起 / 展开侧边栏" aria-pressed="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6l-6 6 6 6"/></svg>
      <span class="sc-label">收起侧边栏</span>
      <span class="sc-label sc-label-open">展开侧边栏</span>
    </button>`;
  side.querySelectorAll('[data-brand-name]').forEach((el) => setBrandName(el, brand.siteName));

  const tg = document.getElementById('sideToggle');
  const setSide = (open) => document.body.classList.toggle('side-open', open);
  if (tg) tg.onclick = () => setSide(!document.body.classList.contains('side-open'));

  const sc = document.getElementById('sideCollapse');
  if (sc) sc.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setSideCollapsed(!document.body.classList.contains('side-collapsed'));
  };
  applyLayoutPrefs();
  // 移动端：点遮罩关闭、Esc 关闭、点菜单项后自动关闭（此前只能再点汉堡，容易「卡住」）
  __docOn('click', (e) => {
    if (!document.body.classList.contains('side-open')) return;
    if (e.target.closest?.('#sideToggle') || e.target.closest?.('.sidebar')) {
      if (e.target.closest?.('.side-item')) setSide(false);   // 选中导航后收起
      return;
    }
    setSide(false);   // 点遮罩/其它区域 → 关闭
  });
  __docOn('keydown', (e) => {
    if (e.key === 'Escape') { setSide(false); setMenu(false); setTopbarHidden(false); }
  });

  /* 用户菜单：点 chip 展开，点外部或按 Esc 关闭（关闭也播一段淡出） */
  const chip = document.getElementById('userChip');
  const menu = document.getElementById('userMenu');
  const menuOpen = () => !!menu && menu.classList.contains('on') && !menu.classList.contains('out');
  const setMenu = (open) => {
    if (!chip || !menu) return;
    if (open) {
      menu.classList.remove('out');
      chip.classList.add('on');
      menu.classList.add('on');
      return;
    }
    chip.classList.remove('on');
    if (!menu.classList.contains('on') || menu.classList.contains('out')) return;
    menu.classList.add('out');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    setTimeout(() => menu.classList.remove('on', 'out'), reduced ? 0 : 160);
  };
  if (chip && menu) {
    chip.onclick = (e) => {
      e.stopPropagation();
      setMenu(!menuOpen());
    };
    menu.addEventListener('click', (e) => e.stopPropagation());
    __docOn('click', () => setMenu(false));
    __docOn('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  }

  /* 顶栏猫爪：点一下放个小爱心 */
  const pawBtn = document.getElementById('pawBtn');
  if (pawBtn) pawBtn.onclick = () => pawBurst(pawBtn);

  const out = async () => {
    clearUserCache();
    try { await api.post('/api/auth/logout', {}); } catch {}
    location.href = '/login';
  };
  const bl = document.getElementById('btnLogout');
  if (bl) bl.onclick = out;
  const sl = document.getElementById('sideLogout');
  if (sl) sl.onclick = (e) => { e.preventDefault(); out(); };

  /* 铃铛：站内通知（域名审核结果 / 登录 IP 提醒），点击展开下拉面板 */
  const bellCount = document.getElementById('bellCount');
  const bellBtn = document.getElementById('bellBtn');

  function setBell(n) {
    if (!bellCount) return;
    if (n > 0) { bellCount.textContent = n > 99 ? '99+' : String(n); bellCount.hidden = false; }
    else bellCount.hidden = true;
  }

  async function loadBell() {
    try {
      const r = await api.get('/api/notifications/unread');
      setBell((r && r.unread) | 0);
    } catch (e) {}
  }

  if (bellBtn) {
    /** 统一关闭：先播退出动画，动画结束再移除节点 */
    const closeNotif = (panel) => {
      if (!panel || !panel.isConnected || panel.classList.contains('out')) return;
      panel.classList.add('out');
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      setTimeout(() => panel.remove(), reduced ? 0 : 160);
    };
    bellBtn.onclick = async (e) => {
      e.stopPropagation();
      let panel = document.getElementById('notifPanel');
      if (panel) {
        // 退出动画中途再点铃铛：取消退出、直接复用面板
        if (panel.classList.contains('out')) { panel.classList.remove('out'); return; }
        closeNotif(panel);
        return;
      }

      panel = document.createElement('div');
      panel.id = 'notifPanel';
      panel.className = 'notif-panel';
      panel.innerHTML = '<div class="np-head">通知</div><div class="np-body"><div class="np-empty">加载中…</div></div>';
      document.body.appendChild(panel);
      // 定位到铃铛下方
      const r = bellBtn.getBoundingClientRect();
      panel.style.top = (r.bottom + 8) + 'px';
      panel.style.right = Math.max(12, window.innerWidth - r.right) + 'px';
      panel.onclick = (ev) => ev.stopPropagation();
      __docOn('click', function close(ev) {
        if (!panel.isConnected) return document.removeEventListener('click', close);
        if (!panel.contains(ev.target)) { closeNotif(panel); document.removeEventListener('click', close); }
      });

      try {
        const d = await api.get('/api/notifications?filter=all');
        const items = (d && d.items) || [];
        panel.querySelector('.np-body').innerHTML = items.length
          ? items.map((n) => `
            <div class="np-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
              <div class="np-t"><b>${esc(n.title)}</b><span class="np-tag">${esc(n.tag || '系统通知')}</span></div>
              <div class="np-b">${esc(n.body)}</div>
            </div>`).join('')
          : '<div class="np-empty">暂无通知</div>';

        panel.querySelectorAll('.np-item').forEach((it) => {
          it.onclick = async () => {
            const id = Number(it.dataset.id);
            try { await api.post('/api/notifications/read', { id }); } catch (e) {}
            it.classList.remove('unread');
            loadBell();
            const link = (items.find((x) => x.id === id) || {}).link;
            if (link) location.href = link;
          };
        });

        const head = panel.querySelector('.np-head');
        const btn = document.createElement('button');
        btn.className = 'np-readall';
        btn.textContent = '全部已读';
        btn.onclick = async () => {
          try { await api.post('/api/notifications/read-all', {}); } catch (e) {}
          panel.querySelectorAll('.np-item').forEach((x) => x.classList.remove('unread'));
          setBell(0);
        };
        head.appendChild(btn);
      } catch (err) {
        const b = panel.querySelector('.np-body');
        if (b) b.innerHTML = '<div class="np-empty">加载失败</div>';
      }
    };
    loadBell();
  }
  /* 搜索框：Ctrl+K 聚焦页面内的域名搜索，聚焦不到就跳域名管理页 */
  const ts = document.getElementById('topSearch');
  if (ts) ts.onclick = () => {
    const el = document.getElementById('label') || document.getElementById('qName') || document.getElementById('whoisName');
    if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else location.href = '/dashboard';
  };
  __docOn('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      const el = document.getElementById('label') || document.getElementById('qName') || document.getElementById('whoisName');
      if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else location.href = '/dashboard';
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
      f.innerHTML = '<b>TerraDomain</b> · 二级域名分发与 DNS 管理 · <a href="https://github.com/wcvjk8tnz8-create/MeoyDomain" target="_blank" rel="noopener noreferrer" style="color:inherit">GitHub</a>';
      main.appendChild(f);
    }
  } catch {}

  mountDecor();
  mountMotion();

  // 顶栏头像与个人资料页保持同源。
  // opt.deferAvatar：页面自己已在首屏快照里取到头像，会在整屏渲染时一次写好，
  // 这里就不要「先默认 Miku → 再异步替换」，否则切页后头像还会跳一帧。
  // 其它页面保持原行为，其 profile 请求会计入就绪门控，过渡同样不会提前收起。
  if (!opt.deferAvatar) {
    renderAvatars('');
    api.get('/api/profile').then((d) => {
      const av = (d && d.profile && d.profile.avatar) || '';
      if (av) renderAvatars(av);
    }).catch(() => {});
  }

  bindPrefetch(side);
  // 空闲时预取其余常用页（不抢占当前页资源）
  idle(() => ['/dashboard', '/whois', '/checkin', '/rewards', '/chat'].forEach(prefetch));

  // 入场动画
  document.body.classList.add('shell-ready');
  return me;
}

/** requestIdleCallback 兜底 */
export function idle(fn) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 2500 });
  else setTimeout(fn, 1200);
}

/* ── 把运行时挂到 window，供内联 onclick / 旧代码使用 ── */
const R: Record<string, any> = {
  api, esc, fmtTime, fmtDate, toast, openModal, closeModal, loadBranding, applyBranding,
  applyFonts, STATUS_MAP, statusBadge, copyText, quotaText, mountNav, mountShell,
  mountSiteFooter, logoHtml, wallpaperSwitchHtml, applyWallpaper, mountWallpaper, mountSakura,
  DEFAULT_BRAND, CN_FONTS, WALLPAPERS, PAW_SVG, SHELL_NAV, SHELL_ICON, prefetch,
  readUserCache, writeUserCache, clearUserCache, idle, renderAvatars, catFaceFallback,
  mountDecor, mountMotion, applyBrand, pawBurst, shellItem, refreshRuntime, cleanupPage, navigate,
};
(window as any).MeoyRuntime = R;
/* 旧内联脚本（profile 等）既从本模块 import，也通过 window 调用这两个名字。
   以前这里只写进 Object.assign 却从未定义，Rollup 报 "is not exported by" /
   "is not defined"，导致 Vite 构建失败。用已有函数显式定义并导出。 */
export const MeoyRenderAvatars = renderAvatars;
export const MeoyRenderCatFaces = catFaceFallback;
Object.assign(window, {
  api, esc, fmtTime, fmtDate, toast, openModal, closeModal, loadBranding, applyBranding,
  STATUS_MAP, statusBadge, copyText, quotaText, mountShell, mountNav, mountSiteFooter,
  MeoyRenderAvatars, MeoyRenderCatFaces, refreshRuntime, cleanupPage, navigate,
});
