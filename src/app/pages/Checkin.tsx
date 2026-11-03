import { useEffect, useRef } from 'react';
import { mountCheckin } from '../legacy/checkin';
import { refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/** Checkin —— 由 checkin.html 迁移，页面结构与交互逻辑 100% 保留 */
export default function CheckinPage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = false;
    let alive = true;
    (async () => {
      try { await mountCheckin(ref.current); } catch (e) { console.error('[checkin] 页面初始化失败', e); }
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
      
        <div className="page-head">
          <h1 className="page-title">签到地</h1>
          <p className="page-sub">每天来一次，领取积分</p>
        </div>
      
        <div className="card" style={{textAlign: "center", padding: "30px 20px"}}>
          <div id="coin" className="coin">
            <span className="coin-num" id="ptsNum">—</span>
            <span className="coin-unit">积分</span>
          </div>
          <div className="hint" id="ptsTip" style={{margin: "8px 0 16px"}}>加载中…</div>
          <button className="btn primary" id="btnCheck" style={{padding: "10px 30px", fontSize: "14px"}}>今日签到</button>
          <div className="hint" id="checkTip" style={{marginTop: "12px"}}></div>
        </div>
      
        <div className="card">
          <h2>积分明细</h2>
          <div id="logBox" className="tablewrap"><div className="empty">加载中…</div></div>
        </div>
      
        <div className="card flat">
          <h3>积分怎么用</h3>
          <div style={{color: "var(--text-2)", fontSize: "12.5px", lineHeight: "1.9"}}>
            · 每天签到领 <b id="ruleCheckin">5</b> 分，一天只能领一次。<br />
            · 申请一个普通子域名消耗 <b id="ruleCost">5</b> 分。<br />
            · 单字域名（如 <span className="mono">a</span>、<span className="mono">1</span>）需要 <b id="ruleShort">35</b> 分。<br />
            · 管理员不限积分。<br />
            · 想要域名永久化或更多配额？去「<a href="/rewards" style={{color: "var(--c1-dim)"}}>奖励中心</a>」用兑换码。
          </div>
        </div>
      
      </div></main>
      
      <div id="toast"></div>
      
      
      
      <style>{`
.coin { display:inline-flex; align-items:baseline; gap:7px; justify-content:center; }
      .coin-num {
        font-family: var(--mono);
        font-size: 44px; font-weight: 700;
        background: linear-gradient(100deg, var(--c1), var(--c2));
        -webkit-background-clip: text; background-clip: text; color: transparent;
        line-height: 1.1;
      }
      .coin-unit { font-size: 13px; color: var(--muted); }
      .coin.pop { animation: coinPop .5s cubic-bezier(.34,1.56,.64,1); }
      @keyframes coinPop {
        0%   { transform: scale(1); }
        40%  { transform: scale(1.16); }
        100% { transform: scale(1); }
      }
`}</style>
    </div>
  );
}
