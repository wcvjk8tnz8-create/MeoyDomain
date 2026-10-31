// ============================================================
//  Cloudflare DNS API 封装
//  真实模式：调用 https://api.cloudflare.com/client/v4
//  Mock 模式（CF_MOCK=1）：内存模拟，方便本地跑通全部流程
// ============================================================

const BASE = 'https://api.cloudflare.com/client/v4';

// ---- mock 存储 ----
const mockStore = new Map();
let mockSeq = 1000;

function mockId() {
  return 'mock' + String(++mockSeq);
}

async function mockCreate(payload) {
  const id = mockId();
  mockStore.set(id, {
    id,
    type: payload.type,
    name: payload.name,
    content: payload.content || '',
    data: payload.data || null,
    ttl: payload.ttl ?? 1,
    proxied: Boolean(payload.proxied),
    priority: payload.priority ?? null,
  });
  return { ok: true, result: mockStore.get(id) };
}

export async function cfCreate(env, payload) {
  if (env.CF_MOCK === '1' || env.CF_MOCK === 'true') return mockCreate(payload);
  const r = await fetch(`${BASE}/zones/${env.CF_ZONE_ID}/dns_records`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return cfParse(r);
}

export async function cfUpdate(env, id, payload) {
  if (env.CF_MOCK === '1' || env.CF_MOCK === 'true') {
    const old = mockStore.get(id);
    if (!old) return { ok: false, errors: [{ message: '记录不存在（mock）' }] };
    Object.assign(old, {
      type: payload.type,
      name: payload.name,
      content: payload.content || '',
      data: payload.data || null,
      ttl: payload.ttl ?? 1,
      proxied: Boolean(payload.proxied),
      priority: payload.priority ?? null,
    });
    return { ok: true, result: old };
  }
  const r = await fetch(`${BASE}/zones/${env.CF_ZONE_ID}/dns_records/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return cfParse(r);
}

export async function cfDelete(env, id) {
  if (env.CF_MOCK === '1' || env.CF_MOCK === 'true') {
    mockStore.delete(id);
    return { ok: true, result: { id } };
  }
  const r = await fetch(`${BASE}/zones/${env.CF_ZONE_ID}/dns_records/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
  });
  return cfParse(r);
}

export async function cfList(env, params = {}) {
  if (env.CF_MOCK === '1' || env.CF_MOCK === 'true') {
    return { ok: true, result: [...mockStore.values()] };
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, v);
  const r = await fetch(`${BASE}/zones/${env.CF_ZONE_ID}/dns_records?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
  });
  return cfParse(r);
}

// 拉取区域 SOA（Cloudflare 自动生成，只读）
export async function cfSoa(env) {
  if (env.CF_MOCK === '1' || env.CF_MOCK === 'true') {
    return {
      ok: true,
      result: [{
        name: env.ROOT_DOMAIN,
        data: {
          mname: `ns1.cloudflare.com`,
          rname: `dns.cloudflare.com`,
          serial: 2380000000,
          refresh: 10000,
          retry: 2400,
          expire: 604800,
          minimum: 1800,
        },
      }],
    };
  }
  const r = await fetch(`${BASE}/zones/${env.CF_ZONE_ID}/dns_records?type=SOA`, {
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
  });
  return cfParse(r);
}

async function cfParse(resp) {
  let json;
  try {
    json = await resp.json();
  } catch {
    return { ok: false, errors: [{ message: `Cloudflare 返回无法解析的内容（HTTP ${resp.status}）` }] };
  }
  if (!resp.ok || !json.success) {
    const msgs = (json.errors || []).map((e) => e.message).filter(Boolean);
    return { ok: false, errors: json.errors || [], message: msgs.join('；') || `Cloudflare API 错误 ${resp.status}` };
  }
  return { ok: true, result: json.result };
}

export function cfErrorMessage(res) {
  if (res.message) return res.message;
  return (res.errors || []).map((e) => e.message || e.code).join('；') || 'Cloudflare API 调用失败';
}
