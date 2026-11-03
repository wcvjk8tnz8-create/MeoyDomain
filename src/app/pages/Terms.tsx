import { useEffect, useRef } from 'react';
import { mountTerms } from '../legacy/terms';
import { refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/** Terms —— 由 terms.html 迁移，页面结构与交互逻辑 100% 保留 */
export default function TermsPage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = true;
    let alive = true;
    (async () => {
      try { await mountTerms(ref.current); } catch (e) { console.error('[terms] 页面初始化失败', e); }
      if (alive) refreshRuntime();
    })();
    return () => { alive = false; cleanupPage(); };
  }, []);
  return (
    <div className="page-root" ref={ref}>
      <div id="bg"></div>
      <header className="topbar" id="topbar"></header>
      <aside className="sidebar" id="sidebar"></aside>
      
      <main className="main"><div className="main-in"><div className="wrap" style={{maxWidth: "820px"}}>
        <div style={{marginBottom: "14px"}}>
          <a href="/dashboard" id="backLink" style={{fontSize: "12.5px"}}>返回</a>
        </div>
        <h1>服务条款与免责声明</h1>
        <div className="sub" id="meta"></div>
      
        <div className="card" id="body">加载中…</div>
      </div></main>
      
      <div id="toast"></div>
    </div>
  );
}
