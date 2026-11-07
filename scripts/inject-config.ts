// 把 GitHub Secrets / Variables 注入 wrangler.toml（只在 CI 中运行）
// 支持覆盖：D1_DATABASE_ID 及 [vars] 区块里的任意键（ROOT_DOMAIN / DEFAULT_QUOTA / ...）
import { readFileSync, writeFileSync } from 'fs';

const FILE = new URL('../wrangler.toml', import.meta.url).pathname;
const PLACEHOLDER_ID = /^[0]{16,}$/; // 占位 database_id

let toml = readFileSync(FILE, 'utf8');
const apply = (key, value) => {
  if (value === undefined || value === '') return false;
  // 匹配  key = "..."  或  key = '...'
  const re = new RegExp(`^(\\s*${key}\\s*=\\s*)(["'])(.*?)\\2`, 'm');
  if (re.test(toml)) {
    toml = toml.replace(re, (_, p, q) => `${p}${q}${value}${q}`);
    console.log(`  ✓ ${key}`);
    return true;
  }
  return false;
};

console.log('注入配置：');

// D1 database_id：占位值必须被替换，否则部署会失败
const d1 = process.env.D1_DATABASE_ID;
if (d1) {
  apply('database_id', d1);
} else {
  const m = toml.match(/database_id\s*=\s*["']([^"']+)["']/);
  if (!m || PLACEHOLDER_ID.test(m[1])) {
    console.log('  · 未拿到 database_id（上一未自动生成 / 未配置），保持原值');
    console.log('    若部署报错，请检查 CLOUDFLARE_API_TOKEN 是否具备 D1 编辑权限。');
  } else {
    console.log('  · database_id 已手动填写，跳过');
  }
}

// 其余可选变量
const KEYS = [
  'ROOT_DOMAIN', 'DEFAULT_QUOTA', 'ALLOW_SIGNUP', 'REQUIRE_APPROVAL', 'RESERVED_LABELS', 'CF_MOCK',
  // R2：桶名（需与 ensure-r2.ts 创建的一致）、公开外链地址
  'R2_BUCKET_NAME', 'R2_PUBLIC_URL', 'AVATAR_MAX_KB',
  // 多根域名
  'ROOT_DOMAINS', 'CF_ZONE_IDS',
];
let n = 0;
for (const k of KEYS) if (apply(k, process.env[k])) n++;
if (!n) console.log('  · 无可选变量需要覆盖');

writeFileSync(FILE, toml);
console.log('完成');
