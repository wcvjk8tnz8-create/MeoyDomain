import { useEffect, useRef } from 'react';
import { mountTickets } from '../legacy/tickets';
import { refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/** Tickets —— 由 tickets.html 迁移，页面结构与交互逻辑 100% 保留 */
export default function TicketsPage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = false;
    let alive = true;
    (async () => {
      try { await mountTickets(ref.current); } catch (e) { console.error('[tickets] 页面初始化失败', e); }
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
        <div className="row between" style={{marginBottom: "14px", flexWrap: "wrap", gap: "9px"}}>
          <div>
            <h1>工单系统</h1>
            <div className="sub" style={{margin: "0"}}>遇到问题？提交工单，管理员会尽快回复</div>
          </div>
          <button className="btn primary" id="btnNew">提交工单</button>
        </div>
      
        <div className="card">
          <div className="row" style={{gap: "6px", flexWrap: "wrap", marginBottom: "12px"}} id="filters">
            <button className="btn sm primary" data-st="">全部</button>
            <button className="btn sm" data-st="open">待处理</button>
            <button className="btn sm" data-st="pending">处理中</button>
            <button className="btn sm" data-st="answered">有回复</button>
            <button className="btn sm" data-st="closed">已关闭</button>
          </div>
      
          <div className="tablewrap">
            <table>
              <thead><tr>
                <th>标题</th><th>状态</th><th>回复</th><th id="thUser">提交人</th><th>更新时间</th><th className="right">操作</th>
              </tr></thead>
              <tbody id="list"><tr><td colspan="6" className="empty">加载中…</td></tr></tbody>
            </table>
          </div>
      
          <div className="row between" style={{marginTop: "12px", flexWrap: "wrap", gap: "9px"}}>
            <div className="sub" id="pageInfo" style={{margin: "0"}}></div>
            <div className="row" style={{gap: "6px"}}>
              <button className="btn sm" id="btnPrev">上一页</button>
              <button className="btn sm" id="btnNext">下一页</button>
            </div>
          </div>
        </div>
      </div></div></main>
      
      <div className="modal" id="modal"><div className="modal-card" id="modalCard"></div></div>
      <div className="toast" id="toast"></div>
    </div>
  );
}
