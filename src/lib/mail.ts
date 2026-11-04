/**
 * 邮件发送与验证码
 *
 * 支持两个服务商，通过后台「站点设置 → 邮件与验证码」配置：
 *   · Resend  —— https://resend.com  （API Key 形如 re_xxx）
 *   · Brevo   —— https://brevo.com   （API Key 形如 xkeysib-xxx）
 *
 * 发件人约定：verify@<你的域名>（需在服务商处验证该域名）
 *
 * 设计原则：
 *   · 验证码只存哈希，不落明文（与密码同一套 PBKDF2）
 *   · 邮件发送失败绝不阻断主流程（注册/改密），只在返回值里带 warning
 *   · 未配置服务商时，接口明确返回「未启用」，前端提示联系管理员
 */
import { hashPassword, verifyPassword } from './crypto.js';
import { now } from './util.js';

/** 读取邮件配置（环境变量优先级高于数据库） */
export async function mailConfig(env) {
  const row = async (k) => {
    const r = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(k).first();
    return String(r?.value || '').trim();
  };
  const [provider, from, key, required] = await Promise.all([
    row('mail_provider'),
    row('mail_from'),
    row('mail_api_key'),
    row('mail_verify_required'),
  ]);
  return {
    provider: String(env.MAIL_PROVIDER || provider || '').trim().toLowerCase(),
    from: String(env.MAIL_FROM || from || '').trim(),
    apiKey: String(env.MAIL_API_KEY || key || '').trim(),
    verifyRequired: String(env.MAIL_VERIFY_REQUIRED || required || '0').trim() === '1',
  };
}

export function mailEnabled(cfg) {
  return !!(cfg && cfg.provider && cfg.apiKey && cfg.from);
}

async function sendViaResend(cfg, to, subject, html, text) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: cfg.from, to: [to], subject, html, text }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Resend HTTP ${r.status}`);
  return { id: j.id };
}

async function sendViaBrevo(cfg, to, subject, html, text) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': cfg.apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: cfg.from },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Brevo HTTP ${r.status}`);
  return { id: j.messageId };
}

/** 发送邮件。失败抛错，由调用方决定是否忽略 */
export async function sendMail(cfg, to, subject, html, text) {
  if (!mailEnabled(cfg)) throw new Error('未配置邮件服务');
  if (cfg.provider === 'resend') return sendViaResend(cfg, to, subject, html, text);
  if (cfg.provider === 'brevo') return sendViaBrevo(cfg, to, subject, html, text);
  throw new Error(`不支持的邮件服务商：${cfg.provider}`);
}

const CODE_TTL_MS = 10 * 60 * 1000; // 验证码 10 分钟有效
const MAX_TRIES = 5;

function randomCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1000000).padStart(6, '0');
}

/**
 * 生成并发送验证码。
 * @returns {{ ok:boolean, sent:boolean, warning?:string, devCode?:string }}
 *          sent=false 表示邮件没发出去（未配置或发送失败）；
 *          此时 devCode 会带上验证码，便于管理员排查（仅未配置服务商时返回，不返回给普通用户）。
 */
export async function issueCode(env, email, scene, ip) {
  const cfg = await mailConfig(env);
  const code = randomCode();
  const codeHash = await hashPassword(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString().slice(0, 19).replace('T', ' ');

  // 同一邮箱同一场景：旧码作废
  await env.DB.prepare('UPDATE email_verifications SET used = 1 WHERE email = ? AND scene = ? AND used = 0')
    .bind(email, scene)
    .run();
  await env.DB.prepare(
    'INSERT INTO email_verifications (email, scene, code_hash, ip, expires_at, used, tries, created_at) VALUES (?,?,?,?,?,0,0,?)'
  )
    .bind(email, scene, codeHash, ip || '', expiresAt, now())
    .run();

  const siteName =
    (await env.DB.prepare("SELECT value FROM settings WHERE key = 'site_name'").first())?.value || 'TerraDomain';
  const isReset = scene === 'reset';
  const subject = isReset ? `${siteName} 重置密码验证码` : `${siteName} 注册验证码`;
  const text = `你的验证码是 ${code}，10 分钟内有效。如非本人操作请忽略此邮件。`;
  const html = `
<div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:520px;margin:0 auto;padding:28px">
  <h2 style="margin:0 0 18px;color:#4f9bff">${siteName}</h2>
  <p style="color:#27345a;font-size:15px;line-height:1.7">你好，</p>
  <p style="color:#27345a;font-size:15px;line-height:1.7">
    你正在进行${isReset ? '重置密码' : '注册'}操作，验证码为：
  </p>
  <div style="margin:22px 0;padding:18px;text-align:center;background:#eaf3ff;border-radius:14px">
    <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#2c4a86">${code}</span>
  </div>
  <p style="color:#8b97b5;font-size:13px;line-height:1.7">验证码 10 分钟内有效。如非本人操作，请忽略此邮件。</p>
</div>`;

  if (!mailEnabled(cfg)) {
    // 未配置服务商：不阻断，返回验证码仅用于本地/管理员排查
    return { ok: true, sent: false, warning: '未配置邮件服务，验证码无法发送', devCode: code };
  }
  try {
    await sendMail(cfg, email, subject, html, text);
    return { ok: true, sent: true };
  } catch (e) {
    return { ok: true, sent: false, warning: '邮件发送失败：' + e.message };
  }
}

/**
 * 校验验证码。通过则标记已使用。
 * @returns {{ ok:boolean, reason?:string }}
 */
export async function checkCode(env, email, scene, code) {
  const mail = String(email || '').trim().toLowerCase();
  const input = String(code || '').trim();
  const row = await env.DB.prepare(
    'SELECT * FROM email_verifications WHERE email = ? AND scene = ? AND used = 0 ORDER BY id DESC LIMIT 1'
  )
    .bind(mail, scene)
    .first();
  if (!row) return { ok: false, reason: '请先获取验证码' };
  if (row.expires_at && new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()) {
    return { ok: false, reason: '验证码已过期，请重新获取' };
  }
  if (Number(row.tries || 0) >= MAX_TRIES) return { ok: false, reason: '错误次数过多，请重新获取验证码' };

  const good = await verifyPassword(input, row.code_hash);
  if (!good) {
    await env.DB.prepare('UPDATE email_verifications SET tries = tries + 1 WHERE id = ?').bind(row.id).run();
    return { ok: false, reason: '验证码不正确' };
  }
  await env.DB.prepare('UPDATE email_verifications SET used = 1 WHERE id = ?').bind(row.id).run();
  return { ok: true };
}
