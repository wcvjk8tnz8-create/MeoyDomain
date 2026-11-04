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
 *   4. OpenAI 兼容协议（/models + /chat/completions），Agnes AI 等网关通用。
 *
 * 审核链路（后台填好地址与 Key 之后）：
 *   自动探测 /models → 自动选定一个模型（管理员可在下拉里改选）→
 *   用「AI，你好…域名是…理由：…」这段中文提示词送审 → 解析 PASS / REJECT。
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

/* ---------- 模型探测与选择 ---------- */

export interface ModelProbe {
  ok: boolean;
  models: string[];
  message: string;
  detail: string;
}

function modelIds(d: any): string[] {
  const list = Array.isArray(d?.data) ? d.data
    : Array.isArray(d?.models) ? d.models
      : Array.isArray(d) ? d : [];
  const out: string[] = [];
  for (const x of list) {
    const id = typeof x === 'string' ? x : String(x?.id || x?.name || '');
    if (id && !out.includes(id)) out.push(id);
  }
  return out.slice(0, 100);
}

/** 拉取网关 /models。override 允许后台用「刚填、还没保存」的地址与 Key 先探测一次。 */
export async function probeAiModels(
  env: any,
  override: { base?: string; key?: string } = {},
): Promise<ModelProbe> {
  const cfg = await loadAiConfig(env).catch(() => null);
  const base = String(override.base || cfg?.base || DEFAULT_AI_BASE).trim().replace(/\/+$/, '');
  const key = String(override.key || cfg?.key || '').trim();
  if (!key) {
    return { ok: false, models: [], message: '未配置 API Key，请先填写并保存', detail: '' };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: ctl.signal,
    });
    const raw = await res.text().catch(() => '');
    if (!res.ok) {
      return { ok: false, models: [], message: `/models 返回 HTTP ${res.status}`, detail: raw.slice(0, 300) };
    }
    let d: any = {};
    try { d = JSON.parse(raw); } catch { /* 非 JSON 直接判失败 */ }
    const models = modelIds(d);
    if (!models.length) {
      return { ok: false, models: [], message: '/models 没有返回可用模型', detail: raw.slice(0, 200) };
    }
    return { ok: true, models, message: `探测到 ${models.length} 个模型`, detail: '' };
  } catch (e) {
    return {
      ok: false, models: [], message: '无法连接 /models（超时或网络不可达）',
      detail: String((e as Error)?.message || e).slice(0, 200),
    };
  } finally { clearTimeout(timer); }
}

export interface ModelChoice {
  selected: string;
  autoPicked: boolean;
  inList: boolean;
}

/**
 * 从探测结果里确定审核用模型：
 *   - 已选模型仍在列表中 → 保留管理员的选择
 *   - 已选模型不在列表中但非空 → 也保留（有些网关 /models 列不全，允许手填）
 *   - 尚未选择 → 自动挑第一个非 embedding 类模型并写入 settings
 */
export async function chooseModel(env: any, models: string[]): Promise<ModelChoice> {
  let cur = '';
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'ai_model'").first();
    cur = String(row?.value || '').trim();
  } catch { /* 表未就绪 */ }
  if (cur) return { selected: cur, autoPicked: false, inList: models.includes(cur) };

  const usable = models.filter((m) => !/embed|rerank|whisper|tts|image|moderation|dall|vision/i.test(m));
  const picked = (usable[0] || models[0] || '').slice(0, 80);
  if (picked) {
    try {
      await env.DB.prepare(
        "INSERT INTO settings(key, value) VALUES ('ai_model', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).bind(picked).run();
    } catch { /* 写不进也不影响本次探测结果 */ }
  }
  return { selected: picked, autoPicked: !!picked, inList: true };
}

/** 未显式配置模型时的兜底名（探测失败也不至于完全没有候选） */
const FALLBACK_MODELS = [
  'gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo', 'deepseek-chat',
  'qwen-turbo', 'claude-3-5-sonnet-20241022',
];

/* ---------- 提示词与结果解析 ---------- */

