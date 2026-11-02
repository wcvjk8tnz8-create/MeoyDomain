#!/usr/bin/env node
/**
 * 确保 R2 存储桶存在（用于用户自定义头像上传）。
 *
 * 设计原则：**绝不阻断部署**。
 *  - 桶已存在 → 复用
 *  - 桶不存在 → 通过 Cloudflare API 自动创建
 *  - 任何失败（权限不足 / Authentication error / 网络问题）
 * 注意：无论是否找到/创建成功，都不会往 wrangler.toml 写 [[r2_buckets]]。
 *   头像上传目前一律当作「未启用 R2」处理（见 src/routes/profile.js）。
 *   桶只是预先备好，将来要启用时手动加回绑定即可。
 *        站点全部功能正常，仅「上传自定义头像」不可用；内置头像库与外链头像不受影响。
 *
 * 关于「公网地址」：
 *   头像默认由 Worker 的 /api/avatar/<key> 代理读取，该 URL 本身即公网可访问，
 *   因此 R2 桶**不需要**开启公开访问，也无需绑定自定义域。
 *   如需外链直连以省 Worker 流量，可设置 R2_CUSTOM_DOMAIN / R2_PUBLIC_URL。
 *
 * 环境变量：
 *   必需 CLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_API_TOKEN
 *   可选 R2_BUCKET_NAME（默认 meoy-avatars）、R2_CUSTOM_DOMAIN、CF_ZONE_ID
 */
const BASE = process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const NAME = process.env.R2_BUCKET_NAME || 'meoy-avatars';
const CUSTOM = String(process.env.R2_CUSTOM_DOMAIN || '').trim();
const ZONE = String(process.env.CF_ZONE_ID || '').trim();

const TOML = new URL('../wrangler.toml', import.meta.url).pathname;

async function disableR2(reason) {
  console.log('');
  console.log('⚠ 未能准备好 R2 存储桶：' + reason);
  console.log('  → 本次部署将移除 R2 绑定：站点其它功能全部正常，仅「上传自定义头像」暂不可用，');
  console.log('    内置 12 款头像与外链头像仍可正常使用。');
  console.log('  如需启用，请给 API Token 加上 Account → R2 → Edit 权限后重新部署；');
  console.log('  或手动创建：npx wrangler r2 bucket create ' + NAME);

  try {
    const { readFileSync, writeFileSync } = await import('node:fs');
    let t = readFileSync(TOML, 'utf8');
    if (/^\s*\[\[r2_buckets\]\]/m.test(t)) {
      // 删除 [[r2_buckets]] 整块，直到下一个顶层节或文件末尾
      t = t.replace(/^\s*\[\[r2_buckets\]\][\s\S]*?(?=^\s*\[(?:\[|[a-z_]))|^\s*\[\[r2_buckets\]\][\s\S]*$/m, '');
      writeFileSync(TOML, t);
      console.log('  ✓ 已从 wrangler.toml 移除 [[r2_buckets]] 绑定');
    }
  } catch (e) {
    console.log('  ✘ 移除绑定失败：' + e.message);
    console.log('    若部署仍报 bucket 不存在，请手动删除 wrangler.toml 里的 [[r2_buckets]] 区块。');
  }

  if (process.env.GITHUB_ENV) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_ENV, 'R2_ENABLED=false\n');
  }
  console.log('');
  process.exit(0); // 不阻断部署
}

if (!ACCOUNT || !TOKEN) {
  await disableR2('缺少 CLOUDFLARE_ACCOUNT_ID 或 CLOUDFLARE_API_TOKEN');
}

const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function cf(path, method = 'GET', body) {
  let r;
  try {
    r = await fetch(`${BASE}${path}`, {
      method,
      headers: H,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('网络请求失败：' + e.message);
  }
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Cloudflare 返回无法解析的内容（HTTP ${r.status}）`); }
  if (!r.ok || !json.success) {
    const msg = (json.errors || []).map((e) => e.message || e.code).join('；') || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return json.result;
}

// ---------- 1. 确保桶存在 ----------
let bucket = null;
try {
  const list = await cf(`/accounts/${ACCOUNT}/r2/buckets?per_page=100`);
  bucket = (list?.buckets || []).find((b) => b.name === NAME) || null;
} catch (e) {
  await disableR2('查询存储桶失败：' + e.message);
}

if (bucket) {
  console.log(`✔ 复用已存在的 R2 存储桶「${NAME}」`);
} else {
  try {
    bucket = await cf(`/accounts/${ACCOUNT}/r2/buckets`, 'POST', { name: NAME });
    console.log(`✔ 已创建 R2 存储桶「${NAME}」`);
  } catch (e) {
    // 创建失败（多为 Token 缺 R2:Edit 权限）→ 降级，不阻断
    await disableR2('创建存储桶失败：' + e.message);
  }
}

// ---------- 2. 可选：绑定自定义域（失败仅提示） ----------
if (CUSTOM && ZONE) {
  try {
    await cf(`/accounts/${ACCOUNT}/r2/buckets/${NAME}/domains/custom`, 'PUT', {
      domain: CUSTOM, zoneId: ZONE, minTLS: '1.0', enabled: true,
    });
    console.log(`✔ 已为 R2 桶绑定自定义域：https://${CUSTOM}`);
    if (process.env.GITHUB_ENV) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_ENV, `R2_PUBLIC_URL=https://${CUSTOM}\n`);
    }
  } catch (e) {
    console.log(`• 自定义域绑定未成功（${e.message}）`);
    console.log(`  可到控制台手动绑定：R2 → ${NAME} → Settings → Custom Domains`);
    console.log('  · 头像仍可通过 /api/avatar/<key> 正常访问，不影响使用。');
  }
} else {
  console.log('• 未配置 R2_CUSTOM_DOMAIN，头像通过 /api/avatar/<key> 代理读取（无需 R2 公网地址）');
}
