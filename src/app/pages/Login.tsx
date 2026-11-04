import { useEffect, useRef } from 'react';
import { mountLogin } from '../legacy/index';
import { refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/** Login —— 由 index.html 迁移，页面结构与交互逻辑 100% 保留 */
export default function LoginPage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = true;
    let alive = true;
    (async () => {
      try { await mountLogin(ref.current); } catch (e) { console.error('[index] 页面初始化失败', e); }
      if (alive) refreshRuntime();
    })();
    return () => { alive = false; cleanupPage(); };
  }, []);
  return (
    <div className="page-root" ref={ref}>
      <div id="bg"></div>
      
      {/* 顶部导航 */}
      <header className="site-nav">
        <div className="site-nav-in">
          <a className="brand" href="/">
            <img id="navLogo" src="/img/logo.jpg" alt="TerraDomain" />
            <span className="brand-name" data-site-name>TerraDomain</span>
          </a>
          <div className="spacer"></div>
          <nav className="site-links">
            <a href="#" id="navReg">注册账号</a>
            <a href="/whois">WHOIS 查询</a>
            <a href="/">返回首页</a>
            <a href="/terms">服务条款</a>
            <span id="bgsw"></span>
          <a href="/home" className="top-link">首页</a>
          </nav>
        </div>
      </header>
      
      <div className="auth-wrap">
        {/* 左：登录 / 注册 */}
        <section className="auth-card">
          <div className="tabs">
            <button className="tab active" id="tabLogin">登录</button>
            <button className="tab" id="tabReg">注册</button>
            <span className="spacer"></span>
          </div>
      
          {/* 登录 */}
          <div id="paneLogin">
            <h2 className="auth-title">欢迎回来</h2>
            <p className="auth-sub">登录后即可管理你的二级子域名与 DNS 记录</p>
      
            <div className="field">
              <label>邮箱</label>
              <input id="lEmail" type="email" placeholder="yourname@gmail.com" autocomplete="username" />
            </div>
            <div className="field">
              <label>密码</label>
              <input id="lPass" type="password" placeholder="请输入密码" autocomplete="current-password" />
            </div>
      
            <div className="row between" style={{marginBottom: "14px"}}>
              <label className="check" style={{margin: "0"}}>
                <input type="checkbox" id="lRemember" checked />
                <span>记住我（90 天免登录）</span>
              </label>
              <a href="#" id="forgotLink" style={{fontSize: "12px"}}>忘记密码？</a>
            </div>
      
            <button className="btn primary block" id="btnLogin">登录账户</button>
          </div>
      
          {/* 忘记密码：邮箱验证码重置 */}
          <div id="paneReset" className="hidden">
            <h2 className="auth-title">重置密码</h2>
            <p className="auth-sub">通过邮箱验证码重置，验证通过后即可设置新密码</p>
      
            <div className="field">
              <label>邮箱</label>
              <input id="fEmail" type="email" placeholder="yourname@gmail.com" autocomplete="username" />
            </div>
            <div className="field">
              <label>验证码</label>
              <div className="row" style={{gap: "8px", flexWrap: "nowrap"}}>
                <input id="fCode" placeholder="6 位数字" inputmode="numeric" maxlength="6" style={{flex: "1", minWidth: "0"}} />
                <button className="btn sm" id="btnSendReset" style={{whiteSpace: "nowrap"}}>发送验证码</button>
              </div>
              <div className="hint" id="fCodeHint">验证码 10 分钟内有效</div>
            </div>
            <div className="field">
              <label>新密码</label>
              <input id="fPass" type="password" placeholder="至少 8 位" autocomplete="new-password" />
            </div>
      
            <button className="btn primary block" id="btnReset">确认重置</button>
            <div style={{textAlign: "center", marginTop: "12px"}}>
              <a href="#" id="backLogin" style={{fontSize: "12.5px"}}>返回登录</a>
            </div>
          </div>
      
          {/* 注册 */}
          <div id="paneReg" className="hidden">
            <h2 className="auth-title">创建账号</h2>
            <p className="auth-sub">注册后即可申请根域名下的二级子域名</p>
      
            <div className="field">
              <label>邮箱</label>
              <input id="rEmail" type="email" placeholder="yourname@gmail.com" autocomplete="username" />
              <div className="hint" id="mailHint">仅支持 Gmail / QQ 邮箱</div>
            </div>
            <div className="field">
              <label>密码</label>
              <input id="rPass" type="password" placeholder="至少 8 位" autocomplete="new-password" />
            </div>
            <div className="field" id="rCodeField" style={{display: "none"}}>
              <label>邮箱验证码</label>
              <div className="row" style={{gap: "8px", flexWrap: "nowrap"}}>
                <input id="rCode" placeholder="6 位数字" inputmode="numeric" maxlength="6" style={{flex: "1", minWidth: "0"}} />
                <button className="btn sm" id="btnSendReg" style={{whiteSpace: "nowrap"}}>发送验证码</button>
              </div>
              <div className="hint" id="rCodeHint">注册前需先验证邮箱</div>
            </div>
      
            <div className="alert warn" style={{marginBottom: "10px"}} id="ipRule">
              同一网络最多注册 2 个账号，超限账号一经发现将被全部封禁。
            </div>
      
            <label className="check" style={{marginBottom: "12px"}}>
              <input type="checkbox" id="rAgree" />
              <span id="agreeLabel">我已阅读并同意《服务条款与免责声明》，了解并接受禁止滥用与免责条款</span>
            </label>
      
            <button className="btn primary block" id="btnReg">注册账户</button>
          </div>
        </section>
      
        {/* 右：信息模块（参考 DNSHE 的侧栏布局） */}
        <aside className="auth-side">
          <div className="side-mod">
            <h3>账户控制台</h3>
            <p>登录后可在控制台查看你名下的全部子域名，管理 A、AAAA、CNAME、MX、TXT、NS、SRV、CAA、NAPTR、DS 等记录，并对接 Vercel、Netlify 等平台的根域名验证。</p>
          </div>
      
          <div className="side-mod">
            <h3>注册域名</h3>
            <ol>
              <li>注册账号并同意服务条款</li>
              <li>提交子域名申请，填写用途说明</li>
              <li>等待管理员审核（通常很快）</li>
              <li>通过后自行添加所需 DNS 记录</li>
            </ol>
            <p className="dim">创建子域名时不会写入任何 DNS 记录。</p>
          </div>
      
          <div className="side-mod">
            <h3>产品服务</h3>
            <ul className="svc">
              <li><b>免费二级域名</b><span>根域名下自由申请</span></li>
              <li><b>多类型解析</b><span>覆盖 10 余种主流记录</span></li>
              <li><b>根域名验证</b><span>Vercel / Netlify / DNSPod</span></li>
              <li><b>Cloudflare 加持</b><span>全球 Anycast 解析</span></li>
            </ul>
          </div>
      
          <div className="side-mod warn">
            <h3>账户安全提醒</h3>
            <p>本站不会以任何理由索要你的密码。请勿使用弱密码或在多处复用同一密码。</p>
            <p className="dim">严禁用于钓鱼、欺诈、恶意程序、垃圾邮件等滥用行为，违者立即封禁。</p>
            <a href="/terms" target="_blank">查看禁止滥用清单 →</a>
          </div>
        </aside>
      </div>
      
      <div id="toast"></div>
    </div>
  );
}
