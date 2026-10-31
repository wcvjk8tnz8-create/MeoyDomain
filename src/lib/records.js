// ============================================================
//  DNS 记录类型定义 / 校验 / 与 Cloudflare API 的字段转换
// ============================================================

export const TTL_CHOICES = [
  { value: 1, label: '自动 (Auto)' },
  { value: 60, label: '1 分钟' },
  { value: 120, label: '2 分钟' },
  { value: 300, label: '5 分钟' },
  { value: 600, label: '10 分钟' },
  { value: 900, label: '15 分钟' },
  { value: 1800, label: '30 分钟' },
  { value: 3600, label: '1 小时' },
  { value: 7200, label: '2 小时' },
  { value: 18000, label: '5 小时' },
  { value: 43200, label: '12 小时' },
  { value: 86400, label: '1 天' },
];

// 每种记录类型在表单里的字段规格
export const RECORD_TYPES = {
  A: {
    label: 'A',
    desc: '把域名指向 IPv4 地址',
    valueLabel: 'IPv4 地址',
    placeholder: '1.2.3.4',
    canProxy: true,
    fields: [],
    example: '192.0.2.1',
  },
  AAAA: {
    label: 'AAAA',
    desc: '把域名指向 IPv6 地址',
    valueLabel: 'IPv6 地址',
    placeholder: '2001:db8::1',
    canProxy: true,
    fields: [],
    example: '2001:db8::1',
  },
  CNAME: {
    label: 'CNAME',
    desc: '域名别名，把一个域名指向另一个域名',
    valueLabel: '目标域名',
    placeholder: 'example.com',
    canProxy: true,
    fields: [],
    example: 'example.com',
  },
  MX: {
    label: 'MX',
    desc: '邮件交换记录，指定接收该域名邮件的服务器',
    valueLabel: '邮件服务器',
    placeholder: 'mx.example.com',
    fields: [{ key: 'priority', label: '优先级', type: 'number', required: true, default: 10, hint: '0-65535，数值越小越优先' }],
    example: 'mx1.example.com',
  },
  TXT: {
    label: 'TXT',
    desc: '文本记录，常用于域名验证、SPF、DKIM、DMARC',
    valueLabel: '文本内容',
    placeholder: 'v=spf1 include:_spf.example.com ~all',
    multiline: true,
    fields: [],
    example: 'v=spf1 -all',
  },
  NS: {
    label: 'NS',
    desc: '名称服务器记录，把该子域委派给其它 DNS 服务器',
    valueLabel: '名称服务器',
    placeholder: 'ns1.example.com',
    fields: [],
    example: 'ns1.example.com',
  },
  SOA: {
    label: 'SOA',
    desc: '起始授权记录（区域主 NS、管理员邮箱、序列号等）',
    valueLabel: '—',
    readonly: true,
    fields: [],
    note: 'Cloudflare 不允许通过 API 新增或修改区域 SOA 记录，此处仅可查看系统自动生成的 SOA 信息。',
  },
  PTR: {
    label: 'PTR',
    desc: '反向解析记录，把 IP 地址映射回域名',
    valueLabel: '目标域名',
    placeholder: 'host.example.com',
    fields: [],
    note: 'PTR 只有在 Cloudflare 托管的反向区域（in-addr.arpa / ip6.arpa）中才会真正生效；在正向域里创建仅作占位。',
    example: 'host.example.com',
  },
  SRV: {
    label: 'SRV',
    desc: '服务记录，指定某服务的主机名与端口（SIP、XMPP 等）',
    valueLabel: '目标主机',
    placeholder: 'sip.example.com',
    struct: true,
    fields: [
      { key: 'service', label: '服务名', type: 'text', required: true, default: '_sip', placeholder: '_sip' },
      { key: 'proto', label: '协议', type: 'select', required: true, default: '_tcp', options: ['_tcp', '_udp', '_tls'] },
      { key: 'priority', label: '优先级', type: 'number', required: true, default: 1 },
      { key: 'weight', label: '权重', type: 'number', required: true, default: 5 },
      { key: 'port', label: '端口', type: 'number', required: true, default: 5060, placeholder: '1-65535' },
    ],
    example: 'sip.example.com',
  },
  CAA: {
    label: 'CAA',
    desc: '证书颁发机构授权，限制哪些 CA 可为该域名签发证书',
    valueLabel: 'CA 域名 / 值',
    placeholder: 'letsencrypt.org',
    struct: true,
    fields: [
      { key: 'flags', label: '标志', type: 'select', required: true, default: 0, options: [0, 128] },
      { key: 'tag', label: '标签', type: 'select', required: true, default: 'issue', options: ['issue', 'issuewild', 'iodef', 'contactemail', 'contactphone'] },
    ],
    example: 'letsencrypt.org',
  },
  NAPTR: {
    label: 'NAPTR',
    desc: '命名权威指针，常用于电话号码映射（ENUM）与服务发现',
    valueLabel: '替换域名 (Replacement)',
    placeholder: 'sip.example.com',
    struct: true,
    fields: [
      { key: 'order', label: '顺序 (Order)', type: 'number', required: true, default: 100 },
      { key: 'preference', label: '偏好 (Preference)', type: 'number', required: true, default: 100 },
      { key: 'flags', label: '标志 (Flags)', type: 'text', required: true, default: 'U', placeholder: 'S / U / A / P' },
      { key: 'service', label: '服务 (Service)', type: 'text', required: true, default: 'SIP+D2U', placeholder: 'E2U+sip' },
      { key: 'regexp', label: '正则 (Regexp)', type: 'text', default: '', placeholder: '!^.*$!sip:info@example.com!' },
    ],
    example: 'sip.example.com',
  },
  DS: {
    label: 'DS',
    desc: '委托签名者记录，用于 DNSSEC：把子区域的密钥信息放到父区域',
    valueLabel: '摘要 (Digest)',
    placeholder: '2BB183AF5F22588179A53B0A98631FAD1A292118',
    struct: true,
    multiline: true,
    fields: [
      { key: 'key_tag', label: '密钥标签 (Key Tag)', type: 'number', required: true, default: 2371 },
      { key: 'algorithm', label: '算法 (Algorithm)', type: 'number', required: true, default: 13, placeholder: '5/7/8/10/13/14/15/16' },
      { key: 'digest_type', label: '摘要类型', type: 'select', required: true, default: 2, options: [1, 2, 3, 4] },
    ],
    example: '2BB183AF5F22588179A53B0A98631FAD1A292118',
  },
};

