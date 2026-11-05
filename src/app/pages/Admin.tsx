import { useEffect, useRef } from 'react';
import { mountAdmin } from '../legacy/admin';
import { refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/** Admin —— 由 admin.html 迁移，页面结构与交互逻辑 100% 保留 */
export default function AdminPage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = false;
    let alive = true;
    (async () => {
      try { await mountAdmin(ref.current); } catch (e) { console.error('[admin] 页面初始化失败', e); }
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
        <h1><span data-site-name>TerraDomain</span> · 管理后台</h1>
        <div className="sub" id="envTip"></div>
      
        <div className="stat-grid" id="stats" style={{marginBottom: "16px"}}></div>
      
        <div className="tabs">
          <button className="tab active" data-tab="pending">待审核</button>
          <button className="tab" data-tab="subs">全部子域名</button>
          <button className="tab" data-tab="users">用户</button>
          <button className="tab" data-tab="locks">验证锁定</button>
          <button className="tab" data-tab="ips">同 IP 账号</button>
          <button className="tab" data-tab="settings">站点设置</button>
          <button className="tab" data-tab="audit">审计日志</button>
        </div>
        <div style={{margin: "-6px 0 14px"}}><a className="btn sm ghost" href="/report">举报滥用 · 处理入口 →</a></div>
      
        <div className="card">
          <div className="tablewrap"><table>
            <thead id="thead"></thead>
            <tbody id="tbody"><tr><td className="empty">加载中…</td></tr></tbody>
          </table></div>
        </div>
      </div></div></main>
      
      <div className="modal" id="modal"><div className="box"></div></div>
      <div id="toast"></div>
    </div>
  );
}
