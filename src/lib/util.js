// 统一响应 / 小工具
export function ok(c, data = {}, status = 200) {
  return c.json({ success: true, ...data }, status);
}

export function fail(c, message, status = 400, extra = {}) {
  return c.json({ success: false, message, ...extra }, status);
}

export function now() {
  return Date.now();
}

export function clientIp(c) {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '';
}

export async function audit(c, user_id, action, target = '', detail = '') {
  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (user_id, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?)'
    )
      .bind(user_id ?? null, action, String(target || '').slice(0, 200), String(detail || '').slice(0, 1000), clientIp(c), now())
      .run();
  } catch {
    /* 审计失败不影响主流程 */
  }
}
