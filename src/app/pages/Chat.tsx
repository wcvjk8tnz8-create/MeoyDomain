import { useEffect, useRef } from 'react';
import { mountChat } from '../legacy/chat';
import { refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/** Chat —— 由 chat.html 迁移，页面结构与交互逻辑 100% 保留 */
export default function ChatPage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = false;
    let alive = true;
    (async () => {
      try { await mountChat(ref.current); } catch (e) { console.error('[chat] 页面初始化失败', e); }
      if (alive) refreshRuntime();
    })();
    return () => { alive = false; cleanupPage(); };
  }, []);
  return (
    <div className="page-root" ref={ref}>
      <div id="bg"></div>
      <header className="topbar" id="topbar"></header>
      <aside className="sidebar" id="sidebar"></aside>
      <main className="main"><div className="main-in">
      
        {/* 列表页 */}
        <div id="viewList">
          <div className="page-head">
            <h1 className="page-title">聊天地</h1>
            <p className="page-sub">发帖、讨论、记录点什么</p>
          </div>
      
          <div className="card">
            <div className="row" style={{alignItems: "flex-end", gap: "9px"}}>
              <div style={{flex: "1", minWidth: "180px"}}>
                <label>搜索</label>
                <input id="q" placeholder="标题或内容关键字" />
              </div>
              <button className="btn" id="btnSearch">搜索</button>
              <button className="btn primary" id="btnNew">发新帖</button>
            </div>
          </div>
      
          <div className="card" id="compose" style={{display: "none"}}>
            <h2>发新帖</h2>
            <div className="field"><label>标题</label><input id="pTitle" maxlength="120" placeholder="写点什么…" /></div>
            <div className="field"><label>内容</label><textarea id="pBody" style={{minHeight: "130px"}} maxlength="8000"></textarea></div>
            <div className="row end">
              <button className="btn ghost" id="btnCancel">取消</button>
              <button className="btn primary" id="btnPost">发布</button>
            </div>
          </div>
      
          <div className="card">
            <div id="listBox"><div className="empty">加载中…</div></div>
            <div className="row between" style={{marginTop: "12px"}}>
              <button className="btn sm" id="btnPrev">上一页</button>
              <span className="dim" id="pageTip" style={{fontSize: "12px"}}></span>
              <button className="btn sm" id="btnNext">下一页</button>
            </div>
          </div>
        </div>
      
        {/* 详情页 */}
        <div id="viewPost" style={{display: "none"}}>
          <div className="page-head">
            <button className="btn sm ghost" id="btnBack">← 返回列表</button>
          </div>
          <div className="card">
            <div className="row between" style={{alignItems: "flex-start", marginBottom: "10px"}}>
              <div>
                <h2 id="dTitle" style={{margin: "0 0 5px"}}></h2>
                <div className="hint" style={{margin: "0"}} id="dMeta"></div>
              </div>
              <div id="dFlags"></div>
            </div>
            <div id="dBody" className="post-body"></div>
            <div className="row end" style={{marginTop: "14px"}} id="dOps"></div>
          </div>
      
          <div className="card">
            <h2>回复 <span className="dim" id="rCount"></span></h2>
            <div id="replyBox"><div className="empty">加载中…</div></div>
            <div className="field" style={{marginTop: "14px"}}>
              <label>写回复</label>
              <textarea id="rBody" style={{minHeight: "80px"}} maxlength="3000" placeholder="友善发言"></textarea>
            </div>
            <div className="row end"><button className="btn primary" id="btnReply">发送</button></div>
          </div>
        </div>
      
      </div></main>
      
      <div id="toast"></div>
      
      
      
      <style>{`
.post-row {
        padding: 11px 0;
        border-bottom: 1px solid rgba(123, 108, 246, .1);
        transition: background .16s ease;
      }
      .post-row:hover { background: rgba(123, 108, 246, .05); }
      .post-row:last-child { border-bottom: none; }
      .post-title { font-family: var(--cn); font-size: 14px; font-weight: 600; margin-bottom: 3px; }
      .post-title a { color: var(--ink); text-decoration: none; }
      .post-title a:hover { color: var(--c1-dim); }
      .post-meta { font-size: 11.5px; color: var(--muted); }
      .post-body {
        font-size: 13px; line-height: 1.85; color: var(--text);
        white-space: pre-wrap; word-break: break-word;
      }
      .reply-row {
        padding: 10px 0;
        border-bottom: 1px solid rgba(123, 108, 246, .1);
      }
      .reply-row:last-child { border-bottom: none; }
`}</style>
    </div>
  );
}
