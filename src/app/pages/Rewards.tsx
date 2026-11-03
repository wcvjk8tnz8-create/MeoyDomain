import { useEffect, useRef } from 'react';
import { mountRewards } from '../legacy/rewards';
import { refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/** Rewards —— 由 rewards.html 迁移，页面结构与交互逻辑 100% 保留 */
export default function RewardsPage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = false;
    let alive = true;
    (async () => {
      try { await mountRewards(ref.current); } catch (e) { console.error('[rewards] 页面初始化失败', e); }
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
          <h1 className="page-title">奖励中心</h1>
          <p className="page-sub">用兑换码兑换域名永久化与配额</p>
        </div>
      
        <div className="card">
          <h2>兑换</h2>
          <div className="row" style={{alignItems: "flex-end", gap: "9px"}}>
            <div style={{flex: "1", minWidth: "200px"}}>
              <label>兑换码</label>
              <input id="code" placeholder="V-A1B2C3 或 PE-XXXXXXX" autocomplete="off" style={{textTransform: "uppercase"}} />
            </div>
            <button className="btn" id="btnPreview" style={{flex: "0 0 auto"}}>识别</button>
          </div>
          <div className="hint" id="previewTip">输入兑换码后点「识别」，可先确认它是什么类型。</div>
      
          <div id="permRow" style={{display: "none", marginTop: "12px"}}>
            <label>要永久化的域名（V 码需要）</label>
            <select id="permSel"></select>
            <div className="hint">兑换后该域名变为<b>永久有效</b>，不再有到期时间。</div>
          </div>
      
          <div className="row end" style={{marginTop: "14px"}}>
            <button className="btn primary" id="btnRedeem">立即兑换</button>
          </div>
        </div>
      
        <div className="card">
          <h2>我的兑换记录</h2>
          <div id="myLogs" className="tablewrap"><div className="empty">加载中…</div></div>
        </div>
      
        <div className="card" id="adminBox" style={{display: "none"}}>
          <h2>管理员 · 派发券</h2>
          <div className="hint" style={{margin: "-4px 0 12px"}}>
            一张券 = 一个码，所有人都能领，<b>每个账号限用 1 次</b>，券本身有总使用量（默认 10000）。
          </div>
          <div className="grid2">
            <div>
              <label>类型</label>
              <select id="gType">
                <option value="permanent">V 码 · 域名永久化</option>
                <option value="quota">PE 码 · 配额</option>
              </select>
            </div>
            <div>
              <label>数量</label>
              <input id="gCount" type="number" min="1" max="200" value="1" />
            </div>
            <div id="gValueWrap" style={{display: "none"}}>
              <label>配额数量</label>
              <input id="gValue" type="number" min="1" max="999" value="1" />
              <div className="hint">填 -1 可派发「无限配额」</div>
            </div>
            <div>
              <label>券总使用量</label>
              <input id="gMax" type="number" min="1" value="10000" />
              <div className="hint">这张券总共可以被兑换多少次。每个账号限用 1 次。</div>
            </div>
            <div>
              <label>有效期（天，留空长期）</label>
              <input id="gDays" type="number" min="0" placeholder="留空=长期" />
            </div>
            <div>
              <label>备注（派发给谁）</label>
              <input id="gNote" placeholder="例如：活动奖励" />
            </div>
          </div>
          <div className="row end" style={{marginTop: "12px"}}>
            <button className="btn danger" id="btnPurge">清空全部券</button>
            <button className="btn primary" id="btnGen">生成</button>
          </div>
          <div id="genOut" style={{marginTop: "12px"}}></div>
        </div>
      
        <div className="card" id="adminList" style={{display: "none"}}>
          <h2>管理员 · 兑换码列表</h2>
          <div id="listWrap" className="tablewrap"><div className="empty">加载中…</div></div>
        </div>
      
      </div></main>
      
      <div id="toast"></div>
    </div>
  );
}
