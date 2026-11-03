/**
 * 用户资料：昵称 / 头像（内置头像库）/ 简介 / UID
 * 独立表 user_profiles，不动 users 结构（避免已存在表补列失败）。
 */
import { Hono } from 'hono';
import { ok, fail, now, audit } from '../lib/util.js';
import { AVATARS, DEFAULT_AVATAR, LEGACY_AVATAR } from '../lib/avatars.js';

const app = new Hono();

/**
 * 老用户资料里可能存着旧版猫脸 SVG 的路径。
 * 统一归一化成新默认头像，保证顶栏与资料页永远一致。
 */
function normAvatar(v) {
  const s = String(v || '').trim();
  return !s || s === LEGACY_AVATAR ? DEFAULT_AVATAR : s;
}

/** 生成对外展示的 UID：不暴露自增 id */
function makeUid(userId) {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符
  let n = userId * 7919 + 104729;
  let s = '';
  for (let i = 0; i < 7; i++) {
    s += ALPHABET[n % ALPHABET.length];
    n = Math.floor(n / ALPHABET.length) + 31;
  }
  return 'VX' + s;
}

/** 头像合法性：只接受站内头像库或 http(s) 外链 */
function safeAvatar(v) {
  const s = normAvatar(v);
  if (AVATARS.some((a) => a.url === s)) return s;
  // 旧版 12 张自绘猫脸 SVG：仍允许已保存的旧值继续读写
  if (/^\/img\/avatar\/[a-z0-9._-]+\.svg$/i.test(s)) return s;
  // 本站 R2 上传的头像：/api/avatar/<key>（key 限制为安全字符）
  if (/^\/api\/avatar\/[A-Za-z0-9._-]{1,120}$/.test(s)) return s;
  if (/^https:\/\/[^\s"']+\.(png|jpe?g|gif|webp|svg)(\?[^\s"']*)?$/i.test(s)) return s.slice(0, 500);
  return null; // 非法
}

/** 读取（不存在则自动创建初始资料） */
async function loadProfile(env, userId) {
  let p = await env.DB.prepare('SELECT * FROM user_profiles WHERE user_id = ?').bind(userId).first();
  if (!p) {
    const uid = makeUid(userId);
    await env.DB.prepare(
      'INSERT INTO user_profiles (user_id, uid, avatar, nickname, bio, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(userId, uid, DEFAULT_AVATAR, '', '', now())
      .run();
    p = { user_id: userId, uid, avatar: DEFAULT_AVATAR, nickname: '', bio: '' };
  }
  return p;
}

/** GET /api/profile —— 我的资料 + 头像库 */
app.get('/', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const p = await loadProfile(c.env, u.id);
  const full = await c.env.DB.prepare('SELECT created_at, last_login_at FROM users WHERE id = ?').bind(u.id).first();
  const dom = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM subdomains WHERE user_id = ? AND status IN ('pending','approved','suspended')"
  )
    .bind(u.id)
    .first();
  const rec = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM dns_records r
     JOIN subdomains s ON s.id = r.subdomain_id
     WHERE s.user_id = ?`
  )
    .bind(u.id)
    .first();

  return ok(c, {
    profile: {
      uid: p.uid,
      avatar: normAvatar(p.avatar),
      nickname: p.nickname || '',
      bio: p.bio || '',
    },
    email: u.email,
    role: u.role,
    createdAt: full?.created_at || null,
    lastLoginAt: full?.last_login_at || null,
    domains: dom?.n || 0,
    records: rec?.n || 0,
    avatars: AVATARS,
  });
});

/** PUT /api/profile —— 更新昵称/头像/简介 */
app.put('/', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  const body = await c.req.json().catch(() => ({}));

  const nickname = String(body.nickname ?? '').trim().slice(0, 24);
  const bio = String(body.bio ?? '').trim().slice(0, 160);
  const avatar = safeAvatar(body.avatar);
  if (body.avatar !== undefined && avatar === null) {
    return fail(c, '头像地址不合法：请选择内置头像，或填写 https 图片链接');
  }

  await loadProfile(c.env, u.id); // 确保有记录
  const sets = [];
  const vals = [];
  if (body.nickname !== undefined) { sets.push('nickname = ?'); vals.push(nickname); }
  if (body.bio !== undefined) { sets.push('bio = ?'); vals.push(bio); }
  if (body.avatar !== undefined) { sets.push('avatar = ?'); vals.push(avatar); }
  if (!sets.length) return fail(c, '没有要更新的内容');
  sets.push('updated_at = ?');
  vals.push(now(), u.id);

  await c.env.DB.prepare(`UPDATE user_profiles SET ${sets.join(', ')} WHERE user_id = ?`)
    .bind(...vals)
    .run();

  await audit(c, u.id, 'user.profile', u.email, sets.filter((s) => !s.startsWith('updated_at')).join(','));
  const p = await loadProfile(c.env, u.id);
  return ok(c, {
    profile: { uid: p.uid, avatar: normAvatar(p.avatar), nickname: p.nickname || '', bio: p.bio || '' },
  });
});


/** POST /api/profile/avatar —— 上传自定义头像到 R2（multipart/form-data） */
app.post('/avatar', async (c) => {
  const u = c.get('user');
  if (!u) return fail(c, '请先登录', 401, { needLogin: true });
  // 头像上传一律按「未启用」处理：项目当前不绑定 R2（wrangler.toml 无 [[r2_buckets]]），
  // 即使账号里存在桶也不启用 —— 避免因 R2 未就绪导致部署失败或上传报错。
  // 用户仍可使用内置头像库或填写外链头像。
  if (!c.env.AVATARS || String(c.env.AVATAR_ENABLED || '').trim() !== '1') {
    return fail(c, '当前未开放自定义头像上传，可从内置头像库中选择或填写头像链接', 501);
  }

  let form;
  try { form = await c.req.formData(); } catch { return fail(c, '上传格式不正确'); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return fail(c, '请选择图片文件');

  const maxKb = Number(c.env.AVATAR_MAX_KB || 2048);
  if (file.size > maxKb * 1024) return fail(c, `图片不能超过 ${maxKb} KB`);
  if (file.size < 16) return fail(c, '图片文件无效');

  // 只接受图片类型
  const type = String(file.type || '').toLowerCase();
  const extMap = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
    'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  };
  const ext = extMap[type];
  if (!ext) return fail(c, '仅支持 PNG / JPG / GIF / WebP / SVG 图片');
  if (ext === 'svg') return fail(c, '出于安全考虑不支持 SVG，请上传 PNG / JPG');

  // 读取前 8 字节校验图片魔数，防止伪造 Content-Type
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const magicOk =
    (ext === 'png' && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) ||
    (ext === 'jpg' && head[0] === 0xff && head[1] === 0xd8) ||
    (ext === 'gif' && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) ||
    (ext === 'webp' && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46);
  if (!magicOk) return fail(c, '文件内容与声明的类型不符，请上传真实图片');

  const key = `u${u.id}-${Date.now().toString(36)}.${ext}`;
  await c.env.AVATARS.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` },
  });

  // 公网地址：后台设置优先，其次环境变量；都没有就用 Worker 代理
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'r2_public_url'").first();
  const publicBase = (String(row?.value || '').trim() || String(c.env.R2_PUBLIC_URL || '').trim()).replace(/\/$/, '');
  const url = publicBase ? `${publicBase}/${key}` : `/api/avatar/${key}`;

  await loadProfile(c.env, u.id);
  await c.env.DB.prepare('UPDATE user_profiles SET avatar = ?, updated_at = ? WHERE user_id = ?')
    .bind(url, now(), u.id)
    .run();
  await audit(c, u.id, 'user.avatar.upload', u.email, key);

  return ok(c, { url, key });
});

export default app;
