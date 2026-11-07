/**
 * Home 页面控制器（由 home.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, esc, loadBranding, applyBranding } from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

export async function mountHome(_root: HTMLElement | null): Promise<void> {
  
  loadBranding().then(applyBranding).catch(() => {});
  const yrEl = document.getElementById('yr');
  if (yrEl) yrEl.textContent = String(new Date().getFullYear());
  
  let ROOTS = [];
  let RT = [];
  
  /* ---------- 可选后缀卡片 ---------- */
  function renderSuffix(list) {
    const box = document.getElementById('suffixGrid');
    if (!list.length) { box.innerHTML = '<div class="nk-sk">暂未配置根域名</div>'; return; }
    box.innerHTML = list.map((d, i) => `
      <div class="card nk-suf">
        ${i === 0 ? '<span class="nk-hot">HOT</span>' : ''}
        <div class="nk-suf-name">.${esc(d.toUpperCase())}</div>
        <div class="nk-suf-desc">${esc(d)}</div>
        <div class="nk-suf-tip">单次注册 365 天，到期前 180 天可续期</div>
      </div>`).join('');
  }
  
  /* ---------- 记录类型标签 ---------- */
  function renderTags() {
    const box = document.getElementById('rtTags');
    if (!RT.length) return;
    const show = RT.slice(0, 13).map((t) => `<span class="nk-tag mono">${esc(t.key)}</span>`).join('');
    const rest = RT.slice(13).map((t) => `<span class="nk-tag mono">${esc(t.key)}</span>`).join('');
    box.innerHTML = show + (rest ? `<span class="nk-tag-hidden" id="rtRest">${rest}</span>` : '');
    const more = document.getElementById('rtMore');
    if (!rest) { more.style.display = 'none'; return; }
    more.onclick = () => {
      const el = document.getElementById('rtRest');
      const on = el.classList.toggle('show');
      more.textContent = on ? '收起' : '更多…';
    };
  }
  
  /* ---------- 初始化配置 ---------- */
  (async () => {
    try {
      const cfg = await api.get('/api/config');
      ROOTS = Array.isArray(cfg.rootDomains) && cfg.rootDomains.length
        ? cfg.rootDomains
        : (cfg.rootDomain ? [cfg.rootDomain] : []);
      RT = Array.isArray(cfg.recordTypes) ? cfg.recordTypes : [];
      /* qRoot 现在是下拉框：列出全部已配置根域名，可切换查询其它后缀 */
      const sel = document.getElementById('qRoot') as HTMLSelectElement | null;
      if (sel) {
        sel.innerHTML = ROOTS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')
          || '<option value="">—</option>';
        const want = new URLSearchParams(location.search).get('root');
        if (want && ROOTS.indexOf(want) >= 0) sel.value = want;
      }
      renderSuffix(ROOTS);
      renderTags();
      try {
        const h = location.origin;
        if (h && h !== 'null') {
          document.getElementById('apiHost').textContent = h;
          document.querySelectorAll('.c-str').forEach(() => {});
        }
      } catch {}
    } catch {}
  })();
  
  /* ---------- 域名查询：一次查全部后缀 ---------- */
  const STATE = {
    free: '可用', available: '可用',
    pending: '审核中', registered: '已注册', taken: '已注册',
    rejected: '已驳回', suspended: '已停用', reserved: '系统保留',
  };
  document.getElementById('searchForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const label = document.getElementById('qName').value.trim();
    const box = document.getElementById('results');
    if (!label) { box.innerHTML = '<div class="nk-res-empty">请输入域名前缀</div>'; return; }
    box.innerHTML = '<div class="nk-res-empty">查询中…</div>';
  
    const sel = document.getElementById('qRoot') as HTMLSelectElement | null;
    const picked = (sel && sel.value && ROOTS.indexOf(sel.value) >= 0) ? sel.value : ROOTS[0];
    const jobs = (picked ? [picked] : ROOTS).map((root) =>
      api.get('/api/whois?name=' + encodeURIComponent(label + '.' + root))
        .then((d) => ({ root, data: d.result || d, err: null }))
        .catch((err) => ({ root, data: null, err: err.message || '查询失败' }))
    );
    const rs = await Promise.all(jobs);
    box.innerHTML = rs.map(({ root, data, err }) => {
      if (err) return `<div class="card nk-res err"><div class="nk-res-name mono">${esc(label + '.' + root)}</div><div class="nk-res-state">${esc(err)}</div></div>`;
      const st = data.state || data.status || '';
      const txt = STATE[st] || st || '未知';
      const free = ['free', 'available'].includes(st);
      return `<div class="card nk-res ${free ? 'ok' : 'no'}">
        <div class="nk-res-name mono">${esc((label + '.' + root).toUpperCase())}</div>
        <div class="nk-res-state">${esc(txt)}</div>
        <div class="nk-res-act">${free
          ? `<a class="btn sm primary" href="/register?label=${encodeURIComponent(label)}&root=${encodeURIComponent(root)}">立即注册</a>`
          : `<span class="nk-res-dim">域名不可用</span>`}</div>
      </div>`;
    }).join('');
  });
  
}
