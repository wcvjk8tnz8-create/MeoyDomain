/**
 * TerraDomain · 全站中英文切换（i18n）
 *
 * 为什么用「运行时 DOM 文本映射」而不是给每个组件加 t()：
 *   项目里有 14 个 React 页面 + 一批 legacy 控制器用 innerHTML 动态渲染，
 *   逐处改写会漏掉异步表格、弹窗、toast、后端返回的中文提示。
 *   这里在 DOM 层统一拦截：静态文案、动态注入、SPA 切页后的新节点全部覆盖，
 *   页面代码零改动即可支持双语。
 *
 * 原文保存在 WeakMap 里（按 Text 节点 / 元素属性），切回中文是精确还原，
 * 不走反向字典，因此不会出现「中→英→中」越翻越歪。
 */

export type Lang = 'zh' | 'en';

const STORE_KEY = 'terradata_lang';
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'] as const;

/* ───────────────────────── 词典 ─────────────────────────
   key 为页面上的中文原文（trim 后）。长词组必须在前，子串替换按长度降序，
   避免「域名」先把「域名管理」拆坏。 */
const DICT: Record<string, string> = {
  /* 骨架 / 导航 */
  '控制台': 'Console', '资源管理': 'Resources', '用户中心': 'Account',
  '系统': 'System', '其它': 'More', '首页': 'Home', '返回首页': 'Back to home',
  '站点首页': 'Site Home', '域名管理': 'Domains', '注册域名': 'Register Domain',
  'WHOIS 查询': 'WHOIS Lookup', '域名转移': 'Transfer Domain', '签到地': 'Daily Check-in',
  '奖励中心': 'Rewards', '聊天地': 'Community', '工单系统': 'Support Tickets',
  '个人资料': 'Profile', '管理后台': 'Admin Panel', '服务条款': 'Terms of Service',
  '退出登录': 'Sign out', '域名详情': 'Domain Details', '关于': 'About',
  '搜索': 'Search', '通知': 'Notifications', '全部已读': 'Mark all read',
  '暂无通知': 'No notifications', '加载中…': 'Loading…', '加载中...': 'Loading…',
  '加载失败': 'Failed to load', '暂无数据': 'No data', '暂无消息': 'No messages',
  '请选择左侧消息查看内容': 'Select a message to read', '全部消息': 'All',
  '未读': 'Unread', '已读': 'Read', '修改密码': 'Change Password',
  '我的域名': 'My Domains', '登录': 'Sign in', '注册': 'Sign up',
  '注册账号': 'Create account', '语言': 'Language',
  '系统通知': 'System', '安全提醒': 'Security', '自助验证': 'Verification',
  '上午好': 'Good morning', '中午好': 'Good afternoon', '下午好': 'Good afternoon',
  '晚上好': 'Good evening', '管理员': 'Admin', '用户': 'User',
  '在线': 'Online', '配额不限': 'Unlimited quota', '普通用户': 'User',

  /* 通用按钮 / 状态 */
  '保存': 'Save', '保存修改': 'Save changes', '取消': 'Cancel', '确认': 'Confirm',
  '确定': 'OK', '删除': 'Delete', '添加': 'Add', '返回': 'Back', '提交': 'Submit',
  '关闭': 'Close', '复制': 'Copy', '刷新': 'Refresh', '修改': 'Edit', '查看': 'View',
  '全部': 'All', '更多': 'More', '更多…': 'More…', '提示': 'Notice',
  '成功': 'Success', '失败': 'Failed', '已保存': 'Saved', '已保存，刷新页面后生效': 'Saved. Refresh to apply.',
  '上一页': 'Previous', '下一页': 'Next', '10条/页': '10 / page', '20条/页': '20 / page',
  '共 0 条': '0 total', '已开通': 'Active', '待审核': 'Pending', '已驳回': 'Rejected',
  '已停用': 'Suspended', '已过期': 'Expired', '永久': 'Perpetual', '不占配额': 'Not counted',
  '停用原因': 'Suspension reason', '剩': 'left', '到期': 'Expires',
  '暂无工单': 'No tickets', '暂无工单，喵～': 'No tickets yet ~',
  '全部已处理': 'All handled', '未读消息': 'Unread', '今日待办': 'To-do',
  '示例数据': 'Sample data', '近 7 日访问': 'Last 7 days', '较上周 +1': '+1 vs last week',
  '今日 +20': '+20 today', '点击侧栏查看': 'See sidebar',
  '完善个人资料': 'Complete your profile', '开启两步验证': 'Enable 2FA',
  '阅读最新公告': 'Read the latest announcement', '领取每日积分': 'Claim daily points',
  '基本资料': 'Basic', '联系人': 'Contact', '安全设置': 'Security', '登录日志': 'Login history',
  '用户名': 'Username', '用户名暂不支持修改': 'Username cannot be changed',
  '消息推送设置': 'Notification preferences', '所有消息': 'All messages',
  '仅重要': 'Important only', '禁用推送': 'Disabled', '禁用消息推送': 'Disabled',
  '手机号码': 'Phone', '未绑定': 'Not linked', '个人简介': 'Bio',
  '介绍一下自己吧': 'Tell us about yourself', 'UID': 'UID', '邮箱': 'Email',
  '最近登录': 'Last login', '时间': 'Time', 'IP': 'IP',
  '设备': 'Device', '结果': 'Result', '分类': 'Category', '优先级': 'Priority',
  '状态': 'Status', '标题': 'Title', '提交时间': 'Submitted', '操作': 'Actions',
  '＋ 提交工单': '+ New ticket', '待处理': 'Open', '处理中': 'In progress',
  '有回复': 'Answered', '已关闭': 'Closed', '账号登录提醒': 'Sign-in alert',
  '转移须知': 'Before you transfer', '资源转移': 'Transfer',
  '转移确认': 'Review', '转移提交': 'Done', '下一步': 'Next', '上一步': 'Back',
  '重新开始': 'Start over', '确认并提交': 'Confirm & submit',
  '转移不可逆！一旦接收方确认接受，所有权将立即转移，您将无法再管理该资源。':
    'Transfers are irreversible. Ownership moves immediately once accepted.',
  '我已阅读并同意转移须知': 'I have read and agree to the transfer terms',
  '我了解转移成功后资源无法找回': 'I understand the transfer cannot be undone',
  '请确认转移信息': 'Confirm transfer details', '已提交（演示）': 'Submitted (demo)',
  '已提交（演示）～': 'Submitted (demo) ~',

  /* 登录页 */
  '欢迎回来': 'Welcome back',
  '登录后即可管理你的二级子域名与 DNS 记录': 'Sign in to manage your subdomains and DNS records',
  '请输入密码': 'Enter your password', '记住我（90 天免登录）': 'Keep me signed in (90 days)',
  '忘记密码？': 'Forgot password?', '登录账户': 'Sign in',
  '重置密码': 'Reset password',
  '通过邮箱验证码重置，验证通过后即可设置新密码': 'Reset with an email code, then set a new password',
  '验证码': 'Verification code', '6 位数字': '6-digit code', '发送验证码': 'Send code',
  '验证码 10 分钟内有效': 'The code is valid for 10 minutes',
  '新密码': 'New password', '至少 8 位': 'At least 8 characters',
  '确认重置': 'Confirm reset', '返回登录': 'Back to sign in',
  '创建账号': 'Create your account',
  '注册后即可申请根域名下的二级子域名': 'Sign up to request a subdomain under any root domain',
  '仅支持 Gmail / QQ 邮箱': 'Gmail / QQ Mail only',
  '邮箱验证码': 'Email verification code', '注册前需先验证邮箱': 'Verify your email first',
  '同一网络最多注册 2 个账号，超限账号一经发现将被全部封禁。':
    'At most 2 accounts per network. Excess accounts will be banned.',
  '我已阅读并同意《服务条款与免责声明》，了解并接受禁止滥用与免责条款':
    'I have read and agree to the Terms & Disclaimer, including the abuse policy',
  '注册账户': 'Create account',
  '账户控制台': 'Your Console',
  '登录后可在控制台查看你名下的全部子域名，管理 A、AAAA、CNAME、MX、TXT、NS、SRV、CAA、NAPTR、DS 等记录，并对接 Vercel、Netlify 等平台的根域名验证。':
    'View all your subdomains, manage A / AAAA / CNAME / MX / TXT / NS / SRV / CAA / NAPTR / DS records, and verify ownership for Vercel, Netlify and more.',
  '注册账号并同意服务条款': 'Create an account and accept the terms',
  '提交子域名申请，填写用途说明': 'Submit a request with a short description',
  '等待管理员审核（通常很快）': 'Wait for review (usually quick)',
  '通过后自行添加所需 DNS 记录': 'Add the DNS records you need',
  '创建子域名时不会写入任何 DNS 记录。': 'No DNS records are created automatically.',
  '产品服务': 'What you get', '免费二级域名': 'Free subdomains',
  '多类型解析': 'Full DNS records', '根域名验证': 'Domain verification',
  'Cloudflare 加持': 'Powered by Cloudflare', '根域名下自由申请': 'Pick any root domain',
  '覆盖 10 余种主流记录': '10+ common record types',
  'Vercel / Netlify / DNSPod': 'Vercel / Netlify / DNSPod',
  '全球 Anycast 解析': 'Global Anycast DNS',
  '账户安全提醒': 'Account security',
  '本站不会以任何理由索要你的密码。请勿使用弱密码或在多处复用同一密码。':
    'We will never ask for your password. Avoid weak or reused passwords.',
  '严禁用于钓鱼、欺诈、恶意程序、垃圾邮件等滥用行为，违者立即封禁。':
    'Phishing, fraud, malware and spam are strictly prohibited and result in an immediate ban.',
  '查看禁止滥用清单 →': 'View the abuse policy →',
  '二级域名分发': 'Subdomain distribution',

  /* 落地页 */
  '免费域名注册': 'Free Domain Registration',
  '永久免费的二级域名注册与 DNS 解析管理。': 'Free subdomains and DNS hosting, forever.',
  '即刻部署，几分钟即可上线你的服务。': 'Deploy in minutes and put your service online.',
  '立即开始': 'Get started', '查找可用域名': 'Find a domain',
  '域名注册 可选后缀': 'Available Suffixes', 'HOT': 'HOT', 'Free': 'Free',
  '请输入域名前缀，仅前缀（不需要带后缀）': 'Enter a label only — no suffix needed',
  '例如：my-project': 'e.g. my-project', '立即查询': 'Search',
  'TerraDomain 核心服务': 'Core Features',
  '永久免费的域名注册': 'Free, forever',
  '注册即拥有完整管理权，免费续期，无需任何费用与信用卡。':
    'Full control, free renewals, no fees and no credit card required.',
  '完善的 DNS 管理': 'Full DNS control',
  '12 种记录类型、自定义 TTL、Cloudflare 代理、根域名验证一应俱全。':
    '12 record types, custom TTL, Cloudflare proxy and domain verification.',
  '免费技术支持': 'Community support',
  '内置工单系统与讨论区，遇到问题可随时提交，社区与管理员共同协助。':
    'Built-in tickets and community forum, with help from users and admins.',
  '免费 DNS': 'Free DNS', '专业级权威解析': 'Authoritative DNS',
  '12+ 记录类型': '12+ record types', '域名托管委派': 'Delegation',
  'DNSSEC 就绪': 'DNSSEC ready', 'DNS 解析服务': 'DNS Hosting',
  '12+ 种记录类型': '12+ record types',
  '覆盖网站、邮箱、验证与 DNSSEC 场景。': 'For websites, mail, verification and DNSSEC.',
  '记录集与智能解析': 'Record sets & smart routing',
  'TTL 可低至 1 分钟，支持 Cloudflare 代理加速。': 'TTL as low as 1 minute, with optional Cloudflare proxy.',
  '大规模承载能力': 'Built for scale',
  '依托 Cloudflare 全球边缘网络，稳定可靠。': 'Reliable, on the Cloudflare global edge network.',
  'Whois 查询 & DNS 工具': 'WHOIS & DNS Tools',
  '公开查询接口，无需登录即可调用': 'Public API — no login required',
  'Web 查询页': 'Web lookup', 'Whois LookUP': 'Whois lookup', 'DNS 工具': 'DNS tools',
  '访问': 'Visit', '，支持查询本站子域名，以及 DNSHE / 任意外部域名。':
    ' to query local subdomains, DNSHE or any external domain.',
  '自动识别输入归属：本站走 D1 实时状态，外部域名走 DNSHE 公开 WHOIS 或 RDAP。':
    'Detects the source: local domains use live D1 data, external ones use WHOIS / RDAP.',
  '在域名详情页自助添加 A / AAAA / CNAME / MX / TXT 等记录，并支持平台验证一键写入。':
    'Add A / AAAA / CNAME / MX / TXT records and one-click platform verification.',
  '服务': 'Services', '开源': 'Open source', '问题反馈': 'Issues',
  '免费、开源的二级域名分发与 DNS 管理系统。': 'Free and open-source subdomain & DNS management.',
  '基于 Cloudflare Workers + D1。': 'Built on Cloudflare Workers + D1.',
  '· 二级域名分发': '· Subdomain distribution',
  '# 查询子域名状态（公开接口）': '# Query a subdomain (public API)',
  '# 返回示例': '# Example response',

  /* 域名列表 / 注册页 */
  '域名关键字': 'Search domains', '域名': 'Domain', '根域名': 'Root Domain',
  '记录数': 'Records', '注册时间': 'Created', '到期时间': 'Expires',
  'DNS 记录': 'DNS Records', '释放': 'Release', '移除': 'Remove', '续期': 'Renew',
  '域名总数': 'Total Domains',
  '我的积分': 'My Points', '管理员不限积分': 'Unlimited points',
  '管理员申请子域名不消耗积分。': 'Admin accounts do not spend points on new subdomains.',
  '明细': 'Details',
  '注册入口已独立为单独页面：可先检查名称是否可用、查看积分消耗、再提交申请。':
    'Registration has its own page: check availability, review the point cost, then submit.',
  '前往注册 →': 'Go to register →', '注册须知': 'Before you register',
  '用途说明': 'Intended use', '域名前缀': 'Label', '检查可用性': 'Check availability',
  '立即注册': 'Register now', '提交申请': 'Submit request',
  '该后缀由 AI 自动审核，通过后立即开通（无需人工同意）':
    'AI-reviewed suffix — approved instantly, no manual review',
  'DNS 记录数不限': 'Unlimited DNS records',
  '输入前缀后自动检查是否可用，仅支持字母、数字与连字符。':
    'Availability is checked as you type. Letters, digits and hyphens only.',
  '申请成功，已开通': 'Approved and activated',
  '已提交，等待管理员审核': 'Submitted for review',
  'AI 审核通过，已自动开通': 'Approved by AI',
  '登录成功': 'Signed in', '已退出登录': 'Signed out',

  /* 本轮新增：登录页重做 / 落地页无插画 Hero */
  '给每个想法，': 'An address for', '一个好记的地址。': 'every idea.',
  '免费申请二级域名，自行管理 DNS 记录，几分钟就能把服务挂上线。':
    'Claim a free subdomain, manage your own DNS records, and ship in minutes.',
  '即时开通': 'Instant setup', '审核通过即可使用，无需等待生效': 'Ready as soon as it is approved',
  '完整解析': 'Full DNS control', '12 种记录类型，平台验证一键写入': '12 record types with one-click platform verification',
  '开源免费': 'Open source', '基于 Cloudflare Workers + D1': 'Built on Cloudflare Workers + D1',
  '本站不会以任何理由索要你的密码': 'We will never ask for your password',
  '查找域名': 'Find a domain',
  '永久免费': 'Free forever',
  '12+ 种记录类型 · 全球 Anycast 解析 · 永久免费':
    '12+ record types · Global Anycast DNS · Free forever',
  '记录类型': 'record types', '种记录类型': 'record types',

  /* 控制台 / 后台常见短语（子串替换时长词优先，不会拆坏复合词） */
  '记录': 'Records', '查询': 'Lookup', '类型': 'Type', '已注册': 'Registered',
  '已封禁': 'Banned', '正常': 'Normal', '不限': 'Unlimited', '已删除': 'Deleted',
  '确认认证完成': 'Confirm verification', '配额': 'Quota', '积分': 'Points',
  '验证锁定': 'Verification lock', '停用': 'Suspend', '恢复': 'Restore',
  '永久有效': 'Perpetual', '读取中…': 'Loading…', '自动': 'Auto',
  '发新帖': 'New post', '置顶': 'Pinned', '回复': 'Reply', '说明': 'Note',
  '审核中': 'Under review', '未知': 'Unknown', '兑换码': 'Redeem code',
  '提交工单': 'New ticket', '概览': 'Overview', '解析': 'DNS',
  '选择域名': 'Select a domain', '申请人': 'Requester', '角色': 'Role',
  '详情': 'Details', '已添加': 'Added', '添加选中': 'Add selected',
  '封禁': 'Ban', '备注': 'Note', '地址': 'Address', '同 IP 账号': 'Same-IP accounts',
  '留空则不修改': 'Leave blank to keep',
  '已配置，留空不修改': 'Configured — leave blank to keep',
  '已由环境变量配置': 'Set via environment variable',
  '后台不可修改。': 'Read-only in the panel.',
  '拉取我的域名': 'Fetch my domains', '服务器': 'Server', '工具': 'Tools',
  '二级域名分发控制台': 'Subdomain console', 'AI 自动审核': 'AI auto-review',
  '已配 Zone': 'Zone configured', '核心服务': 'Core Features', '解析服务': 'DNS Hosting',

  /* 页脚 */
  '界面模板 · 演示用途 · 所有内容均为占位': 'Template · Demo · Placeholder content',
};

