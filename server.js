import express from 'express';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Redis } from '@upstash/redis';
import { del } from '@vercel/blob';
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
  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const key = `rl:login:${ip}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 600);
  if (n > 10) return res.status(429).json({ error: 'Too many attempts. Try again in 10 minutes.' });

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
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

if (!process.env.VERCEL) app.listen(process.env.PORT || 3000, () => console.log('http://localhost:3000'));
export default app;
