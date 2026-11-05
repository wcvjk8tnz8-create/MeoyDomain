import { useEffect, useRef } from 'react';
import { mountReport } from '../legacy/report';
import { refreshRuntime, cleanupPage } from '../lib/runtime';

/** 举报滥用域名 —— 公开入口（无需登录即可提交），管理员在此处理 */
export default function ReportPage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = '';
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = true;
    let alive = true;
    (async () => {
      try { await mountReport(ref.current); } catch (e) { console.error('[report] 页面初始化失败', e); }
      if (alive) refreshRuntime();
    })();
    return () => { alive = false; cleanupPage(); };
  }, []);
  return (
    <div className="page-root" ref={ref}>
      <div id="bg"></div>
      <header className="topbar" id="topbar"></header>
      <aside className="sidebar" id="sidebar"></aside>
      <main className="main"><div className="main-in"><div className="wrap" style={{maxWidth: '900px'}}>

        <div className="page-head">
          <h1 className="page-title">举报滥用域名</h1>
          <p className="page-sub">发现违规用途？在这里告诉我们</p>
        </div>

        <div className="alert info" id="abuseIntro">
          如发现本站分配的域名被用于钓鱼、恶意程序、垃圾邮件等违规用途，请在此提交举报。管理员会尽快核查处理。
        </div>

        <div className="card">
          <h2>提交举报</h2>
          <div className="hint" style={{marginBottom: '14px'}}>
            我们只处理本站分配的域名；外部域名请联系其注册商或托管商。
          </div>

          <label className="f">被举报域名 <span className="req">必填</span></label>
          <input className="input" id="rpDomain" placeholder="例如：abuse.meoy.top" />

          <label className="f">滥用类型 <span className="req">必填</span></label>
          <select className="input" id="rpType">
            <option value="">请选择滥用类型</option>
            <option value="phishing">钓鱼 / 仿冒</option>
            <option value="malware">恶意程序 / 木马</option>
            <option value="spam">垃圾邮件</option>
            <option value="illegal">赌博 / 色情 / 违法内容</option>
            <option value="trademark">侵犯商标 / 知识产权</option>
            <option value="fraud">诈骗</option>
            <option value="other">其它违规</option>
          </select>

          <label className="f">详细描述 <span className="req">必填</span></label>
          <textarea className="input" id="rpDesc" rows={5} placeholder="请描述具体的违规行为、时间与影响（至少 10 个字）" style={{minHeight: '110px', resize: 'vertical'}}></textarea>

          <label className="f">证据链接 <span className="dim">选填</span></label>
          <input className="input" id="rpEvidence" placeholder="https://…（截图、页面存档或日志）" />

          <label className="f">联系邮箱 <span className="dim">选填</span></label>
          <input className="input" id="rpEmail" placeholder="用于回复处理结果" />

          <div className="hint" style={{margin: '14px 0'}}>
            我们会保留举报人的 IP 用于防滥用，联系邮箱仅用于回复处理结果。<br />
            提交举报即表示你确认所填信息真实，恶意虚假举报会被限制。
          </div>

          <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
            <button className="btn primary" id="rpSubmit">提交举报</button>
            <span className="hint" id="rpOut" style={{alignSelf: 'center'}}></span>
          </div>
        </div>

        <div className="card" id="rpContactCard" style={{display: 'none'}}>
          <h2>其它举报渠道</h2>
          <div id="rpContact"></div>
        </div>

        <div className="card" id="rpMineCard">
          <div className="head-row"><h2>我的举报</h2><button className="btn sm ghost" id="rpRefresh">刷新</button></div>
          <div id="rpMine" className="tablewrap"><div className="empty">加载中…</div></div>
        </div>

        <div className="card" id="rpAdminCard" style={{display: 'none'}}>
          <div className="head-row">
            <h2>滥用举报 · 管理</h2>
            <select className="input" id="rpFilter" style={{width: '150px', padding: '8px 12px'}}>
              <option value="">全部</option>
              <option value="open">待处理</option>
              <option value="investigating">处理中</option>
              <option value="resolved">已处理</option>
              <option value="dismissed">已驳回</option>
            </select>
          </div>
          <div id="rpAdmin" className="tablewrap"><div className="empty">加载中…</div></div>
          <div id="rpPager" style={{display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px'}}></div>
        </div>

        <div className="card flat">
          <h3>相关链接</h3>
          <div style={{display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '13px'}}>
            <a href="/terms">服务条款与免责声明</a>
            <a href="/whois">WHOIS 查询</a>
            <a href="/tickets">提交工单</a>
          </div>
        </div>

      </div></div></main>
      <div id="toast"></div>
    </div>
  );
}
