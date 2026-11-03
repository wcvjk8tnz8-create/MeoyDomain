/**
 * Profile 页面控制器（由 profile.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, esc, fmtTime, toast, openModal, closeModal, loadBranding, applyBranding, mountShell, MeoyRenderAvatars } from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

export async function mountProfile(_root: HTMLElement | null): Promise<void> {
  
  let me = null, data = null, curAvatar = '/img/avatar/miku-headset.webp';
  
  mountShell('profile').then(async () => {
    applyBranding(await loadBranding());
    await load();
  }).catch((e) => console.error("初始化失败", e));
  
  async function load() {
    try {
      data = await api.get('/api/profile');
    } catch (e) { toast(e.message, 'err'); return; }
    const p = data.profile || {};
    curAvatar = p.avatar || '/img/avatar/miku-headset.webp';
    const nick = p.nickname || String(data.email || '').split('@')[0];
  
    document.getElementById('pcName').textContent = nick;
    document.getElementById('pcUid').textContent = p.uid || '—';
    document.getElementById('pcMail').textContent = data.email || '—';
    document.getElementById('pcCreated').textContent = fmtTime(data.createdAt);
    document.getElementById('pcLogin').textContent = data.lastLoginAt ? fmtTime(data.lastLoginAt) : '—';
    document.getElementById('pcBio').textContent = p.bio || '';
    document.getElementById('pcDomains').textContent = `${data.domains} Domains`;
    document.getElementById('pcRole').textContent = data.role === 'admin' ? '管理员' : '用户';
    // 等级：按域名数与记录数粗算，纯装饰
    const lv = 1 + Math.floor((data.domains * 3 + data.records) / 2);
    document.getElementById('pcLv').textContent = 'LV ' + lv;
    setAvatar(curAvatar);
  
    document.getElementById('fNick').value = p.nickname || '';
    document.getElementById('fMail').value = data.email || '';
    document.getElementById('fBio').value = p.bio || '';
    document.getElementById('fAvUrl').value = p.avatar || '';
    document.getElementById('secUid').textContent = p.uid || '—';
    document.getElementById('secMail').textContent = data.email || '—';
  }
  
  function setAvatar(url) {
    // 顶栏头像必须跟着变（同一个用户，两处不能不一致）
    try { window.MeoyRenderAvatars && window.MeoyRenderAvatars(url); } catch (e) {}
    curAvatar = url || '/img/avatar/miku-headset.webp';
    const av = document.getElementById('pcAv');
    const pv = document.getElementById('fAvPreview');
    if (av) av.src = curAvatar;
    if (pv) pv.src = curAvatar;
    const u = document.getElementById('fAvUrl');
    if (u) u.value = curAvatar;
  }
  
  /* ---------- 头像选择弹窗（内置角色库：Miku / GUMI / VOCALOID / Ave Mujica） ---------- */
  function openAvatarPicker(afterPick) {
    const list = (data && data.avatars) || [];
    const groups = ['all', ...new Set(list.map((a) => a.group || '其它'))];
    const countOf = (g) => g === 'all' ? list.length : list.filter((a) => (a.group || '其它') === g).length;
    const gname = (g) => g === 'all' ? '全部' : (g === 'Ave Mujica' ? 'Mujica' : g);
    let picked = curAvatar;
    let group = 'all';
  
    openModal('选择头像', `
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:11px;gap:8px;flex-wrap:wrap">
        <div class="av-filters" id="avFilters">
          ${groups.map((g) => `<button type="button" class="av-flt${g === group ? ' on' : ''}" data-g="${esc(g)}">${esc(gname(g))} <b>${countOf(g)}</b></button>`).join('')}
        </div>
        <button class="btn sm" id="btnUploadAv2" style="display:none">上传本地图片</button>
      </div>
      <div class="av-grid" id="avGrid"></div>
      <div class="row end" style="margin-top:14px">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn primary" id="okAv">保存修改</button>
      </div>`);
  
    const grid = document.getElementById('avGrid');
    const draw = () => {
      const arr = group === 'all' ? list : list.filter((a) => (a.group || '其它') === group);
      grid.innerHTML = arr.map((a) => `
        <div class="av-cell${a.url === picked ? ' on' : ''}" data-av="${esc(a.url)}" title="${esc(a.label)}">
          <button class="av-item${a.url === picked ? ' on' : ''}" type="button"><img src="${esc(a.url)}" alt="${esc(a.label)}" loading="lazy"></button>
          <span class="av-label">${esc(a.label)}</span>
        </div>`).join('') || '<div class="hint" style="grid-column:1/-1">暂无头像</div>';
      grid.querySelectorAll('.av-cell').forEach((b) => {
        b.onclick = () => {
          picked = b.dataset.av;
          grid.querySelectorAll('.av-cell, .av-item').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          const inner = b.querySelector('.av-item');
          if (inner) inner.classList.add('on');
        };
      });
    };
    draw();
  
    document.querySelectorAll('#avFilters .av-flt').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('#avFilters .av-flt').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        group = b.dataset.g;
        draw();
      };
    });
  
    const b2 = document.getElementById('btnUploadAv2');
    if (b2) b2.onclick = () => { closeModal(); pickFile(); };
  
    document.getElementById('okAv').onclick = () => {
      closeModal();
      if (afterPick) afterPick(picked);
    };
  }
  
  document.getElementById('btnPickAv').onclick = () => openAvatarPicker((u) => { setAvatar(u); saveNow(); });
  document.getElementById('btnPickAv2').onclick = () => openAvatarPicker((u) => setAvatar(u));
  
  document.getElementById('fAvUrl').addEventListener('change', () => {
    const v = document.getElementById('fAvUrl').value.trim();
    if (v) setAvatar(v);
  });
  
  document.getElementById('btnSave').onclick = () => saveNow();
  
  
  /* ---------- 上传自定义头像（R2） ---------- */
  const fileInput = document.getElementById('fAvFile');
  const upTip = document.getElementById('upTip');
  
  function pickFile() { fileInput.click(); }
  /* 自定义上传默认关闭（当前不绑定 R2）。
     后台在 /api/config 里返回 avatarUpload: true 时才显示并启用。 */
  const btnUp = document.getElementById('btnUploadAv');
  if (btnUp) btnUp.onclick = pickFile;
  try {
    api.get('/api/config').then((cfg) => {
      if (cfg && cfg.avatarUpload === true) {
        [btnUp, document.getElementById('btnUploadAv2')].forEach((b) => { if (b) b.style.display = ''; });
      }
    }).catch((e) => console.error("初始化失败", e));
  } catch (e) {}
  
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const maxKb = 2048;
    if (f.size > maxKb * 1024) { upTip.textContent = `图片不能超过 ${maxKb} KB`; upTip.style.color = 'var(--danger)'; return; }
    upTip.textContent = '上传中…'; upTip.style.color = '';
    const fd = new FormData();
    fd.append('file', f);
    try {
      // 走原生 fetch：需要 multipart，api.req 会强制 JSON
      const r = await fetch('/api/profile/avatar', { method: 'POST', body: fd, credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!j.success) throw new Error(j.message || '上传失败');
      setAvatar(j.url);
      upTip.textContent = '上传成功，记得点「保存修改」';
      upTip.style.color = 'var(--ok)';
      toast('头像已上传');
    } catch (e) {
      upTip.textContent = e.message;
      upTip.style.color = 'var(--danger)';
    }
    fileInput.value = '';
  });
  
  async function saveNow() {
    const btn = document.getElementById('btnSave');
    btn.disabled = true;
    try {
      await api.put('/api/profile', {
        nickname: document.getElementById('fNick').value,
        bio: document.getElementById('fBio').value,
        avatar: document.getElementById('fAvUrl').value.trim() || curAvatar,
      });
      toast('资料已保存');
      await load();
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  }
  
  /* ---------- 修改密码 ---------- */
  document.getElementById('btnPwd').onclick = () => {
    openModal('修改密码', `
      <div class="field"><label>原密码</label><input id="pOld" type="password" autocomplete="current-password"></div>
      <div class="field"><label>新密码（至少 8 位）</label><input id="pNew" type="password" autocomplete="new-password"></div>
      <div class="row end">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn primary" id="okPwd">确认修改</button>
      </div>`);
    document.getElementById('okPwd').onclick = async () => {
      try {
        await api.post('/api/auth/password', {
          oldPassword: document.getElementById('pOld').value,
          newPassword: document.getElementById('pNew').value,
        });
        toast('密码已修改，其它设备已登出');
        closeModal();
      } catch (e) { toast(e.message, 'err'); }
    };
  };
  
  /* ---------- 壁纸切换联动资料卡横幅 ---------- */
  (function syncBanner() {
    const apply = () => {
      const b = document.getElementById('bg');
      const img = b && getComputedStyle(b).backgroundImage;
      const m = img && img.match(/url\("?([^")]+)"?\)/);
      const el = document.getElementById('pcBanner');
      if (el && m) el.src = m[1];
    };
    setTimeout(apply, 600);
    document.addEventListener('click', (e) => {
      if (e.target.closest?.('.bgswitch button')) setTimeout(apply, 100);
    });
  })();
  
}
