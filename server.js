import express from 'express';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Redis } from '@upstash/redis';
import { del, list } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});
const app = express();
app.use(express.json({ limit: '200kb' }));

/* ---------- front-end files (served from the root folder) ---------- */
const serve = (type, body) => (req, res) =>
  res.type(type).set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600').send(body);
app.get('/', serve('html', readFileSync(join(process.cwd(), 'index.html'), 'utf8')));
app.get('/admin', serve('html', readFileSync(join(process.cwd(), 'admin.html'), 'utf8')));
app.get('/style.css', serve('css', readFileSync(join(process.cwd(), 'style.css'), 'utf8')));
app.get('/home.js', serve('js', readFileSync(join(process.cwd(), 'home.js'), 'utf8')));
app.get('/admin-ui.js', serve('js', readFileSync(join(process.cwd(), 'admin-ui.js'), 'utf8')));
app.get('/post', serve('html', readFileSync(join(process.cwd(), 'post.html'), 'utf8')));
app.get('/post.js', serve('js', readFileSync(join(process.cwd(), 'post.js'), 'utf8')));
app.get('/ads.js', serve('js', readFileSync(join(process.cwd(), 'ads.js'), 'utf8')));

/* ---------- admin session ---------- */
const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
const sign = (v) => crypto.createHmac('sha256', secret()).update(v).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const COOKIE = 'HttpOnly; SameSite=Lax; Path=/' + (process.env.VERCEL ? '; Secure' : '');

function isAdmin(req) {
  const m = /(?:^|;\s*)adm=([^;]+)/.exec(req.headers.cookie || '');
  if (!m || !secret()) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  return !!sig && Number(exp) > Date.now() && safeEq(sig, sign(exp));
}
const admin = (req, res, next) => (isAdmin(req) ? next() : res.status(401).json({ error: 'Unauthorized' }));

