/* ============================================================
   Cloud Shader —— 天空蓝云层背景（WebGL，纯原生，无依赖）

   起因： Aceternity 的 cloud-shader 是 React + Tailwind 组件，
        本项目是原生 HTML/CSS/JS（Cloudflare Workers），无法直接复用，
        且其 registry 在当前网络下不可访问（403）。
   因此这里用同样的思路手写：全屏 quad + FBM 噪声体积云 + 时间动画。

   用法：在页面上加 <div class="cloud-bg" id="cloudBg"></div>，
        或任意元素调用 mountCloud(el)。
   - 自动降级：无 WebGL 时退化为 CSS 天空渐变
   - 页面不可见时暂停（省电）
   - prefers-reduced-motion 时渲染一帧静态云
   ============================================================ */

(function () {
  var VERT = [
    'attribute vec2 p;',
    'void main(){ gl_Position = vec4(p, 0.0, 1.0); }',
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    'uniform vec2  uRes;',
    'uniform float uTime;',
    'uniform vec3  uSkyTop;',
    'uniform vec3  uSkyBottom;',
    'uniform vec3  uCloud;',
    'uniform float uSpeed;',
    'uniform float uCover;',

    // —— 随机与噪声 ——
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
    'float noise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p);',
    '  vec2 u = f*f*(3.0-2.0*f);',
    '  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), u.x),',
    '             mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x), u.y);',
    '}',
    // —— 分形叠加：做出云的层次 ——
    'float fbm(vec2 p){',
    '  float v = 0.0, a = 0.5;',
    '  for(int i=0;i<5;i++){ v += a*noise(p); p *= 2.02; a *= 0.5; }',
    '  return v;',
    '}',

    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    // 天空：从底部浅蓝到顶部深一点的蓝
    '  vec3 sky = mix(uSkyBottom, uSkyTop, pow(uv.y, 0.85));',
    '  float t = uTime * uSpeed;',
    '  vec2 q = uv * vec2(2.4, 1.5);',
    // 两层云：远处慢、近处快，制造视差
    '  float c1 = fbm(q * 1.6 + vec2(t * 0.06, t * 0.012));',
    '  float c2 = fbm(q * 3.1 + vec2(-t * 0.035, t * 0.02) + 7.3);',
    '  float d  = smoothstep(0.46, 0.92, c1 * 0.72 + c2 * 0.38);',
    // 地平线附近云更密，顶部更稀薄
    '  d *= mix(0.42, 1.0, 1.0 - uv.y);',
    '  d = clamp(d * uCover, 0.0, 1.0);',
    // 云体受光：底部偏灰、顶部更亮
    '  vec3 lit = mix(uCloud * 0.82, vec3(1.0), smoothstep(0.55, 1.0, c1 + 0.15));',
    '  vec3 col = mix(sky, lit, d * 0.92);',
    // 轻微暗角，避免边缘过亮
    '  float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(1.15, 1.0)));',
    '  col *= mix(0.93, 1.0, vig);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}',
  ].join('\n');

  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) return [0.53, 0.78, 0.95];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /** 在指定元素里挂载云层背景；返回 stop 函数 */
  function mountCloud(el, opt) {
    if (!el) return function () {};
    var o = opt || {};
    var reduced = false;
    try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    var cvs = document.createElement('canvas');
    cvs.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(cvs);

    var gl = null;
    try {
      gl = cvs.getContext('webgl', { antialias: false, alpha: false, depth: false })
        || cvs.getContext('experimental-webgl', { antialias: false, alpha: false, depth: false });
    } catch (e) {}
    if (!gl) { el.classList.add('cloud-fallback'); return function () {}; }

    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
      return s;
    }
    var vs = compile(gl.VERTEX_SHADER, VERT);
    var fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { el.classList.add('cloud-fallback'); return function () {}; }
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { el.classList.add('cloud-fallback'); return function () {}; }
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var U = {
      res: gl.getUniformLocation(prog, 'uRes'),
      time: gl.getUniformLocation(prog, 'uTime'),
      top: gl.getUniformLocation(prog, 'uSkyTop'),
      bottom: gl.getUniformLocation(prog, 'uSkyBottom'),
      cloud: gl.getUniformLocation(prog, 'uCloud'),
      speed: gl.getUniformLocation(prog, 'uSpeed'),
      cover: gl.getUniformLocation(prog, 'uCover'),
    };

    // 配色：深/浅主题各给一套天空色
    function palette() {
      var dark = false;
      try { dark = document.documentElement.getAttribute('data-theme') === 'dark'; } catch (e) {}
      if (dark) return { top: '#0b2545', bottom: '#1e4f7a', cloud: '#9fc0e6', cover: 0.75 };
      return { top: o.top || '#4aa3e8', bottom: o.bottom || '#bfe3fb', cloud: o.cloud || '#ffffff', cover: o.cover || 0.85 };
    }
    var pal = palette();
    gl.uniform3fv(U.top, hexToRgb(pal.top));
    gl.uniform3fv(U.bottom, hexToRgb(pal.bottom));
    gl.uniform3fv(U.cloud, hexToRgb(pal.cloud));
    gl.uniform1f(U.speed, o.speed || 1.0);
    gl.uniform1f(U.cover, pal.cover);

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 1.75);   // 限制 DPR，移动端省性能
      var w = Math.max(1, Math.round(el.clientWidth * dpr));
      var h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (cvs.width !== w || cvs.height !== h) {
        cvs.width = w; cvs.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(U.res, w, h);
      }
    }

    var raf = 0, start = performance.now(), visible = true, stopped = false;
    function frame(now) {
      if (stopped) return;
      if (visible) {
        resize();
        gl.uniform1f(U.time, (now - start) / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      raf = requestAnimationFrame(frame);
    }

    resize();
    if (reduced) {
      // 静态一帧：保留云的形状，但不飘
      gl.uniform1f(U.time, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      raf = requestAnimationFrame(frame);
    }

    // 切到后台就停，回来继续（省电）
    function onVis() { visible = !document.hidden; }
    document.addEventListener('visibilitychange', onVis);
    var ro = null;
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(resize); ro.observe(el); }
    window.addEventListener('resize', resize);

    // 主题切换后重取配色
    var mo = null;
    if (typeof MutationObserver === 'function') {
      mo = new MutationObserver(function () {
        var p = palette();
        gl.uniform3fv(U.top, hexToRgb(p.top));
        gl.uniform3fv(U.bottom, hexToRgb(p.bottom));
        gl.uniform3fv(U.cloud, hexToRgb(p.cloud));
        gl.uniform1f(U.cover, p.cover);
        if (reduced) gl.drawArrays(gl.TRIANGLES, 0, 3);
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    return function stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', resize);
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
    };
  }

  /** 自动挂载：页面上任何 .cloud-bg 都会被填充 */
  function boot() {
    var nodes = document.querySelectorAll('.cloud-bg');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].dataset.cloudReady === '1') continue;
      nodes[i].dataset.cloudReady = '1';
      mountCloud(nodes[i], {
        top: nodes[i].dataset.cloudTop,
        bottom: nodes[i].dataset.cloudBottom,
        speed: parseFloat(nodes[i].dataset.cloudSpeed || '1'),
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(boot, 400);

  window.MeoyCloud = { mount: mountCloud, boot: boot };
})();
