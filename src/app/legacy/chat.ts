/**
 * Chat 页面控制器（由 chat.html 内联脚本平移）
 * 外部符号由 runtime 提供；DOM 查询作用于当前挂载的页面。
 */
import { api, esc, fmtTime, toast, mountShell } from '../lib/runtime';

import type { LegacyCtx } from '../lib/types';

export async function mountChat(_root: HTMLElement | null): Promise<void> {
  
  let me = null;
  let isAdmin = false;
  let page = 1;
  let curPost = null;
  
  function showList() {
    document.getElementById('viewList').style.display = '';
    document.getElementById('viewPost').style.display = 'none';
    loadList();
  }
  
  function showPost(id) {
    document.getElementById('viewList').style.display = 'none';
    document.getElementById('viewPost').style.display = '';
    loadPost(id);
  }
  
  async function loadList() {
    const q = document.getElementById('q').value.trim();
    const box = document.getElementById('listBox');
    box.innerHTML = '<div class="empty">加载中…</div>';
    try {
      const d = await api.get(`/api/chat/posts?page=${page}&q=${encodeURIComponent(q)}`);
      if (!d.items.length) {
        box.innerHTML = '<div class="empty">还没有帖子，点「发新帖」开个头</div>';
        document.getElementById('pageTip').textContent = '';
        return;
      }
      box.innerHTML = d.items.map((p) => `
        <div class="post-row" data-id="${p.id}">
          <div class="row between" style="align-items:flex-start">
            <div style="flex:1;min-width:0">
              <div class="post-title">
                ${p.pinned ? '<span class="badge warn">置顶</span> ' : ''}
                ${p.locked ? '<span class="badge lock">已锁</span> ' : ''}
                <a href="#" data-open="${p.id}">${esc(p.title)}</a>
              </div>
              <div class="post-meta">${esc(p.author)} · ${fmtTime(p.created_at)} · 浏览 ${p.views} · 回复 ${p.reply_count}</div>
            </div>
            ${(isAdmin || (me && p.user_id === me.id))
              ? `<button class="btn sm danger" data-del="${p.id}">删除</button>` : ''}
          </div>
        </div>`).join('');
  
      box.querySelectorAll('[data-open]').forEach((a) => {
        a.onclick = (e) => { e.preventDefault(); showPost(Number(a.dataset.open)); };
      });
      box.querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm('确定删除该帖及其回复？')) return;
          try { await api.del('/api/chat/posts/' + b.dataset.del); toast('已删除'); loadList(); }
          catch (err) { toast(err.message, 'err'); }
        };
      });
      document.getElementById('pageTip').textContent = `第 ${page} 页`;
    } catch (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }
  
  async function loadPost(id) {
    const box = document.getElementById('replyBox');
    box.innerHTML = '<div class="empty">加载中…</div>';
    try {
      const d = await api.get('/api/chat/posts/' + id);
      curPost = d.post;
      document.getElementById('dTitle').textContent = d.post.title;
      document.getElementById('dMeta').textContent =
        `${d.post.author} · ${fmtTime(d.post.created_at)} · 浏览 ${d.post.views}`;
      document.getElementById('dBody').textContent = d.post.content;
      document.getElementById('rCount').textContent = `(${d.replies.length})`;
  
      const flags = document.getElementById('dFlags');
      flags.innerHTML = (d.post.pinned ? '<span class="badge warn">置顶</span> ' : '') +
                        (d.post.locked ? '<span class="badge lock">已锁</span>' : '');
  
      const ops = document.getElementById('dOps');
      const mine = me && d.post.user_id === me.id;
      let h = '';
      if (isAdmin) {
        h += `<button class="btn sm" data-pin="${id}">${d.post.pinned ? '取消置顶' : '置顶'}</button> `;
        h += `<button class="btn sm" data-lock="${id}">${d.post.locked ? '解锁' : '锁定'}</button> `;
      }
      if (isAdmin || mine) h += `<button class="btn sm danger" data-delp="${id}">删除</button>`;
      ops.innerHTML = h;
      const dp = ops.querySelector('[data-delp]');
      if (dp) dp.onclick = async () => {
        if (!confirm('确定删除该帖？')) return;
        try { await api.del('/api/chat/posts/' + id); toast('已删除'); showList(); }
        catch (e) { toast(e.message, 'err'); }
      };
      const pin = ops.querySelector('[data-pin]');
      if (pin) pin.onclick = async () => {
        try { await api.post('/api/chat/posts/' + id + '/flag', { pinned: d.post.pinned ? 0 : 1 }); loadPost(id); }
        catch (e) { toast(e.message, 'err'); }
      };
      const lk = ops.querySelector('[data-lock]');
      if (lk) lk.onclick = async () => {
        try { await api.post('/api/chat/posts/' + id + '/flag', { locked: d.post.locked ? 0 : 1 }); loadPost(id); }
        catch (e) { toast(e.message, 'err'); }
      };
  
      if (!d.replies.length) { box.innerHTML = '<div class="empty">还没有回复，来说两句</div>'; }
      else {
        box.innerHTML = d.replies.map((r) => `
          <div class="reply-row">
            <div class="row between" style="align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div class="post-meta">${esc(r.author)}${r.author_role === 'admin' ? ' <span class="badge inf">管理员</span>' : ''} · ${fmtTime(r.created_at)}</div>
                <div class="post-body" style="margin-top:4px">${esc(r.content)}</div>
              </div>
              ${(isAdmin || (me && r.user_id === me.id))
                ? `<button class="btn sm danger" data-delr="${r.id}">删除</button>` : ''}
            </div>
          </div>`).join('');
        box.querySelectorAll('[data-delr]').forEach((b) => {
          b.onclick = async () => {
            if (!confirm('删除这条回复？')) return;
            try { await api.del('/api/chat/replies/' + b.dataset.delr); loadPost(id); }
            catch (e) { toast(e.message, 'err'); }
          };
        });
      }
  
      const rb = document.getElementById('rBody');
      const br = document.getElementById('btnReply');
      if (d.post.locked && !isAdmin) {
        rb.disabled = true; br.disabled = true;
        rb.placeholder = '该帖已锁定，无法回复';
      } else {
        rb.disabled = false; br.disabled = false; rb.placeholder = '友善发言';
      }
    } catch (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
  }
  
  document.getElementById('btnNew').onclick = () => {
    const c = document.getElementById('compose');
    c.style.display = c.style.display === 'none' ? '' : 'none';
    if (c.style.display === '') document.getElementById('pTitle').focus();
  };
  document.getElementById('btnCancel').onclick = () => {
    document.getElementById('compose').style.display = 'none';
    document.getElementById('pTitle').value = '';
    document.getElementById('pBody').value = '';
  };
  document.getElementById('btnPost').onclick = async () => {
    const t = document.getElementById('pTitle').value.trim();
    const b = document.getElementById('pBody').value.trim();
    if (!t) return toast('请填写标题', 'err');
    if (!b) return toast('请填写内容', 'err');
    const btn = document.getElementById('btnPost');
    btn.disabled = true;
    try {
      await api.post('/api/chat/posts', { title: t, content: b });
      toast('已发布');
      document.getElementById('pTitle').value = '';
      document.getElementById('pBody').value = '';
      document.getElementById('compose').style.display = 'none';
      page = 1;
      loadList();
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  };
  document.getElementById('btnSearch').onclick = () => { page = 1; loadList(); };
  document.getElementById('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { page = 1; loadList(); } });
  document.getElementById('btnPrev').onclick = () => { if (page > 1) { page--; loadList(); } };
  document.getElementById('btnNext').onclick = () => { page++; loadList(); };
  document.getElementById('btnBack').onclick = showList;
  document.getElementById('btnReply').onclick = async () => {
    const b = document.getElementById('rBody').value.trim();
    if (!b) return toast('请输入回复内容', 'err');
    const btn = document.getElementById('btnReply');
    btn.disabled = true;
    try {
      await api.post('/api/chat/posts/' + curPost.id + '/replies', { content: b });
      document.getElementById('rBody').value = '';
      loadPost(curPost.id);
      toast('已发送');
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  };
  
  (async () => {
    me = await mountShell('chat');
    isAdmin = !!(me && me.role === 'admin');
    loadList();
  })();
  
}
