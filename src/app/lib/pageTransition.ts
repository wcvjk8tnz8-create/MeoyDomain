/**
 * 页面切换过渡：Miku 从下方冒出来，旁边一个「跳转中…」对话气泡。
 * 只在「真的发生跳转」时出现：站内链接、后退/前进、整页跳转。
 * 刷新（F5 / Cmd+R）、地址栏直接打开、从外部站点进来都算首屏，不播过渡。
 *
 * ── 导航意图判定 ──
 * SPA 站内跳转不重载文档，由链接点击 / popstate / 路由 key 变化直接驱动。
 * 整页跳转会销毁文档，卸载前在 sessionStorage 留一个短效意图标记；
 * 新文档首屏读到标记才播。刷新同样是卸载，但 Navigation Timing 的
 * type === 'reload' 一律排除，且标记读取后立即消费，不会残留误播。
 *
 * ── 为什么不能只听 refreshRuntime() ──
 * 15 个页面里有 9 个用 mountShell().then(...) 且没有 await（admin/domain/
 * profile/tickets/transfer/whois/terms/checkin/dashboard），mountXxx() 会
 * 立刻 resolve，refreshRuntime() 在资料还在飞的时候就派发 page-ready，
 * 过渡会被瞬间取消 —— 表现就是「有些页面没有动画」。
 * 所以就绪判据改成：#root 内容稳定（MutationObserver 静默窗口）
 * + 最短显示时长；refreshRuntime 的信号只作为加速，不再能取消显示。
 *
 * ── 节奏：解决「素材加载慢 / 页面切太快 / 切完还要干等」──
 * 1. 首屏 mountTransition() → warmAssets() 立刻解码 Miku 与壁纸，
 *    切页时素材已在内存，不再现用现拉。
 * 2. 点击链接的同一瞬间 prefetchRoute(href) 并行发起目标页首屏接口；
 *    目标页控制器读缓存直接渲染，不再「切过去 → 空壳 → 串行等接口」。
 * 3. 换页时机 = 数据到手（或 NAV_MAX_WAIT 上限）+ Miku 起手动画，
 *    两者取较晚者；快页几百毫秒就进，慢页才真的等。
 * 4. 不再固定按住 1.1 秒：只保底 MIN_VISIBLE 让动画看得见，
 *    数据一就绪就收起。导航未发生前旧页面的 page-ready 一律不算数。
 * 5. 过渡期间再点别的链接会改目标并重新预取，不会把点击吞掉。
 *
 * ── 换成 GIF 或 MP4（拿到素材后改顶部一行即可）──
 *   1. 文件丢进 public/img/transition/，如 miku.gif / miku.mp4
 *   2. kind 改成 'gif' 或 'video'，src 改成对应路径
 *   GIF 走 <img>；MP4 自动静音循环内联播放（符合自动播放策略）。
 *   两者都保留冒出 / 缩回动画，不冲突。
 */
import { prefetchRoute } from './prefetch';

const MEDIA: { kind: 'image' | 'gif' | 'video'; src: string } = {
  kind: 'image',
  src: '/img/transition/miku-pop.png',
};

/* 首屏就解码：切页时这些图只走内存缓存，不再占网络往返 */
const WARM_ASSETS = [
  '/img/wallpaper/miku-bouquet.webp',
  '/img/wallpaper/miku-bouquet-dark.webp',
  '/img/wallpaper/miku-bouquet-haze.webp',
];

const I18N = {
  zh: { bubble: '跳转中', hint: '正在为你准备页面', aria: '页面加载中' },
  en: { bubble: 'Heading over', hint: 'Getting things ready', aria: 'Loading page' },
};

/** 每次切页都要出现；0ms = 点击即开始播 */
const SHOW_DELAY = 0;
/** 素材最多等这么久（首屏已预热，通常 0ms） */
const MEDIA_WAIT = 180;
/** 换页前至少让 Miku 起手这么久，避免动画还没露面就切走 */
const NAV_HOLD_MIN = 200;
/** 数据最久等这么久；网慢也不把切页卡死，遮罩继续盖着等页面自己渲染 */
const NAV_MAX_WAIT = 1400;
/** 只保底让动画看得见，数据一好就收起 —— 不再固定按住 1.1 秒 */
const MIN_VISIBLE = 360;
/** #root 静默这么久才算「资料真的渲染完」；预取命中后通常一帧就稳 */
const DOM_QUIET = 180;
const CHECK_TICK = 70;
/** 收起淡出时长，与 CSS 的 opacity .28s / sink .34s 对齐 */
const HIDE_ANIM = 340;
/** 接口挂死也不会把页面遮住 */
const FORCE_HIDE = 8000;
/** 页面忘了派发就绪信号时，才退回「DOM 静默」判据收起，避免永远盖着 */
const READY_FALLBACK = 2600;

