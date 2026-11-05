/**
 * 站内通知（铃铛）
 *
 * 目前用于两类场景：
 *   · domain_approved —— 域名申请审核通过 / 被驳回
 *   · login_ip        —— 账号在新 IP 登录时提醒
 *
 * 写入失败绝不阻断主流程（审核、登录本身已经成功）。
 */
import { now } from './util.js';

const TAGS = {
  domain_approved: '域名审核',
  login_ip: '安全提醒',
  abuse_new: '滥用举报',
  system: '系统通知',
};

/**
 * @param {string} type  domain_approved / login_ip / system
 * @returns {Promise<number|null>} 通知 id，失败返回 null
 */
export async function notify(env, userId, type, title, body, link) {
  try {
    const res = await env.DB.prepare(
      'INSERT INTO notifications (user_id, type, title, body, tag, link, read, created_at) VALUES (?,?,?,?,?,?,0,?)'
    )
      .bind(userId, type, title, body, TAGS[type] || '系统通知', link || null, now())
      .run();
    return res.meta?.last_row_id ?? null;
  } catch {
    return null; // 通知是锦上添花，不能让主流程失败
  }
}

/** 未读数量 */
export async function unreadCount(env, userId) {
  try {
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0')
      .bind(userId)
      .first();
    return r?.n || 0;
  } catch {
    return 0;
  }
}

/** 登录 IP 提醒：同一账号上次登录 IP 与本次不同才发，避免每次登录都刷屏 */
export async function notifyLoginIp(env, userId, email, ip) {
  try {
    const last = await env.DB.prepare(
      "SELECT detail FROM audit_log WHERE user_id = ? AND action = 'user.login' AND detail LIKE 'ip=%' ORDER BY id DESC LIMIT 1"
    )
      .bind(userId)
      .first();
    const prev = String(last?.detail || '').replace('ip=', '').trim();
    if (prev && prev === ip) return null; // 同一个 IP 不重复提醒

    const t = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ts = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
    return notify(
      env,
      userId,
      'login_ip',
      '账号登录提醒',
      `你的账号于 ${ts} 登录成功。登录 IP：${ip || '未知'}。若非本人操作，请立即修改密码。`,
      '/profile.html'
    );
  } catch {
    return null;
  }
}
