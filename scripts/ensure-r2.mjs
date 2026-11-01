#!/usr/bin/env node
/**
 * 确保 R2 存储桶存在（用于用户自定义头像上传）。
 *  - 已存在（按名字查找）→ 直接复用
 *  - 不存在 → 通过 Cloudflare API 自动创建
 *
 * 关于「公网地址」：
 *   项目默认通过 Worker 的 /api/avatar/<key> 代理读取头像，这本身就是公网可访问的
 *   地址，因此 R2 桶本身不需要开启公开访问也能正常显示头像。
 *   如果你希望直接用 R2 的域名外链（省 Worker 流量），可设置变量 R2_CUSTOM_DOMAIN
 *   （如 img.meoy.top），本脚本会尝试通过 Cloudflare API 绑定自定义域；
 *   绑定失败不会阻断部署，只给出手动操作提示。
 *
 * 依赖环境变量：CLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_API_TOKEN
 * 可选：R2_BUCKET_NAME（默认 meoy-avatars）、R2_CUSTOM_DOMAIN、CF_ZONE_ID
 */
const BASE = process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const NAME = process.env.R2_BUCKET_NAME || 'meoy-avatars';
const CUSTOM = String(process.env.R2_CUSTOM_DOMAIN || '').trim();
const ZONE = String(process.env.CF_ZONE_ID || '').trim();

if (!ACCOUNT || !TOKEN) {
  console.error('✘ 缺少 CLOUDFLARE_ACCOUNT_ID 或 CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

const H = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function cf(path, method = 'GET', body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Cloudflare 返回无法解析的内容（HTTP ${r.status}）：${text.slice(0, 200)}`);
  }
  if (!r.ok || !json.success) {
    const msg = (json.errors || []).map((e) => e.message || e.code).join('；') || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return json.result;
}

async function findBucket(name) {
  const list = await cf(`/accounts/${ACCOUNT}/r2/buckets?per_page=100`);
  return (list?.buckets || []).find((b) => b.name === name) || null;
}

// ---------- 1. 确保桶存在 ----------
let bucket;
try {
  bucket = await findBucket(NAME);
} catch (e) {
  console.error('✘ 查询 R2 存储桶失败：' + e.message);
  process.exit(1);
}

if (bucket) {
  console.log(`✔ 复用已存在的 R2 存储桶「${NAME}」`);
} else {
  try {
    bucket = await cf(`/accounts/${ACCOUNT}/r2/buckets`, 'POST', { name: NAME });
    console.log(`✔ 已创建 R2 存储桶「${NAME}」`);
  } catch (e) {
    console.error(`✘ 创建 R2 存储桶「${NAME}」失败：${e.message}`);
    console.error('  请确认 API Token 具备 Account → R2 → Edit 权限。');
    console.error('  也可以手动创建：npx wrangler r2 bucket create ' + NAME);
    process.exit(1);
  }
}

// ---------- 2. 可选：绑定自定义域（失败不阻断） ----------
if (CUSTOM && ZONE) {
  try {
    await cf(`/accounts/${ACCOUNT}/r2/buckets/${NAME}/domains/custom`, 'PUT', {
      domain: CUSTOM,
      zoneId: ZONE,
      minTLS: '1.0',
      enabled: true,
    });
    console.log(`✔ 已为 R2 桶绑定自定义域：https://${CUSTOM}`);
    if (process.env.GITHUB_ENV) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_ENV, `R2_PUBLIC_URL=https://${CUSTOM}\n`);
    }
  } catch (e) {
    console.log(`• 自定义域绑定未成功（${e.message}）`);
    console.log(`  可到 Cloudflare 控制台手动绑定：R2 → ${NAME} → Settings → Custom Domains`);
    console.log('  · 头像仍可通过 Worker 的 /api/avatar/<key> 正常访问，不影响使用。');
  }
} else {
  console.log('• 未配置 R2_CUSTOM_DOMAIN，头像通过 /api/avatar/<key> 代理读取（无需 R2 公网地址）');
}
