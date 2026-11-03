/**
 * Terms 页面控制器（由 terms.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, esc, loadBranding, applyBranding, mountShell } from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

export async function mountTerms(_root: HTMLElement | null): Promise<void> {
  
  (async () => {
    try {
      await api.get('/api/auth/me');
      document.getElementById('backLink').href = '/dashboard';
      document.getElementById('backLink').textContent = '返回控制台';
    } catch {
      document.getElementById('backLink').href = '/';
      document.getElementById('backLink').textContent = '返回登录';
    }
    try {
      const d = await api.get('/api/terms');
      document.getElementById('meta').textContent = `版本 ${d.version} · 注册即视为同意本条款`;
      let html = '';
      d.sections.forEach((s) => {
        html += `<h3 id="${s.id}">${esc(s.title)}</h3>`;
        (s.blocks || []).forEach((b) => (html += `<p>${esc(b)}</p>`));
        if (s.list) html += `<ul>${s.list.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>`;
        if (s.note) html += `<p><strong>${esc(s.note)}</strong></p>`;
      });
      document.getElementById('body').innerHTML = html;
    } catch (e) {
      document.getElementById('body').innerHTML = '<div class="empty">加载失败</div>';
    }
  })();
  
  // 公开页面：未登录也可查看，导航显示登录入口
  mountShell('terms', { optional: true }).then(async () => {
    applyBranding(await loadBranding());
  }).catch(() => {});
  
}
