/**
 * AI 自动审核 + 按根域名的 DNS 记录限额（TerraDomain）
 *
 * 设计原则：
 *   1. 密钥绝不写进代码库。只从后台 settings 或 Worker Secret（AI_API_KEY）读取，
 *      公开接口 /api/config 与后台 GET 都只回显掩码。
 *   2. AI 只作为「免人工审核」的判定器：仅对 ai_review_roots 里列出的根域名生效。
 *   3. 失败即降级：没配 Key、超时、模型报错、返回无法解析 —— 一律回落人工审核。
 *   4. 端点策略：后台填的「接口地址」默认就是**完整请求地址**，先直接 POST 它
 *      （例如 https://apihub.agnes-ai.com/v1）。只有该地址不通时才回落
 *      /chat/completions、/responses 这些官方子路径；成功的端点会被记住，
 *      之后不再重复探测。后台可切「强制直连」彻底不调用子路径。
 *   5. Agnes 官方模型清单会变（现默认 agnes-3.0-flash），不能用
 *      gpt-4o-mini 之类的别名，也别用已下线的旧 ID（会报 model not found）。
 *
 * 链路：后台填地址 + Key → 辅助探测 /models（失败也有内置官方清单可选）→
 *      管理员选定一个模型 → 审核时直接把中文提示词发给该模型 → PASS / REJECT。
 * 关键：探测只是「选模型的辅助」，绝不是审核的前置条件。审核时若已选定模型，
 *      一次 /models 都不请求，避免网关不支持 /models 时整个审核链路瘫痪。
 */

import { normalizeDomain, parseRootList } from './roots.js';

const KEYS = [
  'ai_review_enabled', 'ai_review_roots', 'ai_api_url', 'ai_api_key', 'ai_model',
  'ai_api_endpoint', 'ai_endpoint_mode', 'dns_unlimited_roots',
];

export const DEFAULT_AI_BASE = 'https://apihub.agnes-ai.com/v1';
export const DEFAULT_AI_ROOTS = 'v-1.top';

/** Agnes AI 官方 chat 模型清单（来自官方 MODEL_CATALOG 与接入文档）。
 *  即使网关 /models 不可用，也能直接从这里选，审核不会因此瘫痪。 */
/** 官方 MODEL_CATALOG / API Reference 当前列出的文本模型，按优先级排列。
 *  旧清单以 agnes-2.5-flash 打头，官方现行默认已是 agnes-3.0-flash；
 *  用下线 ID 会直接 model not found —— 这是「审核不到」的常见真因。 */
export const AGNES_CHAT_MODELS = [
  'agnes-3.0-flash',
  'agnes-3.0-pro',
  'agnes-2.5-pro',
  'agnes-2.0-flash',
  'agnes-2.5-flash',
  'agnes-1.5-flash',
  'agnes-2.5-pro-beta',
];

export type EndpointMode = 'auto' | 'direct' | 'standard';

export interface AiConfig {
  enabled: boolean;
  roots: string[];
  base: string;
  key: string;
  model: string;
  /** 上次调用成功的完整端点；下次优先复用，避免每次审核都打多次请求 */
  endpoint: string;
  /** auto=先直连地址本身、失败回落子路径；direct=只直连；standard=只用官方子路径 */
  mode: EndpointMode;
  unlimitedRoots: string[];
  configured: boolean;
}

/** AI 未触发的精确原因。此前一律静默返回 null，用户只看到「等待审核」却不知道为什么。 */
export type AiSkipReason =
  | 'disabled' | 'no-key' | 'root-not-listed'
  | 'all-models-failed' | 'parse-failed' | 'timeout';

export interface AiDiag {
  applies: boolean;
  endpoint: string;
  skipReason: AiSkipReason | null;
  skipText: string;
  root: string;
  roots: string[];
  keySet: boolean;
  model: string;
  attempts: string[];
  enabled: boolean;
}

