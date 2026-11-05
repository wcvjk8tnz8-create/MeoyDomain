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

import { EXTRA_DICT } from './dict.en';

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

  /* AI 端点设置 */
  '接口地址': 'API URL', '端点模式': 'Endpoint mode', '审核模型': 'Review model',
  '强制直连': 'Direct only', '标准 OpenAI': 'Standard OpenAI', '自动': 'Auto',
  '自动：先直连 /v1，不通才回落子路径': 'Auto: POST /v1 first, fall back only on failure',
  '强制直连：只 POST /v1，不调用 /chat/completions': 'Direct: POST /v1 only, never call /chat/completions',
  '标准 OpenAI：POST /v1/chat/completions': 'Standard OpenAI: POST /v1/chat/completions',

  /* 域名列表 / 注册页 */
  '域名关键字': 'Search domains', '域名': 'Domain', '根域名': 'Root Domain',
  '记录数': 'Records', '注册时间': 'Created', '到期时间': 'Expires',
  'DNS 记录': 'DNS Records', '释放': 'Release', '移除': 'Remove', '续期': 'Renew',
  '域名总数': 'Total Domains',
  '我的积分': 'My Points', '管理员不限积分': 'Unlimited points',
  '管理员申请子域名不消耗积分。': 'Admin accounts do not spend points on new subdomains.',
  '明细': 'Details',
  '注册入口已独立为单独页面：可先检查名称是否可用、查看积分消耗，再提交申请。':
    'Registration has its own page: check availability, review the point cost, then submit.',
  // 兼容旧文案里的顿号写法（历史版本用过），避免标点差异再次导致整句匹配失败
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

  /* 本轮新增：注册向导 / Zerexa 落地页 / WHOIS 根域名 / AI 自检 */
  '使用须知': 'Before you start',
  '确认信息': 'Review details', '提交注册': 'Submit',
  '域名注册后不可自助注销，每账号有注册数量上限！注册前请确保你真正需要这个域名！':
    'A registered domain cannot be self-deleted, and each account has a quota. Make sure you really need it.',
  '请勿申请包含敏感、违规词汇的域名。申请提交后由系统审核，请耐心等待。':
    'Do not request names containing sensitive or prohibited words. Requests are reviewed after submission.',
  '请输入域名前缀，选择后缀': 'Enter a label and pick a suffix',
  '输入域名前缀': 'Enter a label', '必填': 'Required', '必读': 'Read first',
  '请简单描述您的使用用途': 'Briefly describe what you will use it for',
  '请简单描述您的使用用途（必填）': 'Briefly describe what you will use it for (required)',
  '管理员审核时会看到这段说明。': 'The reviewer will see this note.',
  '我已阅读并同意使用须知': 'I have read and agree to the terms',
  '我了解注册成功后无法自助注销': 'I understand a registered domain cannot be self-deleted',
  '域名一经注册不可自助注销': 'Domains cannot be self-deleted',
  '子域名注册成功后无法自行删除，请在提交前确认名称与后缀无误。':
    'A subdomain cannot be deleted after registration. Double-check the label and suffix.',
  '禁止用于违规用途': 'Prohibited use',
  '严禁钓鱼、仿冒品牌、恶意程序、垃圾邮件、赌博与违法内容，违者立即停用并封禁账号。':
    'Phishing, brand impersonation, malware, spam, gambling and illegal content are prohibited.',
  '审核与 DNS 记录': 'Review & DNS',
  '提交后进入审核；通过后到「DNS 记录」页按需添加解析，创建时不会自动写入任何记录。':
    'Requests are reviewed; add DNS records yourself after approval. Nothing is created automatically.',
  '注册前请先确认以下事项': 'Please confirm the following first',
  '请核对后将提交注册申请': 'Check the details, then submit your request',
  '（未填写）': '(not provided)', '申请已提交': 'Request submitted',
  'AI 自动审核通过，已即时开通': 'Approved by AI and activated instantly',
  '审核通过，已即时开通': 'Approved and activated instantly',
  'AI 审核未通过，请返回修改用途说明': 'Rejected by AI — go back and revise the description',
  '再注册一个': 'Register another', '查看我的域名 →': 'View my domains →',
  '下一步 →': 'Next →', '← 上一步': '← Back',
  '创建子域名不会自动写入任何 DNS 记录，审核通过后到「DNS 记录」页按需添加。':
    'No DNS records are created automatically. Add them after approval.',

  /* Zerexa 风格落地页 */
  '属于你的': 'Your own', '专属子域名': 'subdomain, made simple',
  '免费注册子域名，自行管理 DNS 记录。每个邮箱默认 5 个额度，管理员可在后台调整配额。':
    'Free subdomains with full DNS control. 5 per email by default; admins can adjust the quota.',
  '输入你想要的前缀': 'Enter the label you want',
  '选择前缀并注册': 'Pick a label & register', '添加 TXT 验证': 'Add TXT verification',
  '查看我的域名': 'View my domains', '管理控制台': 'Console',
  '特性': 'Features', '价格': 'Pricing', '常见问题': 'FAQ',
  '免费额度': 'Free quota', '5 个 / 邮箱': '5 / email', '可在后台调整': 'Adjustable in admin',
  '开通时效': 'Provisioning', '审核后即时': 'Instant on approval', 'AI 后缀可秒批': 'AI suffixes approve in seconds',
  '解析方式': 'DNS hosting', '完整 DNS': 'Full DNS',
  '有效期': 'Validity', '365 天': '365 days', '到期前 180 天可续': 'Renew within 180 days of expiry',
  '可选后缀': 'Available suffixes',
  '为什么选择 TerraDomain': 'Why TerraDomain',
  '免费额度、完整 DNS 与独立控制台，适合个人站点、Demo 和轻量服务。':
    'Free quota, full DNS and a dedicated console — ideal for personal sites, demos and lightweight services.',
  '可在下方切换根域名': 'Switch the root domain below',
  '切换下拉即可查其它后缀': 'switch the dropdown to query another suffix',
  '测试 AI 连接': 'Test AI connection',
  '先保存设置再测试；会真实调用一次模型并返回诊断。':
    'Save settings first. This calls the model once and returns diagnostics.',
  '测试中…': 'Testing…', 'AI 连接正常': 'AI connection OK', '所有候选模型均调用失败': 'All candidate models failed',
  '未配置 API Key（后台填一次，或用 Worker Secret AI_API_KEY）':
    'No API key configured (set it in admin, or use the AI_API_KEY Worker Secret)',
  '自动审核开关已关闭': 'Auto-review is switched off',
  '连接异常（超时或网络不可达）': 'Connection failed (timeout or unreachable)',

  /* 页脚 */
  '界面模板 · 演示用途 · 所有内容均为占位': 'Template · Demo · Placeholder content',
};

