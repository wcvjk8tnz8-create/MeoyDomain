/**
 * Login 页面控制器（由 index.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, toast, loadBranding, applyBranding } from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

export async function mountLogin(_root: HTMLElement | null): Promise<void> {
  
  // 登录页顶栏不再放壁纸切换器（新版式留白优先）。
  // 兼容旧结构：若页面里仍有 #bgsw，保持为空即可，不再注入任何按钮。
  const bgsw = document.getElementById('bgsw');
  if (bgsw) bgsw.innerHTML = '';
  loadBranding().then((b) => {
    applyBranding(b);
    const navLogo = document.getElementById('navLogo') as HTMLImageElement | null;
    if (navLogo) navLogo.src = b.logoUrl;
  });
  
  const tabLogin = document.getElementById('tabLogin'), tabReg = document.getElementById('tabReg');
  const paneLogin = document.getElementById('paneLogin'), paneReg = document.getElementById('paneReg');
  const paneReset = document.getElementById('paneReset');
  /* 三个面板：login / reg / reset（忘记密码）。
     重置面板没有顶部 tab，显示时两个 tab 都取消高亮。 */
  function switchTo(which) {
    const login = which === 'login', reg = which === 'reg', reset = which === 'reset';
    tabLogin.classList.toggle('active', login);
    tabReg.classList.toggle('active', reg);
    paneLogin.classList.toggle('hidden', !login);
    paneReg.classList.toggle('hidden', !reg);
    if (paneReset) paneReset.classList.toggle('hidden', !reset);
  }
  tabLogin.onclick = () => switchTo('login');
  tabReg.onclick = () => switchTo('reg');
  document.getElementById('navReg').onclick = (e) => { e.preventDefault(); switchTo('reg'); };
  
  document.getElementById('btnLogin').onclick = async () => {
    const email = document.getElementById('lEmail').value.trim();
    const password = document.getElementById('lPass').value;
    const remember = document.getElementById('lRemember').checked;
    if (!email || !password) return toast('请输入邮箱和密码', 'err');
    try {
      const d = await api.post('/api/auth/login', { email, password, remember });
      toast('登录成功' + (d.user.role === 'admin' ? '，管理员（不限配额）' : ''));
      setTimeout(() => location.href = '/dashboard', 400);
    } catch (e) { toast(e.message, 'err'); }
  };
  
  document.getElementById('btnReg').onclick = async () => {
    const email = document.getElementById('rEmail').value.trim();
    const password = document.getElementById('rPass').value;
    if (!email || !password) return toast('请输入邮箱和密码', 'err');
    if (password.length < 8) return toast('密码至少 8 位', 'err');
    if (!document.getElementById('rAgree').checked) return toast('请先勾选同意《服务条款与免责声明》', 'err');
    try {
      const body = { email, password, agreeTerms: true };
      const codeEl = document.getElementById('rCode');
      if (codeEl && codeEl.offsetParent !== null) {
        if (!codeEl.value.trim()) return toast('请填写邮箱验证码', 'err');
        body.code = codeEl.value.trim();
      }
      const d = await api.post('/api/auth/register', body);
      toast(d.isFirstAdmin ? '注册成功，已设为管理员（不限配额）' : '注册成功');
      setTimeout(() => location.href = '/dashboard', 400);
    } catch (e) { toast(e.message, 'err'); }
  };
  
  /* ---------- 忘记密码 ---------- */
  
  document.getElementById('forgotLink').onclick = (e) => { e.preventDefault(); switchTo('reset'); };
  document.getElementById('backLogin').onclick = (e) => { e.preventDefault(); switchTo('login'); };
  
  /* 发送验证码（register / reset） */
  async function sendCode(scene, emailInput, btn, hint) {
    const email = document.getElementById(emailInput).value.trim();
    if (!email) return toast('请先填写邮箱', 'err');
    const old = btn.textContent;
    btn.disabled = true;
    let left = 60;
    btn.textContent = left + 's';
    const t = setInterval(() => {
      left--;
      if (left <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = old; }
      else btn.textContent = left + 's';
    }, 1000);
    try {
      await api.post('/api/auth/verify/send', { email, scene });
      toast('验证码已发送，请查收邮件');
      if (hint) hint.textContent = '验证码已发送，10 分钟内有效';
    } catch (e) {
      clearInterval(t);
      btn.disabled = false;
      btn.textContent = old;
      toast(e.message, 'err');
      if (hint) hint.textContent = e.message;
    }
  }
  document.getElementById('btnSendReset').onclick = () =>
    sendCode('reset', 'fEmail', document.getElementById('btnSendReset'), document.getElementById('fCodeHint'));
  document.getElementById('btnSendReg').onclick = () =>
    sendCode('register', 'rEmail', document.getElementById('btnSendReg'), document.getElementById('rCodeHint'));
  
  document.getElementById('btnReset').onclick = async () => {
    const email = document.getElementById('fEmail').value.trim();
    const code = document.getElementById('fCode').value.trim();
    const password = document.getElementById('fPass').value;
    if (!email || !code) return toast('请填写邮箱与验证码', 'err');
    if (!password || password.length < 8) return toast('新密码至少 8 位', 'err');
    try {
      await api.post('/api/auth/reset', { email, code, password });
      toast('密码已重置，请使用新密码登录');
      document.getElementById('lEmail').value = email;
      switchTo('login');
    } catch (e) { toast(e.message, 'err'); }
  };
  
  api.get('/api/rules').then((r) => {
    const names = r.allowedEmailDomains.map((d) => d.split('.')[0]);
    document.getElementById('mailHint').textContent =
      `仅支持 ${names.join(' / ')} 邮箱，其它域名无法注册`;
    document.getElementById('ipRule').textContent =
      `同一网络最多注册 ${r.maxAccountsPerIp} 个账号，超限账号一经发现将被全部封禁。`;
    document.getElementById('agreeLabel').innerHTML =
      `我已阅读并同意<a href="/terms" target="_blank">《服务条款与免责声明》</a>，了解并接受禁止滥用与免责条款`;
  }).catch((e) => console.error("初始化失败", e));
  
  // 后台开启「注册需要验证码」时才显示验证码输入框
  api.get('/api/config').then((cfg) => {
    if (cfg && (cfg.mailVerifyRequired || cfg.verifyRequired)) {
      const f = document.getElementById('rCodeField');
      if (f) f.style.display = '';
    }
  }).catch((e) => console.error("初始化失败", e));
  
  // 登录态探测已由 head 脚本完成（命中则直接跳控制台），这里不再重复请求
  
  // 从 WHOIS 页带名称过来：/?q=xxx
  const preQ = new URLSearchParams(location.search).get('q');
  if (preQ) { switchTo('reg'); document.getElementById('rEmail').focus(); }
  
}