export function explainAiSkip(r: AiSkipReason | null): string {
  switch (r) {
    case 'disabled': return '后台「AI 自动审核」开关未开启';
    case 'no-key': return '未配置 API Key（后台填一次，或 npx wrangler secret put AI_API_KEY）';
    case 'root-not-listed': return '当前根域名不在「AI 自动审核名单」里；名单填 * 可对所有根域名生效';
    case 'all-models-failed': return '所有候选模型调用失败（网关报错或网络不可达），已回落人工审核';
    case 'parse-failed': return '模型有回复但结论无法解析，已回落人工审核';
    case 'timeout': return 'AI 调用超时（12 秒），已回落人工审核';
    default: return '';
  }
}

/** 名单里的 * 表示对所有根域名生效 */
export function rootInAiList(cfg: AiConfig, root: string): boolean {
  return cfg.roots.includes('*') || (!!root && cfg.roots.includes(root));
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
    endpoint: (m.ai_api_endpoint || envStr(env, 'AI_API_ENDPOINT')).trim(),
    mode: (['auto', 'direct', 'standard'].includes(m.ai_endpoint_mode)
      ? m.ai_endpoint_mode : 'auto') as EndpointMode,
    unlimitedRoots: parseRootList(unlimitedRaw),
    configured: !!key,
  };
}

export async function dnsUnlimited(env: any, rootDomain: string): Promise<boolean> {
  const d = normalizeDomain(rootDomain);
  if (!d) return false;
  const cfg = await loadAiConfig(env);
  return cfg.unlimitedRoots.includes(d);
}

export async function aiAppliesTo(env: any, rootDomain: string): Promise<AiConfig | null> {
  const d = normalizeDomain(rootDomain);
  const cfg = await loadAiConfig(env);
  if (!cfg.enabled || !cfg.configured || !d || !rootInAiList(cfg, d)) return null;
  return cfg;
}

/* ---------- 模型探测（辅助，非必需） ---------- */

export interface ProbeAttempt {
  url: string;
  status: number;
  sample: string;
  ms: number;
}

export interface ModelProbe {
  ok: boolean;                    // 是否拿到了可用模型清单（含内置回落）
  models: string[];
  source: 'gateway' | 'catalog'; // gateway = /models 返回；catalog = 内置官方清单
  message: string;
  detail: string;
  attempts: ProbeAttempt[];
}

function modelIds(d: any): string[] {
  // 兼容 {data:[...]}, {models:[...]}, 纯数组, {data:{models:[...]}} 等形状
  const raw = Array.isArray(d) ? d
    : Array.isArray(d?.data) ? d.data
      : Array.isArray(d?.models) ? d.models
        : Array.isArray(d?.data?.models) ? d.data.models
          : Array.isArray(d?.result) ? d.result : [];
  const out: string[] = [];
  for (const x of raw) {
    const id = typeof x === 'string' ? x : String(x?.id || x?.name || x?.model || '');
    if (id && !out.includes(id)) out.push(id);
  }
  return out.slice(0, 100);
}

/** 模型名是否适合 chat/completions（排除图像 / 视频 / 嵌入 / 语音类） */
function isChatModel(id: string): boolean {
  return !/(image|video|embed|rerank|whisper|tts|audio|speech|moderation|dall|vision|draw|music)/i.test(id);
}

/** 脱敏：响应片段里若出现完整 Key，替换为掩码 */
function scrub(s: string, key: string): string {
  let out = String(s || '').slice(0, 300);
  if (key && out.includes(key)) out = out.split(key).join('sk-••••');
  return out.replace(/\s+/g, ' ').trim();
}

/** 生成候选 URL：/models 在不同网关上的挂载位置并不一致 */
function modelUrls(base: string): string[] {
  const urls = [`${base}/models`];
  if (/\/v\d+$/.test(base)) urls.push(`${base.replace(/\/v\d+$/, '')}/models`);
  else urls.push(`${base}/v1/models`);
  return [...new Set(urls)];
}