/* 合并后续页面补录的词典。主词典优先（早期词条经过更多真机校对），
   只补空缺，不覆盖。放在 LONG_KEYS 计算之前，子串排序会自动纳入。 */
for (const [k, v] of Object.entries(EXTRA_DICT)) {
  if (!DICT[k]) DICT[k] = v;
}

/* 完整句子整译：这些是界面上会整段显示的说明文案。
   整句精确命中才会翻译；命中不了就由下方安全网保留全中文，
   绝不用子串替换把它们切成「Sign up入口…ViewPoints消耗」这种夹生话。 */
const FULL_SENTENCES: Record<string, string> = {
  'AI 自动审核（自定义 OpenAI 兼容网关）':
    'AI auto-review (custom OpenAI-compatible gateway)',
  '接口地址 / Base URL（如 https://host/v1）':
    'API URL / Base URL (e.g. https://host/v1)',
  '自动：优先 /chat/completions，失败再试其它端点':
    'Auto: try /chat/completions first, then other endpoints',
  '强制直连：只 POST 填写地址本身（多数网关会 404）':
    'Direct: POST the entered URL itself (most gateways return 404)',
  '标准 OpenAI：只试 /chat/completions 与 /responses':
    'Standard OpenAI: /chat/completions and /responses only',
  '填好地址与 Key 后点「保存」会自动探测 /models，请从返回的清单里选模型（大小写要一致）。Base URL 本身不是端点，直接 POST 通常返回 404。':
    'Saving the URL and key probes /models. Pick a model from the returned list (case-sensitive). A Base URL is not an endpoint — POSTing to it usually returns 404.',
  '每个端点独立超时，成功的地址会被记住后续复用。诊断会列出网关返回的真实模型清单。':
    'Each endpoint has its own timeout; the working address is remembered and reused. Diagnosis lists the models actually returned by the gateway.',
  '诊断中…（会真实请求网关，最多约 45 秒）':
    'Diagnosing… (makes real gateway calls, up to ~45s)',
  '后台未选定审核模型；请先点「探测模型」并从网关清单里选一个':
    'No review model selected. Probe models first, then pick one from the gateway list',

  '默认直接 POST 你填的地址；不通才回落 /chat/completions。成功的地址会被记住。':
    'POSTs the address you entered directly. Falls back to /chat/completions only if it fails; the working endpoint is remembered.',
  '填好地址与 Key 后点「保存」会自动探测 /models；探测不到也没关系，可直接从下拉选 Agnes 官方模型（如 agnes-3.0-flash）。':
    'Saving the URL and key probes /models automatically. If probing fails, just pick an official Agnes model from the dropdown (e.g. agnes-3.0-flash).',

  '勾选后即为本站可用根域名。若要用 Cloudflare 做 DNS 解析，请把该域名 NS 指向 Cloudflare 并填入对应 Zone ID（也可稍后在环境变量配置）。':
    'Checked domains become available root domains here. To use Cloudflare DNS, point the nameservers to Cloudflare and enter the matching Zone ID (or configure it later via environment variables).',
  '封禁后该用户立即下线、无法登录，其全部子域名停用。':
    'Banning signs the user out immediately, blocks sign-in, and disables all their subdomains.',
  '超出限制注册的账号，可在「同 IP 账号」页一键全部封禁。管理员账号不受影响。':
    'Accounts over the per-IP limit can be banned in bulk on the Same IP Accounts page. Admins are unaffected.',
  '发件人需先在服务商处完成域名验证（SPF / DKIM）。':
    'Verify the sender domain with your provider first (SPF / DKIM).',
  '未配置邮件服务时，忘记密码验证码功能不可用（会提示联系管理员）。':
    'Password-reset codes are unavailable until a mail provider is configured (users will be told to contact an admin).',
  '填好地址与 Key 后点「保存」会自动探测 /models；探测不到也没关系，可直接从下拉选 Agnes 官方模型（如 agnes-2.5-flash）。':
    'Saving the URL and key probes /models automatically. If probing fails, just pick an official Agnes model from the dropdown (e.g. agnes-2.5-flash).',
  '/models 探测失败不影响审核，可直接从清单选 agnes-2.5-flash。':
    'A failed /models probe does not block review — pick agnes-2.5-flash from the list.',
  '查询外部域名并识别到托管平台时，结果下方会展示「滥用与违规举报通道」区块。':
    'When an external lookup identifies the hosting platform, an abuse reporting section appears below the result.',
  '全局生效：前台、WHOIS、管理后台、条款页全部应用。拉丁字母与数字始终使用 Redaction 35（像素感），中文字体只接管中文字符。切换后刷新页面即可看到。':
    'Applies site-wide: landing page, WHOIS, admin panel and terms. Latin letters and digits keep Redaction 35; the Chinese font only covers Chinese characters. Refresh to see the change.',
  '本人与管理员始终可见完整地址，不受此项影响。':
    'The owner and admins always see the full address regardless of this setting.',
  '在 Spaceship → API Manager 创建 Key（需 domains 读取权限）。本站只读取域名列表，不注册、不续费、不改 NS。':
    'Create a key in Spaceship → API Manager (needs domains read access). This site only lists domains — no registration, renewal or NS changes.',
  '已注册域名的 DNS 记录、续期、转移等全部不受影响':
    'DNS records, renewals and transfers of existing domains are unaffected',
  '已由环境变量 APPLY_PAUSED 强制开启，后台不可修改。':
    'Forced on by the APPLY_PAUSED environment variable; cannot be changed here.',
  '当前为 MOCK 模式：DNS 记录只写入内存，不会真正调用 Cloudflare。':
    'MOCK mode: DNS records are kept in memory only; Cloudflare is not called.',
  'DNS 记录按各根域名配置的后端实时同步（Cloudflare / Spaceship）。':
    'DNS records sync to the backend configured per root domain (Cloudflare / Spaceship).',
  '已保存，刷新页面后生效': 'Saved. Refresh the page to apply.',
  '诊断中…（会真实请求网关，最多约 20 秒）':
    'Diagnosing… (makes real gateway calls, up to ~20s)',
  '诊断完成，请查看下方明细': 'Diagnosis complete — see details below',
  '未配置，头像走 /api/avatar/<key> 代理读取（桶无需公开）':
    'Not configured; avatars are served through /api/avatar/<key> (bucket can stay private).',
  '未配置。填写 API Key / Secret 并保存后即可自动发现域名。':
    'Not configured. Add the API key / secret and save to discover domains automatically.',
  '删除该子域名并清空其 DNS 记录？':
    'Delete this subdomain and clear all its DNS records?',
  '注意：名单里的根域名必须和你实际申请时选的后缀一致':
    'Note: the roots listed here must match the suffix users actually apply under',

  /* 本轮补齐：此前英文模式下仍整段显示中文的说明与状态文案 */
  '站点已暂停新域名申请，请稍后再试。已注册的域名不受影响。':
    'New domain requests are paused. Please try again later; existing domains are unaffected.',
  '后台「AI 自动审核」开关未开启': 'AI auto-review is switched off in Site Settings',
  '当前根域名不在「AI 自动审核名单」里；名单填 * 可对所有根域名生效':
    'This root is not in the AI auto-review list; set the list to * to cover every root',
  '所有候选模型调用失败（网关报错或网络不可达），已回落人工审核':
    'All candidate models failed (gateway error or unreachable); fell back to manual review',
  '模型有回复但结论无法解析，已回落人工审核':
    'The model replied but its verdict could not be parsed; fell back to manual review',
  'AI 调用超时（单端点 9 秒 / 总预算 20 秒），已回落人工审核':
    'AI call timed out (9s per endpoint / 20s total); fell back to manual review',
  '✓ 审核返回 PASS（通过）': '✓ Review returned PASS',
  '✓ 审核返回 REJECT（驳回）': '✓ Review returned REJECT',
  '模型可调用，但回复无法解析（实际审核会回落人工）':
    'The model is reachable, but its reply could not be parsed (real reviews would fall back to manual)',
  '当前模型不在清单中，可从下拉改选': 'This model is not in the list — pick another one from the dropdown',
  '改选后点「保存」生效。': 'Save after changing the selection.',
  '探测失败：': 'Probe failed: ', '测试失败：': 'Test failed: ', '诊断失败：': 'Diagnosis failed: ',
  '检查失败：': 'Check failed: ', '读取失败：': 'Read failed: ',
  '网络请求失败': 'Network request failed',
  '菜单': 'Menu', '值': 'Value', '例如：': 'e.g. ', '夜深了': 'Late night', '我': 'Me',
  '暂无数据': 'No data', '匿名': 'Anonymous', '本站域名': 'Local domain',
  '须知加载失败，请刷新重试。': 'Could not load the notes. Refresh and try again.',
  '请先勾选同意《服务条款与免责声明》': 'Please accept the Terms & Disclaimer first',
  '请先填写邮箱': 'Enter your email first',
  '确定清空全部券？此操作不可恢复。  兑换记录会保留（便于追溯谁用过）。':
    'Delete all codes? This cannot be undone. Redemption records are kept for auditing.',
  '再次确认：真的要删除所有券吗？': 'Confirm again: really delete every code?',
  '确定取消托管？将删除父区域的 NS 记录，解析权回到本站。  注意：目标服务商上该域名的解析记录不会自动删除，请自行清理。':
    'Cancel delegation? The NS records in the parent zone will be removed and DNS control returns here. Records at the target provider are not deleted automatically — clean them up yourself.',
  '确定将 X 转移给 X？此操作不可撤销。': 'Transfer X to X? This cannot be undone.',
  '选择域名 → 选择平台 → 主机名会自动填入 → 粘贴平台给出的验证值 → 写入锁定。':
    'Pick a domain → choose a platform → the hostname is filled in → paste the verification value → the record is locked.',
  '举报滥用 · 处理入口 →': 'Abuse reports →',
  '发现违规用途？在这里告诉我们': 'Spot a violation? Let us know',
  '其它举报渠道': 'Other reporting channels',
  '相关链接': 'Related links',
  '提交中…': 'Submitting…',
  '登录后可以查看自己的举报记录。': 'Sign in to see your reports.',
  '去登录': 'Sign in',
  '请描述具体的违规行为、时间与影响（至少 10 个字）':
    'Describe the abuse, when it happened and its impact (at least 10 characters)',
  '用于回复处理结果': 'Used only to reply about the outcome',
  'https://…（截图、页面存档或日志）': 'https://… (screenshots, archives or logs)',
  '提交举报即表示你确认所填信息真实，恶意虚假举报会被限制。':
    'By submitting you confirm the information is accurate. Deliberately false reports will be restricted.',
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
  /* 动态数字句式：模板字符串拼接后的真实文案（DOM 里已是完整句） */
  [/^签到领 (\d+) 分$/, m => `Check in for ${m[1]} points`],
  [/^签到成功，\+(\d+) 分$/, m => `Checked in: +${m[1]} points`],
  [/^签到成功 \+(\d+)，当前 (\d+) 分$/, m => `Checked in +${m[1]}; balance ${m[2]} points`],
  [/^明天可再领 (\d+) 分$/, m => `Claim ${m[1]} points again tomorrow`],
  [/^明天可再领 (\d+) 分。单字域名（如 a、1）需 (\d+) 分兑换。$/,
    m => `Claim ${m[1]} points again tomorrow. Single-character labels (e.g. a, 1) cost ${m[2]} points.`],
  [/^今天还没签到，可领 (\d+) 分。单字域名（如 a、1）需 (\d+) 分兑换。$/,
    m => `Not checked in yet — ${m[1]} points available. Single-character labels (e.g. a, 1) cost ${m[2]} points.`],
  [/^签到 \+(\d+) · 域名 -(\d+) · 单字域名 -(\d+)$/,
    m => `Check-in +${m[1]} · Domain -${m[2]} · Single-char -${m[3]}`],
  [/^(\d+) 个域名 · (\d+) 条解析$/, m => `${m[1]} domains · ${m[2]} records`],
  [/^· 另有 (\d+) 个被驳回（不占配额）$/, m => `· ${m[1]} more rejected (do not count against quota)`],
  [/^共 (\d+) 条 · 第 (\d+)\/(\d+) 页$/, m => `${m[1]} total · Page ${m[2]}/${m[3]}`],
  [/^第 (\d+) 页$/, m => `Page ${m[1]}`],
  [/^工单 #(\d+) · (.+)$/, m => `Ticket #${m[1]} · ${m[2]}`],
  [/^版本 (.+) · 注册即视为同意本条款$/, m => `Version ${m[1]} · Signing up means you accept these terms`],
  [/^已永久化 (.+)$/, m => `Made perpetual: ${m[1]}`],
  [/^配额 \+(\d+)，当前 (\d+)$/, m => `Quota +${m[1]}, now ${m[2]}`],
  [/^已清空 (\d+) 张券$/, m => `Cleared ${m[1]} codes`],
  [/^查询 (.+) 下二级子域名的注册状态$/, m => `Check subdomain availability under ${m[1]}`],
  [/^(.+?)需要 (\d+) 分$/, m => `${m[1]} needs ${m[2]} points`],
  [/^AI 自动审核通过（模型 (.+)，耗时 (.+)），已即时开通$/,
    m => `Approved by AI (model ${m[1]}, ${m[2]}) and activated instantly`],
  [/^当前为免审核模式，已直接开通（AI 未参与(.+)）$/,
    m => `Global approval is off — activated directly (AI not involved${m[1]})`],
  [/^已提交，等待管理员审核（AI 未自动审核：(.+)）$/,
    m => `Submitted for manual review (AI did not run: ${m[1]})`],
  /* AI 批量审核队列：后台状态行与 toast 的动态数字句式 */
  [/^待审 (\d+) 个 · AI 名单内 (\d+) 个 · 名单外人工 (\d+) 个 · 超限转人工 (\d+) 个 ｜ 尚未运行过$/,
    m => `Pending ${m[1]} · AI-covered ${m[2]} · manual ${m[3]} · handed over ${m[4]} | Not run yet`],
  [/^待审 (\d+) 个 · AI 名单内 (\d+) 个 · 名单外人工 (\d+) 个 · 超限转人工 (\d+) 个 ｜ 上次运行：(.+)（([\d.]+)s）$/,
    m => `Pending ${m[1]} · AI-covered ${m[2]} · manual ${m[3]} · handed over ${m[4]} | Last run: ${m[5]} (${m[6]}s)`],
  [/^AI 批量审核完成：通过 (\d+) \/ 驳回 (\d+) \/ 待重试 (\d+)$/,
    m => `AI batch review complete: ${m[1]} approved / ${m[2]} rejected / ${m[3]} to retry`],
  [/^本轮审核 (\d+) 个：通过 (\d+) · 驳回 (\d+) · 待重试 (\d+)$/,
    m => `Reviewed ${m[1]}: ${m[2]} approved · ${m[3]} rejected · ${m[4]} to retry`],
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
  if (FULL_SENTENCES[t]) return lead + FULL_SENTENCES[t] + trail;
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
  if (out === t) return raw;
  /* 关键：只翻了半句就停手，会产出「Sign up入口…ViewPoints消耗…Submit request」
     这种中英夹生。宁可整句保留中文，也不能把句子切碎拼贴。
     完整句子的翻译一律走上面的 DICT 整句词条 / PATTERNS 句式。 */
  if (/[\u4e00-\u9fa5]/.test(out)) return raw;
  return lead + out + trail;
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
/* TEXTAREA 不能整块跳过：它的 placeholder 属于界面文案，必须翻。
   只跳过它内部的文本节点（那是可编辑的默认内容，可能含用户输入）。 */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'KBD', 'SVG', 'PATH', 'NOSCRIPT']);
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
    if (t.parentElement?.tagName === 'TEXTAREA') return;
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
  const curTitle = document.title;
  const expectedTitle = translateText(_origTitle, _lang);
  // SPA 切页时页面会自己写新标题。旧实现只缓存首个标题，
  // 导致英文模式下切到任何页面都还显示登录页的中文标题。
  if (!_origTitle || (curTitle !== expectedTitle && /[\u4e00-\u9fa5]/.test(curTitle))) {
    _origTitle = curTitle;
  }
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
          if (t.parentElement?.tagName === 'TITLE') {
            if (_lang === 'en' && /[\u4e00-\u9fa5]/.test(t.data)) {
              _origTitle = t.data;
              const to = translateText(t.data, 'en');
              if (t.data !== to) t.data = to;
            }
            continue;
          }
          if (!isSkipped(t.parentElement)) {
            const saved = origText.get(t);
            // 我们自己写入的译文会再次触发本回调：与预期完全一致时直接忽略，
            // 否则会把英文当成新原文，切回中文就再也还原不了。
            if (saved !== undefined) {
              const expected = _lang === 'zh' ? saved : translateText(saved, 'en');
              if (t.data === expected) continue;
            }
            // 页面代码（React / legacy 控制器）主动改写了文本：
            // 把新值认定为新原文再翻译，绝不把它拉回旧值。
            // 旧实现会无条件恢复 saved，导致选中的根域名被改回默认后缀。
            origText.set(t, t.data);
            const to = _lang === 'zh' ? t.data : translateText(t.data, 'en');
            if (t.data !== to) t.data = to;
          }
        }
      }
    } finally { _applying = false; }
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  if (document.head) mo.observe(document.head, { childList: true, subtree: true, characterData: true });
}
