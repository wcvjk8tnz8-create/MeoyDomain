/**
 * TerraDomain · 注册邮箱规则
 *
 * 默认 whitelist_edu = 原有邮箱域名白名单 ∪ 任意包含 "edu" 的邮箱。
 * 「任何有 edu 这三个字的邮箱」按字面处理：大小写不敏感，邮箱本地部分
 * 或域名任意位置出现连续三个字符 edu 即放行，例如
 *   student@school.edu.cn / edu@gmail.com / me@myedu.org / a@EDU.example
 * 原有 gmail.com / googlemail.com / qq.com / foxmail.com 仍保留，
 * 避免放宽规则反而把老用户挡在门外。
 *
 * 站长可在「站点设置 → 注册邮箱规则」切换四种模式：
 *   whitelist_edu (默认) | whitelist (旧行为) | edu_only (严格) | any (全放开)
 * 优先级：settings.email_rule > 环境变量 EMAIL_RULE > 默认。
 */

export type EmailRule = 'whitelist_edu' | 'whitelist' | 'edu_only' | 'any';

export const EMAIL_RULES: EmailRule[] = ['whitelist_edu', 'whitelist', 'edu_only', 'any'];
export const DEFAULT_EMAIL_RULE: EmailRule = 'whitelist_edu';
export const DEFAULT_ALLOWED_DOMAINS = ['gmail.com', 'googlemail.com', 'qq.com', 'foxmail.com'];

export function normalizeEmailRule(v: unknown): EmailRule {
  const s = String(v ?? '').trim().toLowerCase();
  return (EMAIL_RULES as string[]).includes(s) ? (s as EmailRule) : DEFAULT_EMAIL_RULE;
}

/** 白名单域名（可用 ALLOWED_EMAIL_DOMAINS 覆盖或扩展） */
export function allowedDomains(env: any): string[] {
  return String(env?.ALLOWED_EMAIL_DOMAINS || DEFAULT_ALLOWED_DOMAINS.join(','))
    .split(',')
    .map((d) => String(d).trim().toLowerCase().replace(/^\.+/, ''))
    .filter(Boolean);
}

/** 读取当前生效规则；settings 查询失败（表尚未建）时安全回落 */
export async function emailRuleOf(env: any): Promise<EmailRule> {
  try {
    const row: any = await env?.DB?.prepare(
      "SELECT value FROM settings WHERE key = 'email_rule'"
    ).first();
    const v = String(row?.value ?? '').trim();
    if (v) return normalizeEmailRule(v);
  } catch { /* 设置表不存在 / D1 暂不可用：用环境变量或默认值 */ }
  return normalizeEmailRule(env?.EMAIL_RULE || DEFAULT_EMAIL_RULE);
}

/** 纯函数判定，便于单测 */
export function emailAllowed(mail: string, rule: EmailRule, allow: string[]): boolean {
  const m = String(mail || '').trim().toLowerCase();
  if (!m || m.indexOf('@') < 0) return false;
  const domain = m.split('@')[1] || '';
  const whitelisted = allow.includes(domain);
  const hasEdu = m.includes('edu');
  switch (rule) {
    case 'whitelist': return whitelisted;
    case 'edu_only': return hasEdu;
    case 'any': return true;
    case 'whitelist_edu':
    default: return whitelisted || hasEdu;
  }
}

/** 规则说明（登录页 /api/rules 下发，固定句式便于中英精确翻译） */
export const EMAIL_RULE_HINTS: Record<EmailRule, string> = {
  whitelist_edu: '支持白名单邮箱，以及任何包含 "edu" 的邮箱注册',
  whitelist: '仅支持白名单邮箱注册',
  edu_only: '仅支持包含 "edu" 的邮箱注册',
  any: '支持任意有效邮箱注册',
};

/** 拒绝时的固定提示（fail() 的消息，固定句式便于本地化） */
export const EMAIL_RULE_REJECTS: Record<EmailRule, string> = {
  whitelist_edu: '该邮箱不符合注册规则：仅支持白名单邮箱或包含 "edu" 的邮箱',
  whitelist: '该邮箱不符合注册规则：仅支持白名单邮箱',
  edu_only: '该邮箱不符合注册规则：仅支持包含 "edu" 的邮箱',
  any: '该邮箱不符合注册规则',
};

export function emailRuleHint(rule: EmailRule): string {
  return EMAIL_RULE_HINTS[rule] || EMAIL_RULE_HINTS[DEFAULT_EMAIL_RULE];
}

export function emailRuleReject(rule: EmailRule): string {
  return EMAIL_RULE_REJECTS[rule] || EMAIL_RULE_REJECTS[DEFAULT_EMAIL_RULE];
}
