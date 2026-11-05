/**
 * Terms 页面控制器（由 terms.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 *
 * 语言：后端 /api/terms 会按 X-Lang 返回完整中文 / 英文条款。
 * 切换语言时重新拉取一次，避免「切到 EN 但正文还是上一份中文」。
 */
import { api, esc, loadBranding, applyBranding, mountShell } from '../lib/runtime';
import { currentLang } from '../lib/i18n';

import type { LegacyCtx } from '../lib/types';

export async function mountTerms(_root: HTMLElement | null): Promise<void> {
  let alive = true;
  let disposed = false;

  const load = async () => {
    const body = document.getElementById('body');
    const meta = document.getElementById('meta');
    if (!body || !meta) return;
    const en = currentLang() === 'en';
    body.innerHTML = `<div class="empty">${en ? 'Loading…' : '加载中…'}</div>`;
    try {
      const d = await api.get('/api/terms');
      if (!alive || disposed) return;
      meta.textContent = en
        ? `Version ${d.version} · By registering you accept these terms`
        : `版本 ${d.version} · 注册即视为同意本条款`;
      let html = '';
      (d.sections || []).forEach((s: any) => {
        html += `<h3 id="${esc(s.id)}">${esc(s.title)}</h3>`;
        (s.blocks || []).forEach((b: string) => (html += `<p>${esc(b)}</p>`));
        if (s.list) html += `<ul>${s.list.map((li: string) => `<li>${esc(li)}</li>`).join('')}</ul>`;
        if (s.note) html += `<p><strong>${esc(s.note)}</strong></p>`;
      });
      body.innerHTML = html || `<div class="empty">${en ? 'No content' : '暂无内容'}</div>`;
    } catch (e) {
      if (!alive || disposed) return;
      body.innerHTML = `<div class="empty">${en ? 'Failed to load' : '加载失败'}</div>`;
    }
  };

  // 切换语言 → 立即用新语言重新拉条款（api 会自动带上 X-Lang）。
  // 切到别的页面后 #body 消失，旧监听器自然空转，不会误写其它页面。
  const onLang = () => {
    if (!document.getElementById('body')) { disposed = true; return; }
    void load();
  };
  window.addEventListener('terradata:lang', onLang);

  (async () => {
    try {
      await api.get('/api/auth/me');
      const back = document.getElementById('backLink');
      if (back) {
        back.setAttribute('href', '/dashboard');
        back.textContent = currentLang() === 'en' ? 'Back to console' : '返回控制台';
      }
    } catch {
      const back = document.getElementById('backLink');
      if (back) {
        back.setAttribute('href', '/');
        back.textContent = currentLang() === 'en' ? 'Back to sign in' : '返回登录';
      }
    }
    if (!disposed) void load();
  })();

  // 公开页面：未登录也可查看，导航显示登录入口
  mountShell('terms', { optional: true }).then(async () => {
    applyBranding(await loadBranding());
  }).catch(() => {});
}
