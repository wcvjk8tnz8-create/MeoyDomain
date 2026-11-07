/**
 * 页面切换过渡：Miku 从下方冒出来，旁边一个「跳转中…」对话气泡。
 * 覆盖全站每一个页面，不只 SPA 站内链接 —— 浏览器后退、整页跳转、
 * 根域名静态页跳控制台都算切页。
 *
 * ── 为什么不能只听 refreshRuntime() ──
 * 15 个页面里有 9 个用 mountShell().then(...) 且没有 await（admin/domain/
 * profile/tickets/transfer/whois/terms/checkin/dashboard），mountXxx() 会
 * 立刻 resolve，refreshRuntime() 在资料还在飞的时候就派发 page-ready，
 * 过渡会被瞬间取消 —— 表现就是「有些页面没有动画」。
 * 所以就绪判据改成：#root 内容稳定（MutationObserver 静默窗口）
 * + 最短显示时长；refreshRuntime 的信号只作为加速，不再能取消显示。
 *
 * ── 节奏：解决「素材加载慢 / 页面切太快」──
 * 1. 首屏 mountTransition() → warmAssets() 立刻解码 Miku 与壁纸，
 *    切页时素材已在内存，不再现用现拉。
 * 2. 站内链接不再立刻 pushState：beginTransition(() => navigate(href))
 *    先让 Miku 完整冒出 NAV_HOLD，再真正换页。页面切换不会比动画快。
 * 3. 资料回来后仍至少停留 MIN_VISIBLE，再淡出 HIDE_ANIM，不闪一下就走。
 * 4. 导航未发生前，旧页面控制器提前派发的 page-ready 一律不算数。
 *
 * ── 换成 GIF 或 MP4（拿到素材后改顶部一行即可）──
 *   1. 文件丢进 public/img/transition/，如 miku.gif / miku.mp4
 *   2. kind 改成 'gif' 或 'video'，src 改成对应路径
 *   GIF 走 <img>；MP4 自动静音循环内联播放（符合自动播放策略）。
 *   两者都保留冒出 / 缩回动画，不冲突。
 */
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

/** 每次切页都要出现；0ms = 点击即开始播，不再有「等 80ms 才露面」的空窗 */
const SHOW_DELAY = 0;
/** 素材最多等这么久，网慢也不会把切页卡死（首屏已预热，通常 0ms） */
const MEDIA_WAIT = 260;
/** Miku 先冒出这么久，再真正换页 */
const NAV_HOLD = 320;
/** 出现后至少停留这么久，资料秒回也不一闪而过 */
const MIN_VISIBLE = 1100;
/** #root 静默这么久才算「资料真的渲染完」 */
const DOM_QUIET = 320;
const CHECK_TICK = 90;
/** 收起淡出时长，与 motion.css 的慢收缓动一致 */
const HIDE_ANIM = 420;
/** 接口挂死也不会把页面遮住 */
const FORCE_HIDE = 8000;

let root: HTMLElement | null = null;
let host: HTMLElement | null = null;
let active = false;
let starting = false;
let navPending = false;
let pendingAction: (() => void) | null = null;
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

/** 首屏空闲就预热全部重素材：Miku + 壁纸浅/深/氛围版 */
export function warmAssets() {
  warmMedia();
  const idle = (window as any).requestIdleCallback as ((cb: () => void) => void) | undefined;
  const run = () => { WARM_ASSETS.forEach((src) => { void decodeAsset(src); }); };
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

/** 满足「导航已发生 + 最短显示 + DOM 静默」才收起；ready 信号可跳过静默等待。 */
function scheduleCheck() {
  clearTimeout(checkTimer);
  checkTimer = window.setTimeout(() => {
    if (!active) return;
    const now = performance.now();
    const shown = now - shownAt >= MIN_VISIBLE;
    const stable = now - lastMutation >= DOM_QUIET;
    if (shown && !navPending && (stable || readySignaled)) { hide(); return; }
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
 * 切页开始。三个来源共同驱动，重复调用幂等：
 *  - 站内链接点击：beginTransition(() => navigate(href))（延后换页）
 *  - popstate / App 路由 key 变化：beginTransition()（URL 已变，只播过渡）
 *  - mountTransition()：首次加载 / 整页跳转
 */
export function beginTransition(action?: () => void) {
  if (active || starting) return;
  starting = true;
  readySignaled = false;
  navPending = !!action;
  pendingAction = action || null;
  clearTimeout(showTimer);
  clearTimeout(navTimer);
  showTimer = window.setTimeout(async () => {
    await waitMedia();
    if (!starting) return;
    show();
    starting = false;
    if (pendingAction) {
      // Miku 完整冒出之后再换页：切换不会比动画快
      navTimer = window.setTimeout(() => {
        runPendingAction();
        scheduleCheck();
      }, NAV_HOLD);
    }
  }, SHOW_DELAY);
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
  window.addEventListener('popstate', () => beginTransition());
  window.addEventListener('td:page-ready', endTransition);
  // 语言切换时气泡立刻跟着变（切换器改的是 html[data-lang]）
  try {
    new MutationObserver(applyLang).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-lang'],
    });
  } catch { /* 老浏览器忽略 */ }

  beginTransition();
}
