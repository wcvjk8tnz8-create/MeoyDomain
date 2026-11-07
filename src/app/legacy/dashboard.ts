/**
 * Dashboard 页面控制器（由 dashboard.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 *
 * ── 首屏「一次性就绪」──────────────────────────────────────────
 * 以前 subdomains / config / points / auth / profile 各自 await、各自
 * .then 写 DOM：骨架先露「0 / 欢迎回来 / 默认 Miku」，第一批回来补统计，
 * 第二批补配额与积分卡，第三批再补问候语、头像、顶栏头像 ——
 * 就是用户看到的「一阶段、二阶段、三阶段慢慢加载出来」。
 * 现在五个数据源一次并行出发，全部结算后由 renderAll() 同步写完整个
 * 页面，中间不 await、不 .then；refreshRuntime() 再统一放出页面。
 */
import {
  api, esc, fmtTime, fmtDate, toast, openModal, closeModal,
  loadBranding, applyBranding, statusBadge, mountShell, renderAvatars,
} from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

const DEFAULT_AV = '/img/avatar/miku-headset.webp';

export async function mountDashboard(_root: HTMLElement | null): Promise<void> {
  let rootDomain = '';
  let currentUser: any = null;
  let lastSnap: any = null;
  const PAGE_SIZE = 10;
  let allItems: any[] = [];
  let curPage = 1;
  let ptData: any = null;

  /** 首屏快照：五个接口同时出发，任一失败只降级该项，不拖垮整屏。 */
  async function snapshot() {
    const settle = (p: Promise<any>) => p.catch(() => null);
    const [subs, cfg, points, me, prof] = await Promise.all([
      settle(api.get('/api/subdomains')),
      settle(api.get('/api/config')),
      settle(api.get('/api/points/me')),
      settle(api.get('/api/auth/me')),
      settle(api.get('/api/profile')),
    ]);
    return { subs: subs || {}, cfg: cfg || {}, points, me, prof };
  }

  /** 写操作后局部刷新：只重拉列表与积分，其余沿用上次快照。 */
  async function reload() {
    const [subs, points] = await Promise.all([
      api.get('/api/subdomains').catch(() => (lastSnap && lastSnap.subs) || {}),
      api.get('/api/points/me').catch(() => (lastSnap && lastSnap.points) || null),
    ]);
    renderAll({ ...(lastSnap || {}), subs, points }, currentUser);
  }

  function isAdminNav() {
    return document.querySelector('.navlink[href="/admin"]') !== null;
  }

  /* ---------- 一次性渲染整屏（同步，无任何中间态） ---------- */
  function renderAll(snap: any, shellMe: any) {
    lastSnap = snap;
    const d = snap.subs || {};
    const cfg = snap.cfg || {};
    const items = d.items || [];
    const me = shellMe || (snap.me && (snap.me.user || snap.me)) || currentUser || null;
    currentUser = me;
    rootDomain = cfg.rootDomain || '';
    const isAdmin = !!(me && me.role === 'admin') || isAdminNav();
    const avatar = (snap.prof && snap.prof.profile && snap.prof.profile.avatar) || DEFAULT_AV;

    /* 后台暂停新申请：引导卡直接说明，普通用户不再往注册页跳 */
    const cardHint = document.getElementById('applyCardHint');
    const goReg = document.getElementById('goRegister');
    if (cardHint && cfg.applyPaused) {
      cardHint.className = 'alert a-warn';
      cardHint.innerHTML = '<b>新域名申请已暂停</b><br>' + esc(cfg.applyPausedMessage || '请稍后再试。')
        + '<br><span style="opacity:.8;font-size:12px">已注册的域名、DNS 记录与续期不受影响。</span>';
      if (goReg && !isAdmin) { goReg.textContent = '申请已暂停'; goReg.removeAttribute('href'); goReg.style.opacity = '.5'; goReg.style.pointerEvents = 'none'; }
    }
    const rdEl = document.getElementById('rootDomain');
    if (rdEl) rdEl.textContent = rootDomain;

    const live = items.filter((s) => s.status !== 'rejected');
    const domains = live.length;
    const records = live.reduce((n, s) => n + (Number(s.record_count) || 0), 0);
    const pending = items.filter((s) => s.status === 'pending').length;

    /* 欢迎卡：问候语、副标题、头像一次写完 */
    const nm = String((me && me.email) || '').split('@')[0] || '朋友';
    const hour = new Date().getHours();
    const greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    const av = document.getElementById('wAv');
    if (av instanceof HTMLImageElement) {
      av.onerror = () => { av.onerror = null; av.src = DEFAULT_AV; };
      av.src = avatar;
      av.alt = nm;
    } else if (av) {
      av.textContent = nm.charAt(0).toUpperCase();
    }
    const hi = document.getElementById('wHi');
    const sub = document.getElementById('wSub');
    if (hi) hi.textContent = `${greet}，${nm}`;
    if (sub) sub.textContent = [
      (me && me.role === 'admin') ? '管理员' : '普通用户',
      d.quotaUnlimited ? '配额不限' : `配额 ${d.used}/${d.quota}`,
      `${domains} 个域名 · ${records} 条解析`,
    ].join(' · ');

    /* 配额提示 */
    const quotaHtml = d.quotaUnlimited ? '<span class="badge inf">∞ 不限</span>' : `${d.quota} 个`;
    let tip = isAdmin
      ? ' · 管理员申请即时开通，可占用保留域名且不限数量'
      : cfg.requireApproval ? ' · 新申请需管理员审核' : ' · 即时生效';
    if (d.rejected > 0) tip += ` · 另有 ${d.rejected} 个被驳回（不占配额）`;
    const quotaTip = document.getElementById('quotaTip');
    if (quotaTip) quotaTip.innerHTML = `已使用 ${d.used} / ${quotaHtml}` + tip;

    /* 申请提示（表单已移至 /register） */
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

    /* 四张统计卡：积分也从快照里拿，不再另发请求异步补 */
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('stDomains', domains);
    set('stRecords', records);
    set('stPending', pending);
    set('stPoints', snap.points ? (snap.points.unlimited ? '∞' : snap.points.points) : '—');

    /* 积分卡与列表：和欢迎卡同一帧写完 */
    renderPoints(snap.points);
    allItems = items;
    renderPage();
  }

  /* ---------- 积分卡（纯渲染，不再自己发请求） ---------- */
  function renderPoints(d: any) {
    if (!d) return;                       // 接口失败就保持隐藏，不显示误导性的 0
    ptData = d;
    const rules = d.rules || {};
    const card = document.getElementById('pointsCard');
    if (card) card.style.display = '';
    const val = document.getElementById('ptVal');
    if (val) val.innerHTML = d.unlimited
      ? '<span style="font-size:26px">∞ 不限</span>'
      : String(d.points);
    const ptRules = document.getElementById('ptRules');
    if (ptRules) ptRules.textContent = d.unlimited
      ? '管理员不限积分'
      : `签到 +${rules.checkin} · 域名 -${rules.domainCost} · 单字域名 -${rules.shortCost}`;

    const btn = document.getElementById('btnCheckin') as HTMLButtonElement | null;
    if (btn) {
      if (d.unlimited) {
        btn.disabled = true;
        btn.textContent = '管理员不限';
      } else if (d.checkedIn) {
        btn.disabled = true;
        btn.textContent = `今日已签到（${d.today}）`;
      } else {
        btn.disabled = false;
        btn.textContent = `每日签到 +${rules.checkin}`;
      }
    }
    const tip = document.getElementById('ptTip');
    if (tip) tip.textContent = d.unlimited
      ? '管理员申请子域名不消耗积分。'
      : d.checkedIn
        ? `明天可再领 ${rules.checkin} 分。单字域名（如 a、1）需 ${rules.shortCost} 分兑换。`
        : `今天还没签到，可领 ${rules.checkin} 分。单字域名（如 a、1）需 ${rules.shortCost} 分兑换。`;
  }

  /* ---------- 列表 / 搜索 / 分页 ---------- */
  function filtered() {
    const kw = ((document.getElementById('kw') as HTMLInputElement | null)?.value || '').trim().toLowerCase();
    if (!kw) return allItems;
    return allItems.filter((s) =>
      String(s.fqdn || '').toLowerCase().includes(kw) ||
      String(s.note || '').toLowerCase().includes(kw));
  }

  function renderPage() {
    const tb = document.getElementById('list');
    if (!tb) return;
    const items = filtered();
    const totalPage = Math.max(Math.ceil(items.length / PAGE_SIZE), 1);
    if (curPage > totalPage) curPage = totalPage;
    const start = (curPage - 1) * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);

    if (!items.length) {
      tb.innerHTML = `<tr><td colspan="7" class="empty">${allItems.length ? '没有匹配的域名' : '还没有子域名，先在上方申请一个'}</td></tr>`;
      const pt = document.getElementById('pageTip');
      if (pt) pt.textContent = '';
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

    const pt = document.getElementById('pageTip');
    if (pt) pt.textContent = `第 ${curPage} / ${totalPage} 页 · 共 ${items.length} 个`;
    const prev = document.getElementById('btnPrev') as HTMLButtonElement | null;
    const next = document.getElementById('btnNext') as HTMLButtonElement | null;
    if (prev) prev.disabled = curPage <= 1;
    if (next) next.disabled = curPage >= totalPage;

    // 续期 / 释放按钮（分页后重新绑定）
    tb.querySelectorAll('[data-renew]').forEach((b) => {
      (b as HTMLButtonElement).onclick = async () => {
        const btn = b as HTMLButtonElement;
        btn.disabled = true;
        try {
          const r = await api.post('/api/subdomains/' + btn.dataset.renew + '/renew', {});
          toast(`已续期，新到期 ${fmtDate(r.expiresAt)}`);
          reload();
        } catch (e) { toast((e as Error).message, 'err'); btn.disabled = false; }
      };
    });
    tb.querySelectorAll('[data-del]').forEach((b) => {
      const btn = b as HTMLButtonElement;
      const s = allItems.find((x) => String(x.id) === String(btn.dataset.del));
      const rejected = s && s.status === 'rejected';
      btn.onclick = async () => {
        const msg = rejected
          ? '移除这条被驳回的申请？移除后可以重新申请该名称。'
          : '确定释放该子域名？其在 Cloudflare 上的所有 DNS 记录会一并删除。';
        if (!confirm(msg)) return;
        try { await api.del('/api/subdomains/' + btn.dataset.del); toast(rejected ? '已移除，可重新申请' : '已释放'); reload(); }
        catch (e) { toast((e as Error).message, 'err'); }
      };
    });
  }

  /* ---------- 快捷入口 ---------- */
  document.querySelectorAll('[data-quick]').forEach((a) => {
    (a as HTMLElement).onclick = (e) => {
      if ((a as HTMLElement).dataset.quick === 'list') {
        e.preventDefault();
        document.getElementById('listAnchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
  });

  const btnSearch = document.getElementById('btnSearch');
  if (btnSearch) btnSearch.onclick = () => { curPage = 1; renderPage(); };
  const kw = document.getElementById('kw');
  if (kw) kw.addEventListener('input', () => { curPage = 1; renderPage(); });
  const btnPrev = document.getElementById('btnPrev');
  if (btnPrev) btnPrev.onclick = () => { if (curPage > 1) { curPage--; renderPage(); } };
  const btnNext = document.getElementById('btnNext');
  if (btnNext) btnNext.onclick = () => { curPage++; renderPage(); };

  /* ---------- 签到 / 积分明细 ---------- */
  const btnCheckin = document.getElementById('btnCheckin');
  if (btnCheckin) btnCheckin.onclick = async () => {
    const btn = btnCheckin as HTMLButtonElement;
    btn.disabled = true;
    try {
      const r = await api.post('/api/points/checkin', {});
      toast(`签到成功 +${r.gained}，当前 ${r.points} 分`);
    } catch (e) { toast((e as Error).message, 'err'); }
    // 写操作已清共享缓存，这里拿到的一定是签到后的最新值
    try { renderPoints(await api.get('/api/points/me')); } catch { /* 保留当前值 */ }
  };

  const btnLogs = document.getElementById('btnLogs');
  if (btnLogs) btnLogs.onclick = () => {
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
            <td class="cell-detail" title="${esc([reasonText[l.reason] || l.reason, l.detail].filter(Boolean).join(' · '))}">${esc(reasonText[l.reason] || l.reason)}${l.detail ? ` · ${esc(l.detail)}` : ''}</td>
            <td class="right nowrap" style="color:var(--muted)">${fmtTime(l.created_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : '<div class="empty">暂无记录</div>');
  };

  // 从 WHOIS / 落地页带名称过来：/dashboard?apply=xxx 或 ?label=xxx
  (function () {
    const ps = new URLSearchParams(location.search);
    const pre = ps.get('apply') || ps.get('label');
    if (pre) location.replace('/register?label=' + encodeURIComponent(pre));
  })();

  const btnPwd = document.getElementById('btnPwd');
  if (btnPwd) btnPwd.onclick = () => {
    openModal('修改密码', `
      <div class="field"><label>原密码</label><input id="op" type="password"></div>
      <div class="field"><label>新密码（至少 8 位）</label><input id="np" type="password"></div>
      <div class="row end"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="okPwd">保存</button></div>`);
    const okPwd = document.getElementById('okPwd');
    if (okPwd) okPwd.onclick = async () => {
      try {
        await api.post('/api/auth/password', { oldPassword: (document.getElementById('op') as HTMLInputElement).value, newPassword: (document.getElementById('np') as HTMLInputElement).value });
        toast('已更新，其它设备已下线'); closeModal();
      } catch (e) { toast((e as Error).message, 'err'); }
    };
  };

  /* ── 首屏：快照、骨架、字体并行；全部到齐后一次渲染 ──
     不再 mountShell().then() 里 fire-and-forget 地分波写 DOM，
     mountDashboard 真的 await 完整流程，refreshRuntime() 才会宣告就绪。 */
  const [snap, shellMe, brand] = await Promise.all([
    snapshot(),
    mountShell('domains', { deferAvatar: true }),
    loadBranding().catch(() => null),
  ]);
  if (brand) applyBranding(brand);

  renderAll(snap, shellMe);
  // 顶栏头像与欢迎卡头像同一帧落地，不再「先默认 Miku → 再异步替换」
  renderAvatars((snap.prof && snap.prof.profile && snap.prof.profile.avatar) || '');
}
