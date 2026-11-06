import { Hono } from 'hono';
import { ok, fail, now, clientIp } from '../lib/util.js';
import { langOf } from '../lib/i18nServer.js';
import { VERIFY_PRESETS, RECORD_TYPES } from '../lib/records.js';
import { allowedDomains, emailRuleHint, emailRuleOf } from '../lib/emailRule.js';

const app = new Hono();

/* ---------------- 服务条款 / 免责声明 ---------------- */

const TERMS_VERSION = '2026-10-31';

type Section = {
  id: string;
  title: string;
  blocks: string[];
  list?: string[];
  note?: string;
};

const SECTIONS_ZH: Section[] = [
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
    list: [
      '域名有效期：新申请的域名有效期为一年（具体天数以站点设置为准），到期前 180 天内可自行续期；迁移前已注册的域名为永久有效，不追溯有效期。',
      '域名到期后将被停用并释放解析，到期前会尽力提示，但用户应自行关注到期时间，因未及时续期导致的解析中断、业务损失，本站不承担责任。',
      '同一账号同一时间只能有一个待审核申请；若通过任何方式在短时间内提交多个申请，本站只批准其中一个，其余自动驳回。',
      '续期、释放、修改 DNS 记录等操作一旦执行不可撤销，因误操作导致的解析中断由用户自行承担。',
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

/** 完整英文版：结构与中文版一一对应，英文模式下整页输出，不留中文段落 */
const SECTIONS_EN: Section[] = [
  {
    id: 'terms',
    title: '1. Terms of Service',
    blocks: [
      'This service is provided free of charge by the site operator ("we"). We allocate subdomains under our root domains and let you manage their DNS records.',
      'By registering you confirm that you have read, understood and accepted these terms in full. If you disagree, stop using the service immediately.',
      'We only provide subdomain allocation and DNS management. You are solely responsible for all content, services and conduct made available through your subdomain.',
      'We may suspend or terminate the service without prior notice if you breach these terms, if required by a competent authority, following a complaint or abuse report, where the service or third parties are put at risk, or after prolonged inactivity.',
    ],
  },
  {
    id: 'abuse',
    title: '2. Prohibited abuse (important)',
    blocks: [
      'The following uses of a subdomain are strictly prohibited. Any violation results in an immediate account ban and deletion of all subdomains and DNS records, without further notice:',
    ],
    list: [
      'Phishing, fraud, impersonating another website or brand, and any form of online scam',
      'Distributing trojans, viruses, ransomware or other malware, or operating C2 / botnet control servers',
      'Bulk phishing or spam email, or forging SPF / DKIM / DMARC records to spoof senders',
      'Hosting or redirecting to pornographic, gambling, drug-related, violent, terrorist or content harmful to minors, or other unlawful material',
      'Infringing intellectual property, privacy or reputation rights, doxxing, or harassment',
      'Bypassing paywalls, account theft, credential stuffing, scanning or brute-force attacks, and any other unauthorised access',
      'Evading third-party bans (domain rotation, redirect or landing pages used to bypass risk controls)',
      'Any other activity that violates the laws of the People\'s Republic of China or of your own jurisdiction',
    ],
    note: 'We may decide whether conduct constitutes abuse based on complaints, threat intelligence, automated detection or manual review. Our determination is final.',
  },
  {
    id: 'accounts',
    title: '3. Account rules',
    blocks: [
      'Registration is limited to approved email providers (currently Gmail and QQ Mail).',
      'A maximum of 2 accounts may be registered per IP address. Accounts created beyond this limit may all be banned without notice.',
      'Bulk registration, scripted sign-ups, and using proxies or anonymity networks to bypass the IP limit are prohibited.',
      'Accounts are personal: they may not be transferred, lent or sold. Subdomains under one account may not be shared with others for prohibited purposes.',
      'Keep your password safe. You are responsible for any consequences of a leaked password or of sharing your account.',
    ],
  },
  {
    id: 'disclaimer',
    title: '4. Disclaimer',
    blocks: [
      'The service is provided "as is", without any express or implied warranty, including but not limited to availability, stability, security, fitness for a particular purpose and non-infringement.',
      'We do not guarantee uninterrupted service. We are not liable for outages or data loss caused by Cloudflare or upstream provider failures, network attacks, force majeure, maintenance or upgrades.',
      'We are not responsible for content published through your subdomain, nor for disputes between users.',
      'We are not liable for any direct or indirect loss (including but not limited to lost profit, data loss or business interruption) arising from use of, or inability to use, the service.',
      'We may modify, suspend or terminate all or part of the service at any time, without liability to you or to any third party.',
      'If your conduct causes complaints, penalties or losses to us, you shall fully compensate us for all such losses.',
    ],
    list: [
      'Domain validity: newly approved domains are valid for one year (the exact number of days follows site settings) and may be renewed within 180 days before expiry; domains registered before the migration remain permanent and are not retroactively given an expiry date.',
      'Expired domains are disabled and their records released. We will try to send a reminder, but you are responsible for tracking expiry; we are not liable for outages or losses caused by late renewal.',
      'An account may have only one pending application at a time. If several are submitted within a short period by any means, we will approve only one and automatically reject the rest.',
      'Renewal, release and DNS record changes cannot be undone once executed. You are responsible for outages caused by mistaken operations.',
    ],
  },
  {
    id: 'privacy',
    title: '5. Data & enforcement',
    blocks: [
      'We collect only your registration email, password hash, registration IP and User-Agent, for account security and abuse tracing. We do not sell or share this data with third parties.',
      'We may lawfully disclose the above information to cooperate with investigations by competent authorities or to respond to security incidents.',
      'Enforcement measures include warnings, limiting record creation, disabling subdomains, banning accounts, banning IPs and clearing DNS records; these may be combined.',
      'If you disagree with a ban, you may appeal using the contact details published on the site. Whether access is restored is at our discretion.',
    ],
  },
  {
    id: 'changes',
    title: '6. Changes to these terms',
    blocks: [
      `These terms may be revised at any time and updated on this page (current version ${TERMS_VERSION}). Continued use after a revision constitutes acceptance. Please check this page periodically.`,
    ],
  },
];

/** 渲染为易读的 HTML（供 /terms.html 内嵌 fallback 使用） */
export function termsHtml(sections: Section[] = SECTIONS_ZH) {
  return sections.map((s) => {
    let h = `<h3 id="${s.id}">${s.title}</h3>`;
    s.blocks.forEach((b) => (h += `<p>${b}</p>`));
    if (s.list) h += `<ul>${s.list.map((li) => `<li>${li}</li>`).join('')}</ul>`;
    if (s.note) h += `<p><strong>${s.note}</strong></p>`;
    return h;
  }).join('');
}

// 服务条款（结构化，前端渲染用）。英文模式直接返回完整英文版，
// 不依赖逐句词典命中，避免长段落残留中文。
app.get('/terms', (c) => {
  const en = langOf(c) === 'en';
  const sections = en ? SECTIONS_EN : SECTIONS_ZH;
  return ok(c, { version: TERMS_VERSION, lang: en ? 'en' : 'zh', sections, html: termsHtml(sections) });
});

// 规则摘要（登录页展示）
app.get('/rules', async (c) => {
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'max_accounts_per_ip'").first();
  const rule = await emailRuleOf(c.env);
  return ok(c, {
    maxAccountsPerIp: Number(row?.value || 2),
    allowedEmailDomains: allowedDomains(c.env),
    emailRule: rule,
    emailRuleHint: emailRuleHint(rule),
    termsVersion: TERMS_VERSION,
  });
});

export default app;