/* 带数字 / 变量的句式（优先于子串替换） */
const PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^第 (\d+) \/ (\d+) 页 · 共 (\d+) 个$/, m => `Page ${m[1]} / ${m[2]} · ${m[3]} total`],
  [/^第 (\d+) \/ (\d+) 页$/, m => `Page ${m[1]} / ${m[2]}`],
  [/^共 (\d+) 个$/, m => `${m[1]} total`],
  [/^共 (\d+) 条$/, m => `${m[1]} total`],
  [/^剩 (\d+) 天$/, m => `${m[1]} days left`],
  [/^(\d+) 天$/, m => `${m[1]} days`],
  [/^(\d+) 条\/页$/, m => `${m[1]} / page`],
  [/^(\d+) 项资源$/, m => `${m[1]} resources`],
  [/^LV (\d+)$/, m => `LV ${m[1]}`],
  [/^管理员 · 配额不限 · (\d+) 个域名 · (\d+) 条解析$/,
    m => `Admin · Unlimited quota · ${m[1]} domains · ${m[2]} records`],
  [/^(上午好|中午好|下午好|晚上好)，(.+)$/,
    m => `${DICT[m[1]] || 'Hello'}, ${m[2]}`],
  [/^已使用 (\d+) \/ (.+)$/, m => `Used ${m[1]} / ${m[2]}`],
];