/**
 * 拉取网关 /models。失败时**不返回空清单**，而是回落内置官方模型清单，
 * 并把每一步的 URL / 状态码 / 响应片段都带回去供后台诊断。
 * override 允许用「刚填、还没保存」的地址与 Key 先探测一次。
 */
export async function probeAiModels(
  env: any,
  override: { base?: string; key?: string } = {},
): Promise<ModelProbe> {
  const cfg = await loadAiConfig(env).catch(() => null);
  const base = String(override.base || cfg?.base || DEFAULT_AI_BASE).trim().replace(/\/+$/, '');
  const key = String(override.key || cfg?.key || '').trim();

  const fallback = (message: string, detail: string, attempts: ProbeAttempt[]): ModelProbe => ({
    ok: true, models: [...AGNES_CHAT_MODELS], source: 'catalog',
    message: `${message}（已回落内置 Agnes 官方模型清单，可直接选用）`,
    detail, attempts,
  });

  if (!key) {
    return {
      ok: false, models: [], source: 'catalog',
      message: '未配置 API Key，请先填写并保存', detail: '', attempts: [],
    };
  }

  const attempts: ProbeAttempt[] = [];
  for (const url of modelUrls(base)) {
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: ctl.signal,
      });
      const raw = await res.text().catch(() => '');
      attempts.push({ url, status: res.status, sample: scrub(raw, key), ms: Date.now() - t0 });
      if (res.ok) {
        let d: any = {};
        try { d = JSON.parse(raw); } catch { /* 非 JSON */ }
        const list = modelIds(d);
        if (list.length) {
          return {
            ok: true, models: list, source: 'gateway',
            message: `网关返回 ${list.length} 个模型`, detail: '', attempts,
          };
        }
      }
    } catch (e) {
      attempts.push({
        url, status: 0, sample: String((e as Error)?.name || e), ms: Date.now() - t0,
      });
    } finally { clearTimeout(timer); }
  }

  const last = attempts[attempts.length - 1];
  return fallback(
    `/models 不可用（HTTP ${last?.status || 0}）`,
    last ? `${last.url} → ${last.status} ${last.sample}` : '网络不可达',
    attempts,
  );
}

export interface ModelChoice {
  selected: string;
  autoPicked: boolean;
  inList: boolean;
}

/** 从清单里挑一个 chat 模型；管理员已选的保留（手填允许） */
export async function chooseModel(env: any, models: string[]): Promise<ModelChoice> {
  let cur = '';
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'ai_model'").first();
    cur = String(row?.value || '').trim();
  } catch { /* 表未就绪 */ }
  if (cur) return { selected: cur, autoPicked: false, inList: models.includes(cur) };

  const chat = models.filter(isChatModel);
  const pool = chat.length ? chat : AGNES_CHAT_MODELS;
  // 优先官方 flash 系列，其次任意 chat 模型
  const picked = (pool.find((m) => /agnes-.*flash/i.test(m)) || pool[0] || AGNES_CHAT_MODELS[0]).slice(0, 80);
  if (picked) {
    try {
      await env.DB.prepare(
        "INSERT INTO settings(key, value) VALUES ('ai_model', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).bind(picked).run();
    } catch { /* 写不进也不影响本次结果 */ }
  }
  return { selected: picked, autoPicked: !!picked, inList: models.includes(picked) };
}

/** 兜底候选：Agnes 官方模型优先，再试通用名（适配其它 OpenAI 兼容网关） */
const FALLBACK_MODELS = [
  ...AGNES_CHAT_MODELS,
  'gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo', 'deepseek-chat', 'qwen-turbo',
];

/* ---------- 提示词与结果解析 ---------- */

export interface ReviewInput {
  fqdn: string;
  label: string;
  root: string;
  note: string;
}

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

