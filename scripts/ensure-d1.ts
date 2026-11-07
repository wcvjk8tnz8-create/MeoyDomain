/**
 * 确保 D1 数据库存在，并把 database_id 交给后续步骤。
 *  - 已存在（按名字查找）→ 直接复用
 *  - 不存在 → 通过 Cloudflare API 自动创建
 *  - 在 CI 中会把 uuid 写入 $GITHUB_ENV，供 inject-config.ts 使用
 *
 * 依赖环境变量：CLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_API_TOKEN
 * 可选：D1_DATABASE_NAME（默认 subdomain-hub-db）
 */
const BASE = process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const NAME = process.env.D1_DATABASE_NAME || 'subdomain-hub-db';

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
    throw new Error(`Cloudflare API 失败：${msg}`);
  }
  return json.result;
}

/** 按名字在所有分页里找数据库 */
async function findDatabase(name) {
  let page = 1;
  while (page <= 20) {
    const list = await cf(`/accounts/${ACCOUNT}/d1/database?page=${page}&per_page=50`);
    const hit = (list || []).find((d) => d.name === name);
    if (hit) return hit;
    if (!list || list.length < 50) return null; // 最后一页
    page++;
  }
  return null;
}

let db;
try {
  db = await findDatabase(NAME);
} catch (e) {
  // 少数情况下 ?name 过滤不支持，退化为全量拉取已在上面处理；这里直接抛出
  console.error('✘ 查询 D1 数据库失败：' + e.message);
  process.exit(1);
}

if (db) {
  console.log(`✔ 复用已存在的 D1 数据库「${NAME}」→ ${db.uuid}`);
} else {
  try {
    db = await cf(`/accounts/${ACCOUNT}/d1/database`, 'POST', { name: NAME });
  } catch (e) {
    console.error(`✘ 创建 D1 数据库「${NAME}」失败：${e.message}`);
    console.error('  请确认 API Token 具备 Account → D1 → Edit 权限。');
    process.exit(1);
  }
  console.log(`✔ 已创建 D1 数据库「${NAME}」→ ${db.uuid}`);
}

// 交给后续步骤
if (process.env.GITHUB_ENV) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_ENV, `D1_DATABASE_ID=${db.uuid}\n`);
  console.log('  · 已写入 GITHUB_ENV');
}
if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_OUTPUT, `uuid=${db.uuid}\n`);
}
console.log(db.uuid);
