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
          <div className="row" style={{alignItems: "flex-end", flexWrap: "nowrap"}}>
            <div style={{flex: "1", minWidth: "180px"}}>
              <label>域名</label>
              <div className="row" style={{gap: "0", flexWrap: "nowrap"}}>
                <input id="q" placeholder="me" style={{borderRadius: "var(--radius-s) 0 0 var(--radius-s)", borderRight: "none"}} autocomplete="off" />
                <span className="mono" id="rootSuffix" style={{padding: "0 11px", background: "rgba(0,229,255,.08)", border: "1px solid var(--line)", borderRadius: "0 var(--radius-s) var(--radius-s) 0", display: "flex", alignItems: "center", whiteSpace: "nowrap", color: "var(--c1)", fontSize: "12px"}}>.meoy.top</span>
              </div>
            </div>
            <button className="btn primary" id="btnQuery" style={{flex: "0 0 auto"}}>查询</button>
          </div>
          <div className="hint" style={{marginTop: "6px"}}>
            只写前缀（如 <span className="mono">me</span>）查本站子域名；
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
      </div></main>
      
      <div id="toast"></div>
    </div>
  );
}
