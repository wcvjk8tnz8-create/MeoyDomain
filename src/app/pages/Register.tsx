import { useEffect, useRef, useState } from 'react';
import { mountRegister } from '../legacy/register';
import { refreshRuntime, cleanupPage } from '../lib/runtime';

/**
 * Register —— 参考 DnsNeko 的四步注册向导。
 * 步骤：使用须知 → 选择域名 → 确认信息 → 提交注册。
 * 后缀选择器嵌在同一个输入框里（点右侧按钮展开浮层，行尾标 Free）。
 * 所有 legacy 控制器依赖的 id 都保留在 DOM 中（隐藏步骤只是 display:none）。
 */
type Summary = { label: string; root: string; fqdn: string; note: string };

export default function RegisterPage() {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(2);           // 默认停在「选择域名」，与 DnsNeko 一致
  const [ok1, setOk1] = useState(true);          // 须知默认已确认，可回第一步重新勾选
  const [ok2, setOk2] = useState(true);
  const [summary, setSummary] = useState<Summary>({ label: '', root: '', fqdn: '', note: '' });
  const [done, setDone] = useState<{ fqdn: string; status: string; ai: boolean } | null>(null);
  const [count, setCount] = useState(0);
  const [noteCount, setNoteCount] = useState(0);

  useEffect(() => {
    document.body.className = "";
    document.documentElement.setAttribute('data-skin', 'doc');
    (window as any).MEOY_PUBLIC_PAGE = false;
    let alive = true;

    // legacy 提交成功后由这里接管，停在第四步展示结果（不再直接跳 dashboard）
    (window as any).__TD_WIZARD_DONE = (r: any) => {
      if (!alive) return;
      setDone({
        fqdn: String(r?.fqdn || ''),
        status: String(r?.status || ''),
        ai: !!r?.aiReviewed,
      });
      setStep(4);
    };

    (async () => {
      try { await mountRegister(ref.current); } catch (e) { console.error('[register] 页面初始化失败', e); }
      if (alive) refreshRuntime();
    })();
    return () => { alive = false; delete (window as any).__TD_WIZARD_DONE; cleanupPage(); };
  }, []);

  const readForm = (): Summary => {
    const label = ((document.getElementById('label') as HTMLInputElement)?.value || '').trim();
    const note = ((document.getElementById('note') as HTMLInputElement)?.value || '').trim();
    const btn = document.getElementById('rootPickerBtn');
    const root = btn?.getAttribute('data-root') || (document.getElementById('rootDomain')?.textContent || '').trim();
    return { label, root, fqdn: label && root ? `${label}.${root}` : '', note };
  };

  const goConfirm = () => {
    const s = readForm();
    if (!s.label) { setStep(2); return; }
    setSummary(s);
    setStep(3);
  };

  const steps = ['使用须知', '选择域名', '确认信息', '提交注册'];

  return (
    <div className="page-root" ref={ref}>
      <div id="bg"></div>
      <header className="topbar" id="topbar"></header>
      <aside className="sidebar" id="sidebar"></aside>

      <main className="main"><div className="main-in"><div className="wrap reg-wrap">

        {/* 四步进度条 */}
        <div className="reg-steps">
          {steps.map((s, i) => {
            const n = i + 1;
            const cls = n === step ? 'active' : n < step ? 'done' : '';
            return (
              <div className={`reg-step ${cls}`} key={s}>
                <i>{n < step ? '✓' : n}</i><span>{s}</span>
              </div>
            );
          })}
        </div>

        {/* 两条提示：灰 = 不可逆，蓝 = 审核说明 */}
        <div className="reg-notice gray">域名注册后不可自助注销，每账号有注册数量上限！注册前请确保你真正需要这个域名！</div>
        <div className="reg-notice blue"><b>!</b> 请勿申请包含敏感、违规词汇的域名。申请提交后由系统审核，请耐心等待。</div>

        {/* ── 1. 使用须知 ── */}
        <section className={`reg-pane ${step === 1 ? 'active' : ''}`}>
          <div className="card reg-card">
            <div className="reg-field-head"><span className="reg-ico">📄</span><div><h3>使用须知 <em>必读</em></h3><p>注册前请先确认以下事项</p></div></div>
            <div className="reg-acc">
              <div className="acc open">1. 域名一经注册不可自助注销</div>
              <div className="acc-body">子域名注册成功后无法自行删除，请在提交前确认名称与后缀无误。</div>
              <div className="acc open">2. 禁止用于违规用途</div>
              <div className="acc-body">严禁钓鱼、仿冒品牌、恶意程序、垃圾邮件、赌博与违法内容，违者立即停用并封禁账号。</div>
              <div className="acc open">3. 审核与 DNS 记录</div>
              <div className="acc-body">提交后进入审核；通过后到「DNS 记录」页按需添加解析，创建时不会自动写入任何记录。</div>
            </div>
            <div className="reg-checks">
              <label><input type="checkbox" checked={ok1} onChange={e => setOk1(e.target.checked)} /> 我已阅读并同意使用须知</label>
              <label><input type="checkbox" checked={ok2} onChange={e => setOk2(e.target.checked)} /> 我了解注册成功后无法自助注销</label>
            </div>
            <div className="reg-actions"><span></span><button className="btn primary" disabled={!ok1 || !ok2} onClick={() => setStep(2)}>下一步 →</button></div>
          </div>
        </section>

        {/* ── 2. 选择域名（含 legacy 表单 id） ── */}
        <section className={`reg-pane ${step === 2 ? 'active' : ''}`}>
          <div className="card reg-card">
            <div className="reg-field-head"><span className="reg-ico">✎</span><div><h3>域名前缀 <em>必填</em></h3><p>请输入域名前缀，选择后缀</p></div></div>

            {/* 输入框与后缀选择器合为一体 */}
            <div className="reg-domain-box">
              <input id="label" className="reg-label-input" placeholder="输入域名前缀" autoComplete="off" spellCheck={false}
                     onInput={e => setCount((e.target as HTMLInputElement).value.length)} />
              <span className="reg-count" id="labelCount">{count} / 63</span>
              <div className="root-picker" id="rootPicker" data-no-i18n>
                <button type="button" className="root-picker-btn" id="rootPickerBtn"
                        aria-haspopup="listbox" aria-expanded="false" title="选择根域名">
                  <span className="root-dot">.</span><span id="rootDomain"></span>
                  <svg className="root-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>
                </button>
                <div className="root-picker-menu" id="rootPickerMenu" role="listbox" aria-label="选择根域名"></div>
              </div>
            </div>
            <div className="hint" id="checkTip">输入前缀后自动检查是否可用，仅支持字母、数字与连字符。</div>
            <div className="hint" id="aiRootTip" style={{display: "none"}}></div>
            <div className="hint" id="aiStatusTip" style={{display: "none"}}></div>

            <div className="reg-field-head" style={{marginTop: "22px"}}><span className="reg-ico warm">💬</span><div><h3>用途说明 <em>必填</em></h3><p>请简单描述您的使用用途</p></div></div>
            <textarea id="note" className="input reg-note" placeholder="请简单描述您的使用用途（必填）" maxLength={200}
                      onInput={e => setNoteCount((e.target as HTMLTextAreaElement).value.length)} />
            <div className="reg-note-count">管理员审核时会看到这段说明。<span>{noteCount} / 200</span></div>

            <div id="costBox" style={{display: "none"}}></div>
            <div id="pendingBox"></div>
            <div id="applyTip" className="alert a-info" style={{display: "none"}}>创建子域名不会自动写入任何 DNS 记录，审核通过后到「DNS 记录」页按需添加。</div>

            <div className="reg-actions">
              <button className="btn ghost" onClick={() => setStep(1)}>← 上一步</button>
              <button className="btn primary" onClick={goConfirm}>下一步 →</button>
            </div>
          </div>
        </section>

        {/* ── 3. 确认信息（提交按钮由 legacy 绑定） ── */}
        <section className={`reg-pane ${step === 3 ? 'active' : ''}`}>
          <div className="card reg-card">
            <div className="reg-field-head"><span className="reg-ico">✓</span><div><h3>确认信息</h3><p>请核对后将提交注册申请</p></div></div>
            <div className="reg-summary">
              <div><span>域名</span><b className="mono">{summary.fqdn || '—'}</b></div>
              <div><span>根域名</span><b className="mono">.{summary.root || '—'}</b></div>
              <div><span>用途说明</span><b>{summary.note || '（未填写）'}</b></div>
            </div>
            <label className="check reg-confirm">
              <input type="checkbox" id="agreeUse" />
              <span id="agreeUseLabel">我承诺不将域名用于钓鱼、恶意程序、垃圾邮件等违规用途，并已阅读<a href="/terms" target="_blank">《服务条款与免责声明》</a>：服务按「现状」提供，不对可用性、数据损失及第三方行为承担责任。</span>
            </label>
            <div className="reg-actions">
              <button className="btn ghost" onClick={() => setStep(2)}>← 上一步</button>
              <button className="btn primary" id="btnApply">提交注册</button>
            </div>
          </div>
        </section>

        {/* ── 4. 提交注册 ── */}
        <section className={`reg-pane ${step === 4 ? 'active' : ''}`}>
          <div className="card reg-card reg-done">
            <div className="reg-done-ico">✓</div>
            <h3>申请已提交</h3>
            <p className="mono">{done?.fqdn || summary.fqdn}</p>
            <p className="dim">
              {done?.status === 'approved'
                ? (done?.ai ? 'AI 自动审核通过，已即时开通' : '审核通过，已即时开通')
                : done?.status === 'rejected'
                  ? 'AI 审核未通过，请返回修改用途说明'
                  : '已提交，等待管理员审核'}
            </p>
            <div className="reg-actions center">
              <button className="btn ghost" onClick={() => { setDone(null); setStep(2); }}>再注册一个</button>
              <a className="btn primary" href="/dashboard">查看我的域名 →</a>
            </div>
          </div>
        </section>

        {/* 注册须知（折叠） */}
        <div className="card reg-faq">
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
      <div id="toast"></div>
    </div>
  );
}
