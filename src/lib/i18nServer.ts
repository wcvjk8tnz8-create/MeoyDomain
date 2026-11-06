/**
 * 后端响应本地化（英文模式）
 *
 * 为什么需要它：前端的 i18n 是「DOM 文本映射」，只能翻页面里写死的文案。
 * 但接口返回的 message（toast / 错误提示）、通知标题与正文、服务条款段落、
 * AI 诊断逐行输出、DNS 记录类型名等，全部是后端生成的中文，前端词典永远补不齐。
 *
 * 做法：前端每次请求带上 `X-Lang: en`，统一响应出口（ok / fail）递归遍历返回值，
 * 只把「精确命中词典」的字符串换成英文。
 *
 * 安全性：只做精确匹配，不做子串替换；且跳过明确属于用户数据的字段
 * （fqdn / email / note / reason / body…）。所以用户自己写的用途说明、
 * 备注、域名、邮箱绝不会被改写，也不会出现中英夹生。
 */

export type Lang = 'zh' | 'en';

/** 从请求里读语言：显式 header 优先，其次 ?lang=，最后 Accept-Language */
export function langOf(c: any): Lang {
  const h = String(c?.req?.header?.('x-lang') || '').trim().toLowerCase();
  if (h === 'en' || h === 'zh') return h;
  try {
    const u = new URL(c.req.url);
    const q = u.searchParams.get('lang');
    if (q === 'en' || q === 'zh') return q;
  } catch { /* ignore */ }
  const al = String(c?.req?.header?.('accept-language') || '').toLowerCase();
  if (al.startsWith('en')) return 'en';
  return 'zh';
}

/* ─────────────────────── 固定文案词典 ───────────────────────
   收录所有 fail()/ok({message}) 的固定中文、通知文案、标签、状态词、
   TTL / 记录类型名、AI 诊断行、服务条款段落。key 必须与实际字符串完全一致。 */
