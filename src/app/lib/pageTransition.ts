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

const I18N = {
  zh: { bubble: '跳转中', hint: '正在为你准备页面', aria: '页面加载中' },
  en: { bubble: 'Heading over', hint: 'Getting things ready', aria: 'Loading page' },
};

/* 每次切页都要出现：80ms 只是防同一帧的重复触发，不再跳过快页。 */
const SHOW_DELAY = 80;
/** 出现后至少停留这么久，避免就绪信号过早导致一闪而过 */
const MIN_VISIBLE = 700;
/** #root 静默这么久才算「资料真的渲染完」 */
const DOM_QUIET = 260;
const CHECK_TICK = 90;
const HIDE_ANIM = 340;
/** 接口挂死也不会把页面遮住 */
const FORCE_HIDE = 8000;

let root: HTMLElement | null = null;
let host: HTMLElement | null = null;
let active = false;
let shownAt = 0;
let lastMutation = 0;
let readySignaled = false;
let showTimer = 0;
let checkTimer = 0;
let pendingHidden = 0;
let forceTimer = 0;
let observer: MutationObserver | null = null;

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

function mediaHtml(): string {
  const inner = MEDIA.kind === 'video'
    ? `<video class="td-miku-media" src="${MEDIA.src}" autoplay muted loop
        playsinline preload="auto" disablepictureinpicture aria-hidden="true"></video>`
    : `<img class="td-miku-media" src="${MEDIA.src}" alt=""
        draggable="false" decoding="async" aria-hidden="true">`;
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

/** 满足「最短显示 + DOM 静默」才收起；refreshRuntime 的信号可跳过静默等待。 */
function scheduleCheck() {
  clearTimeout(checkTimer);
  checkTimer = window.setTimeout(() => {
    if (!active) return;
    const now = performance.now();
    const shown = now - shownAt >= MIN_VISIBLE;
    const stable = now - lastMutation >= DOM_QUIET;
    if (shown && (stable || readySignaled)) { hide(); return; }
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

function hide() {
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
 * 切页开始。由三个来源共同驱动，重复调用幂等：
 *  - popstate：navigate() 与浏览器前进/后退
 *  - App.tsx useLayoutEffect：路由 key 变化（保证每个页面组件都触发）
 *  - mountTransition()：首次加载 / 整页跳转
 */
export function beginTransition() {
  if (active) return;
  readySignaled = false;
  clearTimeout(showTimer);
  showTimer = window.setTimeout(show, SHOW_DELAY);
}

/** 页面控制器已完成（refreshRuntime 派发）—— 只加速，不再取消显示。 */
export function endTransition() {
  readySignaled = true;
  if (active) scheduleCheck();
}

/** 只需在入口挂一次；重复调用幂等。 */
export function mountTransition() {
  if (root) return;
  root = build();
  applyLang();

  window.addEventListener('popstate', beginTransition);
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
