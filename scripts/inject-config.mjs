#!/usr/bin/env node
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
if (!d1) {
  const m = toml.match(/database_id\s*=\s*["']([^"']+)["']/);
  if (!m || PLACEHOLDER_ID.test(m[1])) {
    console.error('✘ 未提供 D1_DATABASE_ID，且 wrangler.toml 里仍是占位值。');
    console.error('  请在 Settings → Secrets 添加 D1_DATABASE_ID，或用 npm run db:create 后手动填写。');
    process.exit(1);
  }
  console.log('  · database_id 已手动填写，跳过');
} else {
  apply('database_id', d1);
}

// 其余可选变量
const KEYS = ['ROOT_DOMAIN', 'DEFAULT_QUOTA', 'ALLOW_SIGNUP', 'REQUIRE_APPROVAL', 'RESERVED_LABELS', 'CF_MOCK'];
let n = 0;
for (const k of KEYS) if (apply(k, process.env[k])) n++;
if (!n) console.log('  · 无可选变量需要覆盖');

writeFileSync(FILE, toml);
console.log('完成');
