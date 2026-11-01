/**
 * 用户资料：昵称 / 头像（内置头像库）/ 简介 / UID
 * 独立表 user_profiles，不动 users 结构。
 */
import { ok, fail } from '../lib/resp.js';
import { audit } from '../lib/audit.js';

const app = { routes: []; };
export default app;
