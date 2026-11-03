import { useEffect, useRef } from 'react';
import { mountProfile } from '../legacy/profile';
import { refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/** Profile —— 由 profile.html 迁移，页面结构与交互逻辑 100% 保留 */
export default function ProfilePage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = false;
    let alive = true;
    (async () => {
      try { await mountProfile(ref.current); } catch (e) { console.error('[profile] 页面初始化失败', e); }
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
        <h1>个人资料</h1>
        <div className="sub" style={{margin: "-6px 0 16px"}}>管理你的头像、昵称与账号安全</div>
      
        <div className="profile-grid">
          {/* 左：资料卡（参考 DnsNeko：横幅 + 头像 + 等级 + 域名数 + UID） */}
          <div className="card profile-card">
            <div className="pc-banner">
              <img id="pcBanner" src="/img/sakura1.jpg" alt="" />
              <div className="pc-banner-mask"></div>
            </div>
            <div className="pc-body">
              <div className="pc-av-wrap">
                <img className="pc-av" id="pcAv" src="/img/avatar/miku-headset.webp" alt="" />
                <button className="pc-av-btn" id="btnPickAv" title="更换头像">更换</button>
              </div>
              <div className="pc-name" id="pcName">—</div>
              <div className="pc-tags">
                <span className="badge ok" id="pcState">在线</span>
                <span className="badge inf" id="pcLv">LV 1</span>
                <span className="badge" id="pcDomains">0 Domains</span>
                <span className="badge" id="pcRole">用户</span>
              </div>
              <div className="pc-bio" id="pcBio"></div>
              <div className="kv pc-meta">
                <div className="k">UID</div><div className="mono" id="pcUid">—</div>
                <div className="k">邮箱</div><div className="mono" id="pcMail">—</div>
                <div className="k">注册时间</div><div className="mono" id="pcCreated">—</div>
                <div className="k">最近登录</div><div className="mono" id="pcLogin">—</div>
              </div>
            </div>
          </div>
      
          {/* 右：资料编辑 + 安全设置 */}
          <div className="profile-main">
            <div className="card">
              <h2>基本资料</h2>
              <div className="field">
                <label>昵称</label>
                <input id="fNick" maxlength="24" placeholder="给自己起个名字" />
              </div>
              <div className="field">
                <label>邮箱</label>
                <input id="fMail" disabled />
                <div className="hint">邮箱即登录账号，暂不支持自助修改。如有需要请联系管理员。</div>
              </div>
              <div className="field">
                <label>头像</label>
                <div className="row" style={{gap: "9px", alignItems: "center"}}>
                  <img id="fAvPreview" src="/img/avatar/miku-headset.webp" style={{width: "44px", height: "44px", borderRadius: "50%", border: "1px solid var(--line)", objectFit: "cover"}} />
                  <button className="btn sm" id="btnPickAv2">选择头像</button>
                  <button className="btn sm" id="btnUploadAv" style={{display: "none"}}>上传本地图片</button>
                  <input type="file" id="fAvFile" accept="image/png,image/jpeg,image/gif,image/webp" style={{display: "none"}} />
                  <span className="hint" style={{margin: "0"}}>可从内置头像库选择，或在下方填写图片外链</span>
                </div>
                <input id="fAvUrl" placeholder="/img/avatar/miku-headset.webp 或 https://..." />
                <div className="hint" id="upTip"></div>
              </div>
              <div className="field">
                <label>个人简介</label>
                <textarea id="fBio" maxlength="160" placeholder="写点什么，会显示在资料卡上"></textarea>
              </div>
              <div className="row end">
                <button className="btn primary" id="btnSave">保存修改</button>
              </div>
            </div>
      
            <div className="card">
              <h2>安全设置</h2>
              <div className="alert info" style={{marginBottom: "12px"}}>
                建议定期更换密码，并妥善保管账号。修改密码后，其它设备上的登录状态会被登出。
              </div>
              <div className="sec-row">
                <div><div className="sec-t">登录密码</div><div className="sec-d">上次修改时间未知</div></div>
                <button className="btn sm" id="btnPwd">修改</button>
              </div>
              <div className="sec-row">
                <div><div className="sec-t">UID</div><div className="sec-d">对外展示用，不含敏感信息</div></div>
                <span className="mono" id="secUid">—</span>
              </div>
              <div className="sec-row">
                <div><div className="sec-t">账号邮箱</div><div className="sec-d" id="secMail">—</div></div>
                <span className="badge">已绑定</span>
              </div>
            </div>
          </div>
        </div>
      </div></div></main>
      
      <div className="modal" id="modal"><div className="modal-card" id="modalCard"></div></div>
      <div className="toast" id="toast"></div>
    </div>
  );
}
