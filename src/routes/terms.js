import { Hono } from 'hono';
import { ok, fail, now, clientIp } from '../lib/util.js';
import { VERIFY_PRESETS, RECORD_TYPES } from '../lib/records.js';

const app = new Hono();

/* ---------------- 服务条款 / 免责声明 ---------------- */

const TERMS_VERSION = '2026-10-31';

const SECTIONS = [
  {
    id: 'terms',
    title: '一、服务条款',
    blocks: [
      '本服务由站点运营方（下称「本站」）免费提供，向用户免费分配根域名下的二级子域名，并提供相应 DNS 记录的管理能力。',
      '用户注册即视为已完整阅读、理解并同意本条款全部内容。若不同意，请立即停止注册与使用。',
      '本站仅提供子域名的分配与解析管理服务，用户通过该子域名对外提供的任何内容、服务与行为，均由用户本人独立承担全部责任。',
      '本站保留在以下情形无需事先通知即可暂停或终止服务的权利：违反本条款、收到有权机关要求、遭受投诉举报、危害本站或第三方安全、长期未使用。',
    ],
  },
  {
    id: 'abuse',
    title: '二、禁止滥用（重点）',
    blocks: [
      '严禁利用本站分配的子域名从事下列任何活动，一经发现立即封禁账号、删除全部子域名及 DNS 记录，且不另行通知：',
    ],
    list: [
      '钓鱼、欺诈、仿冒他人网站或品牌，以及任何形式的网络诈骗',
      '传播木马、病毒、勒索软件等恶意程序，或搭建 C2、僵尸网络控制端',
      '钓鱼邮件、垃圾邮件（SPAM）群发，或伪造 SPF / DKIM / DMARC 用于发信欺骗',
      '搭建或跳转至色情、赌博、毒品、暴恐、侵犯未成年人等违法违规内容',
      '侵犯他人知识产权、隐私权、名誉权，或从事人肉搜索、骚扰行为',
      '绕过付费墙、盗用账号、撞库、扫描爆破等未授权访问行为',
      '用于规避他方封禁（域名轮换、跳转落地页规避风控）',
      '任何其他违反中华人民共和国法律法规及所在司法辖区法律的行为',
    ],
    note: '本站有权根据投诉、威胁情报、自动化检测或人工抽查判定是否构成滥用，判定结果为最终结论。',
  },
  {
    id: 'accounts',
    title: '三、账号规则',
    blocks: [
      '注册邮箱仅限指定服务商（当前为 Gmail 与 QQ 邮箱）。',
      '同一 IP 地址最多注册 2 个账号。超出限制注册的账号，管理员有权不经通知全部封禁。',
      '禁止批量注册、使用脚本注册、使用代理或匿名网络规避 IP 限制。',
      '账号仅限本人使用，禁止转让、出借、出售。一个账号下的子域名不得用于多人共享的违规用途。',
      '请自行妥善保管密码。因密码泄露、账号外借导致的任何后果由用户本人承担。',
    ],
  },
  {
    id: 'disclaimer',
    title: '四、免责声明',
    blocks: [
      '本站按「现状」提供服务，不作任何明示或默示的担保，包括但不限于可用性、稳定性、安全性、适用性及不侵权。',
      '本站不保证服务永不中断。因 Cloudflare 及上游服务商故障、网络攻击、不可抗力、维护升级等原因导致的服务中断或数据丢失，本站不承担任何责任。',
      '本站不对用户通过子域名发布的内容承担任何责任，也不对用户之间的纠纷承担责任。',
      '用户因使用或无法使用本服务所遭受的任何直接与间接损失（包括但不限于利润损失、数据丢失、业务中断），本站概不负责。',
      '本站有权在任何时候修改、暂停或终止全部或部分服务，且无需对用户或第三方承担任何责任。',
      '若用户行为导致本站被投诉、被处罚或产生损失，用户应全额赔偿本站因此遭受的一切损失。',
    ],
  },
  {
    id: 'privacy',
    title: '五、信息与处置',
    blocks: [
      '本站仅收集注册邮箱、密码哈希、注册 IP 与 User-Agent，用于账号安全与滥用追溯，不向第三方出售或共享。',
      '为配合有权机关调查或应对安全事件，本站可能依法披露上述信息。',
      '违规处置措施包括：警告、限制添加记录、停用子域名、封禁账号、封禁 IP、清空 DNS 记录，可合并适用。',
      '封禁后用户仍有异议的，可通过站点公告中提供的联系方式申诉，是否恢复由本站决定。',
    ],
  },
  {
    id: 'changes',
    title: '六、条款变更',
    blocks: [
      `本条款可能随时修订并在本页更新（当前版本 ${TERMS_VERSION}），修订后继续使用即视为接受。请定期查阅。`,
    ],
  },
];

/** 渲染为易读的 HTML（供 /terms.html 内嵌 fallback 使用） */
export function termsHtml() {
  return SECTIONS.map((s) => {
    let h = `<h3 id="${s.id}">${s.title}</h3>`;
    s.blocks.forEach((b) => (h += `<p>${b}</p>`));
    if (s.list) h += `<ul>${s.list.map((li) => `<li>${li}</li>`).join('')}</ul>`;
    if (s.note) h += `<p><strong>${s.note}</strong></p>`;
    return h;
  }).join('');
}

// 服务条款（结构化，前端渲染用）
app.get('/terms', (c) => ok(c, { version: TERMS_VERSION, sections: SECTIONS, html: termsHtml() }));

// 规则摘要（登录页展示）
app.get('/rules', async (c) => {
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'max_accounts_per_ip'").first();
  return ok(c, {
    maxAccountsPerIp: Number(row?.value || 2),
    allowedEmailDomains: String(c.env.ALLOWED_EMAIL_DOMAINS || 'gmail.com,googlemail.com,qq.com,foxmail.com')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    termsVersion: TERMS_VERSION,
  });
});

export default app;
