/**
 * AI 自动审核 + 按根域名的 DNS 记录限额（TerraDomain）
 *
 * 设计原则：
 *   1. 密钥绝不写进代码库。只从后台 settings 或 Worker Secret（AI_API_KEY）读取，
 *      公开接口 /api/config 与后台 GET 都只回显掩码。
 *   2. AI 只作为「免人工审核」的判定器：仅对 ai_review_roots 里列出的根域名生效，
 *      其它根域名仍走原有的 REQUIRE_APPROVAL 规则。
 *   3. 失败即降级：没配 Key、超时、模型报错、返回无法解析 —— 一律回落为
 *      pending 人工审核，绝不因为 AI 故障把用户申请卡死或误批准。
 *   4. OpenAI 兼容协议（/chat/completions），Agnes AI 等网关通用。
 */

import { normalizeDomain, parseRootList } from './roots.js';

const KEYS = [
  'ai_review_enabled', 'ai_review_roots', 'ai_api_url', 'ai_api_key', 'ai_model',
  'dns_unlimited_roots',
];

export const DEFAULT_AI_BASE = 'https://apihub.agnes-ai.com/v1';
/** 默认走 AI 审核 / 不限 DNS 记录数的根域名 */
export const DEFAULT_AI_ROOTS = 'v-1.top';

export interface AiConfig {
  enabled: boolean;
  roots: string[];
  base: string;
  key: string;
  model: string;
  unlimitedRoots: string[];
  configured: boolean;
}

function envStr(env: any, k: string): string {
  return String(env?.[k] ?? '').trim();
}

export async function loadAiConfig(env: any): Promise<AiConfig> {
  const m: Record<string, string> = {};
  try {
    const rows = await env.DB
      .prepare(`SELECT key, value FROM settings WHERE key IN (${KEYS.map(() => '?').join(',')})`)
      .bind(...KEYS)
      .all();
    for (const r of rows?.results || []) m[String(r.key)] = String(r.value ?? '').trim();
  } catch { /* 表尚未建好时静默回落 */ }

  const base = (m.ai_api_url || envStr(env, 'AI_API_URL') || DEFAULT_AI_BASE).replace(/\/+$/, '');
  const key = m.ai_api_key || envStr(env, 'AI_API_KEY');
  const enabledRaw = m.ai_review_enabled || envStr(env, 'AI_REVIEW_ENABLED') || '1';
  const rootsRaw = m.ai_review_roots || envStr(env, 'AI_REVIEW_ROOTS') || DEFAULT_AI_ROOTS;
  const unlimitedRaw = m.dns_unlimited_roots || envStr(env, 'DNS_UNLIMITED_ROOTS') || DEFAULT_AI_ROOTS;

  return {
    enabled: enabledRaw === '1',
    roots: parseRootList(rootsRaw),
    base,
    key,
    model: m.ai_model || envStr(env, 'AI_MODEL'),
    unlimitedRoots: parseRootList(unlimitedRaw),
    configured: !!key,
  };
}

/** 该根域名是否免除「单个子域名最多 N 条 DNS 记录」限制 */
export async function dnsUnlimited(env: any, rootDomain: string): Promise<boolean> {
  const d = normalizeDomain(rootDomain);
  if (!d) return false;
  const cfg = await loadAiConfig(env);
  return cfg.unlimitedRoots.includes(d);
}

/** 该根域名是否启用 AI 自动审核 */
export async function aiAppliesTo(env: any, rootDomain: string): Promise<AiConfig | null> {
  const d = normalizeDomain(rootDomain);
  const cfg = await loadAiConfig(env);
  if (!cfg.enabled || !cfg.configured || !d || !cfg.roots.includes(d)) return null;
  return cfg;
}

/* ---------- 模型名自动探测 ----------
   很多 OpenAI 兼容网关（含 Agnes AI）的模型名与官方不同。
   未显式配置 ai_model 时，先拉一次 /models 取第一个可用模型，缓存 10 分钟。 */
let cachedModel = '';
let cachedModelAt = 0;

async function pickModel(cfg: AiConfig, signal: AbortSignal): Promise<string> {
  if (cfg.model) return cfg.model;
  if (cachedModel && Date.now() - cachedModelAt < 600000) return cachedModel;
  try {
    const r = await fetch(`${cfg.base}/models`, {
      headers: { Authorization: `Bearer ${cfg.key}` },
      signal,
    });
    const d: any = await r.json().catch(() => ({}));
    const first = Array.isArray(d?.data) ? d.data[0] : null;
    const id = typeof first === 'string' ? first : String(first?.id || '');
    if (id) { cachedModel = id; cachedModelAt = Date.now(); return id; }
  } catch { /* 探测失败走兜底名 */ }
  return 'gpt-4o-mini';
}

function parseVerdict(text: string): { approve: boolean; reason: string } | null {
  if (!text) return null;
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  // 优先取第一个 JSON 对象
  const m = s.match(/\{[\s\S]*?\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      if (typeof o.approve === 'boolean' || typeof o.approved === 'boolean') {
        return {
          approve: o.approve ?? o.approved,
          reason: String(o.reason || o.message || '').slice(0, 160) || 'AI 审核完成',
        };
      }
    } catch { /* 落到关键词判断 */ }
  }
  const low = s.toLowerCase();
  if (/(拒绝|不通过|违规|驳回|reject|deny|block)/.test(low))
    return { approve: false, reason: s.slice(0, 160) };
  if (/(通过|同意|正常|可用|approve|approve|yes|ok)/.test(low))
    return { approve: true, reason: 'AI 审核通过' };
  return null;
}

export interface ReviewInput {
  fqdn: string;
  label: string;
  root: string;
  note: string;
}

/**
 * 调用 AI 判定申请是否可自动批准。
 * @returns approve=true 自动开通；false 自动驳回；null 表示不可用（回落人工审核）
 */
export async function aiReview(env: any, input: ReviewInput): Promise<{ approve: boolean; reason: string } | null> {
  const cfg = await aiAppliesTo(env, input.root);
  if (!cfg) return null;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const model = await pickModel(cfg, ctl.signal);
    const prompt = [
      '你是二级域名分发平台的审核助手。请判断下面这份子域名申请是否应当自动批准。',
      '',
      `申请域名：${input.fqdn}`,
      `根域名：${input.root}`,
      `用途说明：${input.note || '（申请人未填写）'}`,
      '',
      '应当拒绝的情形：钓鱼、仿冒品牌、恶意软件分发、垃圾邮件、赌博、色情、违法内容、侵犯他人商标，或用途说明明显含糊敷衍到无法判断。',
      '仅凭域名前缀本身不应当拒绝；用途说明为空但域名无明显违规时请批准。判断不确定时倾向批准（误杀比漏放更影响正常用户）。',
      '',
      '只输出 JSON，不要解释、不要 Markdown：{"approve":true 或 false,"reason":"不超过 40 字的中文理由"}',
    ].join('\n');

    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是严格、克制、只输出 JSON 的域名申请审核助手。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        max_tokens: 160,
      }),
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const d: any = await res.json().catch(() => ({}));
    const text = d?.choices?.[0]?.message?.content ?? d?.choices?.[0]?.text ?? '';
    return parseVerdict(String(text));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
