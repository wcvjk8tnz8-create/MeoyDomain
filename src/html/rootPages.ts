import { meoyTopHtml } from './root-meoy.js';
import { v1TopHtml } from './root-v1.js';

/**
 * 根域名落地页既是「可导出的静态文件」，也是 Worker 可直接响应的字符串。
 * 仓库里不再跟踪 .html；两个域名既可以把流量指到 Worker，
 * 也可以执行 `npm run emit:root-pages` 导出后丢任意静态托管。
 */
const pages: Record<string, string> = {
  'meoy.top': meoyTopHtml,
  'v-1.top': v1TopHtml,
};

/** 按 Host 返回对应落地页；其它主机返回 null，继续走静态资源 / SPA 回落。 */
export function rootPageFor(hostname: string): string | null {
  let h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (h.startsWith('www.')) h = h.slice(4);
  return pages[h] ?? null;
}
