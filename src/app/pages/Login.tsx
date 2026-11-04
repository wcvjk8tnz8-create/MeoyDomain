import { useEffect, useRef } from 'react';
import { mountLogin } from '../legacy/index';
import { refreshRuntime, cleanupPage } from '../lib/runtime';

/**
 * Login —— 登录 / 注册 / 找回密码三合一。
 * 版式重做：左侧品牌陈述 + 右侧表单卡片，去掉原先右侧四块堆砌的说明模块。
 * 所有 id 与 legacy 控制器一一对应，交互逻辑保持不变。
 */
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

      {/* 顶部导航：只留必要入口，语言切换器由 i18n 运行时注入 */}
      <header className="site-nav">
        <div className="site-nav-in">
          <a className="brand" href="/home">
            <img id="navLogo" src="/img/logo.jpg" alt="TerraDomain" />
            <span className="brand-name" data-site-name>TerraDomain</span>
          </a>
          <div className="spacer"></div>
          <nav className="site-links">
            <a href="#" id="navReg">注册账号</a>
            <a href="/whois">WHOIS 查询</a>
            <a href="/terms">服务条款</a>
            <a href="/home">返回首页</a>
            <span id="bgsw" hidden></span>
          </nav>
        </div>
      </header>

      <div className="auth-wrap">
        {/* 左：品牌陈述 */}
        <section className="auth-intro">
          <div className="auth-eyebrow"><i></i> FREE SUBDOMAINS <span>/</span> DNS HOSTING</div>
          <h1 className="auth-lead">给每个想法，<br />一个好记的地址。</h1>
          <p className="auth-intro-sub">免费申请二级域名，自行管理 DNS 记录，几分钟就能把服务挂上线。</p>

          <div className="auth-feats">
            <div className="auth-feat">
              <b>01</b>
              <div><strong>即时开通</strong><span>审核通过即可使用，无需等待生效</span></div>
            </div>
            <div className="auth-feat">
              <b>02</b>
              <div><strong>完整解析</strong><span>12 种记录类型，平台验证一键写入</span></div>
            </div>
            <div className="auth-feat">
              <b>03</b>
              <div><strong>开源免费</strong><span>基于 Cloudflare Workers + D1</span></div>
            </div>
          </div>

          <div className="auth-intro-foot">
            <span>12+ 种记录类型 · 全球 Anycast 解析 · 永久免费</span>
          </div>
        </section>

        {/* 右：表单卡片 */}
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

            <div className="row between" style={{marginBottom: "16px"}}>
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

            <label className="check" style={{marginBottom: "14px"}}>
              <input type="checkbox" id="rAgree" />
              <span id="agreeLabel">我已阅读并同意《服务条款与免责声明》，了解并接受禁止滥用与免责条款</span>
            </label>

            <button className="btn primary block" id="btnReg">注册账户</button>
          </div>

          <div className="auth-foot">
            <span>本站不会以任何理由索要你的密码</span>
            <a href="/terms">服务条款</a>
          </div>
        </section>
      </div>

      <div id="toast"></div>
    </div>
  );
}
