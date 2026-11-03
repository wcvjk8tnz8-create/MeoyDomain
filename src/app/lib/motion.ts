/* ============================================================
   动效引擎（独立版）
   用于不加载 shell.js 的页面（落地页 home.html / 登录页 index.html）。
   逻辑与 shell.js 内的 mountMotion() 保持一致：
   - 顶部 2px 滚动进度条
   - 元素滚动到视口才播入场（IntersectionObserver）
   - 表格行错峰淡入
   只动 transform / opacity，不触发重排；reduced-motion 下全部跳过。
   ============================================================ */
export function mountMotionStandalone() {
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 滚动进度条 */
  if (!REDUCED) {
    var bar = document.getElementById('docProgress');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'docProgress';
      bar.setAttribute('aria-hidden', 'true');
      document.body.appendChild(bar);
    }
    var onScroll = function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* 错峰入场 */
  var io = (!REDUCED && 'IntersectionObserver' in window)
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add('in');
          io.unobserve(e.target);
        });
      }, { threshold: .06, rootMargin: '0px 0px -28px 0px' })
    : null;

  function play() {
    /* 表格行 */
    Array.prototype.forEach.call(document.querySelectorAll('tbody'), function (tb) {
      Array.prototype.forEach.call(tb.rows, function (tr, j) {
        tr.style.transitionDelay = (j * 55) + 'ms';
      });
      tb.classList.add('in');
    });

    /* 主要区块：落地页 / 登录页按「顶层 section + footer」逐个入场。
       之前误取了 Hero 内部的 .nk-wrap，结果只有 Hero 一块有动效，
       且整块 opacity:0 依赖 IO —— 一旦 IO 未回调就会永久隐藏。 */
    var reveal = document.querySelectorAll('.reveal');
    if (!reveal.length) {
      var nodes = Array.prototype.slice.call(
        document.querySelectorAll('body > section, body > footer, .auth-wrap > *')
      );
      nodes.forEach(function (el) { el.classList.add('reveal'); });
      reveal = document.querySelectorAll('.reveal');
    }

    /* 首屏元素直接显示，不依赖 IntersectionObserver 回调 —— 防止标题整块消失 */
    Array.prototype.forEach.call(reveal, function (el, i) {
      if (el.classList.contains('in')) return;
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * .95) {
        el.classList.add('in');
        return;
      }
      el.style.transitionDelay = (i * 45) + 'ms';
      if (io) io.observe(el);
      else el.classList.add('in');
    });
  }

  play();
  setTimeout(play, 400);
  setTimeout(play, 1200);
}

