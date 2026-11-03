/**
 * Transfer 页面控制器（由 transfer.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, esc, fmtTime, toast, loadBranding, applyBranding, mountShell } from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

export async function mountTransfer(_root: HTMLElement | null): Promise<void> {
  
  let step = 1, myDomains = [], preview = null;
  
  mountShell('transfer').then(async () => {
    applyBranding(await loadBranding());
    await Promise.all([loadNotice(), loadDomains(), loadHistory()]);
  }).catch((e) => console.error("初始化失败", e));
  
  function goto(n) {
    step = n;
    [1, 2, 3, 4].forEach((i) => {
      document.getElementById('pane' + i).style.display = i === n ? '' : 'none';
      document.querySelectorAll('.step').forEach((s) => {
        const v = Number(s.dataset.s);
        s.classList.toggle('on', v === n);
        s.classList.toggle('done', v < n);
      });
    });
  }
  
  async function loadNotice() {
    try {
      const d = await api.get('/api/transfer/notice');
      document.getElementById('noticeList').innerHTML =
        `<ol>${d.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
    } catch { document.getElementById('noticeList').textContent = '须知加载失败，请刷新重试。'; }
  }
  
  async function loadDomains() {
    try {
      const d = await api.get('/api/subdomains');
      myDomains = (d.items || []).filter((x) => x.status === 'approved');
    } catch { myDomains = []; }
    const sel = document.getElementById('selDom');
    sel.innerHTML = myDomains.length
      ? myDomains.map((x) => `<option value="${x.id}">${esc(x.fqdn)}</option>`).join('')
      : '<option value="">（无可转移的域名）</option>';
  }
  
  async function loadHistory() {
    const tb = document.getElementById('hisList');
    try {
      const d = await api.get('/api/transfer/mine');
      const items = d.items || [];
      if (!items.length) { tb.innerHTML = `<tr><td colspan="3" class="empty">暂无转移记录</td></tr>`; return; }
      tb.innerHTML = items.map((t) => `
        <tr>
          <td class="fqdn">${esc(t.fqdn)}</td>
          <td style="color:var(--muted)">${esc(t.to_email)}</td>
          <td class="nowrap" style="color:var(--muted)">${fmtTime(t.created_at)}</td>
        </tr>`).join('');
    } catch { tb.innerHTML = `<tr><td colspan="3" class="empty">加载失败</td></tr>`; }
  }
  
  /* ---------- 第 1 步 ---------- */
  document.getElementById('next1').onclick = () => {
    if (!document.getElementById('ag1').checked || !document.getElementById('ag2').checked) {
      return toast('请先勾选两个确认项', 'err');
    }
    goto(2);
  };
  
  /* ---------- 第 2 步 ---------- */
  document.getElementById('prev2').onclick = () => goto(1);
  document.getElementById('next2').onclick = async () => {
    const sid = Number(document.getElementById('selDom').value);
    const to = document.getElementById('inpTo').value.trim();
    if (!sid) return toast('请选择要转移的域名', 'err');
    if (!to) return toast('请填写接收账号邮箱', 'err');
    const tip = document.getElementById('chkTip');
    tip.textContent = '校验中…';
    try {
      const d = await api.post('/api/transfer/preview', { subdomainId: sid, toEmail: to });
      preview = d;
      tip.textContent = '';
      const box = document.getElementById('confirmBox');
      box.innerHTML = `
        <div class="k">转移域名</div><div class="mono">${esc(d.fqdn)}</div>
        <div class="k">接收账号</div><div class="mono">${esc(d.toEmail)}</div>
        <div class="k">DNS 记录</div><div>${d.recordCount} 条（一并转移）</div>`;
      document.getElementById('finalBox').innerHTML = box.innerHTML;
      goto(3);
    } catch (e) { tip.textContent = e.message; tip.style.color = 'var(--danger)'; }
  };
  
  /* ---------- 第 3 步 ---------- */
  document.getElementById('prev3').onclick = () => goto(2);
  document.getElementById('next3').onclick = () => {
    if (!document.getElementById('ag3').checked) return toast('请勾选确认项', 'err');
    goto(4);
  };
  
  /* ---------- 第 4 步 ---------- */
  document.getElementById('prev4').onclick = () => goto(3);
  document.getElementById('btnCommit').onclick = async () => {
    const btn = document.getElementById('btnCommit');
    if (!preview) return toast('信息已失效，请重新操作', 'err');
    if (!confirm(`确定将 ${preview.fqdn} 转移给 ${preview.toEmail}？此操作不可撤销。`)) return;
    btn.disabled = true;
    try {
      await api.post('/api/transfer/commit', {
        subdomainId: preview.subdomainId,
        toEmail: preview.toEmail,
        agreed: true,
      });
      toast(`已转移给 ${preview.toEmail}`);
      preview = null;
      await Promise.all([loadDomains(), loadHistory()]);
      [1, 2, 3, 4].forEach((i) => { if (i === 3 || i === 4) document.getElementById('ag' + i) && (document.getElementById('ag' + i).checked = false); });
      goto(1);
      document.getElementById('ag1').checked = false;
      document.getElementById('ag2').checked = false;
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  };
  
}
