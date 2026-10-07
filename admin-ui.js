import { upload } from 'https://esm.sh/@vercel/blob/client';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = (u, m = 'GET', body) =>
  fetch(u, { method: m, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
let sections = [], posts = [];

async function boot() {
  const { admin } = await api('/api/admin/login');
  $('#login').hidden = admin; $('#app').hidden = !admin; $('#out').hidden = !admin;
  if (admin) { await loadSections(); await loadPosts(); }
}
$('#login').onsubmit = async (e) => {
  e.preventDefault();
  try { await api('/api/admin/login', 'POST', { password: $('#pw').value }); $('#pw').value = ''; $('#lerr').textContent = ''; boot(); }
  catch (x) { $('#lerr').textContent = x.message; }
};
$('#out').onclick = async () => { await api('/api/admin/login', 'DELETE'); boot(); };

/* ---------- sections ---------- */
const secRow = (s = {}) => `<div class="row" data-slug="${esc(s.slug || '')}"><input class="ic" value="${esc(s.icon || '📁')}" maxlength="4"><input class="nm" value="${esc(s.name || '')}" placeholder="Section name"><button class="btn ghost del" type="button">Remove</button></div>`;
async function loadSections() {
  sections = await api('/api/sections?t=' + Date.now());
  $('#sec').innerHTML = sections.map((s) => `<option value="${esc(s.slug)}">${esc(s.icon)} ${esc(s.name)}</option>`).join('');
  $('#secs').innerHTML = sections.map(secRow).join('');
}
$('#secs').onclick = (e) => e.target.classList.contains('del') && e.target.parentElement.remove();
$('#addsec').onclick = () => $('#secs').insertAdjacentHTML('beforeend', secRow());
$('#savesec').onclick = async () => {
  const list = [...document.querySelectorAll('#secs .row')].map((r) => ({ slug: r.dataset.slug || undefined, icon: r.querySelector('.ic').value, name: r.querySelector('.nm').value }));
  try { await api('/api/sections', 'PUT', list); await loadSections(); alert('Sections saved'); } catch (x) { alert(x.message); }
};

/* ---------- thumbnails (made in the browser) ---------- */
async function makeThumb(f) {
  try {
    const c = document.createElement('canvas');
    if (f.type.startsWith('image/')) {
      const bmp = await createImageBitmap(f);
      const k = Math.min(1, 480 / bmp.width);
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    } else if (f.type === 'application/pdf') {
      const pdfjs = await import(PDFJS + 'pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
      const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      const page = await doc.getPage(1);
      const v = page.getViewport({ scale: 480 / page.getViewport({ scale: 1 }).width });
      c.width = Math.round(v.width); c.height = Math.round(v.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
    } else return null;
    return await new Promise((ok) => c.toBlob(ok, 'image/webp', 0.8));
  } catch { return null; }
}

/* ---------- upload ---------- */
$('#up').onsubmit = async (e) => {
  e.preventDefault();
  const files = [...$('#file').files], st = $('#st');
  const opts = { access: 'public', handleUploadUrl: '/api/admin/upload' };
  for (const [i, f] of files.entries()) {
    try {
      st.textContent = `Uploading ${i + 1} of ${files.length}: ${f.name}`;
      const th = await makeThumb(f);
      const file = await upload('files/' + f.name, f, opts);
      const thumb = th ? await upload('thumbs/' + f.name + '.webp', th, opts) : null;
      await api('/api/posts', 'POST', {
        url: file.url, thumb: thumb ? thumb.url : '', name: f.name, size: f.size, type: f.type,
        title: (files.length === 1 && $('#title').value) || f.name.replace(/\.[^.]+$/, ''),
        section: $('#sec').value, subject: $('#subj').value, description: $('#desc').value, pinned: $('#pin').checked,
      });
    } catch (x) { st.textContent = 'Upload failed: ' + x.message; return; }
  }
  st.textContent = 'Uploaded.'; e.target.reset(); loadPosts();
};

/* ---------- posts ---------- */
async function loadPosts() {
  posts = await api('/api/posts?t=' + Date.now());
  $('#list').innerHTML = posts.map((p) => `<div class="row" data-id="${esc(p.id)}"><span class="t">${esc(p.title)}<small>${esc(p.section)}${p.subject ? ', ' + esc(p.subject) : ''}${p.pinned ? ', pinned' : ''}</small></span><button class="btn ghost" data-a="edit">Edit</button><button class="btn ghost" data-a="pin">${p.pinned ? 'Unpin' : 'Pin'}</button><button class="btn ghost" data-a="del">Delete</button></div>`).join('') || '<p class="muted">No posts yet. Upload your first file above.</p>';
}
$('#list').onclick = async (e) => {
  const a = e.target.dataset.a;
  if (!a) return;
  const id = e.target.closest('.row').dataset.id, p = posts.find((x) => x.id === id), u = '/api/posts?id=' + encodeURIComponent(id);
  try {
    if (a === 'del') { if (!confirm(`Delete "${p.title}"?`)) return; await api(u, 'DELETE'); }
    else if (a === 'pin') await api(u, 'PATCH', { pinned: !p.pinned });
    else {
      const title = prompt('Title', p.title); if (title === null) return;
      const subject = prompt('Subject', p.subject); if (subject === null) return;
      const description = prompt('Description', p.description); if (description === null) return;
      const section = prompt('Section (' + sections.map((s) => s.slug).join(', ') + ')', p.section); if (section === null) return;
      await api(u, 'PATCH', { title, subject, description, section });
    }
    loadPosts();
  } catch (x) { alert(x.message); }
};

boot();