const LONG_KEYS = Object.keys(DICT).sort((a, b) => b.length - a.length);

/** 纯函数：把一段中文翻成英文。可单独单测，不依赖 DOM。 */
export function translateText(raw: string, to: Lang = currentLang()): string {
  if (to === 'zh') return raw;
  const lead = (raw.match(/^\s*/) || [''])[0];
  const trail = (raw.match(/\s*$/) || [''])[0];
  const t = raw.trim();
  if (!t || !/[\u4e00-\u9fa5]/.test(t)) return raw;

  if (DICT[t]) return lead + DICT[t] + trail;
  for (const [re, fn] of PATTERNS) {
    const m = t.match(re);
    if (m) return lead + fn(m) + trail;
  }
  // 邮箱 / URL / 纯域名 / 用户输入：不碰
  if (/@|https?:\/\/|www\./i.test(t) || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) return raw;

  let out = t;
  for (const k of LONG_KEYS) {
    if (out.includes(k)) out = out.split(k).join(DICT[k]);
  }
  return out === t ? raw : lead + out + trail;
}

/* ───────────────────────── 状态 ───────────────────────── */
let _lang: Lang = 'zh';
try {
  // 站点默认中文；只有用户明确切换过才用英文。
  // 不跟随浏览器语言：中文用户在 en 系统上打开也不该突然变成英文站。
  _lang = localStorage.getItem(STORE_KEY) === 'en' ? 'en' : 'zh';
} catch { /* SSR / 隐私模式 */ }

