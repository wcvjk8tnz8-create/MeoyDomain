/**
 * 静态健康巡检：只用 Node 内置模块，不依赖 node_modules。
 * 把历次线上踩过的坑固化成阻断检查，避免「能打包 ≠ 能运行」的问题再回流。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const errors = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : errors.push(msg));

/* 1. 样式层括号必须成对 —— 少一个 } 会让后面整段规则失效 */
const css = [
  'src/app/styles/components.css',
  'src/app/styles/index.css',
  'src/app/styles/responsive.css',
  'src/app/styles/theme-terra.css',
  'src/app/styles/motion.css',
  'src/app/styles/liquid-glass.css',
];
for (const p of css) {
  const t = read(p);
  const a = (t.match(/\{/g) || []).length, b = (t.match(/\}/g) || []).length;
  check(a === b, `${p} 括号平衡 ${a}/${b}`);
}

/* 2. 词典重复键：对象字面量里同名 key 会让 esbuild 直接报语法错 */
const dicts = ['src/app/lib/i18n.ts', 'src/app/lib/dict.en.ts', 'src/lib/i18nServer.ts'];
for (const p of dicts) {
  const t = read(p);
  const keys = [...t.matchAll(/^\s*'([^']+)'\s*:/gm)].map((m) => m[1]);
  const seen = new Set(), dup = new Set();
  for (const k of keys) { if (seen.has(k)) dup.add(k); seen.add(k); }
  check(dup.size === 0, `${p} 无重复键（${keys.length} 条）${dup.size ? ' → ' + [...dup].join(', ') : ''}`);
}

/* 3. 密钥绝不入库 */
const srcFiles = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', '.wrangler'].includes(e.name)) continue;
      walk(rel);
    } else if (/\.(ts|tsx|js|mjs|json|toml|md)$/.test(e.name)) srcFiles.push(rel);
  }
};
walk('src');
srcFiles.push('wrangler.toml', 'README.md');
for (const p of srcFiles) {
  const fp = path.join(root, p);
  if (!fs.existsSync(fp)) continue;
  const t = fs.readFileSync(fp, 'utf8');
  check(!/\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,})\b/.test(t), `${p} 无明文密钥`);
}

/* 4. 样式层顺序：动效层在前、液态玻璃层收口在最后，且遮罩 / Toast / 抽屉修复仍在。
      iOS 26 玻璃重构后最后加载的不再是 motion.css —— 玻璃层用同等 !important
      收口前五层，必须同时复刻动效层的修复，否则会静默回退成旧 bug。 */
