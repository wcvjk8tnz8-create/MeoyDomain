/**
 * Tickets 页面控制器（由 tickets.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, esc, fmtTime, toast, openModal, closeModal, loadBranding, applyBranding, mountShell } from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

export async function mountTickets(_root: HTMLElement | null): Promise<void> {
  
  let curStatus = '', curPage = 1, curPages = 1, isAdmin = false;
  
  mountShell('tickets').then(async () => {
    applyBranding(await loadBranding());
    load();
  }).catch((e) => console.error("初始化失败", e));
  
  async function load() {
    try {
      const d = await api.get(`/api/tickets?status=${encodeURIComponent(curStatus)}&page=${curPage}`);
      isAdmin = !!d.isAdmin;
      curPages = d.pages;
      document.getElementById('thUser').style.display = isAdmin ? '' : 'none';
      renderList(d.items, isAdmin);
      document.getElementById('pageInfo').textContent = `共 ${d.total} 条 · 第 ${d.page}/${d.pages} 页`;
      document.getElementById('btnPrev').disabled = d.page <= 1;
      document.getElementById('btnNext').disabled = d.page >= d.pages;
    } catch (e) { toast(e.message, 'err'); }
  }
  
  function renderList(items, isAdmin) {
    const tb = document.getElementById('list');
    if (!items.length) {
      tb.innerHTML = `<tr><td colspan="6" class="empty">暂无工单</td></tr>`;
      return;
    }
    tb.innerHTML = items.map((t) => `
      <tr>
        <td><span class="fqdn">${esc(t.subject)}</span></td>
        <td>${statusBadge(t.status)}</td>
        <td>${t.reply_count}</td>
        ${isAdmin ? `<td style="color:var(--muted)">${esc(t.userEmail || '')}</td>` : ''}
        <td class="nowrap" style="color:var(--muted)">${fmtTime(t.updated_at)}</td>
        <td class="right nowrap">
          <button class="btn sm" data-view="${t.id}">查看</button>
        </td>
      </tr>`).join('');
  
    tb.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => openTicket(b.dataset.view); });
  }
  
  function statusBadge(s) {
    const map = { open: 'warn', pending: 'inf', answered: 'ok', closed: '' };
    const cn = { open: '待处理', pending: '处理中', answered: '有回复', closed: '已关闭' };
    return `<span class="badge ${map[s] || ''}">${cn[s] || s}</span>`;
  }
  
  /* ---------- 筛选与分页 ---------- */
  document.querySelectorAll('#filters [data-st]').forEach((b) => {
    b.onclick = () => {
      curStatus = b.dataset.st;
      curPage = 1;
      document.querySelectorAll('#filters [data-st]').forEach((x) => x.classList.toggle('primary', x === b));
      load();
    };
  });
  document.getElementById('btnPrev').onclick = () => { if (curPage > 1) { curPage--; load(); } };
  document.getElementById('btnNext').onclick = () => { if (curPage < curPages) { curPage++; load(); } };
  
  /* ---------- 提交工单 ---------- */
  document.getElementById('btnNew').onclick = () => {
    openModal('提交工单', `
      <div class="field"><label>标题</label><input id="tSub" maxlength="120" placeholder="一句话描述你的问题"></div>
      <div class="field"><label>内容</label><textarea id="tBody" maxlength="4000" placeholder="详细说明，附上域名、报错信息等"></textarea></div>
      <div class="row end">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn primary" id="okNew">提交</button>
      </div>`);
    document.getElementById('okNew').onclick = async () => {
      try {
        await api.post('/api/tickets', {
          subject: document.getElementById('tSub').value,
          content: document.getElementById('tBody').value,
        });
        toast('工单已提交'); closeModal(); curPage = 1; load();
      } catch (e) { toast(e.message, 'err'); }
    };
  };
  
  /* ---------- 工单详情与回复 ---------- */
  async function openTicket(id) {
    let d;
    try { d = await api.get('/api/tickets/' + id); }
    catch (e) { toast(e.message, 'err'); return; }
    const t = d.ticket;
  
    openModal(`工单 #${id} · ${esc(t.subject)}`, `
      <div class="row" style="gap:7px;margin-bottom:11px">${statusBadge(t.status)}<span class="sub" style="margin:0">${fmtTime(t.created_at)}</span></div>
      <div class="reply-box">
        ${d.replies.length ? d.replies.map((r) => `
          <div class="reply${r.is_admin ? ' admin' : ''}">
            <div class="r-head">
              <span class="r-who">${r.is_admin ? '管理员' : '我'}</span>
              <span class="r-time">${fmtTime(r.created_at)}</span>
            </div>
            <div class="r-body">${esc(r.content).replace(/\n/g, '<br>')}</div>
          </div>`).join('') : '<div class="empty">暂无回复</div>'}
      </div>
      ${t.status === 'closed' ? '<div class="alert info" style="margin-top:11px">工单已关闭，无法追加回复。</div>' : `
      <div class="field" style="margin-top:12px"><label>追加回复</label><textarea id="rBody" placeholder="补充信息或追问"></textarea></div>
      <div class="row end" style="gap:6px;flex-wrap:wrap">
        <button class="btn sm" id="btnClose">关闭工单</button>
        <button class="btn primary" id="okReply">发送回复</button>
      </div>`}`);
  
    const rb = document.getElementById('rBody');
    if (rb) {
      document.getElementById('okReply').onclick = async () => {
        try {
          await api.post(`/api/tickets/${id}/reply`, { content: rb.value });
          toast('已回复'); await openTicket(id); load();
        } catch (e) { toast(e.message, 'err'); }
      };
    }
    const bc = document.getElementById('btnClose');
    if (bc) {
      bc.onclick = async () => {
        if (!confirm('确定关闭该工单？关闭后无法追加回复。')) return;
        try { await api.post(`/api/tickets/${id}/close`, {}); toast('工单已关闭'); closeModal(); load(); }
        catch (e) { toast(e.message, 'err'); }
      };
    }
  }
  
}
