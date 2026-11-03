/**
 * Register 页面控制器（由 register.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, toast, mountShell } from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

export async function mountRegister(_root: HTMLElement | null): Promise<void> {
  
  var ROOTS = [];
  var checkTimer = 0;
  var APPLY_PAUSED = false;
  var APPLY_MSG = '';
  var IS_ADMIN = false;
  
  function esc(s){ return String(s ?? '').replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function currentRoot(){
    var sel = document.getElementById('rootDomainSel');
    if (sel) return sel.value;
    return ROOTS[0] || '';
  }
  function rootQuery(){ var r = currentRoot(); return r ? '&root=' + encodeURIComponent(r) : ''; }
  
  /* 后台暂停新申请：普通用户锁定整个表单，管理员仍可自建 */
  function setApplyPaused(msg){
    APPLY_MSG = msg || '站点已暂停新域名申请，请稍后再试。';
    var tip = document.getElementById('applyTip');
    if (tip) {
      tip.className = 'alert a-warn';
      tip.innerHTML = '<b>新域名申请已暂停</b><br>' + esc(APPLY_MSG)
        + '<br><span style="opacity:.8;font-size:12px">已注册的域名、DNS 记录与续期不受影响。</span>';
    }
    if (IS_ADMIN) return;                 // 管理员是「开通」，不锁
    APPLY_PAUSED = true;
    ['label','note','agreeUse','btnApply','rootDomainSel'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.disabled = true;
    });
    var btn = document.getElementById('btnApply');
    if (btn) btn.textContent = '申请已暂停';
  }
  
  /* 根域名：单个时静态后缀，多个时下拉 */
  async function setupRoots(){
    try {
      var cfg = await api.get('/api/config');
      if (cfg.applyPaused) setApplyPaused(cfg.applyPausedMessage);
      var list = Array.isArray(cfg.rootDomains) && cfg.rootDomains.length
        ? cfg.rootDomains
        : (cfg.rootDomain ? [cfg.rootDomain] : []);
      ROOTS = list;
      var wrap = document.getElementById('rootWrap');
      var span = document.getElementById('rootDomain');
      if (!wrap) return;
      if (list.length <= 1) { if (span) span.textContent = list[0] || ''; return; }
      wrap.innerHTML = '<span style="opacity:.5">.</span><select id="rootDomainSel" style="border:none;background:transparent;color:var(--blue);font-family:var(--mono);font-size:12px;padding:0 2px;outline:none;cursor:pointer">'
        + list.map(function(d){ return '<option value="' + esc(d) + '">' + esc(d) + '</option>'; }).join('')
        + '</select>';
      document.getElementById('rootDomainSel').onchange = function(){
        var v = document.getElementById('label').value.trim();
        if (v) runCheck(v);
      };
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
      toast(r.status === 'approved' ? '申请成功，已开通' : '已提交，等待管理员审核');
      document.getElementById('label').value = '';
      document.getElementById('note').value = '';
      document.getElementById('checkTip').innerHTML = '';
      document.getElementById('costBox').style.display = 'none';
      loadPending();
      setTimeout(function(){ location.href = '/dashboard'; }, 900);
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