export function currentLang(): Lang { return _lang; }

const origText = new WeakMap<Text, string>();
const origAttr = new WeakMap<Element, Record<string, string>>();
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'KBD', 'SVG', 'PATH', 'NOSCRIPT', 'TEXTAREA']);
let _origTitle = '';
let _applying = false;

function isSkipped(el: Element | null): boolean {
  let p: Element | null = el;
  while (p && p !== document.body) {
    if (p.hasAttribute?.('data-no-i18n') || SKIP_TAGS.has(p.tagName)) return true;
    p = p.parentElement;
  }
  return false;
}

function translateNode(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node as Text;
    if (!t.parentNode || isSkipped(t.parentElement)) return;
    if (!origText.has(t)) origText.set(t, t.data);
    const from = origText.get(t)!;
    const to = _lang === 'zh' ? from : translateText(from, 'en');
    if (t.data !== to) t.data = to;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (isSkipped(el)) return;

  let saved = origAttr.get(el);
  if (!saved) { saved = {}; origAttr.set(el, saved); }
  for (const a of ATTRS) {
    const cur = el.getAttribute(a);
    if (cur === null) continue;
    if (!(a in saved)) saved[a] = cur;
    const from = saved[a];
    el.setAttribute(a, _lang === 'zh' ? from : translateText(from, 'en'));
  }
  // 按钮型 input 的 value
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'button') {
    const cur = el.getAttribute('value') || '';
    if (!('value' in saved)) saved.value = cur;
    el.setAttribute('value', _lang === 'zh' ? saved.value : translateText(saved.value, 'en'));
  }
  for (const child of Array.from(el.childNodes)) translateNode(child);
}