export const SERVER_DICT: Record<string, string> = {
  /* 通用 / 鉴权 */
  '未登录': 'Not signed in', '请先登录': 'Please sign in first',
  '页面不存在': 'Page not found', '接口不存在': 'Endpoint not found',
  '需要管理员权限': 'Admin privileges required',
  '当前账号没有管理员权限。': 'This account does not have admin privileges.',
  '请求失败': 'Request failed', '操作成功': 'Done',
  '信息不完整': 'Incomplete information', '场景不合法': 'Invalid scene',
  '角色不合法': 'Invalid role', '缺少 IP': 'Missing IP',
  '缺少 label': 'Missing label', '没有要更新的内容': 'Nothing to update',
  '缺少通知 id': 'Missing notification id',
  /* 注册邮箱规则（默认：白名单 ∪ 任意含 edu 的邮箱） */
  '支持白名单邮箱，以及任何包含 "edu" 的邮箱注册': 'Whitelisted mail, plus any email containing "edu"',
  '仅支持白名单邮箱注册': 'Whitelisted mail only',
  '仅支持包含 "edu" 的邮箱注册': 'Only emails containing "edu"',
  '支持任意有效邮箱注册': 'Any valid email address is accepted',
  '该邮箱不符合注册规则：仅支持白名单邮箱或包含 "edu" 的邮箱':
    'This email is not allowed: use a whitelisted address or one containing "edu"',
  '该邮箱不符合注册规则：仅支持白名单邮箱': 'This email is not allowed: whitelisted addresses only',
  '该邮箱不符合注册规则：仅支持包含 "edu" 的邮箱': 'This email is not allowed: address must contain "edu"',
  '该邮箱不符合注册规则': 'This email is not allowed for signup',
  '注册邮箱规则不合法': 'Invalid signup email rule',
  '不能封禁管理员': 'Admin accounts cannot be banned',
  '用户不存在': 'User not found', '账号已封禁': 'Account banned',
  '请先阅读并同意《服务条款与免责声明》': 'Please read and accept the Terms & Disclaimer first',
  '《服务条款与免责声明》': 'Terms & Disclaimer',

  /* 账号 / 密码 / 验证码 */
  '请输入邮箱和密码': 'Enter your email and password',
  '邮箱或密码错误': 'Incorrect email or password',
  '密码至少 8 位': 'Password must be at least 8 characters',
  '新密码至少 8 位': 'New password must be at least 8 characters',
  '密码过长': 'Password is too long', '密码已重置': 'Password has been reset',
  '原密码不正确': 'Current password is incorrect',
  '该邮箱已注册': 'This email is already registered',
  '该邮箱未注册': 'This email is not registered',
  '请填写有效的邮箱地址': 'Enter a valid email address',
  '发件人邮箱格式不正确': 'Sender email is invalid',
  '请填写邮箱验证码': 'Enter the email verification code',
  '请先获取验证码': 'Request a verification code first',
  '验证码不正确': 'Incorrect verification code',
  '验证码已过期，请重新获取': 'The code has expired. Request a new one',
  '验证码已发送，请查收邮件': 'Code sent. Check your inbox',
  '请填写邮箱与验证码': 'Enter your email and the code',
  '密码已修改，其它设备已登出': 'Password changed. Other sessions have been signed out',
  '密码已重置，请使用新密码登录': 'Password reset. Sign in with your new password',
  '发送过于频繁，请 60 秒后再试': 'Too many requests. Try again in 60 seconds',
  '注册账号需要邮箱验证码': 'Email verification is required to sign up',
  '站点未配置邮件服务，无法发送验证码。请联系管理员在「站点设置 → 邮件与验证码」中配置 Resend 或 Brevo。':
    'No mail provider is configured, so verification codes cannot be sent. Ask an admin to set up Resend or Brevo under Site Settings → Mail & Verification.',
  '邮件服务商仅支持 resend / brevo': 'Only resend / brevo are supported as mail providers',
  '验证码发送失败': 'Failed to send the verification code',
  '邮件发送失败：': 'Mail delivery failed: ',
  '未配置邮件服务': 'Mail provider not configured',
  '未配置 API Key（后台填一次，或用 Worker Secret AI_API_KEY）':
    'No API key configured (set it in Site Settings, or use the AI_API_KEY Worker Secret)',

  /* 域名申请 */
  '子域名不存在': 'Subdomain not found', '域名不存在': 'Domain not found',
  '域名格式不正确': 'Invalid domain format',
  '该子域名已被注册': 'This subdomain is already registered',
  '手慢一步，该子域名刚刚被他人注册，请换一个名称':
    'Someone just registered this subdomain. Pick another name',
  '你此前申请的该名称被驳回，可重新申请':
    'Your previous request for this name was rejected; you may apply again',
  '该子域名暂不可用（原申请人正在处理）':
    'This subdomain is temporarily unavailable (the previous applicant is still handling it)',
  '该名称为系统保留，不可申请': 'This name is reserved and cannot be requested',
  '子域名仍在审核中': 'This subdomain is still under review',
  '子域名已被停用': 'This subdomain has been suspended',
  '你已有一个待审核的申请': 'You already have a pending request',
  '同一时间只能申请一个域名。请等待审核完成，或被驳回后再申请。':
    'Only one request at a time. Wait for the review, or reapply after a rejection.',
  '请先勾选免责与使用承诺': 'Please accept the disclaimer and usage terms first',
  '请输入子域名': 'Enter a subdomain',
  '请输入要查询的域名': 'Enter a domain to look up',
  '子域名最多 63 个字符': 'A subdomain can be at most 63 characters',
  '不支持纯数字子域名': 'All-numeric subdomains are not supported',
  '含非法字符': 'Contains invalid characters', '主机名过长': 'Hostname is too long',
  '主机名越界': 'Hostname out of range', '主机名片段': 'Hostname label',
  '域名前缀': 'Subdomain prefix', '根域名': 'Root domain',
  '该根域名不存在或已被移除': 'This root domain does not exist or has been removed',
  '当前没有生效的根域名': 'No active root domains',
  '暂未配置根域名': 'No root domain configured',
  '该域名已经是永久有效': 'This domain is already perpetual',
  '该域名永久有效，无需续期': 'This domain is perpetual; no renewal needed',
  '该域名为永久有效，无需续期': 'This domain is perpetual; no renewal needed',
  '只有已注册的域名可以续期': 'Only registered domains can be renewed',
  '只有已注册的域名可以永久化': 'Only registered domains can be made perpetual',
  '域名已过期，无法续期。请重新申请。': 'This domain has expired and cannot be renewed. Please apply again.',
  '已续期，新到期': 'Renewed. New expiry:',
  '域名审核已通过': 'Domain request approved',
  '域名申请被驳回': 'Domain request rejected',
  '子域名申请已被驳回': 'Subdomain request rejected',
  '域名已被停用': 'Domain suspended',
  '已被管理员停用': 'Suspended by an administrator',
  '不符合使用规范': 'Does not meet the usage policy',
  '未通过审核': 'Review did not pass',
  '原因：': 'Reason: ', '如有疑问可提交工单。': 'Open a support ticket if you have questions.',
  '域名消耗积分': 'Points required for a domain',
  '单字域名消耗': 'Single-character domain cost',
  '单字域名消耗积分': 'Points required for a single-character domain',
  '积分为 0，免费开通': '0 points — free to register',
  '积分不足': 'Not enough points',
  '本次不消耗积分': 'No points are charged for this request',
  '管理员申请不消耗积分': 'Admin requests do not consume points',
  '当前未开放注册': 'Registration is currently closed',
  '新域名申请已暂停': 'New domain requests are paused',
  '申请已暂停': 'Requests are paused',
  /* AI 批量审核队列 */
  'AI 配置读取失败': 'Could not load AI configuration',
  'Workers AI 未绑定': 'Workers AI binding missing',
  '没有需要 AI 处理的待审域名': 'No pending domains for AI to review',
  '批量审核异常：': 'Batch review error: ',
  '域名不可用': 'Domain unavailable',
  '该域名不在已移除列表中': 'This domain is not in the removed list',

  /* DNS / 记录 */
  '记录不存在': 'Record not found', '记录不存在（mock）': 'Record not found (mock)',
  '无权操作该记录': 'You cannot modify this record',
  '无权操作该子域名': 'You cannot modify this subdomain',
  '无权操作': 'Permission denied', '无权查看': 'Permission denied',
  '无权删除': 'Permission denied', '无权回复': 'Permission denied',
  '无权关闭': 'Permission denied',
  '不支持的记录类型': 'Unsupported record type',
  '记录值不能为空': 'Record value cannot be empty',
  'A/AAAA 记录值不能为空': 'A / AAAA record value cannot be empty',
  'CNAME 记录值不能为空': 'CNAME record value cannot be empty',
  'TXT 记录值不能为空': 'TXT record value cannot be empty',
  'MX 记录值不能为空': 'MX record value cannot be empty',
  'NS 记录值不能为空': 'NS record value cannot be empty',
  '验证值过长': 'Verification value is too long',
  'TTL 取值不合法': 'Invalid TTL value', 'CAA 标签不合法': 'Invalid CAA tag',
  '请填写合法的 IPv4 地址': 'Enter a valid IPv4 address',
  '请填写合法的 IPv6 地址': 'Enter a valid IPv6 address',
  '请填写合法的目标主机域名': 'Enter a valid target hostname',
  '请填写合法的邮件服务器域名': 'Enter a valid mail server hostname',
  '请填写验证记录的主机名（如 _vercel）': 'Enter the verification hostname (e.g. _vercel)',
  '根域名验证请填写具体主机名，如 _vercel': 'Domain verification needs a specific hostname, e.g. _vercel',
  '请粘贴平台给出的验证值': 'Paste the verification value provided by the platform',
  '该记录未被锁定': 'This record is not locked',
  '该记录已被「根域名验证」锁定，请先点击“确认认证完成”解除锁定':
    'This record is locked by domain verification. Click "Confirm verification" to unlock it first',
  '该记录正在被「根域名验证」占用，请先完成认证并解除锁定':
    'This record is used by domain verification. Finish verification and unlock it first',
  '目标记录名正在被「根域名验证」占用':
    'That hostname is currently used by domain verification',
  '未配置根域名，无法在根域名下写入验证记录':
    'No root domain configured; cannot write a verification record',
  '没有可用的 NS 地址': 'No usable nameservers',
  '建议至少填写 2 个 NS（多数注册局要求 2 个以上），如确定只需 1 个请联系管理员':
    'At least 2 nameservers are recommended (most registries require 2+). Contact an admin if you really need only one',
  '该服务商需要填写专属 NS 主机名': 'This provider requires a dedicated NS hostname',
  '该服务商不支持委派检查': 'This provider does not support delegation checks',
  '该子域名当前未托管到外部 DNS': 'This subdomain is not delegated to an external DNS provider',
  '未提供 API Token': 'No API token provided', '请填写 API Token': 'Enter an API token',
  '该服务商的委派检查需要 API Token': 'Delegation checks for this provider require an API token',
  'DNS 接口返回无法解析的内容': 'DNS API returned an unparseable response',
  '未能获取 SOA 信息': 'Could not retrieve SOA information',
  'DNS 写入失败：': 'DNS write failed: ', 'DNS 更新失败：': 'DNS update failed: ',
  'DNS 删除失败：': 'DNS delete failed: ', 'DNS API 调用失败': 'DNS API call failed',
  '未配置 Spaceship API 凭证，请先在「站点设置」填写 API Key 与 Secret':
    'Spaceship credentials are not configured. Add the API key and secret under Site Settings.',
  '未配置可用的 DNS 后端：请在后台「根域名管理」把它设为 Spaceship，或填写对应的 Cloudflare Zone ID':
    'No usable DNS backend. Set this root domain to Spaceship in Site Settings, or provide its Cloudflare Zone ID.',
  '一次最多添加 100 个域名': 'At most 100 domains can be added at once',
  '请至少选择一个域名': 'Select at least one domain',
  'RDAP 请求失败：': 'RDAP request failed: ', 'DNSHE 请求失败：': 'DNSHE request failed: ',
  'RDAP 限流，请稍后再试': 'RDAP rate limit reached. Try again shortly',
  'DNSHE 限流，请稍后再试': 'DNSHE rate limit reached. Try again shortly',
  'WHOIS 显示方式不合法': 'Invalid WHOIS display mode',

  /* 工单 / 聊天 / 兑换 / 转移 */
  '工单不存在': 'Ticket not found', '帖子不存在': 'Post not found',
  '回复不存在': 'Reply not found', '内容不能为空': 'Content cannot be empty',
  '请填写工单标题': 'Enter a ticket title', '请填写工单内容': 'Enter ticket details',
  '请填写标题': 'Enter a title', '请填写内容': 'Enter content',
  '标题至少 2 个字': 'Title must be at least 2 characters',
  '标题最多 120 字': 'Title must be at most 120 characters',
  '内容最多 8000 字': 'Content must be at most 8000 characters',
  '回复内容不能为空': 'Reply cannot be empty',
  '回复最多 3000 字': 'Reply must be at most 3000 characters',
  '请输入回复内容': 'Enter a reply',
  '发帖太频繁，请稍后再试': 'Posting too frequently. Try again shortly',
  '回复太频繁，请稍后再试': 'Replying too frequently. Try again shortly',
  '提交太频繁，请稍后再试': 'Submitting too frequently. Try again shortly',
  '该帖已锁定，无法回复': 'This post is locked and cannot be replied to',
  '工单已关闭，无法追加回复': 'This ticket is closed and cannot be replied to',
  '工单已提交': 'Ticket submitted', '工单已关闭': 'Ticket closed',
  '请输入兑换码': 'Enter a redemption code',
  '兑换码不存在': 'Redemption code not found',
  '该兑换码已过期': 'This redemption code has expired',
  '该兑换码已被停用': 'This redemption code is disabled',
  '该兑换码已被用完': 'This redemption code has been used up',
  '未知的兑换码类型': 'Unknown redemption code type',
  '你已经使用过这个兑换码了': 'You have already used this code',
  '类型必须是 permanent 或 quota': 'Type must be permanent or quota',
  '请选择要永久化的域名': 'Select a domain to make perpetual',
  '请先选择要永久化的域名': 'Select a domain to make perpetual first',
  '请选择要转移的域名': 'Select a domain to transfer',
  '请填写接收账号邮箱': 'Enter the recipient account email',
  '不能转给自己': 'You cannot transfer to yourself',
  '该账号不存在': 'Account not found',
  '该账号不存在，请确认邮箱是否正确': 'Account not found. Check the email address',
  '该账号已被封禁，无法接收': 'This account is banned and cannot receive transfers',
  '仅已开通的域名可转移': 'Only active domains can be transferred',
  '无权转移该域名': 'You cannot transfer this domain',
  '请先勾选确认已知悉转移不可逆': 'Please confirm you understand the transfer is irreversible',
  '该域名存在验证锁定记录，请先完成验证再转移':
    'This domain has a verification lock. Complete verification before transferring',
  '图片文件无效': 'Invalid image file',
  '图片不能超过': 'Image must be smaller than ',
  '请选择图片文件': 'Choose an image file',
  '上传格式不正确': 'Unsupported file format',
  '文件内容与声明的类型不符，请上传真实图片':
    'File content does not match its declared type. Upload a real image',
  '仅支持 PNG / JPG / GIF / WebP / SVG 图片': 'Only PNG / JPG / GIF / WebP / SVG images are supported',
  '出于安全考虑不支持 SVG，请上传 PNG / JPG': 'SVG is not allowed for security reasons. Upload PNG / JPG',
  '头像地址不合法：请选择内置头像，或填写 https 图片链接':
    'Invalid avatar URL. Pick a built-in avatar or use an https image link',
  '当前未开放自定义头像上传，可从内置头像库中选择或填写头像链接':
    'Custom avatar uploads are disabled. Pick a built-in avatar or provide an image URL',
  '头像已上传': 'Avatar uploaded', '资料已保存': 'Profile saved',

  /* 签到 / 积分 */
  '今日已签到': 'Already checked in today',
  '今天已经签到过了': 'Already checked in today',
  '今天已经签到过了，明天再来': 'Already checked in today. Come back tomorrow',
  '今天还没有签到': 'Not checked in today',
  '管理员无需签到': 'Admins do not need to check in',
  '每日签到奖励': 'Daily check-in reward',
  '积分数值不合法': 'Invalid point value',
  '请提供 delta 或 set': 'Provide delta or set',
  '调整为': 'Adjusted to ',
  '管理员积分不限，无需调整': 'Admins have unlimited points; no adjustment needed',
  '配额需在 -1（不限）到 500 之间': 'Quota must be between -1 (unlimited) and 500',
  '单 IP 账号数需在 1-50 之间': 'Accounts per IP must be between 1 and 50',
  '同一网络最多注册': 'At most ',
  '账号，你已注册': ' accounts per network; you have registered ',
  '个。超出限制的账号一经发现将被全部封禁。': '. Excess accounts will be banned.',
  '该 IP 下没有可封禁的账号': 'No bannable accounts found under this IP',
  '新用户初始积分': 'Initial points for new users',
  '域名消耗': 'Domain cost', '积分为 0，免费开通': '0 points — free to register',

  /* AI 审核 / 诊断 */
  '自检异常': 'Self-check failed', '模型探测异常': 'Model probe failed',
  '自动审核开关已关闭': 'Auto-review is switched off',
  '未配置 API Key，请先填写并保存': 'No API key configured. Add one and save first',
  '未配置 API Key': 'No API key configured',
  '未配置': 'Not configured', '未检测': 'Not tested', '未配置，': 'Not configured, ',
  '网关清单': 'Gateway list', '内置清单': 'Built-in list', '（未选）': '(not selected)',
  '网关返回': 'Gateway returned ', '个模型': ' models',
  '不可用，已回落内置清单': 'unavailable; fell back to the built-in list',
  '不可用 ·': 'Unavailable ·', '✓ 会触发': '✓ Will trigger',
  '✗ 不在名单，申请会走人工审核': '✗ Not listed; requests go to manual review',
  '模型不在网关 /models 清单里': 'Model is not in the gateway /models list',
  '检查接口地址与模型名': 'Check the API URL and model name',
  '所有候选模型均调用失败 ·': 'All candidate models failed ·',
  '诊断异常：': 'Diagnosis error: ', '诊断完成，请查看下方明细': 'Diagnosis complete — see details below',
  '诊断中…（会真实请求网关，最多约 20 秒）': 'Diagnosing… (makes real gateway calls, up to ~20s)',
  '连接异常（超时或网络不可达）': 'Connection failed (timeout or unreachable)',
  '后台未选定审核模型；请先点「探测模型」并从网关清单里选一个':
    'No review model selected. Probe models first, then pick one from the gateway list',
  '模型探测异常': 'Model probe failed',
  '审核接口调用失败': 'Review API call failed',
  '（真实模型往返）': '(real model round-trip)', '（失败前的探测）': '(probing before failure)',
  '候选模型逐项：': 'Candidate models: ', '/models 请求明细：': '/models request details: ',
  '每个根域名是否会触发 AI：': 'Whether AI triggers for each root domain:',
  '结论：配置齐全，普通用户在名单内根域名申请会由 AI 自动判定':
    'Conclusion: fully configured. Requests from regular users on listed roots will be decided by AI',
  '结论：配置齐全，但当前为全局免审核 —— 申请会瞬间开通，AI 仍会尝试判定并可驳回违规内容，通过时界面会显示实际耗时':
    'Conclusion: fully configured, but global approval is off — requests open instantly. AI still runs and can reject violations; the actual latency is shown on approval.',
  'AI 不会自动审核 →': 'AI will not auto-review →',
  '全局 REQUIRE_APPROVAL：': 'Global REQUIRE_APPROVAL: ',
  '（现已不作为 AI 的前置条件）': '(no longer a prerequisite for AI)',
  '站点当前根域名：': 'Current site root domains: ',
  '作用根域名：': 'Applies to roots: ',
  '自动审核开关：': 'Auto-review: ', '当前模型：': 'Current model: ',
  '接口地址（填写值）：': 'API URL (entered): ', '端点模式：': 'Endpoint mode: ',
  '已记住的成功端点：': 'Remembered working endpoint: ',
  '候选请求地址：': 'Candidate endpoints: ',
  'API Key：': 'API key: ', '网关模型清单：': 'Gateway model list: ',
  '当前模型是否在网关清单中：': 'Is the current model in the gateway list: ',
  '实际打通地址：': 'Working endpoint: ', '审核调用：': 'Review call: ',
  '审核调用耗时：': 'Review call latency: ',
  '审核结果语义：': 'Review result semantics: ',
  '需要审核：AI 通过才立即开通，AI 失败则进入人工审核':
    'Approval required: only an AI pass opens the domain immediately; failures go to manual review',
  '全局免审核：无论 AI 是否调用成功都会直接开通（AI 未参与时界面会写明「免审核直接开通」，不会冒充 AI 通过）':
    'Approval disabled: requests open instantly regardless of AI. When AI is not involved the UI says "opened without review" instead of claiming an AI pass',
  '（已回落内置 Agnes 官方模型清单，可直接选用）': '(fell back to the built-in official Agnes model list — pick one directly)',
  '自动（先直连地址本身，失败回落子路径）': 'Auto (try the entered URL first, then sub-paths)',
  '强制直连（不调用 /chat/completions）': 'Direct only (no /chat/completions)',
  '标准 OpenAI（/chat/completions）': 'Standard OpenAI (/chat/completions)',
  '已启用自定义接口': 'Custom endpoint enabled',
  'AI 审核可用': 'AI review available', 'AI 审核不可用：': 'AI review unavailable: ',
  'AI 审核链路可用': 'AI review pipeline is working',
  'AI 审核完成': 'AI review complete', 'AI 审核通过': 'AI review passed',
  'AI 审核未通过': 'AI review did not pass',
  '管理员免审核': 'Admins skip review',
  '管理员免审核，AI 不触发': 'Admins skip review; AI is not invoked',
  '用途说明未通过自动审核': 'The description did not pass auto-review',
  '（申请人未填写）': '(not provided by the applicant)',
  '未配置 API Key（后台填一次，或 npx wrangler secret put AI_API_KEY）':
    'No API key (set it in Site Settings, or run npx wrangler secret put AI_API_KEY)',
  '自动审核开关未开启': 'Auto-review is switched off',
  '后台未选定审核模型': 'No review model selected',
  '审核模块异常，已回落人工审核': 'Review module error; fell back to manual review',
  '正文字体取值不合法': 'Invalid body font value',
  '标题字体取值不合法': 'Invalid display font value',

  /* 通知 */
  '域名审核': 'Domain review', '安全提醒': 'Security alert',
  '系统通知': 'System', '账号登录提醒': 'Sign-in alert',
  '你的账号于': 'Your account signed in at ',
  '登录成功。登录 IP：': '. Sign-in IP: ',
  '。若非本人操作，请立即修改密码。': '. If this was not you, change your password immediately.',
  '你的域名': 'Your domain ',
  '已审核通过并开通': ' was approved and activated',
  '如有疑问可提交工单。': 'Open a support ticket if you have questions.',

  /* 状态 / 标签 / 通用短词 */
  '待审核': 'Pending', '已开通': 'Active', '已驳回': 'Rejected',
  '已停用': 'Suspended', '已过期': 'Expired', '永久': 'Perpetual',
  '正常': 'Normal', '已封禁': 'Banned', '已解封': 'Unbanned',
  '可注册': 'Available', '已注册': 'Registered', '未注册': 'Unregistered',
  '待处理': 'Open', '处理中': 'In progress', '有回复': 'Answered', '已关闭': 'Closed',
  '系统': 'System', '用户': 'User', '管理员': 'Admin',
  '未知': 'Unknown', '无备注': 'No note', '（无）': '(none)',
  '暂无数据': 'No data', '暂无记录': 'No records', '加载中…': 'Loading…',
  '加载失败': 'Failed to load', '已保存': 'Saved',
  '已保存，刷新页面后生效': 'Saved. Refresh to apply.',
  '已添加': 'Added', '已移除': 'Removed', '已恢复': 'Restored',
  '已删除': 'Deleted', '已更新': 'Updated', '已启用': 'Enabled',
  '未启用': 'Disabled', '已配置': 'Configured', '已发布': 'Published',
  '已发送': 'Sent', '已回复': 'Replied', '已识别': 'Identified',
  '未识别平台': 'Platform not recognized',
  '本站子域名': 'Local subdomain', '任意域名': 'Any domain',
  '外部查询': 'External lookup', '当前域名': 'Current domain',
  '在线举报': 'Report online', '在线举报入口': 'Online report form',
  '滥用与违规举报通道': 'Abuse & violation reporting',
  '滥用举报': 'Abuse reports', '新的滥用举报': 'New abuse report',
  '请填写被举报域名': 'Enter the domain you are reporting',
  '域名格式不正确，请填写完整域名': 'Invalid domain format — enter a full domain',
  '请选择滥用类型': 'Choose an abuse type',
  '请填写详细描述（至少 10 个字）': 'Describe the abuse (at least 10 characters)',
  '详细描述最多 3000 字': 'Description must be at most 3000 characters',
  '证据链接需以 https:// 开头': 'The evidence URL must start with https://',
  '联系邮箱格式不正确': 'Invalid contact email',
  '提交过于频繁，请稍后再试': 'Too many reports. Try again shortly',
  '你已举报过该域名': 'You have already reported this domain',
  '举报失败，请稍后再试': 'Could not submit the report. Try again shortly',
  '举报提交成功，我们会尽快处理': 'Report submitted. We will review it shortly',
  '举报记录不存在': 'Report not found',
  '处理状态不合法': 'Invalid report status',
  '举报处理已更新': 'Report status updated',
  '域名已停用': 'Domain suspended',
  '该域名在本站不存在对应记录': 'No matching domain on this site',
  '举报滥用域名': 'Report domain abuse', '提交举报': 'Submit report',
  '在本站提交举报': 'Report on this site', '举报滥用': 'Report abuse',

  /* ── /api/config 下发的 DNS 记录规格与 TTL（此前英文模式整片中文） ── */
  '自动 (Auto)': 'Auto', '1 分钟': '1 min', '2 分钟': '2 min', '5 分钟': '5 min',
  '10 分钟': '10 min', '15 分钟': '15 min', '30 分钟': '30 min',
  '1 小时': '1 hour', '2 小时': '2 hours', '5 小时': '5 hours',
  '12 小时': '12 hours', '1 天': '1 day',
  'IPv4 地址': 'IPv4 address', 'IPv6 地址': 'IPv6 address', '目标域名': 'Target domain',
  '邮件服务器': 'Mail server', '名称服务器': 'Nameserver', '文本内容': 'Text content',
  '把域名指向 IPv4 地址': 'Point the domain to an IPv4 address',
  '把域名指向 IPv6 地址': 'Point the domain to an IPv6 address',
  '域名别名，把一个域名指向另一个域名': 'Alias one domain to another',
  '邮件交换记录，指定接收该域名邮件的服务器': 'Mail exchange record — the server that receives mail',
  '0-65535，数值越小越优先': '0–65535; lower values have priority',
  '文本记录，常用于域名验证、SPF、DKIM、DMARC': 'Text record for verification, SPF, DKIM and DMARC',
  '名称服务器记录，把该子域委派给其它 DNS 服务器': 'Nameserver record — delegate the subdomain to other DNS servers',
  '起始授权记录（区域主 NS、管理员邮箱、序列号等）': 'Start of authority (primary NS, admin mailbox, serial, …)',
  'Cloudflare 不允许通过 API 新增或修改区域 SOA 记录，此处仅可查看系统自动生成的 SOA 信息。':
    'Cloudflare does not allow creating or editing zone SOA records via API; only the system-generated SOA is shown here.',
  '反向解析记录，把 IP 地址映射回域名': 'Reverse record — map an IP back to a domain',
  'PTR 只有在 Cloudflare 托管的反向区域（in-addr.arpa / ip6.arpa）中才会真正生效；在正向域里创建仅作占位。':
    'PTR only works in Cloudflare-hosted reverse zones (in-addr.arpa / ip6.arpa); in a forward zone it is a placeholder.',
  '服务记录，指定某服务的主机名与端口（SIP、XMPP 等）': 'Service record — hostname and port (SIP, XMPP, …)',
  '证书颁发机构授权，限制哪些 CA 可为该域名签发证书': 'CAA — restrict which CAs may issue certificates',
  '命名权威指针，常用于电话号码映射（ENUM）与服务发现': 'NAPTR — ENUM phone mapping and service discovery',
  '委托签名者记录，用于 DNSSEC：把子区域的密钥信息放到父区域': 'DS record for DNSSEC — publish a child zone key in the parent',
  '替换域名 (Replacement)': 'Replacement domain', '顺序 (Order)': 'Order', '偏好 (Preference)': 'Preference',
  'Vercel 项目域名验证': 'Vercel project domain verification',
  'Netlify 域名所有权验证': 'Netlify domain ownership verification',
  '_dnsauth 开头的 TXT 验证': 'TXT verification starting with _dnsauth',
  '_dnspod 开头的 TXT 验证': 'TXT verification starting with _dnspod',
  '腾讯云 EdgeOne 归属权验证（官方文档：主机记录 edgeonereclaim）': 'Tencent EdgeOne ownership verification (host: edgeonereclaim)',
  'dnsauth 开头的 TXT 验证': 'TXT verification starting with dnsauth',
  '_cf-verify 开头的 TXT 验证': 'TXT verification starting with _cf-verify',
  '验证值含用户名，请完整粘贴': 'The value includes a username — paste it in full',
  'Google 站点验证 TXT': 'Google site verification TXT',
  'MX 优先级需在 0-65535 之间': 'MX priority must be between 0 and 65535',
  'TXT 内容过长（最多 2048 字符）': 'TXT content is too long (max 2048 characters)',
  '端口需在 1-65535 之间': 'Port must be between 1 and 65535',
  '权重需在 0-65535 之间': 'Weight must be between 0 and 65535',
  '优先级需在 0-65535 之间': 'Priority must be between 0 and 65535',
  '服务名需以 _ 开头，如 _sip': 'Service name must start with _, e.g. _sip',
  '协议需为 _tcp / _udp / _tls': 'Protocol must be _tcp / _udp / _tls',
  'CAA 标志只能是 0 或 128': 'CAA flag must be 0 or 128',
  'iodef 需填写 mailto: 或 http(s) 地址': 'iodef must be a mailto: or http(s) URL',
  'Order 需在 0-65535 之间': 'Order must be between 0 and 65535',
  'Preference 需在 0-65535 之间': 'Preference must be between 0 and 65535',
  'Flags 只可为 S/U/A/P 的组合': 'Flags may only contain S/U/A/P',
  'Regexp 与 Replacement 至少填一项': 'Fill in Regexp or Replacement (at least one)',
  'Replacement 需为合法域名': 'Replacement must be a valid domain',
  'Key Tag 需在 0-65535 之间': 'Key Tag must be between 0 and 65535',
  'Algorithm 取值不合法': 'Invalid Algorithm value',
  'Digest Type 取值不合法': 'Invalid Digest Type value',
  'Digest 需为十六进制字符串（至少 20 位）': 'Digest must be a hex string (at least 20 characters)',
  '只能使用小写字母、数字和连字符，且不能以连字符开头或结尾':
    'Use lowercase letters, digits and hyphens only; cannot start or end with a hyphen',

  /* ── 后台固定提示 ── */
  'Spaceship API 地址需以 http:// 或 https:// 开头': 'Spaceship API URL must start with http:// or https://',
  'R2 公网地址需以 http:// 或 https:// 开头': 'R2 public URL must start with http:// or https://',
  '同一时间只能有一个待审核申请，其余已自动驳回': 'Only one pending request is allowed; the rest were auto-rejected',
  '所选域名都已添加过了': 'All selected domains have already been added',
  '模型名不在网关 /models 清单里': 'Model name is not in the gateway /models list',
  '已生效。DNS 记录默认通过 Spaceship API Key 写入；如需改用 Cloudflare，请在「根域名管理」把该域名切换为 Cloudflare 并填写 Zone ID。':
    'Applied. DNS records are written via the Spaceship API key by default. To use Cloudflare, switch this root domain to Cloudflare in Root Domains and enter its Zone ID.',
  '如发现该域名存在钓鱼、恶意程序、垃圾邮件等滥用行为，请联系站点管理员。':
    'If this domain is used for phishing, malware, spam or other abuse, please contact the site administrator.',

  /* 服务条款段落（后端 /api/terms 返回，前端直接渲染） */
  '一、服务条款': '1. Terms of Service', '二、禁止滥用（重点）': '2. Prohibited abuse (important)',
  '三、账号规则': '3. Account rules', '四、免责声明': '4. Disclaimer',
  '五、信息与处置': '5. Data & enforcement', '六、条款变更': '6. Changes to these terms',
  '本服务由站点运营方（下称「本站」）免费提供，向用户免费分配根域名下的二级子域名，并提供相应 DNS 记录的管理能力。':
    'This service is provided free of charge by the site operator ("we"). It allocates subdomains under our root domains and lets you manage their DNS records.',
  '用户注册即视为已完整阅读、理解并同意本条款全部内容。若不同意，请立即停止注册与使用。':
    'By registering you confirm that you have read, understood and accepted these terms in full. If you disagree, stop using the service immediately.',
  '本站仅提供子域名的分配与解析管理服务，用户通过该子域名对外提供的任何内容、服务与行为，均由用户本人独立承担全部责任。':
    'We only allocate subdomains and manage DNS. You are solely responsible for everything you publish or operate through your subdomain.',
  '本站保留在以下情形无需事先通知即可暂停或终止服务的权利：违反本条款、收到有权机关要求、遭受投诉举报、危害本站或第三方安全、长期未使用。':
    'We may suspend or terminate the service without prior notice for: breaching these terms, lawful requests, abuse complaints, security risks, or prolonged inactivity.',
  '严禁利用本站分配的子域名从事下列任何活动，一经发现立即封禁账号、删除全部子域名及 DNS 记录，且不另行通知：':
    'The following are strictly prohibited. Violations result in an immediate ban, deletion of all subdomains and DNS records, without notice:',
  '钓鱼、欺诈、仿冒他人网站或品牌，以及任何形式的网络诈骗':
    'Phishing, fraud, impersonating other sites or brands, and any form of online scam',
  '传播木马、病毒、勒索软件等恶意程序，或搭建 C2、僵尸网络控制端':
    'Distributing trojans, viruses, ransomware or other malware, or hosting C2 / botnet controllers',
  '钓鱼邮件、垃圾邮件（SPAM）群发，或伪造 SPF / DKIM / DMARC 用于发信欺骗':
    'Bulk phishing or spam, or forging SPF / DKIM / DMARC to spoof email senders',
  '搭建或跳转至色情、赌博、毒品、暴恐、侵犯未成年人等违法违规内容':
    'Hosting or redirecting to pornography, gambling, drugs, violent extremism, content harming minors, or other illegal material',
  '侵犯他人知识产权、隐私权、名誉权，或从事人肉搜索、骚扰行为':
    'Infringing intellectual property, privacy or reputation rights, doxxing, or harassment',
  '绕过付费墙、盗用账号、撞库、扫描爆破等未授权访问行为':
    'Bypassing paywalls, account theft, credential stuffing, scanning or brute-force attacks',
  '用于规避他方封禁（域名轮换、跳转落地页规避风控）':
    'Evading third-party blocks (domain rotation, redirect landing pages to bypass risk controls)',
  '任何其他违反中华人民共和国法律法规及所在司法辖区法律的行为':
    'Any other conduct violating the laws of the PRC or your jurisdiction',
  '本站有权根据投诉、威胁情报、自动化检测或人工抽查判定是否构成滥用，判定结果为最终结论。':
    'We determine abuse based on complaints, threat intelligence, automated detection or manual review; our decision is final.',
  '注册邮箱仅限指定服务商（当前为 Gmail 与 QQ 邮箱）。':
    'Only approved email providers are accepted (currently Gmail and QQ Mail).',
  '同一 IP 地址最多注册 2 个账号。超出限制注册的账号，管理员有权不经通知全部封禁。':
    'At most 2 accounts per IP address. Admins may ban all excess accounts without notice.',
  '禁止批量注册、使用脚本注册、使用代理或匿名网络规避 IP 限制。':
    'Bulk registration, scripted sign-ups, and using proxies or anonymity networks to evade IP limits are prohibited.',
  '账号仅限本人使用，禁止转让、出借、出售。一个账号下的子域名不得用于多人共享的违规用途。':
    'Accounts are personal and may not be transferred, lent or sold. Subdomains under one account must not be shared for abusive purposes.',
  '请自行妥善保管密码。因密码泄露、账号外借导致的任何后果由用户本人承担。':
    'Keep your password safe. You are responsible for any consequences of a leaked or shared password.',
  '本站按「现状」提供服务，不作任何明示或默示的担保，包括但不限于可用性、稳定性、安全性、适用性及不侵权。':
    'The service is provided "as is", without any express or implied warranty, including availability, stability, security, fitness or non-infringement.',
  '本站不保证服务永不中断。因 Cloudflare 及上游服务商故障、网络攻击、不可抗力、维护升级等原因导致的服务中断或数据丢失，本站不承担任何责任。':
    'We do not guarantee uninterrupted service. We are not liable for outages or data loss caused by Cloudflare, upstream providers, attacks, force majeure or maintenance.',
  '本站不对用户通过子域名发布的内容承担任何责任，也不对用户之间的纠纷承担责任。':
    'We are not responsible for content published through subdomains, nor for disputes between users.',
  '用户因使用或无法使用本服务所遭受的任何直接与间接损失（包括但不限于利润损失、数据丢失、业务中断），本站概不负责。':
    'We are not liable for any direct or indirect loss (including lost profits, data loss or business interruption) arising from use or inability to use the service.',
  '本站有权在任何时候修改、暂停或终止全部或部分服务，且无需对用户或第三方承担任何责任。':
    'We may modify, suspend or terminate all or part of the service at any time without liability to you or third parties.',
  '若用户行为导致本站被投诉、被处罚或产生损失，用户应全额赔偿本站因此遭受的一切损失。':
    'If your conduct causes complaints, penalties or losses to us, you shall fully compensate us for all resulting damages.',
  '域名有效期：新申请的域名有效期为一年（具体天数以站点设置为准），到期前 180 天内可自行续期；迁移前已注册的域名为永久有效，不追溯有效期。':
    'Validity: newly requested domains are valid for one year (exact days depend on site settings) and can be renewed within 180 days before expiry. Domains registered before migration are perpetual and not retroactively expired.',
  '域名到期后将被停用并释放解析，到期前会尽力提示，但用户应自行关注到期时间，因未及时续期导致的解析中断、业务损失，本站不承担责任。':
    'Expired domains are suspended and their records released. We try to notify you, but you must track expiry yourself; we are not liable for downtime or loss caused by late renewal.',
  '同一账号同一时间只能有一个待审核申请；若通过任何方式在短时间内提交多个申请，本站只批准其中一个，其余自动驳回。':
    'One pending request per account at a time. If multiple requests are submitted rapidly, only one is approved and the rest are automatically rejected.',
  '续期、释放、修改 DNS 记录等操作一旦执行不可撤销，因误操作导致的解析中断由用户自行承担。':
    'Renewal, release and DNS record changes are irreversible. You bear any downtime caused by mistakes.',
  '本站仅收集注册邮箱、密码哈希、注册 IP 与 User-Agent，用于账号安全与滥用追溯，不向第三方出售或共享。':
    'We collect only your email, password hash, sign-up IP and User-Agent for account security and abuse tracing. We never sell or share them.',
  '为配合有权机关调查或应对安全事件，本站可能依法披露上述信息。':
    'We may lawfully disclose that information to cooperate with authorities or respond to security incidents.',
  '违规处置措施包括：警告、限制添加记录、停用子域名、封禁账号、封禁 IP、清空 DNS 记录，可合并适用。':
    'Enforcement may include warnings, record limits, subdomain suspension, account bans, IP bans and clearing DNS records, in any combination.',
  '封禁后用户仍有异议的，可通过站点公告中提供的联系方式申诉，是否恢复由本站决定。':
    'Banned users may appeal via the contact details in site announcements; reinstatement is at our discretion.',
};

