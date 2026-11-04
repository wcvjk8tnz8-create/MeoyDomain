/**
 * Checkin 页面控制器（由 checkin.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, esc, fmtTime, toast, mountShell } from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

export async function mountCheckin(_root: HTMLElement | null): Promise<void> {
  
  async function load() {
    try {
      const d = await api.get('/api/points/me');
      const unlimited = d.unlimited;
      document.getElementById('ptsNum').textContent = unlimited ? '∞' : d.points;
      document.getElementById('ptsTip').textContent = unlimited
        ? '管理员不限积分'
        : (d.canCheckIn ? '今天还没有签到' : '今天已签到，明天再来');
  
      const btn = document.getElementById('btnCheck');
      const tip = document.getElementById('checkTip');
      if (unlimited) {
        btn.disabled = true;
        btn.textContent = '管理员无需签到';
        tip.textContent = '';
      } else if (d.checkedIn) {
        btn.disabled = true;
        btn.textContent = '今日已签到';
        tip.innerHTML = `<span style="color:var(--ok)">明天可再领 ${d.rules.checkin} 分</span>`;
      } else {
        btn.disabled = false;
        btn.textContent = `签到领 ${d.rules.checkin} 分`;
        tip.textContent = '';
      }
  
      const r = d.rules || {};
      if (r.checkin !== undefined) document.getElementById('ruleCheckin').textContent = r.checkin;
      if (r.domainCost !== undefined) document.getElementById('ruleCost').textContent = r.domainCost;
      if (r.shortCost !== undefined) document.getElementById('ruleShort').textContent = r.shortCost;
  
      const box = document.getElementById('logBox');
      if (!d.logs || !d.logs.length) { box.innerHTML = '<div class="empty">还没有积分变动</div>'; return; }
      box.innerHTML = `<table>
        <thead><tr><th>变动</th><th>余额</th><th>说明</th><th>时间</th></tr></thead>
        <tbody>${d.logs.map((l) => `<tr>
          <td class="mono" style="color:${l.delta > 0 ? 'var(--ok)' : 'var(--danger)'}">${l.delta > 0 ? '+' : ''}${l.delta}</td>
          <td class="mono">${l.balance}</td>
          <td class="cell-detail" title="${esc([l.reason, l.detail].filter(Boolean).join(' · '))}">${esc(l.reason || '')}${l.detail ? ' <span style="color:var(--muted)">' + esc(l.detail) + '</span>' : ''}</td>
          <td class="nowrap" style="color:var(--muted)">${fmtTime(l.created_at)}</td>
        </tr>`).join('')}</tbody></table>`;
    } catch (e) { toast(e.message, 'err'); }
  }
  
  document.getElementById('btnCheck').onclick = async () => {
    const btn = document.getElementById('btnCheck');
    const coin = document.getElementById('coin');
    btn.disabled = true;
    try {
      const r = await api.post('/api/points/checkin', {});
      // 弹一下的动画
      coin.classList.remove('pop');
      void coin.offsetWidth;
      coin.classList.add('pop');
      toast(`签到成功，+${r.gained} 分`);
      setTimeout(load, 380);
    } catch (e) { toast(e.message, 'err'); load(); }
  };
  
  (async () => {
    await mountShell('checkin');
    load();
  })();
  
}