/** 扫描整个子树（含属性） */
export function applyI18n(root: Node = document.body): void {
  if (_applying) return;
  _applying = true;
  try { translateNode(root); } finally { _applying = false; }
  document.documentElement.setAttribute('lang', _lang === 'en' ? 'en' : 'zh-CN');
  document.documentElement.setAttribute('data-lang', _lang);
  if (!_origTitle) _origTitle = document.title;
  document.title = translateText(_origTitle, _lang);
  syncButtons();
}

/* ───────────────────── 语言切换按钮 ───────────────────── */
function swHtml(): string {
  return `<span class="lang-switch" data-no-i18n role="group" aria-label="Language">
    <button type="button" data-lang-set="zh" class="${_lang === 'zh' ? 'on' : ''}">中</button>
    <i>/</i>
    <button type="button" data-lang-set="en" class="${_lang === 'en' ? 'on' : ''}">EN</button>
  </span>`;
}

function syncButtons(): void {
  document.querySelectorAll<HTMLElement>('.lang-switch').forEach((sw) => {
    sw.querySelectorAll<HTMLElement>('[data-lang-set]').forEach((b) => {
      b.classList.toggle('on', b.dataset.langSet === _lang);
    });
  });
}

/** 在三种顶栏（控制台 / 落地页 / 登录页）注入切换器，幂等 */
export function mountLangSwitch(): void {
  const slots: Array<[string, 'append' | 'afterSearch']> = [
    ['.topbar-in', 'afterSearch'],
    ['.home-nav', 'append'],
    ['.site-links', 'append'],
  ];
  for (const [sel, mode] of slots) {
    const host = document.querySelector(sel);
    if (!host || host.querySelector('.lang-switch')) continue;
    const wrap = document.createElement('span');
    wrap.innerHTML = swHtml();
    const sw = wrap.firstElementChild!;
    if (mode === 'afterSearch') {
      const anchor = host.querySelector('#topSearch');
      if (anchor && anchor.nextSibling) host.insertBefore(sw, anchor.nextSibling);
      else host.insertBefore(sw, host.firstChild);
    } else host.appendChild(sw);
  }
  syncButtons();
}