const main = read('src/app/main.tsx');
const imports = [...main.matchAll(/import\s+['"]\.\/styles\/([^'"]+)['"]/g)].map((m) => m[1]);
check(imports.at(-1) === 'liquid-glass.css', `liquid-glass.css 为最后加载的样式层（实际 ${imports.at(-1)}）`);
check(
  imports.includes('motion.css') && imports.indexOf('motion.css') < imports.indexOf('liquid-glass.css'),
  '动效层在玻璃层之前加载（玻璃层不得跳过动效层）',
);
const glass = read('src/app/styles/liquid-glass.css');
check(/\.modal\s*\{[^}]*background:\s*rgba\(/s.test(glass), '玻璃层保留半透明弹窗遮罩');
check(/#toast\s*\{[^}]*background:\s*transparent/s.test(glass), '玻璃层保留透明 Toast 容器');
check(/transform:\s*translateX\(calc\(-100%/s.test(glass), '玻璃层保留移动端抽屉收起位移');
check(/body\.side-open \.sidebar\s*\{[^}]*transform:\s*translateX\(0\)/s.test(glass), '玻璃层保留移动端抽屉展开');
check(/prefers-reduced-motion:\s*reduce/.test(glass), '玻璃层尊重减少动态偏好');
/* 页头欢迎卡：四角全圆角玻璃卡，且不再残留直角细线框 */
const welcomeBlock = (glass.match(/\.welcome\s*\{[^}]*\}/s) || [''])[0];
check(/border-radius:\s*var\(--lg-r-lg\)/.test(welcomeBlock) && !/border-radius:\s*0/.test(welcomeBlock), '玻璃层欢迎卡为全圆角玻璃卡');
check(/border:\s*1px solid var\(--lg-stroke\)/.test(welcomeBlock), '玻璃层欢迎卡为四边细线边框');
check(/\.welcome \.w-av\s*\{[^}]*border-radius:\s*50%/s.test(glass), '玻璃层欢迎头像为圆形');
/* 头像与个人资料页同源：Dashboard 用 img，控制器读 /api/profile */
const dashTsx = read('src/app/pages/Dashboard.tsx');
check(/<img\s+className="w-av"\s+id="wAv"/.test(dashTsx), '欢迎头像使用 img 而非首字母方块');
const dashTs = read('src/app/legacy/dashboard.ts');
check(/api\.get\('\/api\/profile'\)/.test(dashTs) && /prof\.profile\.avatar|prof && prof\.profile && prof\.profile\.avatar/.test(dashTs), '欢迎头像读取与个人资料同源的 /api/profile');
const motion = read('src/app/styles/motion.css');
check(/\.modal\s*\{[^}]*background:\s*rgba\(/s.test(motion), '弹窗遮罩为半透明（不是整屏白卡）');
check(/#toast\s*\{[^}]*background:\s*transparent/s.test(motion), 'Toast 容器透明（不是黑色药丸）');
check(/body::after\s*\{/s.test(motion), '抽屉遮罩常驻可过渡');
check(/prefers-reduced-motion:\s*reduce/.test(motion), '尊重系统减少动态偏好');
check(/@keyframes tdPopOut/.test(motion) && /@keyframes tdDropOut/.test(motion), '浮层有对称的退出动画');

/* 5. 动效引擎只能有一套，避免 scroll 监听随切页累积 */
const runtime = read('src/app/lib/runtime.ts');
const refresh = runtime.slice(runtime.indexOf('export function refreshRuntime()'), runtime.indexOf('// 前端通用工具'));
check(!/mountMotionStandalone/.test(refresh), 'refreshRuntime 未重复挂载第二套动效引擎');
check(/bootMotion\(\)/.test(runtime), '动效引擎为全局单例');

/* 6. 保存设置不得再出现未声明的 brandPromise 赋值 */
const admin = read('src/app/legacy/admin.ts');
check(!/^\s*brandPromise\s*=/m.test(admin), '后台保存未给未声明变量赋值');
check(/resetBranding\(\)/.test(admin) && /loadBranding, resetBranding/.test(admin), '品牌缓存走合法清理函数');

/* 7. 顶栏自动缩走 / 后台字体生效 / 单层输入框 / 桌面无孤立按钮 */
const comp = read('src/app/styles/components.css');
check(/--sans:\s*var\(--cn-body\)/.test(comp), '正文 --sans 引用后台可配的 --cn-body');
check(/setProperty\('--td-serif'/.test(runtime) && /removeProperty\('--td-serif'\)/.test(runtime), '非系统字体时衬线标题一起跟随，system 时恢复高雅衬线');
check(/fontBody:\s*d\.fontBody \|\| 'system'/.test(runtime), '品牌缓存默认字体为 system');
check(/fontBody:\s*s\.font_body \|\| 'system'/.test(read('src/index.ts')), '/api/config 默认字体为 system');
check(/syncTopbarState/.test(runtime) && /topbar-compact/.test(runtime) && /topbar-hidden/.test(runtime), '顶栏状态由全局单例驱动');
check(/syncTopbarState\(\)/.test(refresh) && /applyLayoutPrefs\(\)/.test(refresh), '切页时重算顶栏与收起偏好');
check(!/b\.classList\.add\('topbar-hidden'\)/.test(runtime), '滚动不再自动让顶栏整条消失（改为显式收起）');
check(/body\.topbar-compact \.topbar\s*\{[^}]*height:\s*46px/s.test(glass), '玻璃层收窄胶囊样式存在');
check(/body\.topbar-hidden \.topbar/s.test(glass), '玻璃层顶栏收起样式存在');
check(/body\.topbar-hidden \.topbar-reveal/.test(glass), '顶栏收起后仍有唤回把手');
check(/getElementById\('tbStow'\)/.test(runtime) && /getElementById\('tbReveal'\)/.test(runtime) && /getElementById\('sideCollapse'\)/.test(runtime), '顶栏收起钮 / 唤回把手 / 侧栏折叠钮均已挂载');
check(/td_side_collapsed/.test(runtime) && /td_topbar_hidden/.test(runtime), '顶栏与侧栏收起状态写入 localStorage');
check(/body\.side-collapsed/.test(glass) && /side-item::after/.test(glass), '侧栏折叠成图标条且悬停显示名称');
check(/'收起顶栏':\s*'Hide toolbar'/.test(read('src/app/lib/dict.en.ts')), '新增控制按钮有英文词条');
check(/\.side-toggle \{ display: none !important; \}/.test(glass), '桌面/平板隐藏孤立汉堡按钮');
check(/#bellBtn/.test(runtime) && /insertBefore\(b, bell\)/.test(runtime), '主题按钮归入右侧图标组');
const focusBlock = (glass.match(/\.input:focus[\s\S]*?\}/) || [''])[0];
check(!/0 0 0 3px/.test(focusBlock) && /inset 0 0 0 1px/.test(focusBlock), '输入框聚焦为单层（无外部 3px 光环）');
check(/\.reg-field-head\s*\{[^}]*background:\s*transparent/s.test(glass), '字段标题不再叠第二层灰框');
check(/--lg-stroke:\s*rgba\(47, 125, 91/.test(glass), '浅色玻璃描边为可见淡绿');
check(/:not\(\.side-toggle\)/.test(read('src/app/styles/theme-terra.css')), '汉堡按钮被排除出全局按钮基线（避免空灰块）');

/* 8. 官网根路径 = 主页，登录页独立 */
const appRoutes = read('src/app/App.tsx');
check(/'\/\s*':\s*HomePage/.test(appRoutes) && /'\/login':\s*LoginPage/.test(appRoutes), '根路径渲染主页、/login 独立为登录页');
check(/ROUTES\[key\]\s*\|\|\s*HomePage/.test(appRoutes), '未知路径回落主页而非登录页');
check(/\['\/', '\/index\.html', '\/home', '\/home\.html'\]/.test(appRoutes), '根路径复用落地页视觉脚本');
check(/\/login\.html/.test(read('src/index.ts')), 'SPA 回落包含 /login.html');
check(/zx-nav-cta"\s+href="\/register"/.test(read('src/app/pages/Home.tsx')), '主页 CTA 指向注册页');
check(!/href="\/">登录/.test(runtime) && !/location\.href\s*=\s*'\/\?login=1'/.test(runtime), '不再有把根路径当登录页的入口');
check(/\/login\?q=/.test(read('src/app/legacy/whois.ts')) && /href="\/login"/.test(read('src/app/legacy/report.ts')), 'WHOIS / 举报的登录链接指向 /login');

/* 9. 切页过渡：Miku 冒出来 + 跳转中气泡（真实素材，不用 SVG 画角色） */
const transition = read('src/app/lib/pageTransition.ts');
check(/mountTransition\(\)/.test(main) && /from '\.\/lib\/pageTransition'/.test(main), '入口挂载切页过渡层');
check(/addEventListener\('popstate',\s*\(\)\s*=>\s*beginTransition\(undefined, prefetchRoute\(location\.href\)\)\)/.test(transition), 'SPA 切页 / 后退触发过渡并预取（事件对象不误当导航回调）');
check(/addEventListener\('td:page-ready', endTransition\)/.test(transition), '页面资料就绪收起过渡');
check(/td:page-ready/.test(runtime), 'refreshRuntime 派发页面就绪信号');
check(/data-no-i18n/.test(transition), '气泡文案不被全局翻译改写');
check(/kind:\s*'image'/.test(transition) && /miku-pop\.png/.test(transition), '默认使用真实 PNG 素材');
check(/'gif'/.test(transition) && /'video'/.test(transition) && /<video/.test(transition), '预留 GIF / MP4 一行切换');
check(!/<svg|createElementNS|image\/svg\+xml/i.test(transition), '角色不是 SVG 绘制');
check(/SHOW_DELAY\s*=\s*0/.test(transition) && /MIN_VISIBLE\s*=\s*360/.test(transition) && /HIDE_ANIM\s*=\s*340/.test(transition) && /FORCE_HIDE\s*=\s*8000/.test(transition), '点击即播、只保底 360ms、340ms 淡出、8s 兜底（不再固定按住 1.1s）');
check(/NAV_HOLD_MIN\s*=\s*200/.test(transition) && /NAV_MAX_WAIT\s*=\s*1400/.test(transition) && /MEDIA_WAIT\s*=\s*180/.test(transition), '数据到手 + Miku 起手才换页，慢数据最多等 1400ms');
check(/DOM_QUIET\s*=\s*180/.test(transition) && /MutationObserver/.test(transition) && /getElementById\('root'\)/.test(transition), '按 #root 内容稳定判定资料就绪（fire-and-forget 页面不再提前收起）');
check(/warmAssets\(/.test(transition) && /WARM_ASSETS/.test(transition) && /decodeAsset/.test(transition), '首屏预热 Miku 与壁纸，切页不再现拉素材');
check(/miku-bouquet-haze\.webp/.test(transition) && /theme === 'dark'/.test(transition) && /picks\.forEach/.test(transition), '只预热当前主题那张壁纸，不再多拉 310K 抢首屏带宽');
check(/Promise\.race/.test(transition) && /waitMedia\(\)/.test(transition), '素材 / 数据等待都有硬上限，网慢不卡死切页');
check(/beginTransition\(action\?/.test(transition) && /navPending/.test(transition) && /runPendingAction/.test(transition), '站内导航延后到数据之后，且兜底隐藏必补一次换页');
check(/if\s*\(navPending\)\s*return/.test(transition), '导航前旧页面派发的 page-ready 不算就绪');
check(!/endTransition[\s\S]{0,200}clearTimeout\(showTimer\)/.test(transition), '就绪信号不能取消显示');
check(/beginTransition\(undefined, prefetchRoute/.test(read('src/app/App.tsx')) && /useLayoutEffect/.test(read('src/app/App.tsx')), 'App 路由 key 变化驱动，每个页面组件都覆盖');
check(/beginTransition\(\(\)\s*=>\s*navigate\(href\), prefetchRoute\(href\)\)/.test(read('src/app/App.tsx')), '站内链接点击瞬间并行预取，不立刻 pushState');
/* 预取层：数据并行、缓存消费、点击透传、根域名不重播 */
const prefetch = read('src/app/lib/prefetch.ts');
check(/ROUTE_DATA/.test(prefetch) && /fetch\(path/.test(prefetch) && /credentials:\s*'same-origin'/.test(prefetch), '预取层按路由并行发起只读同源 GET');
check(/takePrefetched/.test(prefetch) && /TTL\s*=\s*6000/.test(prefetch) && /cache\.delete\(path\)/.test(prefetch), '预取结果一次性消费且有有效期，不会用旧数据');
check(/takePrefetched\(p\)/.test(runtime) && /api\.req\('GET', p\)/.test(runtime), 'api.get 优先消费预取，未命中走正常请求（401 逻辑不绕过）');
check(/if \(!active && !starting\) return/.test(transition) && /t\?\.closest\?\.\('a\[href\]'\)/.test(transition), '过渡期间链接可点改目标，非链接交互被守卫拦下');
check(/\.td-trans \{[^}]*pointer-events:\s*none/.test(glass), '遮罩不吞点击，链接能透传');
check(/meoy\\\.top\|v-1\\\.top/.test(transition) && /if \(!hopped\) beginTransition\(\)/.test(transition), '根域名页跳过来的首屏不重播第二遍过渡');
check(/wasPending/.test(transition) && /重新排一次导航/.test(transition), '过渡中改点别的页面会重新排导航');
check(/td-miku-rise/.test(glass) && /td-miku-breathe/.test(glass) && /td-trans-bubble/.test(glass), '玻璃层含冒出 / 呼吸 / 气泡样式');
check(/\[data-theme="dark"\] \.td-trans/.test(glass) && /prefers-reduced-motion/.test(glass.split('页面切换过渡').pop() || ''), '过渡层深色与减少动态适配');
check(fs.existsSync(path.join(root, 'public/img/transition/miku-pop.png')), 'Miku 透明素材已入库');

/* 10. 根域名静态页：跳控制台时也走同一套过渡，且副本同步 */
const rootPages = ['meoy.top.html', 'v-1.top.html'];
for (const f of rootPages) {
  const rp = read(`root-pages/${f}`);
  check(/id="tdTransition"/.test(rp) && /td-miku-rise/.test(rp), `${f} 含 Miku 跳页过渡`);
  check(/addEventListener\("click"/.test(rp) && /preventDefault\(\)/.test(rp), `${f} 拦截控制台链接`);
  check(/prefers-color-scheme: dark/.test(rp), `${f} 深色跟随系统`);
  // 只做仓库内自校验：CI 里没有仓库外的工作区交付副本，不能读它
  check(/setTimeout\(function\(\)\{ location\.href = url; \}, 300\)/.test(rp), `${f} Miku 起手 300ms 就跳，不再干等 760ms`);
  check(/rel\s*=\s*"preload"/.test(rp) && /miku-pop\.png/.test(rp), `${f} 页面加载即预热过渡角色，点击时不再现拉`);
  check((rp.match(/id="tdTransition"/g) || []).length === 1, `${f} 过渡层只挂一份`);
}
check(/\.td-trans\.is-out\s*\{[^}]*pointer-events:\s*none/.test(read('src/app/styles/liquid-glass.css')), '淡出期间放行交互，遮罩不多挡 340ms');

/* 11. 花束 Miku 壁纸 / 控制台 UI 重构 */
const runtimeJs = read('src/app/lib/runtime.ts');
const bloom = glass.split('BLOOM · 花束 Miku').pop() || '';
check(/WALLPAPERS[\s\S]{0,400}key: 'bouquet'/.test(runtimeJs), '花束 Miku 已加入壁纸清单');
check(/localStorage\.getItem\('meoy_wallpaper'\)\s*\|\|\s*'bouquet'/.test(runtimeJs), '首次进入默认花束壁纸');
check(/--bg-img-dark/.test(runtimeJs) && /--bg-haze/.test(runtimeJs) && /data-wallpaper/.test(runtimeJs), '壁纸带深色版 / 氛围版 / 状态属性');
check(/data-no-i18n/.test(runtimeJs) && /--wp-thumb/.test(runtimeJs), '切换器改成缩略圆点且不被翻译改写');
check(/meoy_wallpaper_v2/.test(runtimeJs), '旧壁纸存档一次性升级到花束默认');
for (const f of ['miku-bouquet.webp', 'miku-bouquet-dark.webp', 'miku-bouquet-haze.webp', 'miku-bouquet-thumb.webp']) {
  check(fs.existsSync(path.join(root, 'public/img/wallpaper', f)), `壁纸素材 ${f} 已入库`);
}
check(/display:\s*block\s*!important/.test(bloom), '历史层隐藏的 #bg 在控制台重新启用');
check(/z-index:\s*-1/.test(bloom) && /mix-blend-mode:\s*multiply/.test(bloom), '白底插画以 multiply 融入纸面');
check(/--bg-haze/.test(bloom) && /#bg\[data-wp-loaded="1"\]/.test(bloom) && /bl-wp-fade/.test(bloom), '壁纸先用轻量氛围图铺底，高清解码后淡入');
check(/prefers-reduced-motion[\s\S]{0,300}#bg\[data-wp-loaded="1"\][\s\S]{0,160}animation:\s*none/.test(bloom), '减少动态时壁纸不做淡入');
check(/dataset\.wpLoaded/.test(runtimeJs) && /img\.decode/.test(runtimeJs), 'runtime 解码完主图才打上淡入标记');
check(/brandValue/.test(runtimeJs) && /brandRefreshing/.test(runtimeJs) && /Promise\.resolve\(brandValue\)/.test(runtimeJs), '品牌配置走 stale-while-revalidate，切页不再 await 接口');
check(/brandPromise\s*=\s*null/.test(runtimeJs.split('resetBranding').pop() || ''), '后台保存后清缓存，下次切页拉新值');
const shellHtml = read('index.html');
check(/rel="preload" as="image" href="\/img\/transition\/miku-pop\.png"/.test(shellHtml), '首屏 preload 过渡角色');
check(/miku-bouquet-haze\.webp/.test(shellHtml) && /miku-bouquet-dark\.webp/.test(shellHtml), '首屏 preload 壁纸浅/深/氛围版');
check(/html\[data-theme="dark"\] body[\s\S]{0,400}background:\s*transparent\s*!important/.test(bloom), '深色 body 以同等特异性压成透明（否则盖住壁纸）');
check(/background-color:\s*var\(--bl-paper\)/.test(bloom) || /html:not\(\[data-theme="dark"\]\)[\s\S]{0,200}background-color/.test(bloom), '纸面渐变移到根元素');
check(/--bl-jade:\s*#2f8f83/.test(bloom) && /--bl-coral/.test(bloom), '取色自插画：青瓷绿主色 + 花色点缀');
check(/bl-petals/.test(bloom) && /prefers-reduced-motion/.test(bloom), '花瓣呼吸动效且尊重减少动态');
check(/\.bgswitch button[\s\S]{0,300}border-radius:\s*50%/.test(bloom), '壁纸切换器为圆形缩略点');
check(/min-width:\s*620px\s*!important/.test(bloom), '窄屏表格不再竖排断字');
check(imports.at(-1) === 'liquid-glass.css', '重构层仍位于最后加载的样式层');

/* 12. 首屏一次性就绪：不再「一阶段 / 二阶段 / 三阶段慢慢加载出来」 */
const gate = read('src/app/lib/runtime.ts');
const dash = read('src/app/legacy/dashboard.ts');
const dashPage = read('src/app/pages/Dashboard.tsx');
const appSrc = read('src/app/App.tsx');
check(/SHARED_TTL/.test(gate) && /sharedGet/.test(gate) && /pageFetchStart/.test(gate), '同路径在飞 GET 合并成一次，首屏请求纳入在途计数');
check(/sharedGet\.get\(p\)/.test(gate) && /takePrefetched\(p\)/.test(gate), 'api.get 先复用共享 / 预取结果，未命中才发真实请求');
check(/method !== 'GET'[\s\S]{0,80}clearSharedGet\(\)/.test(gate), '写操作立刻清共享缓存，签到 / 释放域名不读旧值');
check(/whenPageFetchesIdle/.test(gate) && /setTimeout\(r, 2500\)/.test(gate), '就绪门控有 2.5s 硬兜底，单个挂死接口不会藏住整页');
check(/page-root\[data-ready="0"\]/.test(gate) && /dataset\.ready = '1'/.test(gate) && /td:page-ready/.test(gate), '全部首屏 GET 结算后才放出页面并宣告过渡收起');
check(/opt\.deferAvatar/.test(gate), '骨架支持由页面快照一次性提供头像，不再先默认后替换');
check(/async function snapshot\(\)/.test(dash) && /Promise\.all\(\[/.test(dash), '控制台首屏五个数据源一次并行出发');
for (const p of ['/api/subdomains', '/api/config', '/api/points/me', '/api/auth/me', '/api/profile']) {
  check(dash.includes(`'${p}'`), `首屏快照包含 ${p}`);
}
check(/function renderAll\(/.test(dash) && /renderPoints\(snap\.points\)/.test(dash), '欢迎卡 / 统计卡 / 积分卡 / 列表由同一个同步函数一次写完');
check(!/async function fillWelcome/.test(dash) && !/api\.get\('\/api\/points\/me'\)\.then\(/.test(dash), '不再有 fire-and-forget 的欢迎语与积分异步补写');
check(/await Promise\.all\(\[\s*snapshot\(\),\s*mountShell\('domains', \{ deferAvatar: true \}\)/.test(dash), 'mountDashboard 真的 await 完整首屏，就绪信号不会提前派发');
check(/renderAvatars\(/.test(dash), '顶栏头像与欢迎卡头像同一帧落地');
check(/data-ready="0"/.test(dashPage) && /id="stDomains">—/.test(dashPage) && /id="wHi">&nbsp;/.test(dashPage), '骨架不放假的 0 / 欢迎回来，数据未到齐前不露脸');
check(/dataset\.ready = '0'/.test(appSrc) && /3000\)/.test(appSrc) && /clearTimeout\(failsafe\)/.test(appSrc), '每个页面挂载先隐藏内容区，并有 3s 放出兜底');
const pageFiles = fs.readdirSync(path.join(root, 'src/app/pages')).filter((f) => f.endsWith('.tsx'));
for (const f of pageFiles) {
  check(/refreshRuntime\(\)/.test(read('src/app/pages/' + f)), `${f} 会触发就绪门控`);
}
check(/READY_FALLBACK/.test(read('src/app/lib/pageTransition.ts')) && /readySignaled \|\| \(now - shownAt >= READY_FALLBACK && stable\)/.test(read('src/app/lib/pageTransition.ts')), '过渡必须等页面宣告整屏就绪，DOM 静默不再单独放行');
check(/readySignaled = false/.test(read('src/app/lib/pageTransition.ts').split('if \(active \|\| starting\)').pop() || ''), '过渡中改点别的页面会作废旧页面的就绪信号');
check(/\.page-root\[data-ready="0"\] \.main/.test(read('src/app/styles/liquid-glass.css')) && /tdPageIn/.test(read('src/app/styles/liquid-glass.css').split('首屏一次性显现').pop() || ''), '未就绪时只藏内容区，就绪后整屏一次淡入（壁纸与玻璃框架照常可见）');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of errors) console.error('  ✗ ' + m);
console.log(`健康巡检：${ok.length} 通过，${errors.length} 失败`);
if (errors.length) process.exit(1);
