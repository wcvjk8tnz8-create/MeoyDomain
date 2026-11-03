import { useEffect, useRef } from 'react';
import { mountHome } from '../legacy/home';
import { refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/** Home —— 由 home.html 迁移，页面结构与交互逻辑 100% 保留 */
export default function HomePage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = "page-home has-cloud";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = true;
    let alive = true;
    (async () => {
      try { await mountHome(ref.current); } catch (e) { console.error('[home] 页面初始化失败', e); }
      if (alive) refreshRuntime();
    })();
    return () => { alive = false; cleanupPage(); };
  }, []);
  return (
    <div className="page-root" ref={ref}>
      <div id="bg" aria-hidden="true"></div>
      <div className="home-grid-bg" aria-hidden="true"></div>
      
      {/* ══ 顶栏 ══ */}
      <header className="home-top">
        <div className="home-top-in">
          <a className="home-brand" href="/home">
            <img data-logo-img src="/img/logo.jpg" alt="" />
            <span><b data-site-name>Meoy</b><i>二级域名分发</i></span>
          </a>
          <nav className="home-nav">
            <a href="/terms">Language</a>
            <a href="/">登录</a>
            <a href="/">注册</a>
            <a className="btn sm primary" href="/whois">关于</a>
          </nav>
        </div>
      </header>
      
      {/* ══ Hero ══ */}
      <section className="nk-hero cloud-bg" data-cloud-speed="0.9">
        <div className="nk-wrap">
          <div className="nk-hero-in">
            <div className="nk-hero-txt">
              <h1 className="nk-h1">免费域名注册</h1>
              <p className="nk-lead">永久免费的二级域名注册与 DNS 解析管理。<br />即刻部署，几分钟即可上线你的服务。</p>
              <div className="nk-cta">
                <a className="btn primary" href="/">立即开始</a>
                <a className="btn" href="#search">查找可用域名</a>
              </div>
            </div>
            <div className="nk-hero-art">
              <img src="/img/neko.jpg" alt="Miku" width="900" height="750" />
            </div>
          </div>
        </div>
      </section>
      
      {/* ══ 可选后缀 ══ */}
      <section className="nk-sec">
        <div className="nk-wrap">
          <h2 className="nk-h2">域名注册 可选后缀</h2>
          <div className="nk-suffix" id="suffixGrid">
            <div className="nk-sk">加载中…</div>
          </div>
        </div>
      </section>
      
      {/* ══ 域名查询 ══ */}
      <section className="nk-sec nk-sec-search" id="search">
        <div className="nk-wrap">
          <div className="nk-search-box">
            <div className="nk-s-tag">DOMAIN SEARCH</div>
            <h2 className="nk-h2" style={{marginBottom: "6px"}}>查找可用域名</h2>
            <p className="nk-sub">请输入域名前缀，仅前缀（不需要带后缀）</p>
            <form className="nk-sbar" id="searchForm">
              <span className="nk-sbar-pre">https://</span>
              <input id="qName" placeholder="例如：my-project" autocomplete="off" spellcheck="false" />
              <span className="nk-sbar-suf">.<span id="qRoot">meoy.top</span></span>
              <button type="submit" className="btn primary">立即查询</button>
            </form>
            <div className="nk-results" id="results"></div>
          </div>
        </div>
      </section>
      
      {/* ══ 核心服务 ══ */}
      <section className="nk-sec">
        <div className="nk-wrap">
          <h2 className="nk-h2">MeoyDomain 核心服务</h2>
          <div className="nk-svc">
            <div className="card nk-svc-card">
              <div className="nk-svc-ico">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2c1.3 0 2.6 2 3.2 5H8.8C9.4 6 10.7 4 12 4ZM4.3 9h3.1c-.1 1-.2 2.1-.2 3s.1 2 .2 3H4.3a8 8 0 0 1 0-6Z" /></svg>
              </div>
              <h3>永久免费的域名注册</h3>
              <p>注册即拥有完整管理权，免费续期，无需任何费用与信用卡。</p>
            </div>
            <div className="card nk-svc-card">
              <div className="nk-svc-ico">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10v2H4V6Zm14 0h2v2h-2V6ZM4 11h6v2H4v-2Zm10 0h6v2h-6v-2ZM4 16h10v2H4v-2Zm14 0h2v2h-2v-2Z" /></svg>
              </div>
              <h3>完善的 DNS 管理</h3>
              <p>12 种记录类型、自定义 TTL、Cloudflare 代理、根域名验证一应俱全。</p>
            </div>
            <div className="card nk-svc-card">
              <div className="nk-svc-ico">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6a2 2 0 0 1 2-2Z" /></svg>
              </div>
              <h3>免费技术支持</h3>
              <p>内置工单系统与讨论区，遇到问题可随时提交，社区与管理员共同协助。</p>
            </div>
          </div>
        </div>
      </section>
      
      {/* ══ 蓝色特性条 ══ */}
      <section className="nk-bar">
        <div className="nk-wrap">
          <div className="nk-bar-in">
            <span>免费 DNS</span>
            <span>专业级权威解析</span>
            <span>12+ 记录类型</span>
            <span>根域名验证</span>
            <span>域名托管委派</span>
            <span>DNSSEC 就绪</span>
          </div>
        </div>
      </section>
      
      {/* ══ DNS 解析服务 ══ */}
      <section className="nk-sec">
        <div className="nk-wrap">
          <h2 className="nk-h2">DNS 解析服务</h2>
          <div className="nk-dns3">
            <div className="card"><h3>12+ 种记录类型</h3><p>覆盖网站、邮箱、验证与 DNSSEC 场景。</p></div>
            <div className="card"><h3>记录集与智能解析</h3><p>TTL 可低至 1 分钟，支持 Cloudflare 代理加速。</p></div>
            <div className="card"><h3>大规模承载能力</h3><p>依托 Cloudflare 全球边缘网络，稳定可靠。</p></div>
          </div>
          <div className="nk-tags" id="rtTags"></div>
          <div className="nk-more"><button className="btn sm" id="rtMore">更多…</button></div>
        </div>
      </section>
      
      {/* ══ Whois & DNS 工具 ══ */}
      <section className="nk-sec nk-sec-alt">
        <div className="nk-wrap">
          <h2 className="nk-h2">Whois 查询 &amp; DNS 工具</h2>
          <p className="nk-sub">公开查询接口，无需登录即可调用</p>
          <div className="nk-tools">
            <div className="nk-term">
              <div className="nk-term-bar"><i></i><i></i><i></i><span>bash</span></div>
              <pre className="nk-term-body"><code><span className="c-dim"># 查询子域名状态（公开接口）</span>
      <span className="c-cmd">curl</span> <span className="c-str">"<span id="apiHost">https://meoy.top</span>/api/whois?name=mail"</span>
      
      <span className="c-dim"># 返回示例</span>
      <span className="c-punc">{'{'}</span>
        <span className="c-key">"success"</span>: <span className="c-num">true</span>,
        <span className="c-key">"state"</span>: <span className="c-str">"registered"</span>,
        <span className="c-key">"fqdn"</span>: <span className="c-str">"mail.meoy.top"</span>,
        <span className="c-key">"recordCount"</span>: <span className="c-num">4</span>
      <span className="c-punc">{'}'}</span></code></pre>
            </div>
            <div className="nk-tool-list">
              <div className="card">
                <h3>Web 查询页</h3>
                <p>访问 <a href="/whois">WHOIS 查询</a>，支持查询本站子域名，以及 DNSHE / 任意外部域名。</p>
              </div>
              <div className="card">
                <h3>Whois LookUP</h3>
                <p>自动识别输入归属：本站走 D1 实时状态，外部域名走 DNSHE 公开 WHOIS 或 RDAP。</p>
              </div>
              <div className="card">
                <h3>DNS 工具</h3>
                <p>在域名详情页自助添加 A / AAAA / CNAME / MX / TXT 等记录，并支持平台验证一键写入。</p>
              </div>
            </div>
          </div>
        </div>
      </section>
      
      {/* ══ 深色页脚 ══ */}
      <footer className="nk-foot">
        <div className="nk-wrap">
          <div className="nk-foot-in">
            <div className="nk-fcol">
              <div className="nk-fbrand"><img data-logo-img src="/img/logo.jpg" alt="" /><span data-site-name>Meoy</span></div>
              <p className="nk-fdesc">免费、开源的二级域名分发与 DNS 管理系统。<br />基于 Cloudflare Workers + D1。</p>
            </div>
            <div className="nk-fcol">
              <h4>服务</h4>
              <a href="/whois">WHOIS 查询</a>
              <a href="/">域名管理</a>
              <a href="/terms">服务条款</a>
            </div>
            <div className="nk-fcol">
              <h4>开源</h4>
              <a href="https://github.com/wcvjk8tnz8-create/MeoyDomain" target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href="https://github.com/wcvjk8tnz8-create/MeoyDomain/issues" target="_blank" rel="noopener noreferrer">问题反馈</a>
              <span className="nk-fdim">MIT License</span>
            </div>
          </div>
          <div className="nk-fbottom">
            <span>© <span id="yr">2026</span> <b>MeoyDomain</b> · 二级域名分发</span>
            <a href="https://github.com/wcvjk8tnz8-create/MeoyDomain" target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>
        </div>
      </footer>
      
      <div className="toast" id="toast"></div>
    </div>
  );
}
