import { useEffect, useRef } from 'react';
import { mountHome } from '../legacy/home';
import { refreshRuntime, cleanupPage } from '../lib/runtime';

/**
 * Home —— 视觉参考 nic.fj.kg / Zerexa Domains：
 * 超大黑体标题、整行搜索框（前缀 + 根域名下拉 + 黑色查询按钮）、
 * 三个胶囊入口、四张指标卡。保留 legacy 控制器全部 id。
 */
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
            <span><b data-site-name>TerraDomain</b><i>Free subdomains</i></span>
          </a>
          <nav className="home-nav">
            <a href="#features">特性</a>
            <a href="#pricing">价格</a>
            <a href="#faq">常见问题</a>
            <a className="btn sm ghost zx-nav-btn" href="/dashboard">管理控制台</a>
            <a className="btn sm primary zx-nav-cta" href="/">立即注册</a>
          </nav>
        </div>
      </header>

      {/* ══ Hero ══ */}
      <section className="zx-hero nk-hero cloud-bg" data-cloud-speed="0.9">
        <div className="nk-wrap">
          <div className="zx-kicker">OPEN REGISTRATION <span>·</span> 5 FREE DOMAINS PER EMAIL</div>
          <h1 className="zx-title">属于你的<span>专属子域名</span></h1>
          <p className="zx-sub">免费注册子域名，自行管理 DNS 记录。每个邮箱默认 5 个额度，管理员可在后台调整配额。</p>

          <form className="zx-search" id="searchForm">
            <input id="qName" placeholder="输入你想要的前缀" autoComplete="off" spellCheck={false} aria-label="域名前缀" />
            <div className="zx-root-wrap" data-no-i18n>
              <select id="qRoot" aria-label="选择根域名"></select>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>
            </div>
            <button type="submit" className="zx-search-btn">查询</button>
          </form>
          <div className="zx-results" id="results"></div>

          <div className="zx-pills">
            <a className="on" href="#suffix">选择前缀并注册</a>
            <a href="/dashboard">添加 TXT 验证</a>
            <a href="/dashboard">查看我的域名</a>
          </div>

          <div className="zx-metrics" id="pricing">
            <div className="zx-metric"><span className="zx-m-lbl">免费额度</span><b>5 个 / 邮箱</b><small>可在后台调整</small></div>
            <div className="zx-metric"><span className="zx-m-lbl">开通时效</span><b>审核后即时</b><small>AI 后缀可秒批</small></div>
            <div className="zx-metric"><span className="zx-m-lbl">解析方式</span><b>完整 DNS</b><small>12+ 种记录类型</small></div>
            <div className="zx-metric"><span className="zx-m-lbl">有效期</span><b>365 天</b><small>到期前 180 天可续</small></div>
          </div>
        </div>
      </section>

      {/* ══ 可选后缀 ══ */}
      <section className="nk-sec" id="suffix">
        <div className="nk-wrap">
          <h2 className="nk-h2">可选后缀</h2>
          <div className="nk-suffix" id="suffixGrid">
            <div className="nk-sk">加载中…</div>
          </div>
        </div>
      </section>

      {/* ══ 核心服务 ══ */}
      <section className="nk-sec nk-sec-alt" id="features">
        <div className="nk-wrap">
          <h2 className="nk-h2">为什么选择 TerraDomain</h2>
          <p className="nk-sub">免费额度、完整 DNS 与独立控制台，适合个人站点、Demo 和轻量服务。</p>
          <div className="nk-svc">
            <div className="card nk-svc-card">
              <div className="nk-svc-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2c1.3 0 2.6 2 3.2 5H8.8C9.4 6 10.7 4 12 4ZM4.3 9h3.1c-.1 1-.2 2.1-.2 3s.1 2 .2 3H4.3a8 8 0 0 1 0-6Z" /></svg></div>
              <h3>永久免费的域名注册</h3>
              <p>注册即拥有完整管理权，免费续期，无需任何费用与信用卡。</p>
            </div>
            <div className="card nk-svc-card">
              <div className="nk-svc-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10v2H4V6Zm14 0h2v2h-2V6ZM4 11h6v2H4v-2Zm10 0h6v2h-6v-2ZM4 16h10v2H4v-2Zm14 0h2v2h-2v-2Z" /></svg></div>
              <h3>完善的 DNS 管理</h3>
              <p>12 种记录类型、自定义 TTL、Cloudflare 代理、根域名验证一应俱全。</p>
            </div>
            <div className="card nk-svc-card">
              <div className="nk-svc-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6a2 2 0 0 1 2-2Z" /></svg></div>
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
            <span>免费 DNS</span><span>专业级权威解析</span><span>12+ 记录类型</span>
            <span>根域名验证</span><span>域名托管委派</span><span>DNSSEC 就绪</span>
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
      <section className="nk-sec nk-sec-alt" id="faq">
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
              <div className="card"><h3>Web 查询页</h3><p>访问 <a href="/whois">WHOIS 查询</a>，支持查询本站子域名，以及 DNSHE / 任意外部域名。</p></div>
              <div className="card"><h3>Whois LookUP</h3><p>自动识别输入归属：本站走 D1 实时状态，外部域名走 DNSHE 公开 WHOIS 或 RDAP。</p></div>
              <div className="card"><h3>DNS 工具</h3><p>在域名详情页自助添加 A / AAAA / CNAME / MX / TXT 等记录，并支持平台验证一键写入。</p></div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ 页脚 ══ */}
      <footer className="nk-foot">
        <div className="nk-wrap">
          <div className="nk-foot-in">
            <div className="nk-fcol">
              <div className="nk-fbrand"><img data-logo-img src="/img/logo.jpg" alt="" /><span data-site-name>TerraDomain</span></div>
              <p className="nk-fdesc">免费、开源的二级域名分发与 DNS 管理系统。<br />基于 Cloudflare Workers + D1。</p>
            </div>
            <div className="nk-fcol"><h4>服务</h4><a href="/whois">WHOIS 查询</a><a href="/dashboard">域名管理</a><a href="/terms">服务条款</a></div>
            <div className="nk-fcol"><h4>开源</h4><a href="https://github.com/wcvjk8tnz8-create/MeoyDomain" target="_blank" rel="noopener noreferrer">GitHub</a><a href="https://github.com/wcvjk8tnz8-create/MeoyDomain/issues" target="_blank" rel="noopener noreferrer">问题反馈</a><span className="nk-fdim">MIT License</span></div>
          </div>
          <div className="nk-fbottom">
            <span>© <span id="yr">2026</span> <b>TerraDomain</b> · 二级域名分发</span>
            <a href="https://github.com/wcvjk8tnz8-create/MeoyDomain" target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>
        </div>
      </footer>

      <div className="toast" id="toast"></div>
    </div>
  );
}