export function setLang(next: Lang): void {
  if (next !== 'zh' && next !== 'en') return;
  _lang = next;
  try { localStorage.setItem(STORE_KEY, next); } catch { /* ignore */ }
  applyI18n(document.body);
  window.dispatchEvent(new CustomEvent('terradata:lang', { detail: next }));
}

export function toggleLang(): void { setLang(_lang === 'zh' ? 'en' : 'zh'); }

/* ─────────── 常驻监听：SPA 切页 / 动态渲染自动翻译 ─────────── */
let _observerStarted = false;
export function startI18n(): void {
  // 事件委托只需挂一次
  if (!(window as any).__tdLangDelegated) {
    (window as any).__tdLangDelegated = true;
    document.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement)?.closest?.('[data-lang-set]') as HTMLElement | null;
      if (btn) { e.preventDefault(); setLang(btn.dataset.langSet === 'en' ? 'en' : 'zh'); }
    });
    // 键盘：Alt+L 快速切换
    document.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); toggleLang(); }
    });
  }
  mountLangSwitch();
  applyI18n(document.body);

  if (_observerStarted || typeof MutationObserver === 'undefined') return;
  _observerStarted = true;
  const mo = new MutationObserver((records) => {
    if (_applying) return;
    _applying = true;
    try {
      for (const r of records) {
        if (r.type === 'childList') {
          for (const n of Array.from(r.addedNodes)) {
            if (n.nodeType === Node.ELEMENT_NODE && (n as Element).classList?.contains('lang-switch')) continue;
            translateNode(n);
          }
          // 新顶栏出现时补挂切换器
          if (r.addedNodes.length) mountLangSwitch();
        } else if (r.type === 'characterData' && r.target) {
          const t = r.target as Text;
          if (!isSkipped(t.parentElement)) {
            if (!origText.has(t)) origText.set(t, t.data);
            const from = origText.get(t)!;
            const to = _lang === 'zh' ? from : translateText(from, 'en');
            if (t.data !== to) t.data = to;
          }
        }
      }
    } finally { _applying = false; }
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
}
