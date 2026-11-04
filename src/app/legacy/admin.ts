/**
 * Admin 页面控制器（由 admin.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, esc, fmtTime, toast, openModal, closeModal, loadBranding, applyBranding, statusBadge, mountShell } from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

export async function mountAdmin(_root: HTMLElement | null): Promise<void> {
  
  let tab = 'pending';
  
  const HEADS = {
    pending: ['域名', '申请人', '用途', '时间', '操作'],
    subs: ['域名', '申请人', '状态', '记录', '时间', '操作'],
    users: ['邮箱', '角色', '状态', '配额', '域名数', '积分', '操作'],
    locks: ['记录名', '类型', '发起人', '锁定时间', '操作'],
    settings: ['站点品牌', '值'],
    ips: ['IP', '账号数', '邮箱', '最近注册', '状态', '操作'],
    audit: ['时间', '用户', '动作', '对象', '详情'],
  };
  
  
  /* ---------- Spaceship 域名选择弹窗 ----------
     拉取后不直接添加，先把账号下所有域名列出来让管理员勾选，
     并可顺手填 Cloudflare Zone ID（做 DNS 解析时需要）。 */
  function openSpaceshipPicker(items, showRoots) {
    let mask = document.getElementById('spMask');
    if (mask) mask.remove();
    mask = document.createElement('div');
    mask.id = 'spMask';
    mask.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(20,28,50,.45);display:grid;place-items:center;padding:16px';
    const rows = items.map((it, i) => `
      <label class="sp-row" style="display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--line);cursor:${it.alreadyAdded ? 'default' : 'pointer'}">
        <input type="checkbox" class="sp-chk" data-i="${i}" ${it.alreadyAdded ? 'disabled' : ''} style="width:16px;height:16px;flex-shrink:0">
        <span style="flex:1;min-width:0">
          <b class="mono">${esc(it.domain)}</b>
          ${it.alreadyAdded ? '<span class="badge ok" style="margin-left:8px">已添加</span>' : ''}
          <div class="hint" style="margin-top:2px">${it.expirationDate ? '到期 ' + esc(String(it.expirationDate).slice(0, 10)) : 'Spaceship 账号域名'}${it.hasZone ? ' · 已配 Zone' : ''}</div>
        </span>
        ${it.alreadyAdded ? '' : `<input class="input sp-zone" data-i="${i}" placeholder="CF Zone ID（可选）" style="width:170px;padding:6px 9px;font-size:12px">`}
      </label>`).join('');
    mask.innerHTML = `
      <div style="background:#fff;border-radius:18px;width:min(640px,96vw);max-height:86vh;display:flex;flex-direction:column;box-shadow:0 18px 50px rgba(20,28,50,.25);overflow:hidden">
        <div style="padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px">
          <b style="font-size:16px">从 Spaceship 添加根域名</b>
          <span class="dim" style="margin-left:auto;font-size:12px">共 ${items.length} 个</span>
        </div>
        <div style="padding:6px 20px;overflow-y:auto;flex:1">
          ${items.length ? rows : '<div class="empty" style="padding:40px 0">账号下没有域名</div>'}
          <div class="hint" style="padding:12px 4px">勾选后即为本站可用根域名。若要用 Cloudflare 做 DNS 解析，请把该域名 NS 指向 Cloudflare 并填入对应 Zone ID（也可稍后在环境变量配置）。</div>
        </div>
        <div style="padding:14px 20px;border-top:1px solid var(--line);display:flex;justify-content:flex-end;gap:10px">
          <button class="btn" id="spCancel">取消</button>
          <button class="btn primary" id="spAdd">添加选中</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
  
    const close = () => mask.remove();
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
    document.getElementById('spCancel').onclick = close;
    document.getElementById('spAdd').onclick = async () => {
      const picked = [];
      mask.querySelectorAll('.sp-chk:checked').forEach((cb) => {
        const i = Number(cb.dataset.i);
        const z = mask.querySelector('.sp-zone[data-i="' + i + '"]');
        picked.push({ domain: items[i].domain, zoneId: z ? z.value.trim() : '' });
      });
      if (!picked.length) return toast('请先勾选要添加的域名', 'err');
      const btn = document.getElementById('spAdd');
      btn.disabled = true; btn.textContent = '添加中…';
      try {
        const r = await api.post('/api/admin/spaceship/add', { domains: picked });
        toast('已添加：' + r.added.join('、') + (r.skipped.length ? '（跳过已存在 ' + r.skipped.length + ' 个）' : ''));
        if (showRoots) showRoots(r.rootDomains);
        close();
      } catch (e) {
        btn.disabled = false; btn.textContent = '添加选中';
        toast(e.message, 'err');
      }
    };
  }
  
  async function load() {
    const s = await api.get('/api/admin/stats');
    document.getElementById('stats').innerHTML = [
      ['用户', s.users], ['已开通域名', s.subdomains], ['待审核', s.pending], ['DNS 记录', s.records], ['验证锁定', s.locked],
    ].map(([l, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')
     + `<div class="stat"><div class="v" style="font-size:13px;font-family:var(--mono)">${esc(s.rootDomain)}</div><div class="l">根域名${s.mock ? ' · MOCK' : ''}</div></div>`;
    document.getElementById('envTip').textContent = s.mock
      ? '当前为 MOCK 模式：DNS 记录只写入内存，不会真正调用 Cloudflare。'
      : 'DNS 记录按各根域名配置的后端实时同步（Cloudflare / Spaceship）。';
  
    document.getElementById('thead').innerHTML = '<tr>' + HEADS[tab].map((h) => `<th>${h}</th>`).join('') + '</tr>';
    const tb = document.getElementById('tbody');
  
    if (tab === 'pending' || tab === 'subs') {
      const d = await api.get('/api/admin/subdomains' + (tab === 'pending' ? '?status=pending' : ''));
      if (!d.items.length) return tb.innerHTML = `<tr><td colspan="6" class="empty">暂无数据</td></tr>`;
      tb.innerHTML = d.items.map((s) => `
        <tr>
          <td><span class="fqdn">${esc(s.fqdn)}</span>${s.reason ? `<div class="hint">${esc(s.reason)}</div>` : ''}</td>
          <td class="mono" style="color:var(--muted)">${esc(s.owner_email)}</td>
          ${tab === 'pending' ? `<td>${esc(s.note || '-')}</td>` : `<td>${statusBadge(s.status)}</td><td>${s.record_count}</td>`}
          <td class="nowrap" style="color:var(--muted)">${fmtTime(s.created_at)}</td>
          <td class="right nowrap">
            ${s.status !== 'approved' ? `<button class="btn sm ok" data-act="approve" data-id="${s.id}">通过</button>` : ''}
            ${s.status !== 'rejected' ? `<button class="btn sm" data-act="reject" data-id="${s.id}">驳回</button>` : ''}
            ${s.status === 'approved' ? `<button class="btn sm danger" data-act="suspend" data-id="${s.id}">停用</button>` : ''}
            ${s.status === 'suspended' ? `<button class="btn sm ok" data-act="restore" data-id="${s.id}">恢复</button>` : ''}
            <button class="btn sm" onclick="location.href='/domain?id=${s.id}'">记录</button>
            <button class="btn sm danger" data-act="del" data-id="${s.id}">删除</button>
          </td>
        </tr>`).join('');
      bindSubActions(tb);
    }
  
    if (tab === 'users') {
      const d = await api.get('/api/admin/users');
      tb.innerHTML = d.items.map((u) => `
        <tr>
          <td class="mono">${esc(u.email)}</td>
          <td>${u.role === 'admin' ? '<span class="badge type">admin</span>' : '<span class="badge">user</span>'}</td>
          <td>${u.status === 'banned' ? `<span class="badge danger">已封禁</span><div class="hint">${esc(u.ban_reason || '')}</div>` : '<span class="badge ok">正常</span>'}</td>
          <td>${u.quotaUnlimited ? '<span class="badge inf">∞ 不限</span>' : u.quota}</td>
          <td>${u.sub_count}</td>
          <td class="mono">${u.points === -1 ? '<span class="badge inf">∞</span>' : (u.points === null ? '<span style="color:var(--muted)">—</span>' : u.points)}</td>
          <td class="right nowrap">
            <button class="btn sm" data-points="${u.id}" data-email="${esc(u.email)}" data-p="${u.points ?? ''}" data-role="${u.role}">积分</button>
            <button class="btn sm" data-quota="${u.id}" data-email="${esc(u.email)}" data-q="${u.quota}" data-role="${u.role}">配额/角色</button>
            ${u.status === 'banned'
              ? `<button class="btn sm ok" data-unban="${u.id}">解封</button>`
              : `<button class="btn sm danger" data-ban="${u.id}" data-email="${esc(u.email)}">封禁</button>`}
          </td>
        </tr>`).join('');
      tb.querySelectorAll('[data-points]').forEach((b) => b.onclick = () => {
        if (b.dataset.role === 'admin') return toast('管理员积分不限，无需调整', 'err');
        openModal('调整积分 · ' + b.dataset.email, `
          <div class="field"><label>设置为</label><input id="pset" type="number" value="${b.dataset.p || 0}"><div class="hint">直接指定最终余额</div></div>
          <div class="field"><label>或增减</label><input id="pdelta" type="number" placeholder="如 +20 或 -5"><div class="hint">填了这项则忽略上面的「设置为」</div></div>
          <div class="field"><label>备注</label><input id="preason" placeholder="选填"></div>
          <div class="row end"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="pok">保存</button></div>`);
        document.getElementById('pok').onclick = async () => {
          const delta = document.getElementById('pdelta').value.trim();
          const body = delta
            ? { delta: Number(delta), reason: document.getElementById('preason').value.trim() }
            : { set: Number(document.getElementById('pset').value), reason: document.getElementById('preason').value.trim() };
          try { await api.post('/api/admin/users/' + b.dataset.points + '/points', body); toast('已保存'); closeModal(); load(); }
          catch (e) { toast(e.message, 'err'); }
        };
      });
      tb.querySelectorAll('[data-quota]').forEach((b) => b.onclick = () => {
        openModal('调整 ' + b.dataset.email, `
          <div class="field"><label>子域名配额</label><input id="q" type="number" value="${b.dataset.q}"><div class="hint">填 -1 表示不限量</div></div>
          <div class="field"><label>角色</label><select id="r"><option value="user" ${b.dataset.role === 'user' ? 'selected' : ''}>user</option><option value="admin" ${b.dataset.role === 'admin' ? 'selected' : ''}>admin</option></select></div>
          <div class="row end"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="ok">保存</button></div>`);
        document.getElementById('ok').onclick = async () => {
          try { await api.post('/api/admin/users/' + b.dataset.quota + '/quota', { quota: Number(document.getElementById('q').value), role: document.getElementById('r').value }); toast('已保存'); closeModal(); load(); }
          catch (e) { toast(e.message, 'err'); }
        };
      });
      tb.querySelectorAll('[data-ban]').forEach((b) => b.onclick = () => {
        openModal('封禁 ' + b.dataset.email, `
          <div class="alert danger">封禁后该用户立即下线、无法登录，其全部子域名停用。</div>
          <div class="field"><label>封禁原因</label><input id="rs" placeholder="违规使用"></div>
          <label class="check" style="margin-bottom:12px"><input type="checkbox" id="pg"> 同时清空其在 Cloudflare 上的全部 DNS 记录</label>
          <div class="row end"><button class="btn" onclick="closeModal()">取消</button><button class="btn danger" id="ok">确认封禁</button></div>`);
        document.getElementById('ok').onclick = async () => {
          try { await api.post('/api/admin/users/' + b.dataset.ban + '/ban', { reason: document.getElementById('rs').value, purgeDns: document.getElementById('pg').checked }); toast('已封禁'); closeModal(); load(); }
          catch (e) { toast(e.message, 'err'); }
        };
      });
      tb.querySelectorAll('[data-unban]').forEach((b) => b.onclick = async () => {
        try { await api.post('/api/admin/users/' + b.dataset.unban + '/unban', {}); toast('已解封'); load(); } catch (e) { toast(e.message, 'err'); }
      });
    }
  
    if (tab === 'locks') {
      const d = await api.get('/api/admin/locks');
      if (!d.items.length) return tb.innerHTML = `<tr><td colspan="5" class="empty">当前没有处于锁定状态的验证记录</td></tr>`;
      tb.innerHTML = d.items.map((r) => `
        <tr class="locked">
          <td class="mono">${esc(r.name)}</td>
          <td><span class="badge type">${esc(r.type)}</span></td>
          <td class="mono" style="color:var(--muted)">${esc(r.owner_email)}</td>
          <td class="nowrap" style="color:var(--muted)">${fmtTime(r.locked_at)}</td>
          <td class="right nowrap">
            <button class="btn sm" data-unlock="${r.id}" data-keep="1">仅解锁</button>
            <button class="btn sm danger" data-unlock="${r.id}" data-keep="0">解锁并删除</button>
          </td>
        </tr>`).join('');
      tb.querySelectorAll('[data-unlock]').forEach((b) => b.onclick = async () => {
        try { await api.post('/api/records/' + b.dataset.unlock + '/force-unlock', { delete: b.dataset.keep !== '1' }); toast('已强制解锁'); load(); }
        catch (e) { toast(e.message, 'err'); }
      });
    }
  
    if (tab === 'ips') {
      const d = await api.get('/api/admin/ips');
      if (!d.items.length) {
        tb.innerHTML = `<tr><td colspan="6" class="empty">暂无注册 IP 记录</td></tr>`;
        return;
      }
      tb.innerHTML = d.items.map((r) => {
        const emails = (r.emails || '').split(',').filter(Boolean);
        const shown = emails.slice(0, 3).join('、') + (emails.length > 3 ? ` 等 ${emails.length} 个` : '');
        const badge = r.ipBanned
          ? `<span class="badge danger">IP 已封禁</span>`
          : r.overLimit
            ? `<span class="badge danger">超限</span>`
            : '<span class="badge ok">正常</span>';
        return `
        <tr class="${r.overLimit && !r.ipBanned ? 'locked' : ''}">
          <td class="mono">${esc(r.ip)}</td>
          <td><b>${r.accounts}</b> <span style="color:var(--muted)">/ ${d.limit}</span></td>
          <td class="mono" style="font-size:11.5px;max-width:280px">${esc(shown)}</td>
          <td class="nowrap" style="color:var(--muted)">${fmtTime(r.last_at)}</td>
          <td>${badge}${r.banned_count ? `<div class="hint">已封 ${r.banned_count} 个</div>` : ''}</td>
          <td class="right nowrap">
            ${r.ipBanned
              ? `<button class="btn sm ok" data-ipunban="${esc(r.ip)}">解封 IP</button>`
              : `<button class="btn sm danger" data-ipban="${esc(r.ip)}" data-n="${r.accounts}">封禁全部</button>`}
          </td>
        </tr>`;
      }).join('');
  
      tb.querySelectorAll('[data-ipban]').forEach((b) => b.onclick = () => {
        const ip = b.dataset.ipban;
        openModal('封禁该 IP 下的全部账号', `
          <div class="alert danger">将封禁 <b>${ip}</b> 下的 ${b.dataset.n} 个账号：立即踢下线、停用其全部子域名。管理员账号不会被封。</div>
          <div class="field"><label>封禁原因</label><input id="ipr" value="同一 IP 注册账号超限，违反服务条款"></div>
          <label class="check" style="margin-bottom:8px"><input type="checkbox" id="ipb" checked> 同时封禁该 IP（禁止再注册/登录）</label>
          <label class="check" style="margin-bottom:14px"><input type="checkbox" id="ipp"> 同时清空其在 Cloudflare 上的全部 DNS 记录</label>
          <div class="row end">
            <button class="btn" onclick="closeModal()">取消</button>
            <button class="btn danger" id="ok">确认封禁</button>
          </div>`);
        document.getElementById('ok').onclick = async () => {
          try {
            const r = await api.post('/api/admin/ips/ban', {
              ip,
              reason: document.getElementById('ipr').value,
              banIp: document.getElementById('ipb').checked,
              purgeDns: document.getElementById('ipp').checked,
            });
            toast(`已封禁 ${r.banned} 个账号` + (r.purged ? `，清空 ${r.purged} 条 DNS` : ''));
            closeModal(); load();
          } catch (e) { toast(e.message, 'err'); }
        };
      });
      tb.querySelectorAll('[data-ipunban]').forEach((b) => b.onclick = async () => {
        try { await api.post('/api/admin/ips/unban', { ip: b.dataset.ipunban }); toast('已解除 IP 封禁'); load(); }
        catch (e) { toast(e.message, 'err'); }
      });
      return;
    }
  
    if (tab === 'settings') {
      const d = await api.get('/api/admin/settings');
      const s = d.items;
      tb.innerHTML = `
        <tr>
          <td style="width:88px;vertical-align:top">
            <img class="logo-preview" src="${esc(s.logo_url || '/img/logo.jpg')}" alt="logo">
            <div class="hint" style="margin-top:6px">当前预览</div>
          </td>
          <td>
            <div class="grid2" style="margin-bottom:10px">
              <div class="field" style="margin:0"><label>站点名称</label><input id="sName" value="${esc(s.site_name || 'TerraDomain')}" placeholder="TerraDomain"></div>
              <div class="field" style="margin:0"><label>Logo 地址</label><input id="sLogo" value="${esc(s.logo_url || '')}" placeholder="/img/logo.jpg"></div>
            </div>
            <div class="grid2" style="margin-bottom:12px">
              <div class="field" style="margin:0"><label>图标地址（favicon）</label><input id="sFav" value="${esc(s.favicon_url || '')}" placeholder="/favicon.ico"></div>
              <div class="field" style="margin:0"><label>站点公告</label><input id="sAnno" value="${esc(s.announcement || '')}" placeholder="留空则不显示"></div>
            </div>
            <div class="field">
              <label>同一 IP 最多注册账号数</label>
              <input id="sIpLimit" type="number" min="1" max="50" value="${esc(s.max_accounts_per_ip || '2')}" style="max-width:160px">
              <div class="hint">超出限制注册的账号，可在「同 IP 账号」页一键全部封禁。管理员账号不受影响。</div>
            </div>
            <div class="field">
              <label>域名有效期</label>
              <div class="grid2">
                <div><span class="dim">新域名有效期（天）</span><input id="sValidDays" type="number" min="1" max="3650" value="365"></div>
                <div><span class="dim">到期前可续期天数</span><input id="sRenewWindow" type="number" min="0" max="3650" value="180"></div>
              </div>
              <div class="hint">迁移前已注册的域名已设为<b>永久有效</b>，不追溯有效期。</div>
            </div>
            <div class="field">
              <label>DNS 提供商 API（可选 · 突破 200 条记录限制）</label>
              <div class="field" style="margin:0 0 8px">
                <span class="dim">API URL</span>
                <input id="sDnsUrl" type="text" autocomplete="off" placeholder="https://api.example.com/v1">
                <div class="hint">留空则使用 Cloudflare（免费版单区域上限约 200 条记录）。
                  填写后所有 DNS 读写走该接口；支持 <span class="mono">{zone}</span> 占位符，例如
                  <span class="mono">https://api.example.com/zones/{zone}/dns_records</span>。</div>
              </div>
              <div class="grid2">
                <div><span class="dim">API Key</span><input id="sDnsKey" type="text" autocomplete="off" placeholder="留空则不修改"></div>
                <div><span class="dim">API Secret</span><input id="sDnsSecret" type="password" autocomplete="new-password" placeholder="留空则不修改"></div>
              </div>
              <div class="hint" id="dnsProvHint"></div>
            </div>
            <div class="field">
              <label>邮件服务与验证码（Resend / Brevo）</label>
              <div class="grid2">
                <div>
                  <span class="dim">服务商</span>
                  <select id="sMailProvider">
                    <option value="">未启用</option>
                    <option value="resend">Resend</option>
                    <option value="brevo">Brevo</option>
                  </select>
                </div>
                <div><span class="dim">发件人邮箱</span><input id="sMailFrom" placeholder="verify@meoy.top"></div>
              </div>
              <div class="field" style="margin:8px 0 0">
                <span class="dim">API Key</span>
                <input id="sMailKey" type="password" autocomplete="new-password" placeholder="留空则不修改">
                <div class="hint" id="mailHint">发件人需先在服务商处完成域名验证（SPF / DKIM）。</div>
              </div>
              <label class="check" style="margin:8px 0 0">
                <input type="checkbox" id="sMailVerifyRequired">
                <span>注册账号需要邮箱验证码</span>
              </label>
              <div class="hint">未配置邮件服务时，忘记密码验证码功能不可用（会提示联系管理员）。</div>
            </div>
            <div class="field">
              <label>R2 头像公网地址（可选）</label>
              <input id="sR2PublicUrl" placeholder="https://img.meoy.top">
              <div class="hint">留空则头像通过 <span class="mono">/api/avatar/&lt;key&gt;</span> 由 Worker 代理读取（桶无需公开）。
                填写后上传的头像直接外链到该地址，可省 Worker 流量。当前状态：<span id="r2Hint" class="dim">读取中…</span></div>
            </div>
            <div class="field">
              <label>AI 自动审核（Agnes AI · OpenAI 兼容）</label>
              <label class="check" style="margin:0 0 8px">
                <input type="checkbox" id="sAiEnabled">
                <span>启用自动审核（仅对下方根域名生效；通过后无需管理员同意）</span>
              </label>
              <div class="grid2">
                <div><span class="dim">接口地址</span><input id="sAiUrl" placeholder="https://apihub.agnes-ai.com/v1"></div>
                <div><span class="dim">模型（留空自动探测）</span><input id="sAiModel" placeholder="留空读取 /models"></div>
              </div>
              <div class="field" style="margin:8px 0 0">
                <span class="dim">API Key</span>
                <input id="sAiKey" type="password" autocomplete="new-password" placeholder="留空则不修改">
                <div class="hint" id="aiHint">读取中…</div>
              </div>
              <div class="grid2" style="margin-top:8px">
                <div><span class="dim">自动审核的根域名</span><input id="sAiRoots" placeholder="v-1.top"></div>
                <div><span class="dim">不限 DNS 记录数的根域名</span><input id="sAiDnsRoots" placeholder="v-1.top"></div>
              </div>
              <div class="hint">密钥只存数据库或 Worker Secret <span class="mono">AI_API_KEY</span>，不会写进代码库；后台与公开接口都只回显掩码。AI 未配置、超时或返回异常时，申请自动回落为人工审核，不会卡住用户。</div>
              <div class="row" style="gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
                <button class="btn sm ghost" id="aiTestBtn" type="button">测试 AI 连接</button>
                <span class="hint" id="aiTestResult" style="margin:0">先保存设置再测试；会真实调用一次模型并返回诊断。</span>
              </div>
            </div>
            <div class="field">
              <label>滥用举报渠道（外部域名 WHOIS 展示）</label>
              <div class="grid2">
                <div><span class="dim">投诉邮箱</span><input id="sAbuseEmail" placeholder="abuse@meoy.top"></div>
                <div><span class="dim">在线举报入口 URL</span><input id="sAbuseUrl" placeholder="https://..."></div>
              </div>
              <div class="hint">查询外部域名并识别到托管平台时，结果下方会展示「滥用与违规举报通道」区块。</div>
            </div>
            <div class="field">
              <label>托管面板域名（CNAME 识别）</label>
              <div class="grid2">
                <div><span class="dim">面板域名</span><input id="sPanelDomain" placeholder="dash.domain.meoy.top"></div>
                <div><span class="dim">显示名称</span><input id="sPanelName" placeholder="TerraDomain 面板"></div>
              </div>
              <div class="hint">外部域名 WHOIS 会探测 CNAME 指向；指向该域名时显示你设定的名称（如
                <span class="mono">meoy.top CNAME dash.domain.meoy.top</span> → 显示「TerraDomain 面板」）。
                Vercel / Netlify / GitHub Pages 等常见平台自动识别，无需配置。</div>
            </div>
            <div class="field">
              <label>DNSHE API 凭证（查询 DNSHE 系域名）</label>
              <div class="grid2">
                <div><span class="dim">API Key</span><input id="sDnsheKey" type="text" autocomplete="off" placeholder="cfsd_..."></div>
                <div><span class="dim">API Secret</span><input id="sDnsheSecret" type="password" autocomplete="new-password" placeholder="留空则不修改"></div>
              </div>
              <div class="hint" id="dnsheHint"></div>
            </div>
            <div class="field">
              <label>积分规则</label>
              <div class="grid2">
                <div><span class="dim">每日签到奖励</span><input id="sCheckin" type="number" min="0" max="1000" value="${esc(s.checkin_points || '5')}"></div>
                <div><span class="dim">新用户初始积分</span><input id="sInitial" type="number" min="0" max="10000" value="${esc(s.initial_points || '10')}"></div>
                <div><span class="dim">申请子域名消耗</span><input id="sCost" type="number" min="0" max="10000" value="${esc(s.domain_cost || '5')}"></div>
                <div><span class="dim">单字域名消耗</span><input id="sShortCost" type="number" min="0" max="100000" value="${esc(s.short_domain_cost || '35')}"></div>
              </div>
              <div class="hint">「单字域名长度上限」= ${esc(s.short_domain_len || '1')}（长度不超过该值即按单字计价）。管理员不消耗积分。老用户首次进入按已有域名数补偿，已有域名不受影响。</div>
            </div>
            <div class="field">
              <label>全局字体（中文字体）</label>
              <div class="grid2">
                <div>
                  <span class="dim">正文字体</span>
                  <select id="sFontBody">
                    <option value="system"${(s.font_body || 'system') === 'system' ? ' selected' : ''}>系统默认（苹方 / 微软雅黑）</option>
                    <option value="noto"${s.font_body === 'noto' ? ' selected' : ''}>思源黑体 Noto Sans SC</option>
                    <option value="lxgw"${s.font_body === 'lxgw' ? ' selected' : ''}>霞鹜文楷 LXGW WenKai</option>
                    <option value="zcool"${s.font_body === 'zcool' ? ' selected' : ''}>站酷快乐体（圆润，偏标题）</option>
                  </select>
                </div>
                <div>
                  <span class="dim">标题字体</span>
                  <select id="sFontDisplay">
                    <option value="zcool"${(s.font_display || 'zcool') === 'zcool' ? ' selected' : ''}>站酷快乐体（圆润活泼）</option>
                    <option value="system"${s.font_display === 'system' ? ' selected' : ''}>系统默认（苹方 / 微软雅黑）</option>
                    <option value="noto"${s.font_display === 'noto' ? ' selected' : ''}>思源黑体 Noto Sans SC</option>
                    <option value="lxgw"${s.font_display === 'lxgw' ? ' selected' : ''}>霞鹜文楷 LXGW WenKai</option>
                  </select>
                </div>
              </div>
              <div class="hint">全局生效：前台、WHOIS、管理后台、条款页全部应用。拉丁字母与数字始终使用 Redaction 35（像素感），中文字体只接管中文字符。切换后刷新页面即可看到。</div>
            </div>
            <div class="field">
              <label>WHOIS 持有人邮箱</label>
              <select id="sWhois" style="max-width:260px">
                <option value="masked"${(s.whois_holder || 'masked') === 'masked' ? ' selected' : ''}>脱敏显示（ab***@gmail.com）</option>
                <option value="none"${s.whois_holder === 'none' ? ' selected' : ''}>不显示</option>
                <option value="full"${s.whois_holder === 'full' ? ' selected' : ''}>完整公开</option>
              </select>
              <div class="hint">本人与管理员始终可见完整地址，不受此项影响。</div>
            </div>
            <div class="field">
              <label>Spaceship 域名注册商（自动发现域名）</label>
              <div class="grid2">
                <div><span class="dim">API 地址</span><input id="sSpUrl" placeholder="https://spaceship.dev/api"></div>
                <div><span class="dim">API Key</span><input id="sSpKey" type="text" autocomplete="off" placeholder="留空则不修改"></div>
              </div>
              <div class="field" style="margin:8px 0 0">
                <span class="dim">API Secret</span><input id="sSpSecret" type="password" autocomplete="new-password" placeholder="留空则不修改">
                <div class="hint" id="spHint">在 Spaceship → API Manager 创建 Key（需 domains 读取权限）。本站只读取域名列表，不注册、不续费、不改 NS。</div>
              </div>
              <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
                <button class="btn sm" id="spTest" type="button">测试连接</button>
                <button class="btn sm primary" id="spFetch" type="button">拉取我的域名</button>
              </div>
              <div class="hint" id="spRoots" style="margin-top:8px">当前根域名：读取中…</div>
            </div>
            <div class="field">
              <label>新域名申请开关</label>
              <label class="check"><input type="checkbox" id="sApplyPaused"${d.applyPaused ? ' checked' : ''}${d.applyPausedFromEnv ? ' disabled' : ''}><span>暂停新域名申请</span></label>
              <div class="hint">暂停后普通用户无法提交新的子域名申请（注册页会锁定并展示下方提示语）；<b>已注册域名的 DNS 记录、续期、转移等全部不受影响</b>，管理员仍可自建域名。${d.applyPausedFromEnv ? '<br><span class="badge warn">已由环境变量 APPLY_PAUSED 强制开启，后台不可修改。</span>' : ''}</div>
              <div style="margin-top:8px"><span class="dim">暂停提示语（留空用默认文案）</span><input id="sApplyPausedMsg" maxlength="200" placeholder="站点已暂停新域名申请，请稍后再试。" value="${esc(d.applyPausedMessage || '')}"></div>
            </div>
            <div class="field">
              <label>根域名管理</label>
              <div id="rootAdmin" style="margin:2px 0 8px">读取中…</div>
              <div class="hint">「移除」后该后缀立即从注册页、WHOIS 与 DNS 中消失，<b>无需重新部署</b>：后台导入的直接删除，环境变量配置的写入屏蔽名单，可随时点「恢复」。已注册在该根域名下的子域名不会被删除。至少要保留一个根域名。</div>
            </div>
            <div class="alert info" style="margin-bottom:12px">
              Logo 可以是站内路径（<span class="mono">/img/logo.jpg</span>）或外链图片地址（<span class="mono">https://…</span>）。
              想换成本地图，把图片放进仓库的 <span class="mono">public/img/</span> 再推一次即可。<br>
              图标建议用 <span class="mono">.ico</span>（兼容最好，浏览器默认会请求 <span class="mono">/favicon.ico</span>），
              也可以用 <span class="mono">.png</span>。
            </div>
            <div class="row">
              <button class="btn primary" id="saveSet">保存</button>
              <button class="btn" id="resetLogo">恢复默认 Logo</button>
              <button class="btn ghost" id="reloadLogo">刷新预览</button>
            </div>
          </td>
        </tr>`;
      const preview = () => {
        tb.querySelector('.logo-preview').src = document.getElementById('sLogo').value.trim() || '/img/logo.jpg';
      };
      document.getElementById('sLogo').addEventListener('input', preview);
      document.getElementById('reloadLogo').onclick = preview;
      document.getElementById('saveSet').onclick = async () => {
        try {
          await api.post('/api/admin/settings', {
            siteName: document.getElementById('sName').value,
            logoUrl: document.getElementById('sLogo').value,
            faviconUrl: document.getElementById('sFav').value,
            announcement: document.getElementById('sAnno').value,
            maxAccountsPerIp: document.getElementById('sIpLimit').value,
            whoisHolder: document.getElementById('sWhois').value,
            checkinPoints: document.getElementById('sCheckin').value,
            initialPoints: document.getElementById('sInitial').value,
            domainCost: document.getElementById('sCost').value,
            shortDomainCost: document.getElementById('sShortCost').value,
            dnsApiUrl: document.getElementById('sDnsUrl').value,
            dnsApiKey: document.getElementById('sDnsKey').value,
            dnsApiSecret: document.getElementById('sDnsSecret').value,
            domainValidDays: document.getElementById('sValidDays').value,
            renewWindowDays: document.getElementById('sRenewWindow').value,
            abuseEmail: document.getElementById('sAbuseEmail').value,
            abuseReportUrl: document.getElementById('sAbuseUrl').value,
            hostingPanelDomain: document.getElementById('sPanelDomain').value,
            hostingPanelName: document.getElementById('sPanelName').value,
            dnsheApiKey: document.getElementById('sDnsheKey').value,
            dnsheApiSecret: document.getElementById('sDnsheSecret').value,
            fontBody: document.getElementById('sFontBody').value,
            fontDisplay: document.getElementById('sFontDisplay').value,
            mailProvider: document.getElementById('sMailProvider').value,
            mailFrom: document.getElementById('sMailFrom').value,
            mailApiKey: document.getElementById('sMailKey').value,
            mailVerifyRequired: document.getElementById('sMailVerifyRequired').checked,
            r2PublicUrl: document.getElementById('sR2PublicUrl').value,
            spaceshipApiUrl: document.getElementById('sSpUrl').value,
            spaceshipApiKey: document.getElementById('sSpKey').value,
            spaceshipApiSecret: document.getElementById('sSpSecret').value,
            applyPaused: document.getElementById('sApplyPaused').checked,
            applyPausedMessage: document.getElementById('sApplyPausedMsg').value,
            aiEnabled: document.getElementById('sAiEnabled').checked,
            aiUrl: document.getElementById('sAiUrl').value,
            aiModel: document.getElementById('sAiModel').value,
            aiApiKey: document.getElementById('sAiKey').value,
            aiRoots: document.getElementById('sAiRoots').value,
            aiDnsUnlimitedRoots: document.getElementById('sAiDnsRoots').value,
          });
          toast('已保存，刷新页面后生效');
          // 立即刷新导航 Logo
          brandPromise = null;
          const b = await loadBranding();
          applyBranding(b);
        } catch (e) { toast(e.message, 'err'); }
      };
      document.getElementById('resetLogo').onclick = async () => {
        try {
          await api.post('/api/admin/settings/reset-logo', {});
          toast('已恢复默认 Logo'); load();
        } catch (e) { toast(e.message, 'err'); }
      };

      /* AI 连接自检：真实调用一次 /models 与 /chat/completions，回报具体失败点 */
      const aiTestBtn = document.getElementById('aiTestBtn');
      if (aiTestBtn) aiTestBtn.onclick = async () => {
        const out = document.getElementById('aiTestResult');
        if (out) { out.textContent = '测试中…'; out.className = 'hint'; }
        try {
          const r = await api.post('/api/admin/ai-test', {});
          if (out) {
            out.className = 'hint';
            out.innerHTML = r.ok
              ? `<span class="badge ok">可用</span> 模型 <span class="mono">${esc(r.model)}</span> · ${r.latencyMs} ms · 返回「${esc(r.sample || '')}」`
              : `<span class="badge warn">不可用</span> ${esc(r.message || '未知错误')}${r.detail ? '<br><span class="mono">' + esc(r.detail) + '</span>' : ''}`;
          }
          toast(r.ok ? 'AI 连接正常' : 'AI 连接失败：' + (r.message || ''), r.ok ? 'ok' : 'err');
        } catch (e) { if (out) out.textContent = '测试失败：' + (e.message || e); }
      };
  
      // 有效期规则
      {
        const ex = d.expiry || {};
        const vd = document.getElementById('sValidDays');
        const rw = document.getElementById('sRenewWindow');
        if (vd && ex.validDays) vd.value = ex.validDays;
        if (rw && ex.renewWindowDays) rw.value = ex.renewWindowDays;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        set('sAbuseEmail', (d.items || {}).abuse_email);
        set('sAbuseUrl', (d.items || {}).abuse_report_url);
        set('sPanelDomain', (d.items || {}).hosting_panel_domain);
        set('sPanelName', (d.items || {}).hosting_panel_name);
      }
  
      // 邮件服务与验证码
      {
        const m = d.mail || {};
        const pv = document.getElementById('sMailProvider');
        const fm = document.getElementById('sMailFrom');
        const ky = document.getElementById('sMailKey');
        const rq = document.getElementById('sMailVerifyRequired');
        const hint = document.getElementById('mailHint');
        if (pv) pv.value = m.provider || '';
        if (fm) fm.value = m.from || '';
        if (rq) rq.checked = !!m.verifyRequired;
        if (m.fromEnv) {
          [pv, fm, ky, rq].forEach((el) => { if (el) el.disabled = true; });
          if (ky) ky.value = m.keyMasked || '';
          hint.innerHTML = '<span class="badge ok">已由环境变量配置</span> 后台不可修改。';
        } else if (m.enabled) {
          if (ky) { ky.placeholder = m.keyMasked || '已配置，留空不修改'; ky.value = ''; }
          hint.innerHTML = '<span class="badge ok">已启用</span> 服务商 <b>' + esc(m.provider) + '</b>，发件人 <span class="mono">' + esc(m.from) + '</span>。需修改时填入新 Key，留空保持原值。';
        } else {
          hint.innerHTML = '未配置。发件人建议填 <span class="mono">verify@你的域名</span>，并先在服务商完成域名验证。';
        }
      }
  
      // R2 头像公网地址
      {
        const el = document.getElementById('sR2PublicUrl');
        const hint = document.getElementById('r2Hint');
        if (el) el.value = d.r2PublicUrl || '';
        if (d.r2FromEnv) {
          if (el) el.disabled = true;
          if (hint) hint.innerHTML = '<span class="badge ok">已由环境变量配置</span> 后台不可修改';
        } else if (hint) {
          hint.textContent = d.r2PublicUrl
            ? '已配置：' + d.r2PublicUrl
            : '未配置，头像走 /api/avatar/<key> 代理读取（桶无需公开）';
        }
      }
  
      // AI 自动审核：Key 只回掩码，留空表示不修改
      {
        const a = d.ai || {};
        const setv = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        const en = document.getElementById('sAiEnabled');
        if (en) en.checked = !!a.enabled;
        setv('sAiUrl', a.url);
        setv('sAiModel', a.model);
        setv('sAiRoots', a.roots);
        setv('sAiDnsRoots', a.dnsUnlimitedRoots);
        const k = document.getElementById('sAiKey');
        const hint = document.getElementById('aiHint');
        if (a.fromEnv) {
          [k].forEach((el) => { if (el) el.disabled = true; });
          if (k) k.value = a.keyMasked || '';
          if (hint) hint.innerHTML = '<span class="badge ok">已由 Worker Secret 配置</span> 后台不可修改。';
        } else if (a.ready) {
          if (k) { k.placeholder = a.keyMasked || '已配置，留空不修改'; k.value = ''; }
          if (hint) hint.innerHTML = '<span class="badge ok">已启用</span> 当前 Key ' + esc(a.keyMasked || '') + '。需更换时填入新 Key，留空保持原值。';
        } else {
          if (hint) hint.innerHTML = '未配置 Key：AI 不会调用，申请照常进入人工审核。也可用 <span class="mono">npx wrangler secret put AI_API_KEY</span> 配置。';
        }
      }

      // 自定义 DNS 提供商：URL 可回显，Key/Secret 只显示掩码；留空表示不修改
      {
        const p = d.dnsProvider || {};
        const urlEl = document.getElementById('sDnsUrl');
        const kEl = document.getElementById('sDnsKey');
        const sEl = document.getElementById('sDnsSecret');
        const hint = document.getElementById('dnsProvHint');
        if (urlEl) urlEl.value = p.url || '';
        if (p.fromEnv) {
          urlEl.disabled = true; kEl.disabled = true; sEl.disabled = true;
          hint.innerHTML = '<span class="badge ok">已由环境变量配置</span> 后台不可修改。当前：<span class="mono">' + esc(p.url) + '</span>';
        } else if (p.custom) {
          if (kEl) kEl.placeholder = p.keyMasked || '已配置，留空不修改';
          if (sEl) sEl.placeholder = '已配置，留空不修改';
          hint.innerHTML = '<span class="badge ok">已启用自定义接口</span> DNS 读写走 <span class="mono">' + esc(p.url) + '</span>。清空 URL 即恢复 Cloudflare。';
        } else {
          hint.innerHTML = '当前使用 <b>Cloudflare</b>（免费版单区域约 200 条记录上限）。';
        }
      }
  
      // DNSHE 凭证：后端只回传掩码，不回传明文；留空表示不修改
      {
        const sec = d.secrets || {};
        const keyEl = document.getElementById('sDnsheKey');
        const secEl = document.getElementById('sDnsheSecret');
        const hint = document.getElementById('dnsheHint');
        if (sec.fromEnv) {
          keyEl.disabled = true; secEl.disabled = true;
          keyEl.value = sec.dnsheApiKeyMasked || '';
          secEl.value = '••••••••';
          hint.innerHTML = '<span class="badge ok">已由环境变量配置</span> 后台不可修改（优先级更高）。';
        } else if (sec.dnsheApiKeySet) {
          keyEl.placeholder = sec.dnsheApiKeyMasked || '已配置，留空不修改';
          secEl.placeholder = '已配置，留空不修改';
          hint.innerHTML = '<span class="badge ok">已配置</span> 需修改时填入新值，留空则保持原值。';
        } else {
          hint.innerHTML = '留空则使用公开模式（免认证，官方限制 <b>2 次/分钟/IP</b>）。填写后额度更高、查询更稳定。';
        }
      }
  
      /* ---------- Spaceship：配置状态 + 拉取域名 + 勾选添加 ---------- */
      {
        const sp = d.spaceship || {};
        const u = document.getElementById('sSpUrl');
        const k = document.getElementById('sSpKey');
        const sc = document.getElementById('sSpSecret');
        const hint = document.getElementById('spHint');
        const rootsEl = document.getElementById('spRoots');
        if (u) u.value = sp.url || '';
        if (sp.fromEnv) {
          [u, k, sc].forEach((e) => { if (e) e.disabled = true; });
          if (k) k.value = sp.keyMasked || '';
          if (hint) hint.innerHTML = '<span class="badge ok">已由环境变量配置</span> 后台不可修改。';
        } else if (sp.enabled) {
          if (k) k.placeholder = sp.keyMasked || '已配置，留空不修改';
          if (sc) sc.placeholder = '已配置，留空不修改';
          if (hint) hint.innerHTML = '<span class="badge ok">已配置</span> 点「拉取我的域名」即可查看账号下的域名并选择添加。';
        } else if (hint) {
          hint.innerHTML = '未配置。填写 API Key / Secret 并保存后即可自动发现域名。';
        }
        const showRoots = (list) => {
          if (rootsEl) rootsEl.textContent = '当前根域名：' + ((list && list.length) ? list.join('、') : '（未配置）');
        };
        showRoots(d.rootDomains);
  
        /* 根域名管理：列出来源、移除、恢复 */
        const renderRoots = async () => {
          const box = document.getElementById('rootAdmin');
          if (!box) return;
          try {
            const r = await api.get('/api/admin/roots');
            const items = r.items || [];
            const removed = r.disabled || [];
            const line = (x, gone) => `<div class="row" style="gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
              <span class="mono" style="min-width:150px">${esc(gone ? x : x.domain)}</span>
              ${gone
                ? '<span class="badge warn">已移除</span>'
                : `<span class="badge ${x.source === 'dynamic' ? 'ok' : ''}">${x.source === 'dynamic' ? '后台导入' : '环境变量'}</span><span class="dim" style="font-size:12px">${x.hasZone ? '已配 Zone' : '未配 Zone'}</span>
                   <span class="badge ${x.backend === 'spaceship' ? 'ok' : ''}" style="font-size:11px">${x.backend === 'spaceship' ? 'Spaceship DNS' : 'Cloudflare DNS'}${x.backendAuto ? ' · 自动' : ''}</span>
                   <select class="input" data-backend="${esc(x.domain)}" title="DNS 记录写入后端" style="width:auto;padding:5px 8px;font-size:12px">
                     <option value="auto"${x.backendAuto ? ' selected' : ''}>自动</option>
                     <option value="spaceship"${!x.backendAuto && x.backend === 'spaceship' ? ' selected' : ''}>Spaceship</option>
                     <option value="cloudflare"${!x.backendAuto && x.backend === 'cloudflare' ? ' selected' : ''}>Cloudflare</option>
                   </select>`}
              <span style="flex:1"></span>
              ${gone
                ? `<button class="btn sm" data-restore="${esc(x)}">恢复</button>`
                : `<button class="btn sm ghost" data-rm="${esc(x.domain)}">移除</button>`}
            </div>`;
            box.innerHTML = (items.map((x) => line(x, false)).join('') || '<div class="dim">（无生效的根域名）</div>')
              + (removed.length
                  ? '<div style="margin-top:10px"><b style="font-size:13px">已移除（可恢复）</b></div>' + removed.map((x) => line(x, true)).join('')
                  : '');
            box.querySelectorAll('[data-backend]').forEach((sel) => {
              sel.onchange = async () => {
                const dmn = sel.dataset.backend;
                const v = sel.value === 'auto' ? '' : sel.value;
                sel.disabled = true;
                try {
                  await api.post('/api/admin/roots/' + encodeURIComponent(dmn) + '/backend', { backend: v });
                  toast('已切换 ' + dmn + ' 的 DNS 写入后端');
                  renderRoots();
                } catch (e) { toast(e.message, 'err'); renderRoots(); }
              };
            });
            box.querySelectorAll('[data-rm]').forEach((b) => {
              b.onclick = async () => {
                const dmn = b.dataset.rm;
                if (!confirm('确定移除根域名 ' + dmn + ' 吗？\n\n该后缀将不再可选；已注册在该根域名下的子域名不会被删除。')) return;
                b.disabled = true;
                try {
                  const q = await api.del('/api/admin/roots/' + encodeURIComponent(dmn));
                  toast('已移除 ' + dmn); showRoots(q.rootDomains); renderRoots();
                } catch (e) { toast(e.message, 'err'); b.disabled = false; }
              };
            });
            box.querySelectorAll('[data-restore]').forEach((b) => {
              b.onclick = async () => {
                b.disabled = true;
                try {
                  const q = await api.post('/api/admin/roots/' + encodeURIComponent(b.dataset.restore) + '/restore', {});
                  toast('已恢复 ' + b.dataset.restore); showRoots(q.rootDomains); renderRoots();
                } catch (e) { toast(e.message, 'err'); b.disabled = false; }
              };
            });
          } catch (e) {
            box.innerHTML = '<span style="color:var(--danger)">读取失败：' + esc(e.message) + '</span>';
          }
        };
        renderRoots();
  
        const testBtn = document.getElementById('spTest');
        if (testBtn) testBtn.onclick = async () => {
          testBtn.disabled = true;
          try {
            const r = await api.post('/api/admin/spaceship/test', {});
            toast('连接成功，账号下共 ' + r.total + ' 个域名');
          } catch (e) { toast(e.message, 'err'); }
          testBtn.disabled = false;
        };
  
        const fetchBtn = document.getElementById('spFetch');
        if (fetchBtn) fetchBtn.onclick = async () => {
          fetchBtn.disabled = true;
          fetchBtn.textContent = '拉取中…';
          try {
            const r = await api.get('/api/admin/spaceship/domains');
            fetchBtn.disabled = false;
            fetchBtn.textContent = '拉取我的域名';
            openSpaceshipPicker(r.items || [], showRoots);
          } catch (e) {
            fetchBtn.disabled = false;
            fetchBtn.textContent = '拉取我的域名';
            toast(e.message, 'err');
          }
        };
      }
      return;
    }
  
    if (tab === 'audit') {
      const d = await api.get('/api/admin/audit');
      tb.innerHTML = d.items.map((a) => `
        <tr>
          <td class="nowrap" style="color:var(--muted)">${fmtTime(a.created_at)}</td>
          <td class="mono" style="color:var(--muted)">${esc(a.email || '系统')}</td>
          <td><span class="badge">${esc(a.action)}</span></td>
          <td class="mono">${esc(a.target || '')}</td>
          <td style="color:var(--muted)">${esc(a.detail || '')}</td>
        </tr>`).join('');
    }
  }
  
  function bindSubActions(tb) {
    const call = async (id, act, body = {}) => {
      if (act === 'reject' || act === 'suspend') {
        const reason = prompt(act === 'reject' ? '驳回原因：' : '停用原因：');
        if (reason === null) return;
        body.reason = reason;
      }
      if (act === 'del' && !confirm('删除该子域名并清空其 DNS 记录？')) return;
      try {
        if (act === 'del') await api.del('/api/admin/subdomains/' + id);
        else await api.post(`/api/admin/subdomains/${id}/${act}`, body);
        toast('操作成功'); load();
      } catch (e) { toast(e.message, 'err'); }
    };
    tb.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => call(b.dataset.id, b.dataset.act));
  }
  
  document.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      tab = t.dataset.tab;
      load();
    };
  });
  
  mountShell('admin').then(async (u) => {
    applyBranding(await loadBranding());
    if (u && u.role !== 'admin') {
      document.querySelector('.wrap').innerHTML =
        '<div class="card"><div class="alert danger">当前账号没有管理员权限。</div><a href="/dashboard">返回我的域名</a></div>';
      return;
    }
    load();
  }).catch((e) => console.error("初始化失败", e));
  
}