export interface ReviewInput {
  fqdn: string;
  label: string;
  root: string;
  note: string;
}

/** 审核提示词：主体句式按需求固定，后面只补判定规则与输出格式 */
export function buildReviewPrompt(input: ReviewInput): string {
  const note = String(input.note || '').trim() || '（申请人未填写）';
  return [
    `AI，你好，你现在要帮我审核一个子域名申请，域名是${input.fqdn}，理由：${note}`,
    '',
    '请判断是否允许自动开通这个子域名。应当拒绝的情形：钓鱼、仿冒品牌、恶意软件分发、垃圾邮件、赌博、色情、违法内容、侵犯他人商标，或理由明显含糊敷衍到无法判断。',
    '仅凭域名前缀本身不应拒绝；理由为空但域名无明显违规时请批准；判断不确定时倾向批准（误杀比漏放更影响正常用户）。',
    '',
    '请只回复一行，格式为「PASS」或「REJECT」，可在后面用中文冒号附一句不超过 40 字的理由。例如：PASS：用途正常',
  ].join('\n');
}

/** 兼容 JSON、PASS/REJECT、中文结论、纯 true/false 四种回复 */
export function parseVerdict(text: string): { approve: boolean; reason: string } | null {
  if (!text) return null;
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  // 优先取第一个 JSON 对象（旧网关可能仍回 JSON）
  const m = s.match(/\{[\s\S]*?\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      const bool = [o.approve, o.approved, o.pass, o.allow].find((x) => typeof x === 'boolean');
      if (bool !== undefined) {
        return { approve: bool, reason: String(o.reason || o.message || '').slice(0, 160) || 'AI 审核完成' };
      }
      const str = [o.approve, o.approved, o.result, o.decision].find((x) => typeof x === 'string');
      if (str && /^(true|false|approve|reject|yes|no)$/i.test(String(str))) {
        const yes = /^(true|approve|yes)$/i.test(String(str));
        return { approve: yes, reason: String(o.reason || o.message || '').slice(0, 160) || 'AI 审核完成' };
      }
    } catch { /* 落到关键词判断 */ }
  }
  // 新提示词约定的一行式结论；先 REJECT 后 PASS，避免「不通过」被当成「通过」
  const first = s.split(/[\r\n]/)[0].trim();
  const no = /^(reject|deny|block|驳回|拒绝|不通过|不同意|不予通过)\s*[:：,，\-]?\s*(.*)$/i.exec(first);
  if (no) return { approve: false, reason: (no[2] || first).trim().slice(0, 160) || 'AI 审核未通过' };
  const yes = /^(pass|approve|approved|allow|通过|批准|同意|可以开通)\s*[:：,，\-]?\s*(.*)$/i.exec(first);
  if (yes) return { approve: true, reason: (yes[2] || 'AI 审核通过').trim().slice(0, 160) || 'AI 审核通过' };

  const low = s.toLowerCase();
  if (/(拒绝|不通过|违规|驳回|reject|deny|block)/.test(low))
    return { approve: false, reason: s.slice(0, 160) };
  if (/(通过|同意|正常|可用|approve|yes|ok|true)/.test(low))
    return { approve: true, reason: 'AI 审核通过' };
  if (/^(true|false|yes|no)$/i.test(low))
    return { approve: /^(true|yes)$/i.test(low), reason: 'AI 审核完成' };
  return null;
}

/** 发一次 chat/completions，返回可读文本与失败诊断 */
async function chatOnce(cfg: AiConfig, model: string, prompt: string, signal: AbortSignal) {
  const messages = [
    { role: 'system', content: '你是二级域名分发平台的审核助手，请按用户给出的规则给出明确结论。' },
    { role: 'user', content: prompt },
  ];
  const call = async (extra: Record<string, unknown>) => {
    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model, messages, ...extra }),
      signal,
    });
    return { res, raw: await res.text().catch(() => '') };
  };
  let { res, raw } = await call({ temperature: 0, max_tokens: 160 });
  // 部分网关不认 max_tokens / temperature，去掉后再试一次
  if (!res.ok && res.status === 400) {
    try { ({ res, raw } = await call({})); } catch { /* 保持原结果 */ }
  }
  if (!res.ok) return { text: '', status: res.status, err: raw.slice(0, 220) };
  let d: any = {};
  try { d = JSON.parse(raw); } catch { /* 非 JSON 直接当文本 */ }
  const text = String(d?.choices?.[0]?.message?.content ?? d?.choices?.[0]?.text ?? d?.output ?? raw);
  return { text, status: res.status, err: '' };
}

