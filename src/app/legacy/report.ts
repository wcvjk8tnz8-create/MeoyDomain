/**
 * 举报滥用域名页控制器
 * 公开页：未登录也能提交；登录后可看自己的举报；管理员在此处理。
 */
import { api, esc, fmtTime, toast, mountShell } from '../lib/runtime';

const TYPE_KEYS = ['phishing', 'malware', 'spam', 'illegal', 'trademark', 'fraud', 'other'];
const TYPE_CN: Record<string, string> = {
  phishing: '钓鱼 / 仿冒', malware: '恶意程序 / 木马', spam: '垃圾邮件',
  illegal: '赌博 / 色情 / 违法内容', trademark: '侵犯商标 / 知识产权',
  fraud: '诈骗', other: '其它违规',
};
const STATUS_CN: Record<string, string> = {
  open: '待处理', investigating: '处理中', resolved: '已处理', dismissed: '已驳回',
};

const $ = (id: string) => document.getElementById(id) as HTMLElement | null;

export async function mountReport(_root: HTMLElement | null): Promise<void> {
  let isAdmin = false;
  let loggedIn = false;
  let page = 1;

  /* 预填：WHOIS / 落地页 / 域名详情跳转过来时带 ?domain= */
  try {
    const q = new URLSearchParams(location.search).get('domain');
    const el = $('rpDomain') as HTMLInputElement | null;
    if (q && el) el.value = q.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase();
  } catch { /* ignore */ }

  /* 公开配置：后台填的投诉邮箱 / 外部入口 */
  api.get('/api/abuse').then((d) => {
    const parts: string[] = [];
    if (d.abuseEmail) parts.push(`投诉邮箱：<a class="mono" href="mailto:${esc(d.abuseEmail)}">${esc(d.abuseEmail)}</a>`);
    if (d.abuseReportUrl) parts.push(`<a href="${esc(d.abuseReportUrl)}" target="_blank" rel="noopener noreferrer">在线举报入口</a>`);
    const card = $('rpContactCard');
    if (!parts.length || !card) return;
    card.style.display = '';
    const box = $('rpContact');
    if (box) box.innerHTML = `<div class="hint" style="line-height:2">${parts.join(' · ')}</div>`;
  }).catch(() => {});

  /* 角色：管理员显示管理面板 */
  try {
    const me = await api.get('/api/auth/me');
    loggedIn = !!(me && (me.user || me).id);
    isAdmin = String((me.user || me).role || '') === 'admin';
  } catch { loggedIn = false; isAdmin = false; }
  if (isAdmin) {
    const card = $('rpAdminCard');
    if (card) card.style.display = '';
    loadAdmin();
  }

  async function loadMine() {
    const box = $('rpMine');
    if (!box) return;
    if (!loggedIn) {
      box.innerHTML = '<div class="empty">登录后可以查看自己的举报记录。<a href="/login">去登录</a></div>';
      return;
    }
    try {
      const d = await api.get('/api/abuse/mine');
      const items = d.items || [];
      if (!items.length) { box.innerHTML = '<div class="empty">暂无举报记录</div>'; return; }
      box.innerHTML = `<table><thead><tr>
        <th>举报编号</th><th>被举报域名</th><th>滥用类型</th><th>处理状态</th><th>处理说明</th><th>举报时间</th>
      </tr></thead><tbody>${items.map((r: any) => `<tr>
        <td class="mono">#${r.id}</td>
        <td class="mono">${esc(r.domain)}</td>
        <td>${esc(r.typeCn || TYPE_CN[r.type] || r.type)}</td>
        <td><span class="badge ${r.status === 'resolved' ? 'ok' : r.status === 'dismissed' ? 'warn' : 'inf'}">${esc(r.statusCn || STATUS_CN[r.status] || r.status)}</span></td>
        <td class="cell-detail" title="${esc(r.admin_note || '')}">${esc(r.admin_note || '—')}</td>
        <td class="nowrap" style="color:var(--muted)">${esc(fmtTime(r.created_at))}</td>
      </tr>`).join('')}</tbody></table>`;
    } catch (e: any) {
      box.innerHTML = `<div class="empty">${esc(e.message || '加载失败')}</div>`;
    }
  }

  async function loadAdmin() {
    const box = $('rpAdmin');
    if (!box) return;
    const status = ($('rpFilter') as HTMLSelectElement | null)?.value || '';
    try {
      const d = await api.get('/api/abuse/admin' + (status ? `?status=${encodeURIComponent(status)}&page=${page}` : `?page=${page}`));
      const items = d.items || [];
      if (!items.length) { box.innerHTML = '<div class="empty">暂无举报记录</div>'; }
      else {
        box.innerHTML = `<table><thead><tr>
          <th>举报编号</th><th>被举报域名</th><th>滥用类型</th><th>详细描述</th><th>举报人</th>
          <th>处理状态</th><th>举报时间</th><th>操作</th>
        </tr></thead><tbody>${items.map((r: any) => `<tr>
          <td class="mono">#${r.id}</td>
          <td class="mono">${esc(r.domain)}${r.local_match ? ' <span class="badge warn">本站域名</span>' : ''}</td>
          <td>${esc(r.typeCn || TYPE_CN[r.type] || r.type)}</td>
          <td class="cell-detail" title="${esc(r.description)}">${esc(String(r.description || '').slice(0, 60))}</td>
          <td class="mono" style="font-size:11px">${esc(r.user_email || '匿名')}</td>
          <td><span class="badge ${r.status === 'resolved' ? 'ok' : r.status === 'dismissed' ? 'warn' : 'inf'}">${esc(r.statusCn || STATUS_CN[r.status] || r.status)}</span></td>
          <td class="nowrap" style="color:var(--muted)">${esc(fmtTime(r.created_at))}</td>
          <td class="nowrap">
            <button class="btn sm ghost" data-act="investigating" data-id="${r.id}">标记为处理中</button>
            <button class="btn sm ghost" data-act="resolved" data-id="${r.id}">标记已处理</button>
            <button class="btn sm ghost" data-act="dismissed" data-id="${r.id}">驳回举报</button>
            ${r.local_match ? `<button class="btn sm" data-act="suspend" data-id="${r.id}">停用该域名</button>` : ''}
          </td>
        </tr>`).join('')}</tbody></table>`;
        box.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) => {
          b.onclick = async () => {
            const act = b.dataset.act!;
            const id = b.dataset.id!;
            if (act === 'dismissed' && !confirm('确定驳回这条举报吗？')) return;
            if (act === 'suspend' && !confirm('确定要停用该域名吗？')) return;
            b.disabled = true;
            try {
              if (act === 'suspend') await api.post(`/api/abuse/admin/${id}/suspend`, {});
              else await api.patch(`/api/abuse/admin/${id}`, { status: act });
              toast(act === 'suspend' ? '域名已停用' : '举报处理已更新', 'ok');
              loadAdmin();
              loadMine();
            } catch (e: any) { toast(e.message, 'err'); b.disabled = false; }
          };
        });
      }
      const pager = $('rpPager');
      if (pager) {
        pager.innerHTML = `<span class="hint" style="align-self:center">共 ${d.total || 0} 条 · 第 ${d.page || 1}/${d.pages || 1} 页</span>
          <button class="btn sm ghost" id="rpPrev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
          <button class="btn sm ghost" id="rpNext" ${page >= (d.pages || 1) ? 'disabled' : ''}>下一页</button>`;
        const prev = $('rpPrev'), next = $('rpNext');
        if (prev) prev.onclick = () => { page = Math.max(1, page - 1); loadAdmin(); };
        if (next) next.onclick = () => { page += 1; loadAdmin(); };
      }
    } catch (e: any) {
      box.innerHTML = `<div class="empty">${esc(e.message || '加载失败')}</div>`;
    }
  }

  const filter = $('rpFilter') as HTMLSelectElement | null;
  if (filter) filter.onchange = () => { page = 1; loadAdmin(); };
  const refresh = $('rpRefresh');
  if (refresh) refresh.onclick = () => { loadMine(); if (isAdmin) loadAdmin(); };

  const submit = $('rpSubmit') as HTMLButtonElement | null;
  if (submit) submit.onclick = async () => {
    const domain = ($('rpDomain') as HTMLInputElement | null)?.value.trim() || '';
    const type = ($('rpType') as HTMLSelectElement | null)?.value || '';
    const description = ($('rpDesc') as HTMLTextAreaElement | null)?.value.trim() || '';
    const evidenceUrl = ($('rpEvidence') as HTMLInputElement | null)?.value.trim() || '';
    const contactEmail = ($('rpEmail') as HTMLInputElement | null)?.value.trim() || '';
    const out = $('rpOut');
    if (!domain) return toast('请填写被举报域名', 'err');
    if (!TYPE_KEYS.includes(type)) return toast('请选择滥用类型', 'err');
    if (description.length < 10) return toast('请填写详细描述（至少 10 个字）', 'err');
    submit.disabled = true;
    if (out) out.textContent = '提交中…';
    try {
      const d = await api.post('/api/abuse', { domain, type, description, evidenceUrl, contactEmail });
      toast(d.message || '举报提交成功，我们会尽快处理', 'ok');
      if (out) out.textContent = d.id ? `举报编号 #${d.id}` : '';
      const desc = $('rpDesc') as HTMLTextAreaElement | null;
      if (desc) desc.value = '';
      loadMine();
      if (isAdmin) loadAdmin();
    } catch (e: any) {
      toast(e.message || '举报失败，请稍后再试', 'err');
      if (out) out.textContent = '';
    } finally { submit.disabled = false; }
  };

  loadMine();
  (async () => {
    await mountShell('report', { optional: true });
  })();
}
