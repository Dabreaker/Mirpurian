const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const id = new URLSearchParams(location.search).get('id') || '';
const EMOJI = ['👍', '❤️', '🔥', '😂', '🙏'];
let dev = '';
try { dev = localStorage.dev || (localStorage.dev = Math.random().toString(36).slice(2) + Date.now().toString(36)); } catch {}
const send = (u, body) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const size = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
const ago = (t) => { const m = (Date.now() - t) / 6e4; return m < 1 ? 'just now' : m < 60 ? Math.floor(m) + ' min ago' : m < 1440 ? Math.floor(m / 60) + ' h ago' : Math.floor(m / 1440) + ' days ago'; };
let D;

function dyn() {
  $('#stats').textContent = `${D.views} views, ${D.dl} downloads`;
  $('#react').innerHTML = EMOJI.map((e) => `<button class="chip ${D.mine.includes(e) ? 'on' : ''}" data-e="${e}">${e} ${D.react[e] || 0}</button>`).join('');
  $('#cm').innerHTML = D.comments.map((c) => `<div class="cm"><b>${esc(c.name)}</b> <small>${ago(c.time)}</small><p>${esc(c.text)}</p></div>`).join('') || '<p class="muted">No comments yet. Be the first.</p>';
}

function view() {
  const p = D.post, img = (p.type || '').startsWith('image/');
  document.title = p.title + ' - MIRPURIAN';
  $('#post').innerHTML = `
    <h2>${esc(p.title)}</h2>
    <p class="muted">${esc(p.section)}${p.subject ? ', ' + esc(p.subject) : ''}. ${size(p.size)}. ${new Date(p.createdAt).toLocaleDateString()}</p>
    ${img || p.thumb ? `<img class="pv" src="${esc(img ? p.url : p.thumb)}" alt="">` : ''}
    ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
    <p><a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener">Open</a> <a class="btn ghost" href="/api/dl?id=${encodeURIComponent(p.id)}">Download</a></p>
    <p class="muted" id="stats"></p>
    <div id="react" class="chips"></div>
    <h3>Comments</h3>
    <div id="cm"></div>
    <form id="cf" class="panel">
      <input id="cn" placeholder="Your name (optional)" maxlength="30">
      <textarea id="ct" placeholder="Write a comment" maxlength="500" required></textarea>
      <input id="web" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
      <button class="btn">Post comment</button>
      <p id="ce" class="err"></p>
    </form>`;
  try { $('#cn').value = localStorage.name || ''; } catch {}
  $('#react').onclick = async (e) => {
    const b = e.target.closest('[data-e]');
    if (!b) return;
    const r = await send('/api/react', { id, emoji: b.dataset.e, dev });
    if (r.error) return;
    D.react = r.react;
    D.mine = r.on ? [...D.mine, b.dataset.e] : D.mine.filter((x) => x !== b.dataset.e);
    dyn();
  };
  $('#cf').onsubmit = async (e) => {
    e.preventDefault();
    try { localStorage.name = $('#cn').value; } catch {}
    const r = await send('/api/comments', { id, name: $('#cn').value, text: $('#ct').value, dev, website: $('#web').value });
    if (r.error) { $('#ce').textContent = r.error; return; }
    $('#ce').textContent = ''; $('#ct').value = '';
    if (r.id) D.comments.push(r);
    dyn();
  };
  dyn();
}

fetch(`/api/post?id=${encodeURIComponent(id)}&dev=${encodeURIComponent(dev)}&v=1`)
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((d) => { D = d; view(); })
  .catch(() => { $('#post').innerHTML = '<p class="empty">Post not found.</p>'; });
