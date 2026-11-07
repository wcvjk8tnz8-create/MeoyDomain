/**
 * 页面切换过渡：切到另一页、资料还没加载完时，Miku 从下方冒出来，
 * 旁边一个「跳转中…」对话气泡；页面就绪后收起。
 *
 * 素材用真实图片，不用 SVG 绘制角色。默认是仓库自带的 Q 版 Miku
 * （已从白底抠成透明 PNG），CSS 负责「冒出来 / 呼吸 / 缩回」的动画。
 *
 * ── 换成 GIF 或 MP4（晚上找到素材后直接改这里，一行即可）──
 *   1. 把文件丢进 public/img/transition/，例如 miku.gif 或 miku.mp4
 *   2. kind 改成 'gif' 或 'video'，src 改成对应路径
 *   gif 会作为 <img> 播放；mp4 自动静音循环内联播放（符合自动播放策略）。
 *   两者都保留 CSS 的冒出 / 缩回动画，不冲突。
 */
const MEDIA: { kind: 'image' | 'gif' | 'video'; src: string } = {
  kind: 'image',
  src: '/img/transition/miku-pop.png',
};

const I18N = {
  zh: { bubble: '跳转中', hint: '正在为你准备页面', aria: '页面加载中' },
  en: { bubble: 'Heading over', hint: 'Getting things ready', aria: 'Loading page' },
};

/* 快页不打扰：160ms 内就绪就完全不出现；出现后至少停留 520ms，
   避免一闪而过；8s 兜底，接口挂死也不会把页面遮住。 */
const SHOW_DELAY = 160;
const MIN_VISIBLE = 520;
const HIDE_ANIM = 340;
const FORCE_HIDE = 8000;

let root: HTMLElement | null = null;
let active = false;
let shownAt = 0;
let showTimer = 0;
let hideTimer = 0;
let pendingHidden = 0;
let forceTimer = 0;

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

function show() {
  if (!root || active) return;
  active = true;
  shownAt = performance.now();
  clearTimeout(pendingHidden);
  clearTimeout(hideTimer);
  applyLang();
  root.hidden = false;
  // 两帧后再加 is-in，确保 display 已生效，进场动画能被播放
  requestAnimationFrame(() => requestAnimationFrame(() => root?.classList.add('is-in')));
  clearTimeout(forceTimer);
  forceTimer = window.setTimeout(hide, FORCE_HIDE);
}

function hide() {
  clearTimeout(forceTimer);
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
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

/** 切页开始（navigate / 浏览器后退 / 整页跳转后的首次挂载）*/
export function beginTransition() {
  if (active) return;
  clearTimeout(showTimer);
  showTimer = window.setTimeout(show, SHOW_DELAY);
}

/** 页面资料就绪（refreshRuntime 派发 td:page-ready）*/
export function endTransition() {
  clearTimeout(showTimer);
  if (!active) return;
  const elapsed = performance.now() - shownAt;
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hide, Math.max(0, MIN_VISIBLE - elapsed));
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

  // 首次加载 / 整页跳转：同样先排队，160ms 内就绪就完全不出现
  beginTransition();
}