export const TYPE_NAMES = Object.keys(RECORD_TYPES);

// 根域名（平台域名）验证常用预设
export const VERIFY_PRESETS = [
  { key: 'vercel', host: '_vercel', label: 'Vercel', hint: 'Vercel 项目域名验证用 TXT 记录' },
  { key: 'netlify', host: '_netlify', label: 'Netlify', hint: 'Netlify 域名所有权验证用 TXT 记录' },
  { key: 'dnspod', host: '_dnsauth', label: 'DNSPod / 腾讯云', hint: '_dnsauth 开头的 TXT 验证记录' },
  { key: 'dnspod2', host: '_dnspod', label: 'DNSPod (_dnspod)', hint: '_dnspod 开头的 TXT 验证记录' },
  { key: 'aliyun', host: 'dnsauth', label: '阿里云云解析', hint: 'dnsauth 开头的 TXT 验证记录' },
  { key: 'cloudflare', host: '_cf-verify', label: 'Cloudflare', hint: '_cf-verify 开头的 TXT 验证记录' },
  { key: 'github', host: '_github-pages-challenge', label: 'GitHub Pages', hint: '验证值里的用户名部分请自行补全' },
  { key: 'google', host: 'google-site-verification', label: 'Google Search Console', hint: 'Google 站点验证 TXT' },
  { key: 'custom', host: '', label: '自定义', hint: '手动填写主机名与 TXT 值' },
];

// ------------------------- 校验工具 -------------------------

const LABEL_RE = /^[A-Za-z0-9_*](?:[A-Za-z0-9_-]*[A-Za-z0-9_*])?$/;

