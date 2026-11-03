import { useEffect, useRef } from 'react';
import { mountRegister } from '../legacy/register';
import { refreshRuntime, cleanupPage, navigate } from '../lib/runtime';

/** Register —— 由 register.html 迁移，页面结构与交互逻辑 100% 保留 */
export default function RegisterPage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = false;
    let alive = true;
    (async () => {
      try { await mountRegister(ref.current); } catch (e) { console.error('[register] 页面初始化失败', e); }
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
      
        <div className="card" id="applyCard">
          <div className="head-row"><h3>注册域名</h3><a className="btn sm ghost" href="/dashboard">返回列表</a></div>
          <div className="alert a-info" id="applyTip">创建子域名不会自动写入任何 DNS 记录，审核通过后到「DNS 记录」页按需添加。</div>
      
          <label className="f">子域名前缀</label>
          <div className="row" style={{gap: "0", flexWrap: "nowrap"}}>
            <input id="label" placeholder="mail" autocomplete="off" spellcheck="false" style={{borderRadius: "var(--radius-s) 0 0 var(--radius-s)", borderRight: "none", flex: "1"}} />
            <span className="mono" id="rootWrap" style={{padding: "0 11px", background: "rgba(79,155,255,.12)", border: "1px solid var(--ink-line)", borderRadius: "0 var(--radius-s) var(--radius-s) 0", display: "flex", alignItems: "center", whiteSpace: "nowrap", color: "var(--blue)", fontSize: "12px"}}>.<span id="rootDomain"></span></span>
          </div>
          <div className="hint" id="checkTip">输入前缀后自动检查是否可用，仅支持字母、数字与连字符。</div>
      
          <label className="f">用途说明（选填，供管理员审核参考）</label>
          <input id="note" className="input" placeholder="例如：个人博客 / 邮件服务" />
          <div className="hint">管理员审核时会看到这段说明。</div>
      
          <div id="costBox" style={{display: "none"}}></div>
      
          <label className="check" style={{marginTop: "16px"}}>
            <input type="checkbox" id="agreeUse" />
            <span id="agreeUseLabel">我承诺不将域名用于钓鱼、恶意程序、垃圾邮件等违规用途，并已阅读<a href="/terms" target="_blank">《服务条款与免责声明》</a>：服务按「现状」提供，不对可用性、数据损失及第三方行为承担责任。</span>
          </label>
      
          <div style={{marginTop: "20px"}}>
            <button className="btn primary" id="btnApply">提交注册</button>
          </div>
      
          <div id="pendingBox"></div>
        </div>
      
        <div className="card" style={{marginTop: "18px"}}>
          <div className="head-row"><h3 style={{fontSize: "16px"}}>注册须知</h3></div>
          <div className="acc">1. 命名规则</div>
          <div className="acc-body">仅支持小写字母、数字与连字符；不能以连字符开头或结尾；长度 1–63 个字符。<code>www</code>、<code>mail</code>、<code>admin</code> 等为系统保留名称，普通用户不可申请。</div>
          <div className="acc">2. 积分与配额</div>
          <div className="acc-body">普通域名消耗 5 分，单字域名（如 <code>a</code>、<code>1</code>）消耗 35 分。每日签到可领 5 分。持有数量受配额限制，管理员不限。</div>
          <div className="acc">3. 有效期与续期</div>
          <div className="acc-body">新注册域名有效期 365 天，到期前 180 天内可续期。管理员持有的域名为永久有效。</div>
          <div className="acc">4. 同一时间只能有一个待审核申请</div>
          <div className="acc-body">已有待审核申请时提交入口会锁定，请等待审核结果（或被驳回）后再提交。</div>
        </div>
      
      </div></div></main>
    </div>
  );
}
