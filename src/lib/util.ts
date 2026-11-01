/**
 * 统一响应 / 小工具（TypeScript 版）
 *
 * 这是渐进式迁移的第一块：存量 .js 仍然 import './util.js'，
 * 两者导出同名函数，互不冲突。新代码请 import './util.ts'。
 */
import type { Context } from 'hono';
import type { Env } from '../types.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** 成功响应 */
export function ok<T extends Record<string, unknown>>(
  c: Context<{ Bindings: Env }>,
  data: T = {} as T,
  status: ContentfulStatusCode = 200
) {
  return c.json({ success: true, ...data }, status);
}

/** 失败响应 */
export function fail(
  c: Context<{ Bindings: Env }>,
  message: string,
  status: ContentfulStatusCode = 400,
  extra: Record<string, unknown> = {}
) {
  return c.json({ success: false, message, ...extra }, status);
}

/** 当前毫秒时间戳 */
export function now(): number {
  return Date.now();
}

/** 客户端 IP（Cloudflare 优先，回落 XFF） */
export function clientIp(c: Context<{ Bindings: Env }>): string {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '';
}

/**
 * 审计日志。
 * 刻意吞掉异常 —— 审计写失败不应该影响主流程。
 */
export async function audit(
  c: Context<{ Bindings: Env }>,
  userId: number | null | undefined,
  action: string,
  target: string | number = '',
  detail = ''
): Promise<void> {
  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (user_id, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?)'
    )
      .bind(
        userId ?? null,
        action,
        String(target || '').slice(0, 200),
        String(detail || '').slice(0, 1000),
        clientIp(c),
        now()
      )
      .run();
  } catch {
    /* 审计失败不影响主流程 */
  }
}