let root: HTMLElement | null = null;
let host: HTMLElement | null = null;
let active = false;
let starting = false;
let navPending = false;
let pendingAction: (() => void) | null = null;
let navReady: Promise<void> = Promise.resolve();
let dataReady = true;
let shownAt = 0;
let lastMutation = 0;
let readySignaled = false;
let showTimer = 0;
let navTimer = 0;
let checkTimer = 0;
let pendingHidden = 0;
let forceTimer = 0;
let observer: MutationObserver | null = null;
let mediaWarm: Promise<void> | null = null;
/** 本次文档生命周期里是否发生过「用户主动导航」的交互 */
let navArmed = false;

/* ── 导航意图：只有跳转才播，刷新不播 ── */
const NAV_INTENT_KEY = 'td:nav-intent';
const NAV_INTENT_TTL = 6000;

function markNavigation() {
  try { sessionStorage.setItem(NAV_INTENT_KEY, String(Date.now())); } catch {}
}
function clearNavigation() {
  try { sessionStorage.removeItem(NAV_INTENT_KEY); } catch {}
}
function armNavigation() { navArmed = true; }

/** 兼容旧浏览器的 navigation.type；reload 必须单独识别 */
function navigationType(): string {
  try {
    const entries = performance.getEntriesByType?.('navigation') as unknown as
      { type?: string }[] | undefined;
    if (entries?.length && entries[0].type) return String(entries[0].type);
  } catch { /* 老浏览器走下面的 performance.navigation */ }
  try {
    const legacy = (performance as any).navigation;
    if (legacy) {
      if (legacy.type === 1) return 'reload';
      if (legacy.type === 2) return 'back_forward';
      return 'navigate';
    }
  } catch { /* 拿不到就按普通首屏处理 */ }
  return 'navigate';
}

/** 一次性消费意图标记；刷新 / 无标记 / 超时都返回 false */
function consumeNavigationIntent(): boolean {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(NAV_INTENT_KEY); } catch {}
  if (raw !== null) clearNavigation();
  if (navigationType() === 'reload') return false;   // 刷新绝不播
  const at = Number(raw);
  return raw !== null && Number.isFinite(at) && Date.now() - at < NAV_INTENT_TTL;
}

/** 首屏要不要播：根域名页跳来时那一页已播过，这里不重播第二遍 */
function shouldPlayOnLoad(): boolean {
  let hopped = false;
  try {
    const h = new URL(document.referrer || '', location.href).hostname;
    hopped = /(^|\.)(meoy\.top|v-1\.top)$/i.test(h);
  } catch { /* referrer 被隐私策略掐掉时按普通首屏处理 */ }
  if (hopped) { clearNavigation(); return false; }
  return consumeNavigationIntent();
}

function lang(): 'zh' | 'en' {
  return document.documentElement.getAttribute('data-lang') === 'en' ? 'en' : 'zh';
}

function applyLang() {
  if (!root) return;
  const t = I18N[lang()];
  const bubble = root.querySelector('.td-bubble-text');
  const hint = root.querySelector('.td-trans-hint');
  if (bubble) bubble.textContent = t.bubble;
  if (hint) hint.textContent = t.hint;
  root.setAttribute('aria-label', t.aria);
}

/** 解码一张图（失败也 resolve，绝不阻塞切页） */
function decodeAsset(src: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const img = new Image();
    img.src = src;
    if (typeof img.decode === 'function') img.decode().then(finish, finish);
    else { img.onload = finish; img.onerror = finish; }
    window.setTimeout(finish, 1500);
  });
}

/** 过渡素材预热：入口 mountTransition() 时调用一次，幂等 */
function warmMedia(): Promise<void> {
  if (mediaWarm) return mediaWarm;
  mediaWarm = new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    if (MEDIA.kind === 'video') {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.src = MEDIA.src;
      v.addEventListener('loadeddata', finish, { once: true });
      v.addEventListener('error', finish, { once: true });
      try { v.load(); } catch { finish(); }
    } else {
      decodeAsset(MEDIA.src).then(finish, finish);
    }
    window.setTimeout(finish, 1500);
  });
  return mediaWarm;
}

/** 首屏空闲只预热「当前主题那张壁纸 + 氛围图」。
 *  以前连浅/深两张 175K/135K 都拉，没用上的那张纯属抢首屏带宽。
 *  切主题时 applyWallpaper 自己会解码另一张，不影响切换。 */
