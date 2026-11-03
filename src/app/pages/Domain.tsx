import { useEffect, useRef } from 'react';
import { mountDomain } from '../legacy/domain';
import { refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/** Domain —— 由 domain.html 迁移，页面结构与交互逻辑 100% 保留 */
export default function DomainPage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = false;
    let alive = true;
    (async () => {
      try { await mountDomain(ref.current); } catch (e) { console.error('[domain] 页面初始化失败', e); }
      if (alive) refreshRuntime();
    })();
    return () => { alive = false; cleanupPage(); };
  }, []);
  return (
    <div className="page-root" ref={ref}>
      <div id="bg"></div>
      <header className="topbar" id="topbar"></header>
      <aside className="sidebar" id="sidebar"></aside>
      
      <main className="main"><div className="main-in"><div className="wrap">
          <div style={{marginBottom: "14px"}}>
          <a href="/dashboard" style={{fontSize: "12.5px"}}>← 返回域名管理</a>
          <div className="row between" style={{marginTop: "6px", alignItems: "center"}}>
            <div>
              <span className="fqdn" id="fqdn"></span> <span className="copy" id="copyFqdn">复制</span>
              <span id="statusBadge" style={{marginLeft: "8px"}}></span>
            </div>
          </div>
        </div>
      
        <div id="statusAlert"></div>
      
        <div className="detail-layout">
          <div className="detail-main">
      
            <div className="tabs" id="tabs">
              <button className="tab on" data-tab="overview">概览</button>
              <button className="tab" data-tab="dns">DNS 解析</button>
              <button className="tab" data-tab="ns">DNS 服务器</button>
            </div>
      
            {/* 概览 */}
            <div className="tabpane on" data-pane="overview">
              <div className="card">
                <h2>概览</h2>
                <div id="overviewBox"><div className="empty">加载中…</div></div>
              </div>
            </div>
      
            {/* DNS 解析 */}
            <div className="tabpane" data-pane="dns">
        <div className="card">
          <h2>自助验证</h2>
          <div className="sub" style={{marginBottom: "12px"}}>
            选择域名 → 选择平台 → 主机名会自动填入 → 粘贴平台给出的验证值 → 写入锁定。
            锁定期间任何人都不能修改或删除，只有发起者点击「确认认证完成」后才会移除该验证 TXT。
          </div>
          <div className="field">
            <label>① 选择域名</label>
            <select id="vDomain"></select>
            <div className="hint">验证记录默认写在这条域名所属的<b>根域名</b>下（如 <span className="mono">_vercel.meoy.top</span>）。</div>
          </div>
          <div className="field">
            <label>② 选择平台</label>
            <div className="preset-grid" id="presets"></div>
            <div className="hint" id="presetHint"></div>
          </div>
          <div className="field">
            <label>写入位置</label>
            <div className="row" style={{gap: "6px"}}>
              <button className="btn sm primary" id="scopeRoot" data-scope="root">根域名 · <span className="mono" id="rootLbl"></span></button>
              <button className="btn sm" id="scopeSub" data-scope="sub">本子域名 · <span className="mono" id="subLbl"></span></button>
            </div>
            <div className="hint">Vercel / Netlify / DNSPod 等验证根域名所有权时，记录写在根域名下（如 <span className="mono">_vercel.meoy.top</span>）；若平台只校验你自己的子域名，再选「本子域名」。</div>
          </div>
          <div className="preset-grid" id="presets"></div>
          <div className="grid2">
            <div className="field">
              <label>③ 验证主机名（已按平台自动填入，可微调）</label>
              <input id="vHost" placeholder="_vercel" autocomplete="off" />
              <div className="hint">将生成 <span className="mono" id="vPreview"></span></div>
            </div>
            <div className="field">
              <label>④ 验证值（从平台复制粘贴）</label>
              <textarea id="vValue" placeholder="粘贴平台提供的验证值"></textarea>
            </div>
          </div>
          <div className="row end">
            <button className="btn primary" id="btnVerify">写入并锁定</button>
          </div>
        </div>
      
        <div className="card">
          <div className="row between" style={{marginBottom: "10px"}}>
            <h2 style={{margin: "0"}}>DNS 记录</h2>
            <button className="btn primary sm" id="btnAdd">添加记录</button>
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>类型</th><th>主机名</th><th>记录值</th><th>TTL</th><th>状态</th><th className="right">操作</th></tr></thead>
              <tbody id="recList"><tr><td colspan="6" className="empty">加载中…</td></tr></tbody>
            </table>
          </div>
        </div>
      
        <div className="card flat">
          <h3>常用模板</h3>
          <div className="row" id="tpls" style={{gap: "6px"}}></div>
        </div>
            </div>
      
            {/* DNS 服务器 */}
            <div className="tabpane" data-pane="ns">
        <div className="card">
          <h2>域名托管（NS 委派）</h2>
          <div className="sub" style={{marginBottom: "12px"}}>
            把该子域名的解析权整体交给第三方 DNS（anyns.io / DNSHE / Cloudflare 等）。
            系统会在父区域写入 NS 记录，之后该域名下的全部记录由目标服务商负责，本站不再接管解析。
          </div>
          <div id="delegationBox"><div className="empty">加载中…</div></div>
        </div>
      
        <div className="card flat">
          <div className="row between">
            <h3 style={{margin: "0"}}>SOA 记录</h3>
            <button className="btn sm" id="btnSoa">查看 SOA</button>
          </div>
          <div className="hint" style={{marginTop: "8px"}}>SOA 由 Cloudflare 自动生成，只读，无法通过 API 修改。</div>
        </div>
            </div>
      
          </div>
      
          <aside className="detail-side">
            <div className="card">
              <h2>快捷操作</h2>
              <div className="ops">
                <button className="op-btn" data-act="add"><span>＋</span>添加解析</button>
                <button className="op-btn" data-act="ns"><span>◎</span>DNS 服务器</button>
                <button className="op-btn" data-act="whois"><span>⌕</span>WHOIS 查询</button>
                <button className="op-btn" data-act="renew"><span>↻</span>续期</button>
                <button className="op-btn" data-act="ssl"><span>🔒</span>SSL 证书</button>
              </div>
            </div>
            <div className="card flat">
              <h3>小提示</h3>
              <div style={{color: "var(--text-2)", fontSize: "12px", lineHeight: "1.8"}}>
                创建子域名默认不写入任何 DNS 记录，需要时在「DNS 解析」里添加。
              </div>
            </div>
          </aside>
        </div>
      </div></div></main>
      
      <div className="modal" id="modal"><div className="box"></div></div>
      <div id="toast"></div>
    </div>
  );
}