/** 带变量的消息：正则 → 英文模板（按数组顺序匹配，先到先得） */
export const SERVER_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^图片不能超过 (\d+) KB$/, m => `Image must be smaller than ${m[1]} KB`],
  [/^已达上限，每个账号最多持有 (\d+) 个子域名$/, m => `Quota reached: each account can hold at most ${m[1]} subdomains`],
  [/^单个子域名最多 (\d+) 条记录$/, m => `At most ${m[1]} records per subdomain`],
  [/^此操作会删除全部 (\d+) 张券，且不可恢复。请带上确认参数重试。$/,
    m => `This deletes all ${m[1]} codes and cannot be undone. Retry with the confirm parameter.`],
  [/^同一网络最多注册 (\d+) 个账号，你已注册 (\d+) 个。超出限制的账号一经发现将被全部封禁。$/,
    m => `At most ${m[1]} accounts per network; you have ${m[2]}. Excess accounts will be banned.`],
  [/^同一时间最多注册 (\d+) 个账号，你已注册 (\d+) 个。$/,
    m => `At most ${m[1]} accounts per IP; you have ${m[2]}.`],
  [/^你已有一个待审核的申请（(.+?)），同一时间只能申请一个域名。请等待审核完成，或被驳回后再申请。$/,
    m => `You already have a pending request (${m[1]}). Only one at a time — wait for the review or reapply after a rejection.`],
  [/^当前不在续期窗口内：仅在到期前 (\d+) 天内可续期（还剩 (\d+) 天）$/,
    m => `Outside the renewal window: renewal is only allowed within ${m[1]} days before expiry (${m[2]} days left)`],
  [/^根域名 (.+?) 的积分必须是 0 或正整数$/, m => `Points for root ${m[1]} must be 0 or a positive integer`],
  [/^根域名 (.+?) 的积分需在 0-100000 之间$/, m => `Points for root ${m[1]} must be between 0 and 100000`],
  [/^网关返回 (\d+) 个模型$/, m => `Gateway returned ${m[1]} models`],
  [/^所有候选模型均调用失败 · (.+)$/, m => `All candidate models failed · ${m[1]}`],
  [/^调整为 ([\-\d.]+)$/, m => `Adjusted to ${m[1]}`],
  [/^DNS (写入|更新|删除)失败：(.+)$/, m => `DNS ${m[1] === '写入' ? 'write' : m[1] === '更新' ? 'update' : 'delete'} failed: ${m[2]}`],
  [/^DNS 接口返回无法解析的内容（HTTP (\d+)）$/, m => `DNS API returned an unparseable response (HTTP ${m[1]})`],
  [/^(RDAP|DNSHE) 请求失败：(.+)$/, m => `${m[1]} request failed: ${m[2]}`],
  [/^(RDAP|DNSHE) 限流，请稍后再试$/, m => `${m[1]} rate limit reached. Try again shortly`],
  [/^邮件发送失败：(.+)$/, m => `Mail delivery failed: ${m[1]}`],
  [/^诊断异常：(.+)$/, m => `Diagnosis error: ${m[1]}`],
  [/^接口不存在$/, () => 'Endpoint not found'],
  [/^你的账号于 (.+?) 登录成功。登录 IP：(.+?)。若非本人操作，请立即修改密码。$/,
    m => `Your account signed in at ${m[1]} from IP ${m[2]}. If this was not you, change your password immediately.`],
  [/^你的域名 (.+?) 已审核通过并开通，有效期 (\d+) 天。快去添加 DNS 记录吧。$/,
    m => `Your domain ${m[1]} was approved and activated (valid for ${m[2]} days). Add your DNS records now.`],
  [/^你的域名 (.+?) 已审核通过并开通（永久有效）。快去添加 DNS 记录吧。$/,
    m => `Your domain ${m[1]} was approved and activated (perpetual). Add your DNS records now.`],
  [/^你的域名 (.+?) 未通过审核。原因：(.+?)如有疑问可提交工单。$/,
    m => `Your domain ${m[1]} was rejected. Reason: ${m[2]} Open a support ticket if you have questions.`],
  [/^你的域名 (.+?) 已被管理员停用。原因：(.+?)如有疑问可提交工单。$/,
    m => `Your domain ${m[1]} was suspended by an administrator. Reason: ${m[2]} Open a support ticket if you have questions.`],
  [/^你的域名 (.+?) 未通过审核。如有疑问可提交工单。$/,
    m => `Your domain ${m[1]} was rejected. Open a support ticket if you have questions.`],
  [/^你的域名 (.+?) 已被管理员停用。如有疑问可提交工单。$/,
    m => `Your domain ${m[1]} was suspended by an administrator. Open a support ticket if you have questions.`],
  [/^你的域名 (.+?) 已审核通过并开通(.+)$/,
    m => `Your domain ${m[1]} was approved and activated${m[2]}`],
  [/^域名申请被驳回(.+)$/, m => `Domain request rejected${m[1]}`],
  [/^域名已被停用(.+)$/, m => `Domain suspended${m[1]}`],
  [/^结论：AI 不会自动审核 → (.+)$/, m => `Conclusion: AI will not auto-review → ${m[1]}`],
  [/^有新的滥用举报待处理，请前往管理后台查看。域名：(.+)$/,
    m => `A new abuse report is waiting. Check the admin panel. Domain: ${m[1]}`],
  [/^拉取 (\d+) 个域名$/, m => `Fetched ${m[1]} domains`],
  [/^自动驳回同批 (\d+) 个申请$/, m => `Auto-rejected ${m[1]} requests in the same batch`],
  [/^根域名 (.+?) 的积分必须是 0 或正整数$/, m => `Point cost for ${m[1]} must be 0 or a positive integer`],
  [/^根域名 (.+?) 的积分需在 0-100000 之间$/, m => `Point cost for ${m[1]} must be between 0 and 100000`],
  [/^AI 名单（(.+?)）没有覆盖任何当前根域名$/, m => `AI root list (${m[1]}) does not cover any active root`],
  [/^(.+?) 记录为系统托管，不支持手动创建$/, m => `${m[1]} records are system-managed and cannot be created manually`],
  [/^有效期 (\d+) 天$/, m => `Valid for ${m[1]} days`],
  [/^（未配置）$/, () => '(not configured)'],
  [/^根域名 (.+?) 已(.+)$/, m => `Root ${m[1]} ${m[2]}`],
  /* AI 批量审核队列 */
  [/^本轮审核 (\d+) 个：通过 (\d+) · 驳回 (\d+) · 待重试 (\d+)$/,
    m => `Reviewed ${m[1]}: ${m[2]} approved · ${m[3]} rejected · ${m[4]} to retry`],
  [/^批量审核异常：(.+)$/, m => `Batch review error: ${m[1]}`],
  [/^(.+?)：已失败 (\d+) 次，转人工审核（后台可点「重试全部」清零）$/,
    m => `${m[1]}: failed ${m[2]} times, handed to manual review (use "Retry all" in admin to reset)`],
];

