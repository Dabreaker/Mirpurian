import crypto from 'node:crypto';

const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
const sign = (v) => crypto.createHmac('sha256', secret()).update(v).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const COOKIE = 'HttpOnly; Secure; SameSite=Lax; Path=/';

export function isAdmin(req) {
  const m = /(?:^|;\s*)adm=([^;]+)/.exec(req.headers.cookie || '');
  if (!m || !secret()) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  return !!sig && Number(exp) > Date.now() && safeEq(sig, sign(exp));
}

export function setSession(res) {
  const exp = String(Date.now() + 7 * 864e5);
  res.setHeader('Set-Cookie', `adm=${exp}.${sign(exp)}; ${COOKIE}; Max-Age=${7 * 86400}`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `adm=; ${COOKIE}; Max-Age=0`);
}

export function checkPassword(p) {
  const real = process.env.ADMIN_PASSWORD || '';
  return !!real && safeEq(String(p || ''), real);
}
