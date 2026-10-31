// 前端通用工具：接口封装、提示、渲染辅助
const api = {
  async req(method, path, body) {
    const opt = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) opt.body = JSON.stringify(body);
    let res, data;
    try {
      res = await fetch(path, opt);
      data = await res.json().catch(() => ({}));
    } catch (e) {
      throw new Error('网络请求失败');
    }
    if (res.status === 401) {
      if (!['/', '/index'].includes(location.pathname)) location.href = '/';
    }
    if (!data.success) throw new Error(data.message || '请求失败');
    return data;
  },
  get: (p) => api.req('GET', p),
  post: (p, b) => api.req('POST', p, b),
  patch: (p, b) => api.req('PATCH', p, b),
  del: (p) => api.req('DELETE', p),
};

function toast(msg, type = 'ok', ms = 2600) {
  let box = document.getElementById('toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    document.body.appendChild(box);
  }
  const d = document.createElement('div');
  d.className = 'toast ' + (type === 'err' ? 'err' : '');
  d.textContent = msg;
  box.appendChild(d);
  setTimeout(() => d.remove(), ms);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(Number(ts));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function copyText(t) {
  navigator.clipboard?.writeText(t).then(() => toast('已复制'), () => toast('复制失败', 'err'));
}

const STATUS_MAP = {
  pending: { cls: 'warn', text: '待审核' },
  approved: { cls: 'ok', text: '已开通' },
  rejected: { cls: 'danger', text: '已驳回' },
  suspended: { cls: 'danger', text: '已停用' },
};

function statusBadge(s) {
  const m = STATUS_MAP[s] || { cls: '', text: s };
  return `<span class="badge ${m.cls}">${m.text}</span>`;
}

// 顶部导航
async function mountNav(active) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  let user = null;
  try {
    user = (await api.get('/api/auth/me')).user;
  } catch {
    location.href = '/';
    return;
  }
  const isAdmin = user.role === 'admin';
  nav.innerHTML = `
    <div class="logo">二级域名分发<span> · 控制台</span></div>
    <div class="spacer"></div>
    <div class="links">
      <a class="navlink ${active === 'dash' ? 'active' : ''}" href="/dashboard">我的域名</a>
      ${isAdmin ? `<a class="navlink ${active === 'admin' ? 'active' : ''}" href="/admin">管理后台</a>` : ''}
      <span class="sep"></span>
      <span class="badge" style="font-weight:400">${esc(user.email)}</span>
      <button class="btn sm ghost" id="btnLogout">退出</button>
    </div>`;
  document.getElementById('btnLogout').onclick = async () => {
    await api.post('/api/auth/logout', {});
    location.href = '/';
  };
  return user;
}

function openModal(title, html) {
  const m = document.getElementById('modal');
  m.querySelector('.box').innerHTML = `<h2>${esc(title)}</h2>${html}`;
  m.classList.add('show');
}
function closeModal() {
  document.getElementById('modal').classList.remove('show');
}
window.closeModal = closeModal;

document.addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});
