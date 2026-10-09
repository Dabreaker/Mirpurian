import express from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { list } from '@vercel/blob';
import { Redis } from '@upstash/redis';
import { makeData } from './blobindex.js';

// Comments, reactions and view counts are optional: they switch on when Upstash Redis is connected.
const rUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const rTok = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = rUrl && rTok ? new Redis({ url: rUrl, token: rTok }) : null;
const TTL = Math.max(1, Number(process.env.CACHE_MINUTES) || 30) * 60; // seconds

const app = express();
app.use(express.json({ limit: '20kb' }));

/* ---------- pages (served from the root folder) ---------- */
const serve = (type, body) => (req, res) =>
  res.type(type).set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600').send(body);
app.get('/', serve('html', readFileSync(join(process.cwd(), 'index.html'), 'utf8')));
app.get('/post', serve('html', readFileSync(join(process.cwd(), 'post.html'), 'utf8')));
app.get('/style.css', serve('css', readFileSync(join(process.cwd(), 'style.css'), 'utf8')));
app.get('/ads.js', serve('js', readFileSync(join(process.cwd(), 'ads.js'), 'utf8')));
app.get('/home.js', serve('js', readFileSync(join(process.cwd(), 'home.js'), 'utf8')));
app.get('/post.js', serve('js', readFileSync(join(process.cwd(), 'post.js'), 'utf8')));

/* ---------- site data from Blob (cached to save the free-plan operation limits) ---------- */
const metaCache = new Map(); // pathname -> { sig, json }
async function readJson(b) {
  const v = +new Date(b.uploadedAt);
  const sig = `${v}|${b.size}`;
  const hit = metaCache.get(b.pathname);
  if (hit && hit.sig === sig) return hit.json;
  const r = await fetch(`${b.url}?v=${v}`);
  if (!r.ok) throw new Error(`could not read file (HTTP ${r.status})`);
  const json = await r.json();
  metaCache.set(b.pathname, { sig, json });
  return json;
}
async function listAll() {
  const out = [];
  let cursor;
  do {
    const r = await list({ cursor, limit: 1000 });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}
const mem = { t: 0, data: null, p: null };
async function getData(maxAge = TTL) {
  if (mem.data && (Date.now() - mem.t) / 1000 < maxAge) return mem.data;
  if (!mem.p) {
    mem.p = (async () => {
      const d = await makeData(await listAll(), readJson);
      d.social = !!redis;
      mem.data = d;
      mem.t = Date.now();
      return d;
    })().finally(() => { mem.p = null; });
  }
  try { return await mem.p; } catch (e) { if (mem.data) return mem.data; throw e; }
}
const findPost = async (id) => (await getData(Infinity)).posts.find((p) => p.id === id);

app.get('/api/data', async (req, res) => {
  const d = await getData();
  res.set('Cache-Control', `public, max-age=60, s-maxage=${TTL}, stale-while-revalidate=600`).json(d);
});

/* ---------- downloads, reactions, comments (need Redis) ---------- */
const EMOJI = ['👍', '❤️', '🔥', '😂', '🙏'];
const ipOf = (req) => String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
async function tooMany(req, name, max, secs) {
  const k = `rl:${name}:${ipOf(req)}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, secs);
  return n > max;
}

app.get('/api/dl', async (req, res) => {
  const p = await findPost(String(req.query.id || ''));
  if (!p || !p.file) return res.status(404).send('Not found');
  if (redis) await redis.hincrby('dl', p.id, 1).catch(() => {});
  const u = p.file.url;
  res.redirect(/\.blob\.vercel-storage\.com\//.test(u) ? u + (u.includes('?') ? '&' : '?') + 'download=1' : u);
});

app.get('/api/social', async (req, res) => {
  if (!redis) return res.json({ enabled: false });
  const id = String(req.query.id || '');
  if (!(await findPost(id))) return res.status(404).json({ error: 'Post not found' });
  if (req.query.v) await redis.hincrby('views', id, 1);
  const dev = String(req.query.dev || '').slice(0, 40);
  const [cm, rc, views, dl, mine] = await Promise.all([
    redis.hgetall(`comments:${id}`), redis.hgetall(`react:${id}`), redis.hget('views', id), redis.hget('dl', id),
    Promise.all(EMOJI.map((e) => (dev ? redis.sismember(`rset:${id}`, `${dev}:${e}`) : 0))),
  ]);
  const comments = Object.values(cm || {}).map(({ dev: _d, ...c }) => c).sort((a, b) => a.time - b.time);
  res.set('Cache-Control', 'no-store').json({
    enabled: true, comments, react: rc || {}, views: Number(views) || 0, dl: Number(dl) || 0, mine: EMOJI.filter((e, i) => mine[i]),
  });
});

app.post('/api/react', async (req, res) => {
  if (!redis) return res.status(503).json({ error: 'Not enabled' });
  const { id, emoji, dev } = req.body || {};
  if (!EMOJI.includes(emoji) || !dev || !(await findPost(String(id)))) return res.status(400).json({ error: 'Bad request' });
  if (await tooMany(req, 'r', 30, 60)) return res.status(429).json({ error: 'Slow down' });
  const m = `${String(dev).slice(0, 40)}:${emoji}`;
  const added = await redis.sadd(`rset:${id}`, m);
  if (!added) await redis.srem(`rset:${id}`, m);
  await redis.hincrby(`react:${id}`, emoji, added ? 1 : -1);
  res.json({ react: (await redis.hgetall(`react:${id}`)) || {}, on: !!added });
});

app.post('/api/comments', async (req, res) => {
  if (!redis) return res.status(503).json({ error: 'Not enabled' });
  const { id, name, text, dev, website } = req.body || {};
  if (website) return res.json({ ok: true }); // honeypot
  const t = String(text || '').trim().slice(0, 500);
  const n = String(name || '').trim().slice(0, 30) || 'Anonymous';
  if (!t) return res.status(400).json({ error: 'Write something first' });
  if (/https?:\/\/|www\./i.test(t)) return res.status(400).json({ error: 'Links are not allowed' });
  if (!(await findPost(String(id)))) return res.status(404).json({ error: 'Post not found' });
  if (await tooMany(req, 'c', 5, 60)) return res.status(429).json({ error: 'Slow down, try again in a minute' });
  const cid = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const c = { id: cid, name: n, text: t, time: Date.now(), dev: String(dev || '').slice(0, 40) };
  await redis.hset(`comments:${id}`, { [cid]: c });
  const { dev: _d, ...pub } = c;
  res.json(pub);
});

/* ---------- health: open /api/health to see what is connected (no secrets shown) ---------- */
app.get('/api/health', async (req, res) => {
  const out = { BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN, commentsAndReactions: !!redis, cacheMinutes: TTL / 60 };
  try {
    const d = await getData();
    Object.assign(out, { blobWorks: true, posts: d.posts.length, ads: d.ads.length, warnings: d.warnings });
  } catch (e) {
    out.blobWorks = false;
    out.blobError = String(e.message).slice(0, 200);
  }
  res.set('Cache-Control', 'no-store').json(out);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: String(err.message || err).slice(0, 200) });
});

if (!process.env.VERCEL) app.listen(process.env.PORT || 3000, () => console.log('http://localhost:3000'));
export default app;
