// ============================================================
//  托管服务商识别（CNAME 探测）
//  查询域名的 CNAME 指向，匹配已知平台，像 DNSHE 系那样展示「托管在谁家」。
//  例：meoy.top CNAME → dash.domain.meoy.top  → 显示「TerraDomain 面板」
//      xxx.com  CNAME → cname.vercel-dns.com → 显示「Vercel」
//  数据走 DoH（DNS-over-HTTPS），无需 API Key。
// ============================================================

/** 已知平台的 CNAME 指纹（按优先级从具体到宽泛排列） */
export const HOSTING_FINGERPRINTS = [
  { name: 'Cloudflare Pages', match: ['.pages.dev'] },
  { name: 'Cloudflare Workers', match: ['.workers.dev'] },
  { name: 'Vercel', match: ['cname.vercel-dns.com', '.vercel-dns.com', '.vercel.app', 'cname.vercel-dns.com.'] },
  { name: 'Netlify', match: ['.netlify.app', '.netlify.com'] },
  { name: 'GitHub Pages', match: ['.github.io', '.github.map.fastly.net'] },
  { name: 'GitLab Pages', match: ['.gitlab.io'] },
  { name: 'Firebase Hosting', match: ['.web.app', '.firebaseapp.com'] },
  { name: 'Heroku', match: ['.herokuapp.com', '.herokudns.com'] },
  { name: 'Render', match: ['.onrender.com'] },
  { name: 'Fly.io', match: ['.fly.dev'] },
  { name: 'Deno Deploy', match: ['.deno.dev', '.deno.net'] },
  { name: 'Railway', match: ['.railway.app', '.up.railway.app'] },
  { name: 'Surge.sh', match: ['.surge.sh'] },
  { name: 'Rainbond', match: ['.rainbond.com'] },
  { name: 'Aliyun OSS', match: ['.oss-cn-', '.aliyuncs.com'] },
  { name: 'Tencent COS', match: ['.cos.', '.myqcloud.com'] },
  { name: 'Cloudflare', match: ['.cdn.cloudflare.net'] },
];

/** DoH 端点（按顺序尝试） */
const DOH_ENDPOINTS = [
  (d) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(d)}&type=CNAME`,
  (d) => `https://dns.google/resolve?name=${encodeURIComponent(d)}&type=CNAME`,
];

/** 取 CNAME 目标（未设置则返回 null） */
// 超时压到 5 秒/端点：托管识别是锦上添花，不能拖慢主查询
export async function resolveCname(domain, timeout = 5000) {
  for (const mk of DOH_ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(mk(domain), {
        headers: { Accept: 'application/dns-json' },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const j = await r.json().catch(() => null);
      const ans = (j && j.Answer) || [];
      // type 5 = CNAME
      const hit = ans.find((a) => Number(a.type) === 5 && a.data);
      if (hit) return String(hit.data).replace(/\.+$/, '').toLowerCase();
      // 明确查询成功但没有 CNAME → 确实不存在
      if (j && Number(j.Status) === 0) return null;
    } catch {
      clearTimeout(timer);
      continue;
    }
  }
  return null;
}

/** 规范化：统一去掉末尾点、转小写 */
function norm(d) {
  return String(d || '').replace(/\.+$/, '').toLowerCase();
}

/**
 * 识别托管平台
 * @param {string} domain  要查询的域名
 * @param {object} custom  自定义面板配置 { domain, name }
 * @returns {Promise<{hosting: string|null, cname: string|null, source: string}>}
 */
export async function detectHosting(domain, custom = null) {
  const cname = await resolveCname(domain);
  if (!cname) return { hosting: null, cname: null, source: 'none' };

  // ① 自定义面板域名优先（如 dash.domain.meoy.top → TerraDomain 面板）
  if (custom && custom.domain) {
    const cd = norm(custom.domain);
    if (cname === cd || cname.endsWith('.' + cd)) {
      return { hosting: custom.name || custom.domain, cname, source: 'custom' };
    }
  }

  // ② 已知平台指纹
  for (const fp of HOSTING_FINGERPRINTS) {
    for (const m of fp.match) {
      const mm = norm(m);
      if (cname === mm || cname.endsWith(mm) || cname.endsWith('.' + mm)) {
        return { hosting: fp.name, cname, source: 'fingerprint' };
      }
    }
  }

  // ③ 认不出平台，但确实有 CNAME —— 原样展示，让用户自己判断
  return { hosting: null, cname, source: 'cname' };
}

/** 从站点设置读取自定义面板配置 */
export async function customPanel(env) {
  let domain = String(env.HOSTING_PANEL_DOMAIN || '').trim().toLowerCase();
  let name = String(env.HOSTING_PANEL_NAME || '').trim();
  if (!domain) {
    try {
      const rows = await env.DB
        .prepare("SELECT key, value FROM settings WHERE key IN ('hosting_panel_domain','hosting_panel_name')")
        .all();
      const m = Object.fromEntries((rows?.results || []).map((r) => [r.key, String(r.value || '').trim()]));
      domain = (m.hosting_panel_domain || '').toLowerCase();
      name = m.hosting_panel_name || '';
    } catch { /* 忽略 */ }
  }
  return domain ? { domain, name: name || domain } : null;
}
