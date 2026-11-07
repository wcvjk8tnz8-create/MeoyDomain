/**
 * SPA 外壳：唯一挂载点与首屏同步预置脚本。
 * 仓库不跟踪 .html；Vite 在 config 阶段由本模板生成 index.html（已 gitignore），
 * Worker 亦可直接用此字符串响应，浏览器收到的仍是标准 HTML 文档。
 */
export const spaShellHtml = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="theme-color" content="#ffffff">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>TerraDomain · 二级域名分发</title>
  <link rel="icon" href="/favicon.ico">
  <!-- 切页过渡 / 控制台壁纸：首屏就开始拉，切页时只走内存缓存。
       字体 stylesheet 走 media=print 异步，不阻塞首屏渲染。 -->
  <link rel="preload" as="image" href="/img/transition/miku-pop.png">
  <link rel="preload" as="image" href="/img/wallpaper/miku-bouquet-haze.webp">
  <link rel="preload" as="image" href="/img/wallpaper/miku-bouquet.webp" media="(prefers-color-scheme: light)">
  <link rel="preload" as="image" href="/img/wallpaper/miku-bouquet-dark.webp" media="(prefers-color-scheme: dark)">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Redaction+35:ital,wght@0,400;0,700;1,400&family=ZCOOL+KuaiLe&family=Noto+Sans+SC:wght@400;500;700&family=LXGW+WenKai+TC:wght@400&display=swap">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Redaction+35:ital,wght@0,400;0,700;1,400&family=ZCOOL+KuaiLe&family=Noto+Sans+SC:wght@400;500;700&family=LXGW+WenKai+TC:wght@400&display=swap" media="print" onload="this.media='all'">
  <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Redaction+35:ital,wght@0,400;0,700;1,400&family=ZCOOL+KuaiLe&family=Noto+Sans+SC:wght@400;500;700&family=LXGW+WenKai+TC:wght@400&display=swap"></noscript>
  <!-- 样式由 src/app/main.tsx 引入 Tailwind 管线，不再加载手写 CSS -->
  <script>
    /* 主题预置：必须在 React 渲染前同步执行，避免深色模式刷新时白屏闪烁 */
    (function(){try{var k='meoy_theme',v=localStorage.getItem(k);
    if(v!=='dark'&&v!=='light'){v=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
    if(v==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();
    /* 语言预置：同步设置 lang / data-lang，供 CSS 与辅助技术使用 */
    (function(){try{var v=localStorage.getItem('terradata_lang')==='en'?'en':'zh';
    document.documentElement.setAttribute('lang',v==='en'?'en':'zh-CN');
    document.documentElement.setAttribute('data-lang',v);
    if(v==='en')document.title='TerraDomain · Free Subdomains';}catch(e){}})();
  </script>
</head>
<body>
  <!-- 唯一的 HTML 壳：所有页面均为 React TSX 组件，由此挂载 -->
  <div id="root"></div>
  <script type="module" src="/src/app/main.tsx"></script>
</body>
</html>
`;
