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

for (const m of ok) console.log('  ✓ ' + m);
for (const m of errors) console.error('  ✗ ' + m);
console.log(`健康巡检：${ok.length} 通过，${errors.length} 失败`);
if (errors.length) process.exit(1);
