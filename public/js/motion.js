/* ============================================================
   动效引擎（独立版）
   用于不加载 shell.js 的页面（落地页 home.html / 登录页 index.html）。
   逻辑与 shell.js 内的 mountMotion() 保持一致：
   - 顶部 2px 滚动进度条
   - 元素滚动到视口才播入场（IntersectionObserver）
   - 表格行错峰淡入
   只动 transform / opacity，不触发重排；reduced-motion 下全部跳过。
   ============================================================ */
(function () {
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

    /* 主要区块：若页面没标 .reveal，就用主容器的一级子元素当入场单元 */
    var reveal = document.querySelectorAll('.reveal');
    if (!reveal.length) {
      var host = document.querySelector('main') || document.querySelector('.nk-wrap') || document.body;
      reveal = Array.prototype.filter.call(host.children, function (el) {
        return el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE';
      });
      Array.prototype.forEach.call(reveal, function (el) { el.classList.add('reveal'); });
    }

    if (!io) {
      Array.prototype.forEach.call(reveal, function (el) { el.classList.add('in'); });
      return;
    }
    Array.prototype.forEach.call(reveal, function (el, i) {
      if (el.classList.contains('in')) return;
      el.style.transitionDelay = (i * 45) + 'ms';
      io.observe(el);
    });
  }

  play();
  setTimeout(play, 400);
  setTimeout(play, 1200);
})();
