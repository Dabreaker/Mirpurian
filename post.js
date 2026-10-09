const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const id = new URLSearchParams(location.search).get('id') || '';
const EMOJI = ['👍', '❤️', '🔥', '😂', '🙏'];
let dev = '';
try { dev = localStorage.dev || (localStorage.dev = Math.random().toString(36).slice(2) + Date.now().toString(36)); } catch {}
const send = (u, body) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const size = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
const ago = (t) => { const m = (Date.now() - t) / 6e4; return m < 1 ? 'just now' : m < 60 ? Math.floor(m) + ' min ago' : m < 1440 ? Math.floor(m / 60) + ' h ago' : Math.floor(m / 1440) + ' days ago'; };
let S;

function dyn() {
  $('#stats').textContent = `${S.views} views, ${S.dl} downloads`;
  $('#react').innerHTML = EMOJI.map((e) => `<button class="chip ${S.mine.includes(e) ? 'on' : ''}" data-e="${e}">${e} ${S.react[e] || 0}</button>`).join('');
  $('#cm').innerHTML = S.comments.map((c) => `<div class="cm"><b>${esc(c.name)}</b> <small>${ago(c.time)}</small><p>${esc(c.text)}</p></div>`).join('') || '<p class="muted">No comments yet. Be the first.</p>';
}

function view(p, D) {
  const f = p.file, isImg = f && /^(png|jpe?g|gif|webp|avif)$/.test(f.ext);
  const sec = D.sections.find((s) => s.id === p.section);
  document.title = p.title + ' - MIRPURIAN';
  $('#post').innerHTML = `
    <h2>${esc(p.title)}</h2>
    <p class="muted">${esc(sec ? sec.name : p.section)}${p.subject ? ', ' + esc(p.subject) : ''}. ${new Date(p.date).toLocaleDateString()}${f && f.size ? '. ' + size(f.size) : ''}</p>
    ${isImg ? `<img class="pv" src="${esc(f.url)}" alt="">` : p.thumb ? `<img class="pv" src="${esc(p.thumb)}" alt="">` : ''}
    ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
    ${p.tags.length ? `<div class="meta">${p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    ${f ? `<p><a class="btn" href="${esc(f.url)}" target="_blank" rel="noopener">${f.ext === 'link' ? 'Open link' : 'Open'}</a>${f.ext === 'link' ? '' : ` <a class="btn ghost" href="/api/dl?id=${encodeURIComponent(p.id)}">Download</a>`}</p>` : ''}
    <div id="social" hidden>
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
      </form>
    </div>`;
}

async function loadSocial() {
  try {
    const r = await fetch(`/api/social?id=${encodeURIComponent(id)}&dev=${encodeURIComponent(dev)}&v=1`);
    const j = await r.json();
    if (!r.ok || !j.enabled) return;
    S = j;
    $('#social').hidden = false;
    try { $('#cn').value = localStorage.name || ''; } catch {}
    $('#react').onclick = async (e) => {
      const b = e.target.closest('[data-e]');
      if (!b) return;
      const x = await send('/api/react', { id, emoji: b.dataset.e, dev });
      if (x.error) return;
      S.react = x.react;
      S.mine = x.on ? [...S.mine, b.dataset.e] : S.mine.filter((y) => y !== b.dataset.e);
      dyn();
    };
    $('#cf').onsubmit = async (e) => {
      e.preventDefault();
      try { localStorage.name = $('#cn').value; } catch {}
      const x = await send('/api/comments', { id, name: $('#cn').value, text: $('#ct').value, dev, website: $('#web').value });
      if (x.error) { $('#ce').textContent = x.error; return; }
      $('#ce').textContent = ''; $('#ct').value = '';
      if (x.id) S.comments.push(x);
      dyn();
    };
    dyn();
  } catch {}
}

MP.then((D) => {
  const p = D.posts.find((x) => x.id === id);
  if (!p) throw new Error('Post not found');
  view(p, D);
  if (D.social) loadSocial();
}).catch((e) => { $('#post').innerHTML = `<p class="err">${esc(e.message)}</p>`; });
