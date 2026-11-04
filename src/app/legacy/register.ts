/**
 * Register 页面控制器（由 register.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, toast, mountShell, onDoc } from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

export async function mountRegister(_root: HTMLElement | null): Promise<void> {
  
  var ROOTS = [];
  var AI_ROOTS = [];
  var DNS_UNLIMITED = [];
  var checkTimer = 0;

  /* 当前后缀的规则提示：AI 自动审核 / DNS 记录不限 */
  function updateRootTip(d){
    var el = document.getElementById('aiRootTip');
    if (!el) return;
    var bits = [];
    if (AI_ROOTS.indexOf(d) >= 0) bits.push('该后缀由 AI 自动审核，通过后立即开通（无需人工同意）');
    if (DNS_UNLIMITED.indexOf(d) >= 0) bits.push('DNS 记录数不限');
    el.textContent = bits.length ? '✨ ' + bits.join(' · ') : '';
    el.style.display = bits.length ? '' : 'none';
  }
  var APPLY_PAUSED = false;
  var APPLY_MSG = '';
  var IS_ADMIN = false;
  
  function esc(s){ return String(s ?? '').replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function currentRoot(){
    var btn = document.getElementById('rootPickerBtn');
    if (btn && btn.getAttribute('data-root')) return btn.getAttribute('data-root');
    return ROOTS[0] || '';
  }
  function rootQuery(){ var r = currentRoot(); return r ? '&root=' + encodeURIComponent(r) : ''; }
  
  /* 后台暂停新申请：普通用户锁定整个表单，管理员仍可自建 */
  function setApplyPaused(msg){
    APPLY_MSG = msg || '站点已暂停新域名申请，请稍后再试。';
    var tip = document.getElementById('applyTip');
    if (tip) {
      tip.className = 'alert a-warn';
      tip.style.display = '';
      tip.innerHTML = '<b>新域名申请已暂停</b><br>' + esc(APPLY_MSG)
        + '<br><span style="opacity:.8;font-size:12px">已注册的域名、DNS 记录与续期不受影响。</span>';
    }
    if (IS_ADMIN) return;                 // 管理员是「开通」，不锁
    APPLY_PAUSED = true;
    ['label','note','agreeUse','btnApply','rootPickerBtn'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) (el as HTMLButtonElement).disabled = true;
    });
    closeRootMenu();
    var btn = document.getElementById('btnApply');
    if (btn) btn.textContent = '申请已暂停';
  }
  
  /* ───── 根域名选择器（参考 DnsNeko） ─────
     原来是塞在窄胶囊里的原生 <select>：弹层由浏览器绘制、样式不可控、
     小屏还会被裁。改为自定义按钮 + 浮层列表，每项右侧标 Free。 */
  function closeRootMenu(){
    var menu = document.getElementById('rootPickerMenu');
    var btn = document.getElementById('rootPickerBtn');
    if (menu) { menu.classList.remove('show'); menu.setAttribute('aria-hidden', 'true'); }
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  function toggleRootMenu(){
    var menu = document.getElementById('rootPickerMenu');
    var btn = document.getElementById('rootPickerBtn') as HTMLButtonElement;
    if (!menu || !btn || btn.disabled) return;
    var on = !menu.classList.contains('show');
    menu.classList.toggle('show', on);
    menu.setAttribute('aria-hidden', on ? 'false' : 'true');
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function selectRoot(d){
    if (!d) return;
    var btn = document.getElementById('rootPickerBtn');
    var span = document.getElementById('rootDomain');
    if (span) span.textContent = d;
    if (btn) btn.setAttribute('data-root', d);
    document.querySelectorAll('#rootPickerMenu .root-opt').forEach(function(el){
      var on = el.getAttribute('data-root') === d;
      el.classList.toggle('on', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    closeRootMenu();
    updateRootTip(d);
    try { window.dispatchEvent(new CustomEvent('terradata:root', { detail: d })); } catch {}
    var v = (document.getElementById('label') as HTMLInputElement)?.value.trim();
    if (v) runCheck(v);   // 换后缀立即重新查可用性
  }

  async function setupRoots(){
    try {
      var cfg = await api.get('/api/config');
      if (cfg.applyPaused) setApplyPaused(cfg.applyPausedMessage);
      var list = Array.isArray(cfg.rootDomains) && cfg.rootDomains.length
        ? cfg.rootDomains
        : (cfg.rootDomain ? [cfg.rootDomain] : []);
      ROOTS = list;
      AI_ROOTS = Array.isArray(cfg.aiReviewRoots) ? cfg.aiReviewRoots : [];
      DNS_UNLIMITED = Array.isArray(cfg.dnsUnlimitedRoots) ? cfg.dnsUnlimitedRoots : [];
      updateRootTip(list[0] || '');

      /* AI 状态可视化：说明「为什么这次没走 AI」——
         常见原因是后台还没填 Key、开关被关、或当前账号是管理员（免审核）。 */
      var aiTip = document.getElementById('aiStatusTip');
      if (aiTip) {
        var st = cfg.aiStatus || {};
        var msg = '';
        if (!st.ready) msg = '⚠ AI 自动审核未配置 API Key：申请会回落人工审核。';
        else if (!st.enabled) msg = '⚠ AI 自动审核开关已关闭：申请会回落人工审核。';
        else if (!st.modelSelected) msg = '✓ AI 自动审核已就绪（未指定模型，将使用 agnes-2.5-flash）；管理员账号免审核，不会触发 AI。';
        else msg = '✓ AI 自动审核已就绪，审核模型 ' + esc(st.model) + '；管理员账号免审核，不会触发 AI。';
        aiTip.textContent = msg;
        aiTip.style.display = '';
      }

      var btn = document.getElementById('rootPickerBtn') as HTMLButtonElement;
      var span = document.getElementById('rootDomain');
      var menu = document.getElementById('rootPickerMenu');
      // 兼容仍使用旧 #rootWrap / #rootDomainSel 结构的页面
      if (!btn || !span || !menu) {
        var wrap = document.getElementById('rootWrap');
        if (wrap && list.length > 1) {
          wrap.innerHTML = '<span style="opacity:.5">.</span><select id="rootDomainSel">'
            + list.map(function(d){ return '<option value="' + esc(d) + '">' + esc(d) + '</option>'; }).join('')
            + '</select>';
        } else if (span) span.textContent = list[0] || '';
        return;
      }

      var first = list[0] || '';
      span.textContent = first;
      btn.setAttribute('data-root', first);

      if (list.length <= 1) {
        btn.classList.add('single');
        menu.innerHTML = '';
        return;   // 只有一个后缀：整块就是静态文字，不展开
      }

      menu.innerHTML = list.map(function(d, i){
        return '<button type="button" class="root-opt' + (i === 0 ? ' on' : '') + '" role="option"'
          + ' data-root="' + esc(d) + '" aria-selected="' + (i === 0 ? 'true' : 'false') + '">'
          + '<span class="root-opt-name">.' + esc(d.toUpperCase()) + '</span>'
          + '<span class="root-opt-free">Free</span></button>';
      }).join('');
      menu.querySelectorAll('.root-opt').forEach(function(el){
        (el as HTMLButtonElement).onclick = function(){ selectRoot(el.getAttribute('data-root')); };
      });
      btn.onclick = function(e){ e.stopPropagation(); toggleRootMenu(); };
      // /register?label=foo&root=v-1.top：从 WHOIS / 落地页带后缀跳进来时保持选中
      try {
        var want = new URLSearchParams(location.search).get('root');
        if (want && list.indexOf(want) >= 0) selectRoot(want);
      } catch {}
      try { window.dispatchEvent(new CustomEvent('terradata:root', { detail: first })); } catch {}
      // 点外部 / Esc 关闭；监听随切页自动注销
      onDoc('click', function(e){
        if (!(e.target as HTMLElement)?.closest?.('#rootPicker')) closeRootMenu();
      });
      onDoc('keydown', function(e){ if (e.key === 'Escape') closeRootMenu(); });
    } catch (e) {}
  }
  
  async function runCheck(v){
    var tip = document.getElementById('checkTip');
    var costBox = document.getElementById('costBox');
    if (!v) { tip.innerHTML = '输入前缀后自动检查是否可用，仅支持字母、数字与连字符。'; costBox.style.display = 'none'; return; }
    try {
      var r = await api.get('/api/subdomains/check?label=' + encodeURIComponent(v) + rootQuery());
      if (r.applyPaused) setApplyPaused(r.applyPausedMessage);   // 页面打开后才暂停也能即时提示
      var link =' <a href="/whois?name=' + encodeURIComponent(v) + '" target="_blank" style="font-size:11.5px">whois 详情</a>';
      tip.innerHTML = (r.available
        ? '<span style="color:var(--ok)">' + esc(r.fqdn) + ' 可以注册</span>'
        : '<span style="color:var(--danger)">' + esc(r.message) + '</span>') + link;
  
      if (r.available && r.cost > 0) {
        costBox.style.display = '';
        costBox.innerHTML = '<div class="alert ' + (r.enough ? 'a-info' : 'a-red') + '" style="margin-top:14px">'
          + (r.short ? '<b>单字域名</b> · ' : '')
          + '本次消耗 <b>' + r.cost + '</b> 分 · 当前余额 <b>' + (r.points ?? 0) + '</b> 分'
          + (r.enough ? '' : '<br>积分不足，可前往签到地每日领取')
          + '</div>';
      } else if (r.available) {
        costBox.style.display = '';
        costBox.innerHTML = '<div class="alert a-info" style="margin-top:14px">管理员申请不消耗积分</div>';
      } else {
        costBox.style.display = 'none';
      }
    } catch (e) { tip.innerHTML = '检查失败，请稍后重试'; costBox.style.display = 'none'; }
  }
  
  /* 待审核申请：同一时间只能有一个 */
  async function loadPending(){
    var box = document.getElementById('pendingBox');
    var btn = document.getElementById('btnApply');
    var labelEl = document.getElementById('label');
    try {
      var d = await api.get('/api/subdomains/mine?limit=200');
      var pending = (d.items || []).filter(function(s){ return s.status === 'pending'; });
      if (!pending.length) {
        box.innerHTML = '';
        if (APPLY_PAUSED) return;        // 暂停态优先，别把按钮重新启用
        btn.disabled = false; labelEl.disabled = false; btn.textContent = '提交注册';
        return;
      }
      var f = pending[0].fqdn || pending[0].label;
      box.innerHTML = '<div class="alert a-warn" style="margin-top:16px">你已有一个待审核的申请：<b>' + esc(f)
        + '</b><br>同一时间只能申请一个域名，请等待审核结果（或被驳回）后再提交。</div>';
      btn.disabled = true;
      labelEl.disabled = true;
      btn.textContent = '待审核中';
    } catch (e) {}
  }
  
  /* 本机已同意过免责则自动勾选 */
  try {
    if (localStorage.getItem('meoy_agree_use') === '1') {
      var ag = document.getElementById('agreeUse');
      if (ag) ag.checked = true;
    }
  } catch (e) {}
  
  document.getElementById('label').addEventListener('input', function(e){
    var v = e.target.value.trim();
    clearTimeout(checkTimer);
    if (!v) {
      document.getElementById('checkTip').innerHTML = '输入前缀后自动检查是否可用，仅支持字母、数字与连字符。';
      document.getElementById('costBox').style.display = 'none';
      return;
    }
    checkTimer = setTimeout(function(){ runCheck(v); }, 350);
  });
  
  document.getElementById('btnApply').onclick = async function(){
    if (APPLY_PAUSED) return toast(APPLY_MSG, 'err');
    var label = document.getElementById('label').value.trim();
    var note = document.getElementById('note').value.trim();
    if (!label) return toast('请输入子域名', 'err');
    var agree = document.getElementById('agreeUse');
    if (agree && !agree.checked) return toast('请先勾选免责与使用承诺', 'err');
    try {
      localStorage.setItem('meoy_agree_use', '1');
      var r = await api.post('/api/subdomains', { label: label, note: note, root: currentRoot() });
      const rejected = r.status === 'rejected';
      toast(rejected
        ? 'AI 审核未通过：' + (r.aiReason || '请修改用途说明后再试')
        : r.status === 'approved'
          ? (r.aiReviewed ? 'AI 审核通过，已自动开通' : '申请成功，已开通')
          : '已提交，等待管理员审核', rejected ? 'err' : 'ok');
      if (rejected) {
        // 驳回时保留输入，方便用户改写用途说明重新提交；不跳转
        document.getElementById('checkTip').innerHTML = '<span style="color:var(--danger)">'
          + esc(r.aiReason || '用途说明未通过自动审核') + '</span>';
        document.getElementById('costBox').style.display = 'none';
        return;
      }
      document.getElementById('label').value = '';
      document.getElementById('note').value = '';
      document.getElementById('checkTip').innerHTML = '';
      document.getElementById('costBox').style.display = 'none';
      loadPending();
      // 新版四步向导存在时停在第四步展示结果；没有时才沿用旧的自动跳转
      if (typeof (window as any).__TD_WIZARD_DONE === 'function') {
        (window as any).__TD_WIZARD_DONE(r);
      } else {
        setTimeout(function(){ location.href = '/dashboard'; }, 900);
      }
    } catch (e) {
      toast(e.message, 'err');
    }
  };
  
  (async function init(){
    await mountShell('register');
    try {
      var me = await api.get('/api/auth/me');
      IS_ADMIN = !!(me && (me.role === 'admin' || (me.user && me.user.role === 'admin')));
    } catch (e) {}
    await setupRoots();
    await loadPending();
    var q = new URLSearchParams(location.search).get('label');
    if (q) {
      var el = document.getElementById('label');
      if (el) { el.value = q; runCheck(q); }
    }
  })();
  
}