export function warmAssets() {
  warmMedia();
  const el = document.documentElement;
  const theme = el.getAttribute('data-theme');
  const dark = theme === 'dark'
    || (theme !== 'light' && typeof (window as any).matchMedia === 'function'
      && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const picks = [
    '/img/wallpaper/miku-bouquet-haze.webp',
    dark ? WARM_ASSETS[1] : WARM_ASSETS[0],
  ];
  const idle = (window as any).requestIdleCallback as ((cb: () => void) => void) | undefined;
  const run = () => { picks.forEach((src) => { void decodeAsset(src); }); };
  if (idle) idle(run); else window.setTimeout(run, 120);
}

/** 最多等 MEDIA_WAIT，素材没好也照常播（总比白等强） */
function waitMedia(): Promise<void> {
  return Promise.race([
    warmMedia(),
    new Promise<void>((r) => window.setTimeout(r, MEDIA_WAIT)),
  ]);
}

function mediaHtml(): string {
  const inner = MEDIA.kind === 'video'
    ? `<video class="td-miku-media" src="${MEDIA.src}" autoplay muted loop
        playsinline preload="auto" disablepictureinpicture aria-hidden="true"></video>`
    : `<img class="td-miku-media" src="${MEDIA.src}" alt=""
        draggable="false" decoding="sync" aria-hidden="true">`;
  // 外层负责「从下方冒出来」，内层负责冒出后的轻微呼吸，两个动画不抢 transform
  return `<div class="td-miku-rise">${inner}</div>`;
}

function build(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'tdTransition';
  el.className = 'td-trans';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('data-no-i18n', '');   // 双语模块别改写气泡文案
  el.innerHTML = `
    <div class="td-trans-panel">
      <div class="td-trans-bubble">
        <span class="td-bubble-text"></span>
        <span class="td-bubble-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      </div>
      <div class="td-miku-stage">${mediaHtml()}</div>
      <div class="td-trans-hint"></div>
      <div class="td-trans-bar" aria-hidden="true"><span></span></div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function stopWatching() {
  try { observer?.disconnect(); } catch {}
  observer = null;
  clearTimeout(checkTimer);
}

function watchDom() {
  stopWatching();
  host = document.getElementById('root') || document.body;
  lastMutation = performance.now();
  try {
    observer = new MutationObserver(() => { lastMutation = performance.now(); });
    observer.observe(host, { childList: true, subtree: true, characterData: true });
  } catch { /* 老浏览器：只靠时长与就绪信号 */ }
}

/**
 * 只有页面自己宣告「整屏写完」才收起。
 * 以前 (stable || readySignaled) 让 DOM 静默 180ms 单独放行：预取数据一到、
 * 第一波骨架渲染完就收起，后面 profile / points 陆续回来继续改 DOM ——
 * 用户看到的就是「一阶段、二阶段、三阶段慢慢加载出来」。
 */
function scheduleCheck() {
  clearTimeout(checkTimer);
  checkTimer = window.setTimeout(() => {
    if (!active) return;
    const now = performance.now();
    const shown = now - shownAt >= MIN_VISIBLE;
    const stable = now - lastMutation >= DOM_QUIET;
    const settled = readySignaled || (now - shownAt >= READY_FALLBACK && stable);
    if (shown && !navPending && dataReady && settled) { hide(); return; }
    scheduleCheck();
  }, CHECK_TICK);
}

function show() {
  if (!root || active) return;
  active = true;
  shownAt = performance.now();
  clearTimeout(pendingHidden);
  applyLang();
  root.hidden = false;
  // 两帧后再加 is-in，确保 display 已生效，进场动画能被播放
  requestAnimationFrame(() => requestAnimationFrame(() => root?.classList.add('is-in')));
  watchDom();
  scheduleCheck();
  clearTimeout(forceTimer);
  forceTimer = window.setTimeout(hide, FORCE_HIDE);
}

function runPendingAction() {
  if (!navPending && !pendingAction) return;
  const fn = pendingAction;
  pendingAction = null;
  navPending = false;
  clearTimeout(navTimer);
  try { fn?.(); } catch { /* 软导航失败也不该把过渡层卡住 */ }
}

function hide() {
  runPendingAction();          // 兜底隐藏时若还没换页，补一次，绝不让页面停住
  clearTimeout(forceTimer);
  clearTimeout(checkTimer);
  stopWatching();
  if (!root || !active) return;
  active = false;
  root.classList.add('is-out');
  root.classList.remove('is-in');
  pendingHidden = window.setTimeout(() => {
    if (!root || active) return;
    root.hidden = true;
    root.classList.remove('is-out');
  }, HIDE_ANIM);
}

/**
 * 切页开始。只有跳转才调用，重复调用幂等：
 *  - 站内链接点击：beginTransition(() => navigate(href))（延后换页）
 *  - popstate / App 路由 key 变化：beginTransition()（URL 已变，只播过渡）
 *  - mountTransition()：仅当检测到「从别的页跳过来」的意图标记
 *  刷新 / 直接打开 / 外部进入不会调用到这里。
 */
export function beginTransition(action?: () => void, ready?: Promise<void>) {
  if (action) armNavigation();
  // 过渡中又点了别的页面：改目标 + 重新预取，不重播动画、不吞点击
  if (active || starting) {
    if (action) {
      const wasPending = navPending;
      pendingAction = action;
      navPending = true;
      // 旧页面的就绪信号不能沿用，否则换目标后会被当成新页面已完成
      readySignaled = false;
      if (ready) { dataReady = false; navReady = ready; ready.then(markDataReady); }
      // 已经换过页了还再点一次：重新排一次导航，别等兜底隐藏才跳
      if (!wasPending && !starting) {
        clearTimeout(navTimer);
        navTimer = window.setTimeout(() => { runPendingAction(); scheduleCheck(); }, 120);
      }
    }
    return;
  }
  starting = true;
  readySignaled = false;
  navPending = !!action;
  pendingAction = action || null;
  navReady = ready || Promise.resolve();
  dataReady = !ready;
  if (ready) ready.then(markDataReady);
  clearTimeout(showTimer);
  clearTimeout(navTimer);
  showTimer = window.setTimeout(async () => {
    await waitMedia();
    if (!starting) return;
    show();
    starting = false;
    if (pendingAction) {
      const t0 = performance.now();
      const pre = Promise.race([
        navReady,
        // 超过上限就先换页，之后交给 #root 静默判据，不让遮罩无限盖着
        new Promise<void>((r) => window.setTimeout(() => { dataReady = true; r(); }, NAV_MAX_WAIT)),
      ]);
      // 数据到手（或上限）+ Miku 起手，两者取较晚者再换页
      await pre;
      const wait = Math.max(0, NAV_HOLD_MIN - (performance.now() - t0));
      navTimer = window.setTimeout(() => {
        runPendingAction();
        scheduleCheck();
      }, wait);
    }
  }, SHOW_DELAY);
}

function markDataReady() {
  dataReady = true;
  if (active) scheduleCheck();
}

/** 页面控制器已完成（refreshRuntime 派发）—— 导航前的旧信号不算数。 */
export function endTransition() {
  if (navPending) return;
  readySignaled = true;
  if (active) scheduleCheck();
}

/** 只需在入口挂一次；重复调用幂等。 */
export function mountTransition() {
  if (root) return;
  warmAssets();
  root = build();
  applyLang();

  // 必须包一层：事件对象不能被当成「延后导航回调」传进 beginTransition
  window.addEventListener('popstate', () => beginTransition(undefined, prefetchRoute(location.href)));
  window.addEventListener('td:page-ready', endTransition);
  // 过渡盖着的时候仍能点别的页面链接（改目标并重新预取），
  // 但不要误触旧页面上的按钮 / 表单。捕获阶段先于页面自身的事件。
  document.addEventListener('click', (e) => {
    // 用户主动交互后若文档被卸载（整页跳转），给新文档留一个导航意图。
    // 刷新也会卸载，但新文档靠 navigation.type === 'reload' 排除。
    if (!e.defaultPrevented && (e as MouseEvent).button === 0
      && !(e as MouseEvent).metaKey && !(e as MouseEvent).ctrlKey
      && !(e as MouseEvent).shiftKey && !(e as MouseEvent).altKey) armNavigation();
    if (!active && !starting) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('a[href]')) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // 整页跳转会销毁文档：只在「刚发生导航交互 / 过渡正在进行」时留标记。
  // SPA 换页不触发 pagehide，标记不会写进去，也就不会污染下一次刷新。
  window.addEventListener('pagehide', (ev) => {
    if (!(ev as PageTransitionEvent).persisted && (navArmed || active || starting)) {
      markNavigation();
    }
  });
  // bfcache 恢复不算新跳转：收掉残留遮罩、清掉意图，避免后退回来卡一层 Miku
  window.addEventListener('pageshow', (ev) => {
    if (!(ev as PageTransitionEvent).persisted) return;
    clearNavigation();
    clearTimeout(showTimer); clearTimeout(navTimer); clearTimeout(checkTimer);
    clearTimeout(forceTimer); clearTimeout(pendingHidden);
    stopWatching();
    active = false; starting = false; navPending = false;
    pendingAction = null; readySignaled = false;
    if (root) {
      root.hidden = true;
      root.classList.remove('is-in', 'is-out');
    }
  });
  // 语言切换时气泡立刻跟着变（切换器改的是 html[data-lang]）
  try {
    new MutationObserver(applyLang).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-lang'],
    });
  } catch { /* 老浏览器忽略 */ }

  // 首屏默认不播。只有检测到「从别的页跳过来」的意图标记才播；
  // 刷新 / 直接打开 / 外部进入 / 根域名页已播过的情况全部跳过。
  if (shouldPlayOnLoad()) beginTransition();
}
