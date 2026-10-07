const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICONS = { pdf: '📕', doc: '📄', docx: '📄', ppt: '📊', pptx: '📊', xls: '📈', xlsx: '📈', zip: '🗜️', mp4: '🎞️', mp3: '🎧' };
let sections = [], posts = [], cur = '', q = '';

const ext = (p) => (p.name || p.url).split('.').pop().toLowerCase().split('?')[0];
const size = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
const ago = (t) => { const d = (Date.now() - t) / 864e5; return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : Math.floor(d) + ' days ago'; };

function card(p) {
  const e = ext(p);
  const sec = sections.find((s) => s.slug === p.section);
  const th = p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : `<span class="ico">${ICONS[e] || '📎'}</span>`;
  return `<a class="card" href="/post?id=${esc(p.id)}">
    <div class="th">${th}${p.pinned ? '<b class="pin" title="Pinned"></b>' : ''}</div>
    <h3>${esc(p.title)}</h3>
    <div class="meta"><span class="tag">${esc(sec ? sec.name : p.section)}</span>${p.subject ? `<span>${esc(p.subject)}</span>` : ''}</div>
    <div class="foot"><span>${esc(e.toUpperCase())} ${size(p.size)}</span><span>${ago(p.createdAt)}</span></div></a>`;
}

function render() {
  $('#chips').innerHTML = [{ slug: '', name: 'All', icon: '✨' }, ...sections]
    .map((s) => `<button class="chip ${s.slug === cur ? 'on' : ''}" data-s="${esc(s.slug)}">${esc(s.icon)} ${esc(s.name)}</button>`).join('');
  const t = q.toLowerCase();
  const list = posts.filter((p) => (!cur || p.section === cur) && (!t || `${p.title} ${p.subject} ${p.description}`.toLowerCase().includes(t)));
  $('#grid').innerHTML = list.map(card).join('') || '<p class="empty">Nothing here yet. Check back soon.</p>';
}

async function load() {
  [sections, posts] = await Promise.all([fetch('/api/sections').then((r) => r.json()), fetch('/api/posts').then((r) => r.json())]);
  cur = decodeURIComponent(location.hash.slice(1));
  render();
}

$('#chips').onclick = (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  cur = b.dataset.s;
  history.replaceState(null, '', cur ? '#' + cur : location.pathname);
  render();
};
$('#q').oninput = (e) => { q = e.target.value; render(); };
load();
