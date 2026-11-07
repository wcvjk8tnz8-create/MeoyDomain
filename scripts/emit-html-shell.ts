/**
 * 仓库不跟踪 index.html：构建 / 开发前由 TS 模板即时生成。
 * 生成物已写进 .gitignore；浏览器收到的仍是标准 HTML 文档，
 * 只是「谁生成它」从仓库文件变成了 TypeScript 模块。
 */
import { writeFileSync } from 'node:fs';
import { spaShellHtml } from '../src/html/spa.ts';

writeFileSync(new URL('../index.html', import.meta.url), spaShellHtml, 'utf8');
console.log('✓ 已由 src/html/spa.ts 生成 index.html（不入库）');
