/**
 * 子域名申请开关
 *
 * 管理员可在后台「站点设置」暂停新申请（例如维护、配额耗尽、被滥用时）。
 * 暂停只影响「新建子域名」这一个动作，不影响：
 *   · 已注册域名的 DNS 记录增删改、续期、转移
 *   · WHOIS 查询、签到、兑换、聊天地等其它功能
 *   · 管理员自建域名（管理员是「开通」而非「申请」，仍可操作）
 *
 * 存 settings 表：
 *   apply_paused         = '1' / '0'
 *   apply_paused_message = 自定义提示语（可空）
 */

const DEFAULT_MESSAGE = '站点已暂停新域名申请，请稍后再试。已注册的域名不受影响。';

export async function applyGate(env) {
  try {
    const rows = await env.DB.prepare(
      "SELECT key, value FROM settings WHERE key IN ('apply_paused','apply_paused_message')"
    ).all();
    const s = Object.fromEntries((rows.results || []).map((r) => [r.key, r.value]));
    const envPaused = String(env.APPLY_PAUSED || '').trim() === '1';
    return {
      paused: envPaused || String(s.apply_paused || '').trim() === '1',
      message: String(s.apply_paused_message || '').trim().slice(0, 200) || DEFAULT_MESSAGE,
    };
  } catch {
    /* settings 表尚未建立：降级为「未暂停」，不阻断站点 */
    return { paused: String(env.APPLY_PAUSED || '').trim() === '1', message: DEFAULT_MESSAGE };
  }
}

export { DEFAULT_MESSAGE };