export interface AiTestResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  sample: string;
  message: string;
  detail: string;
}

/** 后台「测试 AI 连接」：用选定的模型 + 真实审核提示词跑一次，不回传密钥 */
export async function aiTest(env: any): Promise<AiTestResult> {
  const cfg = await loadAiConfig(env);
  const t0 = Date.now();
  const blank: AiTestResult = { ok: false, model: '', latencyMs: 0, sample: '', message: '', detail: '' };
  if (!cfg.configured) {
    return { ...blank, message: '未配置 API Key（后台填一次，或用 Worker Secret AI_API_KEY）' };
  }
  if (!cfg.enabled) return { ...blank, message: '自动审核开关已关闭' };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    let model = cfg.model;
    if (!model) {
      const p = await probeAiModels(env);
      if (p.ok) model = (await chooseModel(env, p.models)).selected;
    }
    model = model || FALLBACK_MODELS[0];
    const prompt = buildReviewPrompt({
      fqdn: 'demo.v-1.top', label: 'demo', root: 'v-1.top', note: '个人博客，用于展示作品集',
    });
    const r = await chatOnce(cfg, model, prompt, ctl.signal);
    if (r.text) {
      const v = parseVerdict(r.text);
      return {
        ...blank, ok: true, model, latencyMs: Date.now() - t0,
        sample: r.text.trim().slice(0, 80),
        message: v ? (v.approve ? '审核返回：PASS（通过）' : '审核返回：REJECT（驳回）')
          : '模型可调用，但回复无法解析（实际审核会回落人工）',
      };
    }
    return {
      ...blank, model, latencyMs: Date.now() - t0,
      message: `模型 ${model} 调用失败 · HTTP ${r.status}`,
      detail: r.err.slice(0, 300),
    };
  } catch (e) {
    return {
      ...blank, message: '连接异常（超时或网络不可达）',
      detail: String((e as Error)?.message || e).slice(0, 200),
      latencyMs: Date.now() - t0,
    };
  } finally { clearTimeout(timer); }
}

/**
 * 调用 AI 判定申请是否可自动批准。
 * @returns approve=true 自动开通；false 自动驳回；null 表示不可用（回落人工审核）
 */
export async function aiReview(
  env: any, input: ReviewInput,
): Promise<{ approve: boolean; reason: string; model?: string } | null> {
  const cfg = await aiAppliesTo(env, input.root);
  if (!cfg) return null;

  const ctl = new AbortController();
  // 12 秒：/models 探测 + 最多 3 个候选模型，避免网关慢时整体降级
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const prompt = buildReviewPrompt(input);

    // 选定的模型优先；模型未配置时先探测并自动选一个，失败才走兜底名
    let model = cfg.model;
    let probed: string[] = [];
    if (!model) {
      const p = await probeAiModels(env);
      if (p.ok) {
        probed = p.models;
        model = (await chooseModel(env, p.models)).selected;
      }
    }
    const candidates = [
      model,
      ...probed.filter((x) => x && x !== model).slice(0, 2),
      ...FALLBACK_MODELS,
    ].filter(Boolean);

    for (const candidate of candidates.slice(0, 4)) {
      if (ctl.signal.aborted) break;
      try {
        const r = await chatOnce(cfg, candidate, prompt, ctl.signal);
        if (!r.text) continue;               // 该模型不可用，换下一个
        const verdict = parseVerdict(r.text);
        if (verdict) return { ...verdict, model: candidate };
      } catch { /* 超时或网络异常，换下一个 */ }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