export function parseVerdict(text: string): { approve: boolean; reason: string } | null {
  if (!text) return null;
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
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
        return {
          approve: /^(true|approve|yes)$/i.test(String(str)),
          reason: String(o.reason || o.message || '').slice(0, 160) || 'AI 审核完成',
        };
      }
    } catch { /* 落到关键词判断 */ }
  }
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

/**
 * 生成候选请求地址（按优先级）。
 *
 * 后台「接口地址」填的是什么，就先 POST 什么 —— 例如填
 * https://apihub.agnes-ai.com/v1，就先直接请求 /v1，不额外拼 /chat/completions。
 * 只有它不通（或用户选了 standard）才尝试官方子路径。
 * 上次成功的端点排最前，成功一次后后续审核只发一个请求。
 */
export function endpointCandidates(cfg: Pick<AiConfig, 'base' | 'endpoint' | 'mode'>): string[] {
  const b = String(cfg.base || DEFAULT_AI_BASE).trim().replace(/\/+$/, '');
  const remembered = String(cfg.endpoint || '').trim().replace(/\/+$/, '');
  const list: string[] = [];

  if (cfg.mode === 'direct') {
    list.push(remembered || b);              // 只打地址本身，绝不调用子路径
  } else if (cfg.mode === 'standard') {
    list.push(`${b}/chat/completions`, `${b}/responses`);
  } else {
    if (remembered) list.push(remembered);
    list.push(b);                            // 用户填的 /v1 本体
    list.push(`${b}/chat/completions`, `${b}/responses`);
    if (!/\/v\d+$/.test(b)) {              // base 没带版本号时补一组
      list.push(`${b}/v1`, `${b}/v1/chat/completions`);
    }
  }
  return [...new Set(list.filter(Boolean))].slice(0, 6);
}

/** 不同端点吃不同的请求体：直连地址全带上，官方子路径按各自规范发 */
function requestBody(url: string, model: string, prompt: string, extra: Record<string, unknown>) {
  const messages = [
    { role: 'system', content: '你是二级域名分发平台的审核助手，请按用户给出的规则给出明确结论。' },
    { role: 'user', content: prompt },
  ];
  if (/\/responses\b/.test(url)) return { model, input: prompt, ...extra };
  if (/\/chat\/completions\b/.test(url)) return { model, messages, ...extra };
  // 直连 /v1 之类的聚合入口：三种字段都给，网关挑自己认的那个
  return { model, messages, prompt, input: prompt, ...extra };
}

/** 兼容 chat/completions、responses 以及聚合入口的各种返回形状 */
function extractText(d: any, raw: string): string {
  const cand = [
    d?.choices?.[0]?.message?.content,
    d?.choices?.[0]?.text,
    d?.output_text,
    d?.output?.[0]?.content?.[0]?.text,
    d?.output?.[0]?.text,
    typeof d?.output === 'string' ? d.output : undefined,
    d?.text, d?.response, d?.content, d?.result,
    typeof d?.data === 'string' ? d.data : undefined,
  ];
  for (const x of cand) if (x != null && String(x).trim()) return String(x);
  return raw;
}

export interface ChatAttempt { url: string; status: number; err: string }

/** 逐个候选端点发一次请求，第一个成功的立即返回 */
async function chatOnce(cfg: AiConfig, model: string, prompt: string, signal: AbortSignal) {
  const attempts: ChatAttempt[] = [];
  let lastStatus = 0;
  for (const url of endpointCandidates(cfg)) {
    const call = async (extra: Record<string, unknown>) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
        body: JSON.stringify(requestBody(url, model, prompt, extra)),
        signal,
      });
      return { res, raw: await res.text().catch(() => '') };
    };
    try {
      let { res, raw } = await call({ temperature: 0, max_tokens: 160 });
      // 部分网关不认 max_tokens / temperature，去掉后再试一次同一地址
      if (!res.ok && res.status === 400) {
        try { ({ res, raw } = await call({})); } catch { /* 保持原结果 */ }
      }
      if (res.ok) {
        let d: any = {};
        try { d = JSON.parse(raw); } catch { /* 非 JSON 直接当文本 */ }
        return { text: extractText(d, raw), status: res.status, err: '', url, attempts };
      }
      lastStatus = res.status;
      attempts.push({ url, status: res.status, err: scrub(raw, cfg.key) });
    } catch (e) {
      attempts.push({ url, status: 0, err: String((e as Error)?.name || e) });
    }
  }
  const last = attempts[attempts.length - 1];
  return { text: '', status: lastStatus, err: last?.err || '', url: '', attempts };
}

