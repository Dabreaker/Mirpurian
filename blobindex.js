// Turns the list of files in the Blob store (plus their .json metadata files) into the site data.
const IMG = /\.(png|jpe?g|gif|webp|avif)$/i;
const AD = /(^|\/)ads?[\/_-]/i;
const slug = (s) => String(s || '').toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
const nice = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const isUrl = (u) => /^https?:\/\//i.test(u);

export const DEFAULT_SECTIONS = [
  { id: 'syllabus', name: 'Syllabus', icon: '📘' },
  { id: 'notes', name: 'Notes', icon: '📝' },
  { id: 'notice', name: 'Notice', icon: '📢' },
  { id: 'suggestions', name: 'Suggestions', icon: '💡' },
  { id: 'others', name: 'Others', icon: '📦' },
];

export async function makeData(blobs, readJson) {
  const byPath = new Map(blobs.map((b) => [b.pathname, b]));
  const warnings = [];
  let site = {};
  if (byPath.has('site.json')) {
    try { site = (await readJson(byPath.get('site.json'))) || {}; } catch (e) { warnings.push('site.json: ' + e.message); }
  }
  const ads = blobs.filter((b) => IMG.test(b.pathname) && AD.test(b.pathname)).map((b) => b.url);
  const metas = blobs.filter((b) => /\.json$/i.test(b.pathname) && b.pathname !== 'site.json');
  const posts = [];

  await Promise.all(metas.map(async (b) => {
    try {
      const m = await readJson(b);
      if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('must be a JSON object');
      if (m.hidden) return;
      const dir = b.pathname.slice(0, b.pathname.lastIndexOf('/') + 1);
      const base = b.pathname.replace(/\.json$/i, '');
      const find = (p) => {
        if (!p) return null;
        const s = String(p);
        if (isUrl(s)) return { url: s };
        return byPath.get(s.startsWith('/') ? s.slice(1) : dir + s) || null;
      };
      let f = find(m.file);
      if (m.file && !f) warnings.push(`${b.pathname}: file "${m.file}" was not found in the store`);
      if (!m.file) f = blobs.find((x) => x.pathname.startsWith(base + '.') && !/\.json$/i.test(x.pathname) && !/\.thumb\./i.test(x.pathname)) || null;
      let t = find(m.thumb);
      if (m.thumb && !t) warnings.push(`${b.pathname}: thumb "${m.thumb}" was not found in the store`);
      if (!t) t = blobs.find((x) => x.pathname.startsWith(base + '.thumb.') && IMG.test(x.pathname)) || null;

      const name = f && f.pathname ? f.pathname.split('/').pop() : '';
      const ext = f ? (f.pathname ? name.split('.').pop().toLowerCase() : 'link') : '';
      posts.push({
        id: base,
        title: String(m.title || (name ? nice(name.replace(/\.[^.]+$/, '')) : nice(base.split('/').pop()))).slice(0, 140),
        section: slug(m.section) || 'others',
        subject: String(m.subject || '').slice(0, 60),
        description: String(m.description || '').slice(0, 2000),
        tags: Array.isArray(m.tags) ? m.tags.map((x) => String(x).slice(0, 24)).slice(0, 8) : [],
        pinned: !!m.pinned,
        date: Date.parse(m.date) || +new Date(b.uploadedAt),
        file: f ? { url: f.url, name, ext, size: f.size || 0 } : null,
        thumb: t ? t.url : f && f.pathname && IMG.test(name) ? f.url : '',
      });
    } catch (e) {
      warnings.push(`${b.pathname}: ${e.message}`);
    }
  }));

  posts.sort((a, b) => b.pinned - a.pinned || b.date - a.date);

  const cfg = Array.isArray(site.sections) && site.sections.length ? site.sections : DEFAULT_SECTIONS;
  const sections = cfg
    .map((s) => ({ id: slug(s.id || s.name), name: String(s.name || s.id || '').slice(0, 40), icon: String(s.icon || '📁').slice(0, 4) }))
    .filter((s) => s.id && s.name);
  for (const p of posts) if (!sections.some((s) => s.id === p.section)) sections.push({ id: p.section, name: nice(p.section), icon: '📁' });

  return { site: { title: String(site.title || 'MIRPURIAN').slice(0, 40) }, sections, posts, ads, warnings, built: Date.now() };
}
