/**
 * Rewards 页面控制器（由 rewards.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, esc, fmtTime, toast, copyText, mountShell } from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

export async function mountRewards(_root: HTMLElement | null): Promise<void> {
  
  let isAdmin = false;
  let previewType = '';
  
  async function loadMine() {
    try {
      const d = await api.get('/api/redeem/mine');
      const box = document.getElementById('myLogs');
      if (!d.items.length) { box.innerHTML = '<div class="empty">还没有兑换记录</div>'; return; }
      box.innerHTML = `<table>
        <thead><tr><th>兑换码</th><th>类型</th><th>域名</th><th>时间</th></tr></thead>
        <tbody>${d.items.map((l) => `<tr>
          <td class="mono">${esc(l.code)}</td>
          <td>${l.type === 'permanent' ? '<span class="badge inf">永久化</span>' : '<span class="badge ok">配额 +' + l.value + '</span>'}</td>
          <td>${l.fqdn ? '<span class="fqdn">' + esc(l.fqdn) + '</span>' : '—'}</td>
          <td class="nowrap" style="color:var(--muted)">${fmtTime(l.created_at)}</td>
        </tr>`).join('')}</tbody></table>`;
    } catch (e) { document.getElementById('myLogs').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }
  
  /** V 码需要选择域名：列出自己已注册且非永久的域名 */
  async function loadPermOptions() {
    try {
      const d = await api.get('/api/subdomains');
      const opts = (d.items || []).filter((s) => s.status === 'approved' && !(s.expiry && s.expiry.perpetual));
      const sel = document.getElementById('permSel');
      if (!opts.length) {
        sel.innerHTML = '<option value="">（没有可永久化的域名）</option>';
        return;
      }
      sel.innerHTML = opts.map((s) => `<option value="${s.id}">${esc(s.fqdn)}</option>`).join('');
    } catch {}
  }
  
  document.getElementById('btnPreview').onclick = async () => {
    const code = document.getElementById('code').value.trim();
    const tip = document.getElementById('previewTip');
    const permRow = document.getElementById('permRow');
    permRow.style.display = 'none';
    previewType = '';
    if (!code) { tip.textContent = '请输入兑换码'; return; }
    try {
      const r = await api.get('/api/redeem/preview?code=' + encodeURIComponent(code));
      previewType = r.type;
      tip.innerHTML = r.usable
        ? `<span style="color:var(--ok)">可用：${esc(r.typeText)}${r.type === 'quota' ? ' ×' + r.value : ''}</span>`
        : `<span style="color:var(--danger)">不可用：${esc(r.reason)}</span>`;
      if (r.usable && r.type === 'permanent') {
        permRow.style.display = '';
        await loadPermOptions();
      }
    } catch (e) {
      tip.innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`;
    }
  };
  
  document.getElementById('btnRedeem').onclick = async () => {
    const code = document.getElementById('code').value.trim();
    if (!code) return toast('请输入兑换码', 'err');
    const btn = document.getElementById('btnRedeem');
    btn.disabled = true;
    try {
      const body = { code };
      if (previewType === 'permanent') {
        const sid = document.getElementById('permSel').value;
        if (!sid) { btn.disabled = false; return toast('请选择要永久化的域名', 'err'); }
        body.subdomainId = Number(sid);
      }
      const r = await api.post('/api/redeem/redeem', body);
      toast(r.type === 'permanent' ? `已永久化 ${r.fqdn}` : `配额 +${r.added}，当前 ${r.after < 0 ? '∞' : r.after}`);
      document.getElementById('code').value = '';
      document.getElementById('previewTip').textContent = '输入兑换码后点「识别」，可先确认它是什么类型。';
      document.getElementById('permRow').style.display = 'none';
      loadMine();
      loadPermOptions();
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  };
  
  /* ---------------- 管理员 ---------------- */
  async function loadAdminList() {
    try {
      const d = await api.get('/api/redeem/admin/list');
      const box = document.getElementById('listWrap');
      if (!d.items.length) { box.innerHTML = '<div class="empty">还没有兑换码</div>'; return; }
      box.innerHTML = `<table>
        <thead><tr><th>兑换码</th><th>类型</th><th>用量 / 总量</th><th>状态</th><th>备注</th><th class="right">操作</th></tr></thead>
        <tbody>${d.items.map((r) => {
          const dead = r.status !== 'active' || (r.expires_at && r.expires_at < Date.now());
          return `<tr${dead ? ' style="opacity:.6"' : ''}>
            <td class="mono">${esc(r.code)}</td>
            <td>${r.type === 'permanent' ? '<span class="badge inf">永久化</span>' : '<span class="badge ok">配额 ' + r.value + '</span>'}</td>
            <td>${r.used_count} / ${r.max_uses}</td>
            <td>${r.status === 'active' ? '<span class="badge ok">启用</span>' : '<span class="badge warn">停用</span>'}</td>
            <td style="color:var(--muted)">${esc(r.note || '—')}</td>
            <td class="right nowrap">
              <button class="btn sm" data-tg="${r.id}">${r.status === 'active' ? '停用' : '启用'}</button>
              <button class="btn sm danger" data-rm="${r.id}">删除</button>
            </td>
          </tr>`;
        }).join('')}</tbody></table>`;
      box.querySelectorAll('[data-tg]').forEach((b) => {
        b.onclick = async () => {
          try { await api.post('/api/redeem/admin/' + b.dataset.tg + '/toggle', {}); loadAdminList(); }
          catch (e) { toast(e.message, 'err'); }
        };
      });
      box.querySelectorAll('[data-rm]').forEach((b) => {
        b.onclick = async () => {
          if (!confirm('确定删除该兑换码？')) return;
          try { await api.del('/api/redeem/admin/' + b.dataset.rm); toast('已删除'); loadAdminList(); }
          catch (e) { toast(e.message, 'err'); }
        };
      });
    } catch (e) { document.getElementById('listWrap').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }
  
  document.getElementById('gType').onchange = (e) => {
    document.getElementById('gValueWrap').style.display = e.target.value === 'quota' ? '' : 'none';
  };
  
  document.getElementById('btnGen').onclick = async () => {
    const btn = document.getElementById('btnGen');
    btn.disabled = true;
    try {
      const type = document.getElementById('gType').value;
      const r = await api.post('/api/redeem/admin/generate', {
        type,
        count: Number(document.getElementById('gCount').value) || 1,
        value: Number(document.getElementById('gValue').value) || 1,
        maxUses: Number(document.getElementById('gMax').value) || 10000,
        days: Number(document.getElementById('gDays').value) || 0,
        note: document.getElementById('gNote').value.trim(),
      });
      const out = document.getElementById('genOut');
      out.innerHTML = `<div class="alert ok" style="margin:0">
        已生成 ${r.count} 张 ${type === 'permanent' ? 'V' : 'PE'} 码：
        <div class="mono" style="margin-top:7px;font-size:12px;line-height:2;word-break:break-all">
          ${r.codes.map((c) => esc(c)).join('<br>')}
        </div>
        <button class="btn sm" id="btnCopyAll" style="margin-top:9px">复制全部</button>
      </div>`;
      const cb = document.getElementById('btnCopyAll');
      if (cb) cb.onclick = () => { copyText(r.codes.join('\n')); };
      loadAdminList();
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  };
  
  document.getElementById('btnPurge').onclick = async () => {
    const btn = document.getElementById('btnPurge');
    const first = confirm('确定清空全部券？此操作不可恢复。\n\n兑换记录会保留（便于追溯谁用过）。');
    if (!first) return;
    const again = confirm('再次确认：真的要删除所有券吗？');
    if (!again) return;
    btn.disabled = true;
    try {
      const r = await api.del('/api/redeem/admin/all?confirm=1');
      toast(`已清空 ${r.deleted} 张券`);
      loadAdminList();
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  };
  
  (async () => {
    const me = await mountShell('rewards');
    isAdmin = !!(me && me.role === 'admin');
    if (isAdmin) {
      document.getElementById('adminBox').style.display = '';
      document.getElementById('adminList').style.display = '';
      loadAdminList();
    }
    loadMine();
    loadPermOptions();
  })();
  
}
