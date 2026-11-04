/**
 * Dashboard 页面控制器（由 dashboard.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, esc, fmtTime, fmtDate, toast, openModal, closeModal, loadBranding, applyBranding, statusBadge, mountShell } from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

export async function mountDashboard(_root: HTMLElement | null): Promise<void> {
  
  let rootDomain = '';
  let checkTimer = null;
  
  async function load() {
    // 列表是主体，config 只用于展示根域名 —— 并行取，且 config 失败不影响列表渲染
    const [d, cfg] = await Promise.all([
      api.get('/api/subdomains'),
      api.get('/api/config').catch(() => ({})),
    ]);
    rootDomain = cfg.rootDomain || '';
  
    /* 后台暂停新申请：引导卡直接说明，普通用户不再往注册页跳 */
    const cardHint = document.getElementById('applyCardHint');
    const goReg = document.getElementById('goRegister');
    if (cardHint && cfg.applyPaused) {
      cardHint.className = 'alert a-warn';
      cardHint.innerHTML = '<b>新域名申请已暂停</b><br>' + esc(cfg.applyPausedMessage || '请稍后再试。')
        + '<br><span style="opacity:.8;font-size:12px">已注册的域名、DNS 记录与续期不受影响。</span>';
      const admin = document.querySelector('.navlink[href="/admin"]') !== null;
      if (goReg && !admin) { goReg.textContent = '申请已暂停'; goReg.removeAttribute('href'); goReg.style.opacity = '.5'; goReg.style.pointerEvents = 'none'; }
    }
    const rdEl = document.getElementById('rootDomain');
    if (rdEl) rdEl.textContent = rootDomain;
    const quotaHtml = d.quotaUnlimited ? '<span class="badge inf">∞ 不限</span>' : `${d.quota} 个`;
    const isAdmin = document.querySelector('.navlink[href="/admin"]') !== null;
    let tip = isAdmin
      ? ' · 管理员申请即时开通，可占用保留域名且不限数量'
      : cfg.requireApproval ? ' · 新申请需管理员审核' : ' · 即时生效';
    if (d.rejected > 0) tip += ` · 另有 ${d.rejected} 个被驳回（不占配额）`;
    document.getElementById('quotaTip').innerHTML = `已使用 ${d.used} / ${quotaHtml}` + tip;
  
    // 单域名队列提示（申请表单已移至 /register.html，这里只做提示）
    const applyTip = document.getElementById('applyTip');
    if (applyTip) {
      if (d.pendingApplication && !isAdmin) {
        applyTip.className = 'alert a-warn';
        applyTip.innerHTML = `你已有一个待审核的申请：<b>${esc(d.pendingApplication.fqdn)}</b><br>同一时间只能申请一个域名，请等待审核结果（或被驳回）后再提交。`;
      } else if (isAdmin) {
        applyTip.className = 'alert a-info';
        applyTip.innerHTML = '创建子域名不会自动写入任何 DNS 记录。<b>管理员特权</b>：申请即时开通、不限数量、可使用 www / mail / admin 等保留域名。';
      } else if (!cfg.requireApproval) {
        applyTip.className = 'alert a-info';
        applyTip.innerHTML = '创建子域名不会自动写入任何 DNS 记录，开通后到「DNS 记录」页按需添加。';
      }
    }
  
    allItems = d.items || [];
    renderPage();                       // 先出列表：下面任何一步出错都不该让用户看不到域名
    try { renderStats(d); } catch (e) {}
    try { fillWelcome(d); } catch (e) {}
  }
  
  /* ---------- 控制台统计与欢迎条 ---------- */
  function renderStats(d) {
    const items = d.items || [];
    const live = items.filter((s) => s.status !== 'rejected');
    const domains = live.length;
    const records = live.reduce((n, s) => n + (Number(s.record_count) || 0), 0);
    const pending = items.filter((s) => s.status === 'pending').length;
  
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('stDomains', domains);
    set('stRecords', records);
    set('stPending', pending);
  
    // 积分（异步，不阻塞）
    api.get('/api/points/me').then((p) => {
      set('stPoints', p.unlimited ? '∞' : p.points);
    }).catch(() => set('stPoints', '—'));
  
  }
  
  /* 欢迎条：自己取当前用户，不依赖骨架返回值（骨架可能先于数据 resolve） */
  async function fillWelcome(d) {
    let me = currentUser;
    if (!me || !me.id) {
      try { const r = await api.get('/api/auth/me'); me = (r && r.user) || r || null; currentUser = me; }
      catch { me = null; }
    }
    if (!me) return;
  
    const items = d.items || [];
    const domains = items.filter((s) => s.status !== 'rejected').length;
    const records = items.filter((s) => s.status !== 'rejected')
      .reduce((n, s) => n + (Number(s.record_count) || 0), 0);
  
    const nm = String(me.email || '').split('@')[0] || '朋友';
    const av = document.getElementById('wAv');
    const hi = document.getElementById('wHi');
    const sub = document.getElementById('wSub');
    const hour = new Date().getHours();
    const greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    if (av) av.textContent = nm.charAt(0).toUpperCase();
    if (hi) hi.textContent = `${greet}，${nm}`;
    if (sub) sub.textContent = [
      me.role === 'admin' ? '管理员' : '普通用户',
      d.quotaUnlimited ? '配额不限' : `配额 ${d.used}/${d.quota}`,
      `${domains} 个域名 · ${records} 条解析`,
    ].join(' · ');
  }
  
  let currentUser = null;
  const PAGE_SIZE = 10;
  let allItems = [];
  let curPage = 1;
  
  function filtered() {
    const kw = (document.getElementById('kw')?.value || '').trim().toLowerCase();
    if (!kw) return allItems;
    return allItems.filter((s) =>
      String(s.fqdn || '').toLowerCase().includes(kw) ||
      String(s.note || '').toLowerCase().includes(kw));
  }
  
  function renderPage() {
    const tb = document.getElementById('list');
    const items = filtered();
    const totalPage = Math.max(Math.ceil(items.length / PAGE_SIZE), 1);
    if (curPage > totalPage) curPage = totalPage;
    const start = (curPage - 1) * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);
  
    if (!items.length) {
      tb.innerHTML = `<tr><td colspan="7" class="empty">${allItems.length ? '没有匹配的域名' : '还没有子域名，先在上方申请一个'}</td></tr>`;
      document.getElementById('pageTip').textContent = '';
      return;
    }
    tb.innerHTML = slice.map((s) => {
  
      const rejected = s.status === 'rejected';
      const note = rejected
        ? `<div class="alert danger" style="margin:6px 0 0;padding:6px 9px;font-size:12px">
             驳回原因：${esc(s.reason || '未说明')}<br>
             <span style="opacity:.85">该域名不占用配额。修正后可释放它再重新申请。</span>
           </div>`
        : s.reason && s.status === 'suspended'
          ? `<div class="hint" style="color:var(--danger)">停用原因：${esc(s.reason)}</div>`
          : s.reason ? `<div class="hint">${esc(s.reason)}</div>` : '';
      const ex = s.expiry || {};
      let expiryHtml = '<span style="color:var(--muted)">—</span>';
      if (s.status === 'approved' || s.status === 'suspended') {
        if (ex.perpetual) expiryHtml = '<span class="badge inf">永久</span>';
        else if (ex.expired) expiryHtml = '<span class="badge danger">已过期</span>';
        else if (ex.canRenew) expiryHtml = `<span class="badge warn">剩 ${ex.daysLeft} 天</span><div class="hint" style="font-size:11px">${fmtDate(ex.expiresAt)} 到期</div>`;
        else expiryHtml = `<span class="badge ok">${ex.daysLeft} 天</span><div class="hint" style="font-size:11px">${fmtDate(ex.expiresAt)} 到期</div>`;
      }
      const canRenew = s.status === 'approved' && ex.canRenew;
      return `
      <tr class="${rejected ? 'rejected' : ''}">
        <td><span class="fqdn"${rejected ? ' style="opacity:.75;text-decoration:line-through"' : ''}>${esc(s.fqdn)}</span>${note}</td>
        <td>${statusBadge(s.status)}${rejected ? '<div class="hint">不占配额</div>' : ''}</td>
        <td class="nowrap" style="color:var(--muted)">.${esc(
          s.root_domain || String(s.fqdn || '').replace(/^[^.]+\./, '') || rootDomain
        )}</td>
        <td>${s.record_count}</td>
        <td class="nowrap" style="color:var(--muted)">${fmtTime(s.created_at)}</td>
        <td class="nowrap">${expiryHtml}</td>
        <td class="right nowrap">
          ${canRenew ? `<button class="btn sm primary" data-renew="${s.id}">续期</button>` : ''}
          ${rejected ? '' : `<button class="btn sm" onclick="location.href='/domain?id=${s.id}'">DNS 记录</button>`}
          <button class="btn sm ${rejected ? '' : 'danger'}" data-del="${s.id}">${rejected ? '移除' : '释放'}</button>
        </td>
      </tr>`;
  
    }).join('');
  
    document.getElementById('pageTip').textContent = `第 ${curPage} / ${totalPage} 页 · 共 ${items.length} 个`;
    document.getElementById('btnPrev').disabled = curPage <= 1;
    document.getElementById('btnNext').disabled = curPage >= totalPage;
  
    // 续期 / 释放按钮（分页后重新绑定）
    tb.querySelectorAll('[data-renew]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await api.post('/api/subdomains/' + b.dataset.renew + '/renew', {});
          toast(`已续期，新到期 ${fmtDate(r.expiresAt)}`);
          load();
        } catch (e) { toast(e.message, 'err'); b.disabled = false; }
      };
    });
    tb.querySelectorAll('[data-del]').forEach((b) => {
      const s = allItems.find((x) => String(x.id) === String(b.dataset.del));
      const rejected = s && s.status === 'rejected';
      b.onclick = async () => {
        const msg = rejected
          ? '移除这条被驳回的申请？移除后可以重新申请该名称。'
          : '确定释放该子域名？其在 Cloudflare 上的所有 DNS 记录会一并删除。';
        if (!confirm(msg)) return;
        try { await api.del('/api/subdomains/' + b.dataset.del); toast(rejected ? '已移除，可重新申请' : '已释放'); load(); }
        catch (e) { toast(e.message, 'err'); }
      };
    });
  }
  
  /* ---------- 多根域名 ---------- */
  let ROOTS = [];
  
  function rootQuery() {
    const r = currentRoot();
    return r ? '&root=' + encodeURIComponent(r) : '';
  }
  
  function currentRoot() {
    const sel = document.getElementById('rootDomainSel');
    if (sel && sel.value) return sel.value;
    return ROOTS[0] || '';
  }
  
  
  
  document.querySelectorAll('[data-quick]').forEach((a) => {
    a.onclick = (e) => {
      const t = a.dataset.quick;
      if (t === 'list') {
        e.preventDefault();
        document.getElementById('listAnchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
  });
  
  document.getElementById('btnSearch').onclick = () => { curPage = 1; renderPage(); };
  document.getElementById('kw').addEventListener('input', () => { curPage = 1; renderPage(); });
  document.getElementById('btnPrev').onclick = () => { if (curPage > 1) { curPage--; renderPage(); } };
  document.getElementById('btnNext').onclick = () => { curPage++; renderPage(); };
  
  
  /* ---------------- 积分 ---------------- */
  let ptData = null;
  
  async function loadPoints() {
    try {
      ptData = await api.get('/api/points/me');
    } catch { return; }
    const d = ptData;
    const card = document.getElementById('pointsCard');
    card.style.display = '';
    document.getElementById('ptVal').innerHTML = d.unlimited
      ? '<span style="font-size:26px">∞ 不限</span>'
      : String(d.points);
    document.getElementById('ptRules').textContent = d.unlimited
      ? '管理员不限积分'
      : `签到 +${d.rules.checkin} · 域名 -${d.rules.domainCost} · 单字域名 -${d.rules.shortCost}`;
  
    const btn = document.getElementById('btnCheckin');
    if (d.unlimited) {
      btn.disabled = true;
      btn.textContent = '管理员不限';
    } else if (d.checkedIn) {
      btn.disabled = true;
      btn.textContent = `今日已签到（${d.today}）`;
    } else {
      btn.disabled = false;
      btn.textContent = `每日签到 +${d.rules.checkin}`;
    }
    const tip = document.getElementById('ptTip');
    tip.textContent = d.unlimited
      ? '管理员申请子域名不消耗积分。'
      : d.checkedIn
        ? `明天可再领 ${d.rules.checkin} 分。单字域名（如 a、1）需 ${d.rules.shortCost} 分兑换。`
        : `今天还没签到，可领 ${d.rules.checkin} 分。单字域名（如 a、1）需 ${d.rules.shortCost} 分兑换。`;
  }
  
  document.getElementById('btnCheckin').onclick = async () => {
    const btn = document.getElementById('btnCheckin');
    btn.disabled = true;
    try {
      const r = await api.post('/api/points/checkin', {});
      toast(`签到成功 +${r.gained}，当前 ${r.points} 分`);
      await loadPoints();
    } catch (e) {
      toast(e.message, 'err');
      await loadPoints();
    }
  };
  
  document.getElementById('btnLogs').onclick = () => {
    const rows = (ptData && ptData.logs) || [];
    const reasonText = {
      checkin: '每日签到', apply: '申请子域名', grant: '开通额度',
      admin_adjust: '管理员调整', admin_set: '管理员设置',
    };
    openModal('积分明细', rows.length ? `
      <div class="tablewrap"><table>
        <thead><tr><th>变动</th><th>余额</th><th>说明</th><th class="right">时间</th></tr></thead>
        <tbody>${rows.map((l) => `
          <tr>
            <td class="mono" style="color:${l.delta >= 0 ? 'var(--ok)' : 'var(--danger)'}">${l.delta >= 0 ? '+' : ''}${l.delta}</td>
            <td class="mono">${l.balance}</td>
            <td>${esc(reasonText[l.reason] || l.reason)}${l.detail ? ` · ${esc(l.detail)}` : ''}</td>
            <td class="right nowrap" style="color:var(--muted)">${fmtTime(l.created_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="empty">暂无记录</div>');
  };
  
  // 从 WHOIS / 落地页带名称过来：/dashboard?apply=xxx 或 ?label=xxx
  // 申请表单已独立成页，这里直接带名称跳过去
  (function () {
    const ps = new URLSearchParams(location.search);
    const pre = ps.get('apply') || ps.get('label');
    if (pre) location.replace('/register?label=' + encodeURIComponent(pre));
  })();
  
  document.getElementById('btnPwd').onclick = () => {
    openModal('修改密码', `
      <div class="field"><label>原密码</label><input id="op" type="password"></div>
      <div class="field"><label>新密码（至少 8 位）</label><input id="np" type="password"></div>
      <div class="row end"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="okPwd">保存</button></div>`);
    document.getElementById('okPwd').onclick = async () => {
      try {
        await api.post('/api/auth/password', { oldPassword: document.getElementById('op').value, newPassword: document.getElementById('np').value });
        toast('已更新，其它设备已下线'); closeModal();
      } catch (e) { toast(e.message, 'err'); }
    };
  };
  
  mountShell('domains').then(async (me) => {
    currentUser = me || null;
    applyBranding(await loadBranding());
    /* 注意：这里曾调用 setupRoots()，但该函数只定义在 register.html，
       dashboard 里是未定义引用 → ReferenceError 被下面的 catch 静默吞掉，
       load() 永远不执行，列表就一直停在「加载中…」。
       dashboard 的根域名由 load() 内自己的 /api/config 取得，无需 setupRoots。 */
    load().catch((e) => {
      const tb = document.getElementById('list');
      if (tb) tb.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--danger)">加载失败：${esc(e && e.message || e)}</td></tr>`;
      toast('域名列表加载失败：' + ((e && e.message) || e), 'err');
    });
    loadPoints().catch(() => {});
  }).catch((e) => { console.error('shell 初始化失败', e); });
  
}