app.get('/api/admin/login', (req, res) => res.json({ admin: isAdmin(req) }));
app.delete('/api/admin/login', (req, res) => {
  res.setHeader('Set-Cookie', `adm=; ${COOKIE}; Max-Age=0`);
  res.json({ ok: true });
});
app.post('/api/admin/login', async (req, res) => {
  try {
    const key = `rl:login:${String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim()}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 600);
    if (n > 10) return res.status(429).json({ error: 'Too many attempts. Try again in 10 minutes.' });
  } catch (e) { console.error('login rate limit skipped:', e.message); }

  const real = process.env.ADMIN_PASSWORD || '';
  if (!real || !safeEq(String(req.body?.password || ''), real)) return res.status(401).json({ error: 'Wrong password' });
  const exp = String(Date.now() + 7 * 864e5);
  res.setHeader('Set-Cookie', `adm=${exp}.${sign(exp)}; ${COOKIE}; Max-Age=${7 * 86400}`);
  res.json({ ok: true });
});

/* ---------- Blob client uploads (admin only) ---------- */
app.post('/api/admin/upload', async (req, res) => {
  try {
    res.json(await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async () => {
        if (!isAdmin(req)) throw new Error('Unauthorized');
        return { addRandomSuffix: true, maximumSizeInBytes: 200 * 1024 * 1024 };
      },
      onUploadCompleted: async () => {},
    }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ---------- sections ---------- */
const DEFAULT_SECTIONS = [
  { slug: 'syllabus', name: 'Syllabus', icon: '📘' },
  { slug: 'notes', name: 'Notes', icon: '📝' },
  { slug: 'notice', name: 'Notice', icon: '📢' },
  { slug: 'suggestions', name: 'Suggestions', icon: '💡' },
  { slug: 'others', name: 'Others', icon: '📦' },
];
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

app.get('/api/sections', async (req, res) => {
  res.set('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
  res.json((await redis.get('sections')) || DEFAULT_SECTIONS);
});
app.put('/api/sections', admin, async (req, res) => {
  const list = (Array.isArray(req.body) ? req.body : [])
    .map((s) => ({
      slug: s.slug || slugify(s.name || '') || 's' + Math.random().toString(36).slice(2, 7),
      name: String(s.name || '').trim().slice(0, 40),
      icon: String(s.icon || '📁').slice(0, 4),
    }))
    .filter((s) => s.name);
  await redis.set('sections', list);
  res.json(list);
});

/* ---------- posts ---------- */
const clean = (b) => ({
  title: String(b.title || 'Untitled').slice(0, 120),
  section: String(b.section || 'others').slice(0, 40),
  subject: String(b.subject || '').slice(0, 60),
  description: String(b.description || '').slice(0, 600),
  pinned: !!b.pinned,
});

app.get('/api/posts', async (req, res) => {
  const ids = await redis.zrange('posts', 0, -1, { rev: true });
  let posts = ids.length ? (await redis.mget(...ids.map((i) => `post:${i}`))).filter(Boolean) : [];
  if (req.query.section) posts = posts.filter((p) => p.section === req.query.section);
  posts.sort((a, b) => b.pinned - a.pinned);
  res.set('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
  res.json(posts);
});

app.post('/api/posts', admin, async (req, res) => {
  const b = req.body || {};
  if (!b.url) return res.status(400).json({ error: 'File URL missing' });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const post = {
    id, ...clean(b),
    url: b.url, thumb: b.thumb || '', name: String(b.name || ''),
    size: Number(b.size) || 0, type: String(b.type || ''), createdAt: Date.now(),
  };
  await redis.set(`post:${id}`, post);
  await redis.zadd('posts', { score: post.createdAt, member: id });
  res.json(post);
});

app.patch('/api/posts', admin, async (req, res) => {
  const old = await redis.get(`post:${req.query.id}`);
  if (!old) return res.status(404).json({ error: 'Post not found' });
  const post = { ...old, ...clean({ ...old, ...req.body }) };
  await redis.set(`post:${old.id}`, post);
  res.json(post);
});

app.delete('/api/posts', admin, async (req, res) => {
  const old = await redis.get(`post:${req.query.id}`);
  if (!old) return res.status(404).json({ error: 'Post not found' });
  await del([old.url, old.thumb].filter(Boolean)).catch(() => {});
  await redis.del(`post:${old.id}`);
  await redis.zrem('posts', old.id);
  const ks = await redis.hkeys(`comments:${old.id}`);
  if (ks.length) await redis.zrem('crecent', ...ks.map((k) => `${old.id}|${k}`));
  await redis.del(`comments:${old.id}`, `react:${old.id}`, `rset:${old.id}`);
  await redis.hdel('views', old.id);
  await redis.hdel('dl', old.id);
  res.json({ ok: true });
});

/* ---------- helpers ---------- */
const ipOf = (req) => String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
async function tooMany(req, name, max, secs) {
  const k = `rl:${name}:${ipOf(req)}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, secs);
  return n > max;
}
const banned = async (dev) => !!dev && !!(await redis.sismember('banned', dev));
const EMOJI = ['👍', '❤️', '🔥', '😂', '🙏'];

/* ---------- ads (random 32:9 banner, files in Blob ads/) ---------- */
let adCache = { t: 0, list: [] };
async function adList(force) {
  if (force || Date.now() - adCache.t > 60000) {
    const { blobs } = await list({ prefix: 'ads/', limit: 1000 });
    adCache = { t: Date.now(), list: blobs.map((b) => ({ url: b.url, name: b.pathname.replace(/^ads\//, ''), size: b.size })) };
  }
  return adCache.list;
}
app.get('/api/ad', async (req, res) => {
  const l = await adList();
  res.set('Cache-Control', 'no-store').json({ url: l.length ? l[Math.floor(Math.random() * l.length)].url : '' });
});
app.get('/api/ads', admin, async (req, res) => res.json(await adList(true)));
app.delete('/api/ads', admin, async (req, res) => {
  const u = String(req.query.url || '');
  if (!u.includes('/ads/')) return res.status(400).json({ error: 'Not an ad file' });
  await del(u);
  adCache.t = 0;
  res.json({ ok: true });
});

/* ---------- single post, downloads, reactions, comments ---------- */
app.get('/api/post', async (req, res) => {
  const id = String(req.query.id || '');
  const post = await redis.get(`post:${id}`);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (req.query.v) await redis.hincrby('views', id, 1);
  const dev = String(req.query.dev || '');
  const [cm, rc, views, dl, mine] = await Promise.all([
    redis.hgetall(`comments:${id}`), redis.hgetall(`react:${id}`), redis.hget('views', id), redis.hget('dl', id),
    Promise.all(EMOJI.map((e) => (dev ? redis.sismember(`rset:${id}`, `${dev}:${e}`) : 0))),
  ]);
  const comments = Object.values(cm || {}).map(({ dev: _d, ...c }) => c).sort((a, b) => a.time - b.time);
  res.set('Cache-Control', 'no-store').json({ post, comments, react: rc || {}, views: Number(views) || 0, dl: Number(dl) || 0, mine: EMOJI.filter((e, i) => mine[i]) });
});

app.get('/api/dl', async (req, res) => {
  const p = await redis.get(`post:${req.query.id}`);
  if (!p) return res.status(404).send('Not found');
  await redis.hincrby('dl', p.id, 1);
  res.redirect(p.url + (p.url.includes('?') ? '&' : '?') + 'download=1');
});

app.post('/api/react', async (req, res) => {
  const { id, emoji, dev } = req.body || {};
  if (!EMOJI.includes(emoji) || !dev || !(await redis.exists(`post:${id}`))) return res.status(400).json({ error: 'Bad request' });
  if (await banned(String(dev))) return res.status(403).json({ error: 'Blocked' });
  if (await tooMany(req, 'r', 30, 60)) return res.status(429).json({ error: 'Slow down' });
  const m = `${String(dev).slice(0, 40)}:${emoji}`;
  const added = await redis.sadd(`rset:${id}`, m);
  if (!added) await redis.srem(`rset:${id}`, m);
  await redis.hincrby(`react:${id}`, emoji, added ? 1 : -1);
  res.json({ react: (await redis.hgetall(`react:${id}`)) || {}, on: !!added });
});

app.post('/api/comments', async (req, res) => {
  const { id, name, text, dev, website } = req.body || {};
  if (website) return res.json({ ok: true });
  const t = String(text || '').trim().slice(0, 500);
  const n = String(name || '').trim().slice(0, 30) || 'Anonymous';
  if (!t) return res.status(400).json({ error: 'Write something first' });
  if (/https?:\/\/|www\./i.test(t)) return res.status(400).json({ error: 'Links are not allowed' });
  if (!(await redis.exists(`post:${id}`))) return res.status(404).json({ error: 'Post not found' });
  if (await banned(String(dev || ''))) return res.status(403).json({ error: 'You cannot comment' });
  if (await tooMany(req, 'c', 5, 60)) return res.status(429).json({ error: 'Slow down, try again in a minute' });
  const cid = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const c = { id: cid, name: n, text: t, time: Date.now(), dev: String(dev || '').slice(0, 40) };
  await redis.hset(`comments:${id}`, { [cid]: c });
  await redis.zadd('crecent', { score: c.time, member: `${id}|${cid}` });
  const { dev: _d, ...pub } = c;
  res.json(pub);
});

/* ---------- admin: moderation + stats ---------- */
app.get('/api/admin/comments', admin, async (req, res) => {
  const ms = await redis.zrange('crecent', 0, 49, { rev: true });
  const rows = await Promise.all(ms.map(async (m) => {
    const [pid, cid] = String(m).split('|');
    const c = await redis.hget(`comments:${pid}`, cid);
    return c && { ...c, pid };
  }));
  res.json(rows.filter(Boolean));
});
app.delete('/api/admin/comments', admin, async (req, res) => {
  const { pid, cid } = req.query;
  await redis.hdel(`comments:${pid}`, String(cid));
  await redis.zrem('crecent', `${pid}|${cid}`);
  res.json({ ok: true });
});
app.get('/api/admin/bans', admin, async (req, res) => res.json(await redis.smembers('banned')));
app.post('/api/admin/bans', admin, async (req, res) => { await redis.sadd('banned', String(req.body?.dev || '')); res.json({ ok: true }); });
app.delete('/api/admin/bans', admin, async (req, res) => { await redis.srem('banned', String(req.query.dev || '')); res.json({ ok: true }); });

app.get('/api/admin/stats', admin, async (req, res) => {
  const [views, dl, posts, comments] = await Promise.all([redis.hgetall('views'), redis.hgetall('dl'), redis.zcard('posts'), redis.zcard('crecent')]);
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + Number(b), 0);
  res.json({ posts, comments, views: views || {}, dl: dl || {}, totalViews: sum(views), totalDl: sum(dl) });
});

/* open /api/health in a browser to see what is connected (no secrets shown) */
app.get('/api/health', async (req, res) => {
  const out = {
    ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD,
    BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
    REDIS_URL: !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL),
    REDIS_TOKEN: !!(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN),
  };
  try { await redis.ping(); out.redisWorks = true; } catch (e) { out.redisWorks = false; out.redisError = String(e.message).slice(0, 120); }
  try { await list({ limit: 1 }); out.blobWorks = true; } catch (e) { out.blobWorks = false; out.blobError = String(e.message).slice(0, 120); }
  res.set('Cache-Control', 'no-store').json(out);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error: ' + String(err.message || err).slice(0, 160) });
});

if (!process.env.VERCEL) app.listen(process.env.PORT || 3000, () => console.log('http://localhost:3000'));
export default app;