export function isValidIPv4(v) {
  const parts = String(v).trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export function isValidIPv6(v) {
  const s = String(v).trim();
  if (!s || s.length > 45) return false;
  if (s.indexOf(':') === -1) return false;
  return /^[0-9A-Fa-f:.]+$/.test(s) && !/:::.+/.test(s);
}

export function isDomain(v) {
  const s = String(v).trim().replace(/\.$/, '');
  if (!s || s.length > 253) return false;
  return s.split('.').every((l) => LABEL_RE.test(l));
}

function inRange(n, min, max) {
  return Number.isFinite(n) && n >= min && n <= max;
}

/**
 * 校验并归一化主机名：
 *  - 空 / @ / 子域名本身  => 记录名 = 子域名 FQDN
 *  - 其它                => 记录名 = host + '.' + FQDN
 * 永远不允许越出该子域名的范围（防止改到别人/根域的记录）
 */
export function resolveHost(rawHost, fqdn, label) {
  let h = String(rawHost ?? '').trim().toLowerCase().replace(/\.+$/, '');
  if (!h || h === '@') return { ok: true, host: '@', name: fqdn };
  if (h === fqdn) return { ok: true, host: '@', name: fqdn };
  // 允许直接贴完整域名（必须落在该子域名之下）
  if (h.endsWith('.' + fqdn)) h = h.slice(0, -(fqdn.length + 1));
  if (h === label) return { ok: true, host: '@', name: fqdn };
  if (!h) return { ok: true, host: '@', name: fqdn };
  if (h.length > 200) return { ok: false, error: '主机名过长' };
  const labels = h.split('.');
  for (const l of labels) {
    if (!LABEL_RE.test(l)) return { ok: false, error: `主机名片段 "${l}" 含非法字符` };
  }
  // 禁止再写一层绝对域名
  if (h.includes('.')) {
    // 允许多级（如 _acme-challenge.api），但不允许包含根域名
    if (h.endsWith('.' + fqdn)) return { ok: false, error: '主机名越界' };
  }
  return { ok: true, host: h, name: `${h}.${fqdn}` };
}

/**
 * 校验一条记录，返回 { ok, error } 或 { ok:true, payload, display }
 * payload 为写入 Cloudflare API 的 body
 */
export function buildRecord(type, input, fqdn) {
  const spec = RECORD_TYPES[type];
  if (!spec) return { ok: false, error: '不支持的记录类型' };
  if (spec.readonly) return { ok: false, error: `${type} 记录为系统托管，不支持手动创建` };

  const ttlRaw = input.ttl === undefined || input.ttl === null || input.ttl === '' ? 1 : Number(input.ttl);
  if (!TTL_CHOICES.some((t) => t.value === ttlRaw)) return { ok: false, error: 'TTL 取值不合法' };

  const content = String(input.content ?? '').trim();
  if (!content && !spec.struct) return { ok: false, error: '记录值不能为空' };
  if (spec.struct && !content && type !== 'NAPTR') return { ok: false, error: '记录值不能为空' };

  const payload = { type, ttl: ttlRaw, comment: (input.comment || '').slice(0, 200) || undefined };
  let priority = null;
  let data = null;

  switch (type) {
    case 'A':
      if (!isValidIPv4(content)) return { ok: false, error: '请填写合法的 IPv4 地址' };
      break;
    case 'AAAA':
      if (!isValidIPv6(content)) return { ok: false, error: '请填写合法的 IPv6 地址' };
      break;
    case 'CNAME':
    case 'NS':
    case 'PTR': {
      if (!isDomain(content)) return { ok: false, error: '请填写合法的域名' };
      break;
    }
    case 'MX': {
      if (!isDomain(content)) return { ok: false, error: '请填写合法的邮件服务器域名' };
      priority = Number(input.priority ?? 10);
      if (!inRange(priority, 0, 65535)) return { ok: false, error: 'MX 优先级需在 0-65535 之间' };
      payload.priority = priority;
      break;
    }
    case 'TXT':
      if (content.length > 2048) return { ok: false, error: 'TXT 内容过长（最多 2048 字符）' };
      break;
    case 'SRV': {
      if (!isDomain(content)) return { ok: false, error: '请填写合法的目标主机域名' };
      const port = Number(input.port);
      const weight = Number(input.weight ?? 5);
      priority = Number(input.priority ?? 1);
      if (!inRange(port, 1, 65535)) return { ok: false, error: '端口需在 1-65535 之间' };
      if (!inRange(weight, 0, 65535)) return { ok: false, error: '权重需在 0-65535 之间' };
      if (!inRange(priority, 0, 65535)) return { ok: false, error: '优先级需在 0-65535 之间' };
      const service = String(input.service || '').trim();
      const proto = String(input.proto || '_tcp').trim();
      if (!/^_[A-Za-z0-9-]+$/.test(service)) return { ok: false, error: '服务名需以 _ 开头，如 _sip' };
      if (!/^_[A-Za-z0-9-]+$/.test(proto)) return { ok: false, error: '协议需为 _tcp / _udp / _tls' };
      data = {
        service,
        proto,
        name: String(input.srv_name || fqdn).trim() || fqdn,
        priority,
        weight,
        port,
        target: content,
      };
      payload.data = data;
      break;
    }
    case 'CAA': {
      const tag = String(input.tag || 'issue');
      if (!['issue', 'issuewild', 'iodef', 'contactemail', 'contactphone'].includes(tag))
        return { ok: false, error: 'CAA 标签不合法' };
      const flags = Number(input.flags ?? 0);
      if (![0, 128].includes(flags)) return { ok: false, error: 'CAA 标志只能是 0 或 128' };
      if (tag === 'iodef' && !/^(mailto:|https?:)\S+/i.test(content) && !isDomain(content))
        return { ok: false, error: 'iodef 需填写 mailto: 或 http(s) 地址' };
      data = { flags, tag, value: content };
      payload.data = data;
      break;
    }
    case 'NAPTR': {
      const order = Number(input.order ?? 100);
      const preference = Number(input.preference ?? 100);
      if (!inRange(order, 0, 65535)) return { ok: false, error: 'Order 需在 0-65535 之间' };
      if (!inRange(preference, 0, 65535)) return { ok: false, error: 'Preference 需在 0-65535 之间' };
      const flags = String(input.flags ?? 'U').trim();
      if (!/^[SUAPsuap]{1,2}$/.test(flags)) return { ok: false, error: 'Flags 只可为 S/U/A/P 的组合' };
      const service = String(input.service ?? '').trim();
      if (!service) return { ok: false, error: 'Service 不能为空' };
      const regexp = String(input.regexp ?? '').trim();
      const replacement = content.trim();
      if (!regexp && !replacement) return { ok: false, error: 'Regexp 与 Replacement 至少填一项' };
      if (replacement && !isDomain(replacement)) return { ok: false, error: 'Replacement 需为合法域名' };
      data = { flags, order, preference, regexp, replacement, service };
      payload.data = data;
      break;
    }
    case 'DS': {
      const keyTag = Number(input.key_tag);
      const algorithm = Number(input.algorithm);
      const digestType = Number(input.digest_type ?? 2);
      if (!inRange(keyTag, 0, 65535)) return { ok: false, error: 'Key Tag 需在 0-65535 之间' };
      if (![5, 7, 8, 10, 13, 14, 15, 16].includes(algorithm)) return { ok: false, error: 'Algorithm 取值不合法' };
      if (![1, 2, 3, 4].includes(digestType)) return { ok: false, error: 'Digest Type 取值不合法' };
      if (!/^[0-9A-Fa-f]{20,}$/.test(content.replace(/\s+/g, '')))
        return { ok: false, error: 'Digest 需为十六进制字符串（至少 20 位）' };
      data = {
        key_tag: keyTag,
        algorithm,
        digest_type: digestType,
        digest: content.replace(/\s+/g, '').toUpperCase(),
      };
      payload.data = data;
      break;
    }
    default:
      return { ok: false, error: '不支持的记录类型' };
  }

  if (spec.canProxy) {
    payload.proxied = ttlRaw === 1 ? Boolean(input.proxied) : false;
  }
  if (!spec.struct) payload.content = content;

  return {
    ok: true,
    payload,
    content,
    priority,
    data,
    ttl: ttlRaw,
    proxied: payload.proxied ? 1 : 0,
    display: formatDisplay({ type, content, data, priority }),
  };
}

// 把记录渲染成便于阅读的一行文本
export function formatDisplay(rec) {
  const d = typeof rec.data === 'string' ? safeJson(rec.data) : rec.data;
  switch (rec.type) {
    case 'MX':
      return `${rec.priority ?? 10} ${rec.content}`;
    case 'SRV':
      return d ? `${d.priority} ${d.weight} ${d.port} ${d.target}` : rec.content;
    case 'CAA':
      return d ? `${d.flags} ${d.tag} "${d.value}"` : rec.content;
    case 'NAPTR':
      return d ? `${d.order} ${d.preference} "${d.flags}" "${d.service}" "${d.regexp}" ${d.replacement}` : rec.content;
    case 'DS':
      return d ? `${d.key_tag} ${d.algorithm} ${d.digest_type} ${d.digest}` : rec.content;
    default:
      return rec.content;
  }
}

export function safeJson(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// 子域名标签校验（3-63 位，字母数字与连字符，不能以连字符开头/结尾）
export function validateLabel(label) {
  const l = String(label || '').trim().toLowerCase();
  if (!l) return { ok: false, error: '请输入子域名' };
  if (l.length < 2) return { ok: false, error: '子域名至少 2 个字符' };
  if (l.length > 63) return { ok: false, error: '子域名最多 63 个字符' };
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(l)) return { ok: false, error: '只能使用小写字母、数字和连字符，且不能以连字符开头或结尾' };
  if (/^\d+$/.test(l)) return { ok: false, error: '不支持纯数字子域名' };
  return { ok: true, label: l };
}
