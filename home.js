const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICONS = { pdf: '📕', doc: '📄', docx: '📄', ppt: '📊', pptx: '📊', xls: '📈', xlsx: '📈', zip: '🗜️', mp4: '🎞️', mp3: '🎧', txt: '📃', link: '🔗' };
const size = (n) => (!n ? '' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
const fmt = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
let D, cur = decodeURIComponent(location.hash.slice(1)), q = '';

function card(p) {
  const sec = D.sections.find((s) => s.id === p.section);
  const f = p.file;
  const th = p.thumb
    ? `<img src="${esc(p.thumb)}" alt="" loading="lazy" decoding="async">`
    : `<span class="ico">${f ? ICONS[f.ext] || '📎' : '📝'}</span>`;
  return `<a class="card" href="/post?id=${encodeURIComponent(p.id)}">
    <div class="th">${th}${p.pinned ? '<b class="pin" title="Pinned"></b>' : ''}</div>
    <h3>${esc(p.title)}</h3>
    <div class="meta"><span class="tag">${esc(sec ? sec.name : p.section)}</span>${p.subject ? `<span>${esc(p.subject)}</span>` : ''}</div>
    <div class="foot"><span>${f ? esc(f.ext.toUpperCase()) + ' ' + size(f.size) : 'Post'}</span><span>${fmt(p.date)}</span></div></a>`;
}

function render() {
  const counts = {};
  D.posts.forEach((p) => { counts[p.section] = (counts[p.section] || 0) + 1; });
  const secs = D.sections.filter((s) => counts[s.id]);
  $('#chips').innerHTML = [{ id: '', name: 'All', icon: '✨' }, ...secs]
    .map((s) => `<button class="chip ${s.id === cur ? 'on' : ''}" data-s="${esc(s.id)}">${esc(s.icon)} ${esc(s.name)}${s.id ? ' ' + counts[s.id] : ''}</button>`).join('');
  const t = q.toLowerCase();
  const list = D.posts.filter((p) => (!cur || p.section === cur) && (!t || [p.title, p.subject, p.description, p.tags.join(' ')].join(' ').toLowerCase().includes(t)));
  $('#grid').innerHTML = list.map(card).join('') || `<p class="empty">${D.posts.length ? 'No matches.' : 'No posts yet.'}</p>`;
}

$('#chips').onclick = (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  cur = b.dataset.s;
  history.replaceState(null, '', cur ? '#' + cur : location.pathname);
  render();
};
$('#q').oninput = (e) => { q = e.target.value; render(); };

MP.then((d) => {
  D = d;
  if (d.warnings.length) console.warn('MIRPURIAN metadata warnings:', d.warnings);
  render();
}).catch((e) => { $('#grid').innerHTML = `<p class="err">${esc(e.message)}</p>`; });
