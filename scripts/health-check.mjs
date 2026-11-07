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
check(/addEventListener\('popstate', beginTransition\)/.test(transition), 'SPA 切页 / 后退触发过渡');
check(/addEventListener\('td:page-ready', endTransition\)/.test(transition), '页面资料就绪收起过渡');
check(/td:page-ready/.test(runtime), 'refreshRuntime 派发页面就绪信号');
check(/data-no-i18n/.test(transition), '气泡文案不被全局翻译改写');
check(/kind:\s*'image'/.test(transition) && /miku-pop\.png/.test(transition), '默认使用真实 PNG 素材');
check(/'gif'/.test(transition) && /'video'/.test(transition) && /<video/.test(transition), '预留 GIF / MP4 一行切换');
check(!/<svg|createElementNS|image\/svg\+xml/i.test(transition), '角色不是 SVG 绘制');
check(/SHOW_DELAY\s*=\s*80/.test(transition) && /MIN_VISIBLE\s*=\s*700/.test(transition) && /FORCE_HIDE\s*=\s*8000/.test(transition), '每页必显示、最短停留、8s 兜底防遮死');
check(/DOM_QUIET\s*=\s*260/.test(transition) && /MutationObserver/.test(transition) && /getElementById\('root'\)/.test(transition), '按 #root 内容稳定判定资料就绪（fire-and-forget 页面不再提前收起）');
check(!/endTransition[\s\S]{0,200}clearTimeout\(showTimer\)/.test(transition), '就绪信号不能取消显示');
check(/beginTransition\(\)/.test(read('src/app/App.tsx')) && /useLayoutEffect/.test(read('src/app/App.tsx')), 'App 路由 key 变化驱动，每个页面组件都覆盖');
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
  check(/location\.href\s*=\s*url/.test(rp) && /setTimeout/.test(rp), `${f} 过渡结束后才跳转`);
  check((rp.match(/id="tdTransition"/g) || []).length === 1, `${f} 过渡层只挂一份`);
}

/* 11. 花束 Miku 壁纸 / 控制台 UI 重构 */
const runtimeJs = read('src/app/lib/runtime.ts');
const bloom = glass.split('BLOOM · 花束 Miku').pop() || '';
check(/WALLPAPERS[\s\S]{0,400}key: 'bouquet'/.test(runtimeJs), '花束 Miku 已加入壁纸清单');
check(/localStorage\.getItem\('meoy_wallpaper'\)\s*\|\|\s*'bouquet'/.test(runtimeJs), '首次进入默认花束壁纸');
check(/--bg-img-dark/.test(runtimeJs) && /--bg-haze/.test(runtimeJs) && /data-wallpaper/.test(runtimeJs), '壁纸带深色版 / 氛围版 / 状态属性');
check(/data-no-i18n/.test(runtimeJs) && /--wp-thumb/.test(runtimeJs), '切换器改成缩略圆点且不被翻译改写');
for (const f of ['miku-bouquet.webp', 'miku-bouquet-dark.webp', 'miku-bouquet-haze.webp', 'miku-bouquet-thumb.webp']) {
  check(fs.existsSync(path.join(root, 'public/img/wallpaper', f)), `壁纸素材 ${f} 已入库`);
}
check(/display:\s*block\s*!important/.test(bloom), '历史层隐藏的 #bg 在控制台重新启用');
check(/z-index:\s*-1/.test(bloom) && /mix-blend-mode:\s*multiply/.test(bloom), '白底插画以 multiply 融入纸面');
check(/html\[data-theme="dark"\] body[\s\S]{0,400}background:\s*transparent\s*!important/.test(bloom), '深色 body 以同等特异性压成透明（否则盖住壁纸）');
check(/background-color:\s*var\(--bl-paper\)/.test(bloom) || /html:not\(\[data-theme="dark"\]\)[\s\S]{0,200}background-color/.test(bloom), '纸面渐变移到根元素');
check(/--bl-jade:\s*#2f8f83/.test(bloom) && /--bl-coral/.test(bloom), '取色自插画：青瓷绿主色 + 花色点缀');
check(/bl-petals/.test(bloom) && /prefers-reduced-motion/.test(bloom), '花瓣呼吸动效且尊重减少动态');
check(/\.bgswitch button[\s\S]{0,300}border-radius:\s*50%/.test(bloom), '壁纸切换器为圆形缩略点');
check(/min-width:\s*620px\s*!important/.test(bloom), '窄屏表格不再竖排断字');
check(imports.at(-1) === 'liquid-glass.css', '重构层仍位于最后加载的样式层');

for (const m of ok) console.log('  ✓ ' + m);
for (const m of errors) console.error('  ✗ ' + m);
console.log(`健康巡检：${ok.length} 通过，${errors.length} 失败`);
if (errors.length) process.exit(1);
