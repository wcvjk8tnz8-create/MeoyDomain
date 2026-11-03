import { useEffect, useRef } from 'react';
import { mountTransfer } from '../legacy/transfer';
import { refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/** Transfer —— 由 transfer.html 迁移，页面结构与交互逻辑 100% 保留 */
export default function TransferPage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = false;
    let alive = true;
    (async () => {
      try { await mountTransfer(ref.current); } catch (e) { console.error('[transfer] 页面初始化失败', e); }
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
        <h1>域名转移</h1>
        <div className="sub" style={{margin: "-6px 0 16px"}}>把域名转给本站的另一个账号</div>
      
        {/* 四步进度条 */}
        <div className="card">
          <div className="steps" id="steps">
            <div className="step on" data-s="1"><span className="s-num">1</span><span className="s-txt">转移须知</span></div>
            <div className="step" data-s="2"><span className="s-num">2</span><span className="s-txt">域名转移</span></div>
            <div className="step" data-s="3"><span className="s-num">3</span><span className="s-txt">转移确认</span></div>
            <div className="step" data-s="4"><span className="s-num">4</span><span className="s-txt">转移提交</span></div>
          </div>
          <div className="alert warn" style={{margin: "14px 0"}}>
            <b>域名转移不可逆</b>：转移成功后你失去该域名及全部 DNS 记录的权限，本站无法协助找回。
          </div>
        </div>
      
        {/* 第 1 步：须知 */}
        <div className="card pane" id="pane1">
          <h2>转移须知</h2>
          <div className="notice-list" id="noticeList">加载中…</div>
          <div className="field" style={{marginTop: "14px"}}>
            <label className="check"><input type="checkbox" id="ag1" /> 我已阅读并同意转移须知</label>
            <label className="check" style={{marginTop: "8px"}}><input type="checkbox" id="ag2" /> 我了解转移成功后域名无法找回</label>
          </div>
          <div className="row end"><button className="btn primary" id="next1">下一步</button></div>
        </div>
      
        {/* 第 2 步：选择域名与接收账号 */}
        <div className="card pane" id="pane2" style={{display: "none"}}>
          <h2>域名转移</h2>
          <div className="field">
            <label>选择域名</label>
            <select id="selDom"></select>
            <div className="hint">仅显示你名下<b>已开通</b>的域名。</div>
          </div>
          <div className="field">
            <label>接收账号</label>
            <input id="inpTo" placeholder="对方在本站注册的邮箱" />
            <div className="hint" id="chkTip"></div>
          </div>
          <div className="row" style={{gap: "6px"}}>
            <button className="btn" id="prev2">上一步</button>
            <button className="btn primary" id="next2">下一步</button>
          </div>
        </div>
      
        {/* 第 3 步：确认 */}
        <div className="card pane" id="pane3" style={{display: "none"}}>
          <h2>转移确认</h2>
          <div className="kv" id="confirmBox"></div>
          <div className="field" style={{marginTop: "12px"}}>
            <label className="check"><input type="checkbox" id="ag3" /> 我确认以上信息无误，并知悉转移不可撤销</label>
          </div>
          <div className="row" style={{gap: "6px"}}>
            <button className="btn" id="prev3">上一步</button>
            <button className="btn primary" id="next3">下一步</button>
          </div>
        </div>
      
        {/* 第 4 步：提交 */}
        <div className="card pane" id="pane4" style={{display: "none"}}>
          <h2>转移提交</h2>
          <div className="alert danger" style={{marginBottom: "13px"}}>
            点击下方按钮即完成转移，此操作<b>立即生效且不可撤销</b>。
          </div>
          <div className="kv" id="finalBox"></div>
          <div className="row" style={{gap: "6px", marginTop: "14px"}}>
            <button className="btn" id="prev4">上一步</button>
            <button className="btn danger" id="btnCommit">确认转移</button>
          </div>
        </div>
      
        {/* 转移记录 */}
        <div className="card">
          <h2>我的转移记录</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>域名</th><th>接收方</th><th>时间</th></tr></thead>
              <tbody id="hisList"><tr><td colspan="3" className="empty">加载中…</td></tr></tbody>
            </table>
          </div>
        </div>
      </div></div></main>
      
      <div className="modal" id="modal"><div className="modal-card" id="modalCard"></div></div>
      <div className="toast" id="toast"></div>
    </div>
  );
}
