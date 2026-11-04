import { useEffect, useRef } from 'react';
import { mountWhois } from '../legacy/whois';
import { refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/** Whois —— 由 whois.html 迁移，页面结构与交互逻辑 100% 保留 */
export default function WhoisPage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = true;
    let alive = true;
    (async () => {
      try { await mountWhois(ref.current); } catch (e) { console.error('[whois] 页面初始化失败', e); }
      if (alive) refreshRuntime();
    })();
    return () => { alive = false; cleanupPage(); };
  }, []);
  return (
    <div className="page-root" ref={ref}>
      <div id="bg"></div>
      <header className="topbar" id="topbar"></header>
      <aside className="sidebar" id="sidebar"></aside>
      
      <main className="main"><div className="main-in"><div className="wrap" style={{maxWidth: "760px"}}>
        <h1>WHOIS 查询</h1>
        <div className="sub" id="rootTip">查询某个二级子域名的注册状态</div>
        <div className="hint" id="hostTip" style={{margin: "0 0 12px"}}></div>

        <div className="card">
          <label>域名</label>
          <div className="whois-search">
            <input id="q" placeholder="me" autocomplete="off" spellCheck={false} aria-label="域名前缀或完整域名" />
            <div className="whois-root-wrap" data-no-i18n>
              <select id="whoisRootSel" aria-label="选择根域名"></select>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>
            </div>
            <button className="btn primary" id="btnQuery">查询</button>
          </div>
          {/* 兼容旧控制器：保留隐藏节点，避免 null 引用 */}
          <span id="rootSuffix" className="mono" style={{display: "none"}}></span>
          <div className="hint" style={{marginTop: "8px"}}>
            只写前缀（如 <span className="mono">me</span>）时按右侧选中的根域名查询，<b>切换下拉即可查其它后缀</b>；
            输入完整域名（如 <span className="mono">example.com</span>、<span className="mono">foo.de5.net</span>）可查<b>任意域名</b>。
          </div>
        </div>
      
        <div className="card" id="result" style={{display: "none"}}></div>
      
        <div className="card flat">
          <h3>说明</h3>
          <div style={{color: "var(--text-2)", fontSize: "12.5px", lineHeight: "1.9"}}>
            · <b>本站子域名</b>：只写前缀即可，显示注册状态、持有人与积分价格。<br />
            · <b>任意域名</b>：输入完整域名，DNSHE 系（<span className="mono">de5.net</span> / <span className="mono">us.ci</span> / <span className="mono">cc.cd</span> / <span className="mono">ccwu.cc</span> / <span className="mono">bot.cd</span>）走 DNSHE 公开接口，其它后缀走 RDAP 注册局数据。<br />
            · <b>可注册</b>：名称未被占用，可立即申请。<br />
            · <b>审核中</b>：已有人提交申请，等待管理员审核。<br />
            · <b>已注册</b>：已被注册并生效。<br />
            · <b>已驳回</b>：申请未通过，原申请人可修正后重新申请。<br />
            · <b>已停用</b>：因违规被停用。<br />
            · 持有人邮箱默认脱敏显示，本人与管理员可见完整地址。<br />
            · 外部查询结果缓存 6 小时，避免触发上游限流。
          </div>
        </div>
      </div></div></main>
      
      <div id="toast"></div>
    </div>
  );
}