const SKIP_KEYS = new Set([
  // 只跳过真正的标识符 / 用户输入字段。
  // title / body / detail / reason / description 等虽可能含用户数据，但 tr()
  // 只做「整串精确命中固定词典」，用户自己写的内容不会命中；之前把它们整类
  // 跳过，反而让通知标题、审计日志、条款段落、举报文案在英文模式下一直是中文。
  'fqdn', 'email', 'note', 'url', 'href', 'logoUrl', 'faviconUrl',
  'siteName', 'domain', 'root', 'rootDomain', 'key', 'value', 'name', 'ip',
  'userAgent', 'model', 'endpoint', 'base', 'sample', 'query', 'fqdnQuery',
  'avatar', 'avatarUrl', 'evidenceUrl', 'applyPausedMessage', 'from', 'to',
]);

/** 翻译单个字符串：精确命中优先，再试带变量句式，否则原样返回 */
export function tr(c: any, s: string): string {
  if (typeof s !== 'string' || !/[\u4e00-\u9fa5]/.test(s)) return s;
  if (langOf(c) !== 'en') return s;
  const lead = (s.match(/^\s*/) || [''])[0];
  const trail = (s.match(/\s*$/) || [''])[0];
  const t = s.trim();
  if (SERVER_DICT[t]) return lead + SERVER_DICT[t] + trail;
  for (const [re, fn] of SERVER_PATTERNS) {
    const m = t.match(re);
    if (m) return lead + fn(m) + trail;
  }
  return s;   // 不认识 → 保留中文，绝不子串拼贴
}

/**
 * 递归本地化响应对象。只翻「精确命中」的字符串，且跳过用户数据字段。
 * 有深度与节点数上限，避免异常大对象拖慢响应。
 */
export function localize(c: any, value: any, depth = 0, key = ''): any {
  if (langOf(c) !== 'en') return value;
  if (depth > 8) return value;
  if (typeof value === 'string') return SKIP_KEYS.has(key) ? value : tr(c, value);
  if (Array.isArray(value)) {
    if (value.length > 500) return value;
    return value.map((v) => localize(c, v, depth + 1, key));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value)) {
      if (++n > 300) break;
      // lines[] 是 AI 诊断的逐行中文输出，属于服务端生成文案，需要翻
      out[k] = localize(c, v, depth + 1, k);
    }
    return out;
  }
  return value;
}
