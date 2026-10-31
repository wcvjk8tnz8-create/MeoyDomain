#!/usr/bin/env node
// 运维小工具：把指定邮箱设为管理员 / 解封用户
// 用法：
//   node scripts/admin.mjs a@b.com
//   node scripts/admin.mjs a@b.com --unban
//   node scripts/admin.mjs a@b.com --local
import { execSync } from 'node:child_process';

const [email, ...flags] = process.argv.slice(2);
if (!email) {
  console.log('用法： node scripts/admin.mjs <email> [--unban] [--local]');
  process.exit(1);
}
const target = flags.includes('--local') ? '--local' : '--remote';
const unban = flags.includes('--unban');

const sql = unban
  ? `UPDATE users SET status='active', ban_reason=NULL WHERE email='${email.replace(/'/g, "''")}'`
  : `UPDATE users SET role='admin', status='active', ban_reason=NULL WHERE email='${email.replace(/'/g, "''")}'`;

console.log(`> ${sql}`);
try {
  execSync(`npx wrangler d1 execute subdomain-hub-db ${target} --command "${sql}"`, { stdio: 'inherit' });
  console.log(unban ? '✔ 已解封' : '✔ 已设为管理员');
} catch (e) {
  console.error('执行失败，请确认已执行 npm install 并登录 wrangler');
  process.exit(1);
}