/** 记住成功端点（best-effort，写不进也不影响本次结果） */
async function rememberEndpoint(env: any, url: string): Promise<void> {
  if (!url) return;
  try {
    await env.DB.prepare(
      "INSERT INTO settings(key, value) VALUES ('ai_api_endpoint', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(url).run();
  } catch { /* 表未就绪时忽略 */ }
}

export interface AiTestResult {
  ok: boolean;
  model: string;
  /** 实际打通的完整请求地址（直连 /v1 成功时就是 /v1） */
  endpoint: string;
  latencyMs: number;
  sample: string;
  message: string;
  detail: string;
  attempts: string[];
  keySet: boolean;
  base: string;
}

/** 后台「用此模型测试审核」：真实打一次 chat/completions，把每个候选的失败原因都带回来 */
export async function aiTest(env: any): Promise<AiTestResult> {
  const cfg = await loadAiConfig(env).catch(() => null);
  const t0 = Date.now();
  const blank: AiTestResult = {
    ok: false, model: '', endpoint: '', latencyMs: 0, sample: '', message: '', detail: '',
    attempts: [], keySet: !!cfg?.configured, base: cfg?.base || DEFAULT_AI_BASE,
  };
  if (!cfg?.configured) {
    return { ...blank, message: '未配置 API Key（后台填一次，或用 Worker Secret AI_API_KEY）' };
  }
  if (!cfg.enabled) return { ...blank, message: '自动审核开关已关闭' };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  const attempts: string[] = [];
  try {
    // 已选模型优先；未选时用官方清单，绝不等待 /models
    const candidates = [
      cfg.model || '',
      ...FALLBACK_MODELS.filter((x) => x && x !== cfg.model),
    ].filter(Boolean).slice(0, 5);
    const prompt = buildReviewPrompt({
      fqdn: 'demo.v-1.top', label: 'demo', root: 'v-1.top', note: '个人博客，用于展示作品集',
    });
    for (const model of candidates) {
      if (ctl.signal.aborted) break;
      try {
        const r = await chatOnce(cfg, model, prompt, ctl.signal);
        if (r.text) {
          await rememberEndpoint(c.env, r.url);
          const v = parseVerdict(r.text);
          return {
            ...blank, ok: true, model, endpoint: r.url, latencyMs: Date.now() - t0,
            attempts: [...attempts, ...r.attempts.map((a) => `${a.url} → HTTP ${a.status}${a.err ? ' · ' + a.err.slice(0, 80) : ''}`)],
            sample: r.text.trim().slice(0, 80),
            message: v ? (v.approve ? '✓ 审核返回 PASS（通过）' : '✓ 审核返回 REJECT（驳回）')
              : '模型可调用，但回复无法解析（实际审核会回落人工）',
          };
        }
        attempts.push(`${model} → HTTP ${r.status}${r.err ? ' · ' + r.err.slice(0, 120) : ''}`);
        for (const a of r.attempts) attempts.push(`  ${a.url} → HTTP ${a.status}${a.err ? ' · ' + a.err.slice(0, 80) : ''}`);
      } catch (e) {
        attempts.push(`${model} → ${String((e as Error)?.name || 'error')}`);
      }
    }
    return {
      ...blank, latencyMs: Date.now() - t0, attempts,
      message: '所有候选模型均调用失败',
      detail: attempts[0] || '',
    };
  } catch (e) {
    return {
      ...blank, message: '连接异常（超时或网络不可达）',
      detail: String((e as Error)?.message || e).slice(0, 200),
      latencyMs: Date.now() - t0, attempts,
    };
  } finally { clearTimeout(timer); }
}

/** AI 审核的完整结果：结论 + 为什么（成功或没触发都要讲清楚） */
export interface AiReviewOutcome {
  verdict: { approve: boolean; reason: string; model?: string } | null;
  diag: AiDiag;
}

/**
 * 带诊断的审核。此前 aiAppliesTo 返回 null 就悄悄吞掉一切，
 * 用户只看到「等待管理员审核」却不知道是没配 Key、后缀不在名单、还是模型报错。
 * 现在每一项前置条件都单独给出原因，前端与审计日志都能显示。
 */
export async function aiReviewDetailed(env: any, input: ReviewInput): Promise<AiReviewOutcome> {
  const root = normalizeDomain(input.root);
  const cfg = await loadAiConfig(env).catch(() => null);
  const diag: AiDiag = {
    applies: false,
    endpoint: cfg?.endpoint || cfg?.base || '',
    skipReason: null,
    skipText: '',
    root,
    roots: cfg?.roots || [],
    keySet: !!cfg?.configured,
    model: cfg?.model || AGNES_CHAT_MODELS[0],
    attempts: [],
    enabled: !!cfg?.enabled,
  };
  const skip = (r: AiSkipReason): AiReviewOutcome => {
    diag.skipReason = r;
    diag.skipText = explainAiSkip(r);
    return { verdict: null, diag };
  };

  if (!cfg) return skip('no-key');
  if (!cfg.enabled) return skip('disabled');
  if (!cfg.configured) return skip('no-key');
  if (!root || !rootInAiList(cfg, root)) return skip('root-not-listed');
  diag.applies = true;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  let gotReply = false;
  try {
    const prompt = buildReviewPrompt(input);
    // 探测只发生在「后台选模型」阶段；审核链路不请求 /models
    const selected = cfg.model || AGNES_CHAT_MODELS[0];
    const candidates = [selected, ...FALLBACK_MODELS.filter((x) => x !== selected)].slice(0, 4);

    for (const model of candidates) {
      if (ctl.signal.aborted) break;
      try {
        const r = await chatOnce(cfg, model, prompt, ctl.signal);
        if (!r.text) {
          diag.attempts.push(`${model} → HTTP ${r.status}${r.err ? ' · ' + r.err.slice(0, 90) : ''}`);
          for (const a of r.attempts) diag.attempts.push(`  ${a.url} → HTTP ${a.status}`);
          continue;
        }
        await rememberEndpoint(env, r.url);
        gotReply = true;
        const verdict = parseVerdict(r.text);
        if (verdict) {
          diag.attempts.push(`${model} → ${verdict.approve ? 'PASS' : 'REJECT'} · ${r.url}`);
          return { verdict: { ...verdict, model }, diag };
        }
        diag.attempts.push(`${model} → 回复无法解析：${r.text.trim().slice(0, 60)}`);
      } catch (e) {
        diag.attempts.push(`${model} → ${String((e as Error)?.name || 'error')}`);
      }
    }
    if (ctl.signal.aborted) return skip('timeout');
    return skip(gotReply ? 'parse-failed' : 'all-models-failed');
  } catch {
    return skip(ctl.signal.aborted ? 'timeout' : 'all-models-failed');
  } finally {
    clearTimeout(timer);
  }
}

/** 兼容旧调用点：只要结论 */
export async function aiReview(
  env: any, input: ReviewInput,
): Promise<{ approve: boolean; reason: string; model?: string } | null> {
  return (await aiReviewDetailed(env, input)).verdict;
}
