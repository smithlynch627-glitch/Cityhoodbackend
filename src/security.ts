import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { IS_PROD, SESSION_SECRET } from './config';

/* ------------------------------------------------------------------ secrets */
const SECRET = SESSION_SECRET || randomBytes(32).toString('hex');
if (!SESSION_SECRET) {
  if (IS_PROD) console.warn('[security] SESSION_SECRET is not set — sessions will reset on every restart. Set it on Railway.');
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const hmac = (data: string, purpose: string) => createHmac('sha256', `${SECRET}:${purpose}`).update(data).digest('base64url');

export const sha256 = (s: string) => createHash('sha256').update(s).digest();
export function safeEqual(a: string, b: string) {
  return timingSafeEqual(sha256(a), sha256(b));
}

/* ------------------------------------------------------------------ tokens (compact JWT-like, HS256) */
export type Scope = 'user' | 'admin' | 'grab' | 'login';

export function signToken(scope: Scope, payload: Record<string, unknown>, ttlSec: number) {
  const body = b64u(JSON.stringify({ ...payload, scope, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  return `${body}.${hmac(body, scope)}`;
}

export function verifyToken<T = Record<string, unknown>>(scope: Scope, token: string | undefined | null): (T & { exp: number }) | null {
  if (!token || typeof token !== 'string' || token.length > 4096) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = hmac(body, scope);
  if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p.scope !== scope || typeof p.exp !== 'number' || p.exp < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}

export function bearer(req: Request) {
  const h = String(req.headers.authorization ?? '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

/* ------------------------------------------------------------------ random */
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function randomCode(len = 6, alphabet = ALPHA) {
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}
/** 6-digit numeric code with no leading zero (100000–999999), from a CSPRNG. */
export const sixDigits = () => String(randomInt(100000, 1000000));
export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

/* ------------------------------------------------------------------ rate limiting */
const buckets = new Map<string, { n: number; reset: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

/** Fixed-window counter. Returns false when `key` exceeded `limit` within `windowMs`. */
export function allow(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  b.n++;
  return b.n <= limit;
}
/** How many hits `key` has in its current window (without adding one). */
export function hits(key: string) {
  const b = buckets.get(key);
  return b && b.reset >= Date.now() ? b.n : 0;
}
export function retryAfter(key: string) {
  const b = buckets.get(key);
  return b ? Math.max(1, Math.ceil((b.reset - Date.now()) / 1000)) : 0;
}

/**
 * The visitor's IP, for rate limits. Behind Railway, `req.ip` with `trust proxy = 1` can be one of Railway's own
 * proxy hops, which would make every visitor look like the same person. Railway's edge removes any
 * X-Forwarded-For a client sends and puts the real client first, so on Railway (or with TRUST_PROXY_HEADERS=1)
 * the first entry is used. IPv6 visitors are grouped by their /64 network, since one device can rotate addresses
 * inside it. Anywhere else the direct connection address is used, because the headers could be faked there.
 */
const TRUST_HEADERS = !!process.env.RAILWAY_ENVIRONMENT || process.env.TRUST_PROXY_HEADERS === '1';
export function clientIp(req: Request) {
  let ip = '';
  if (TRUST_HEADERS) {
    const first = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    const real = String(req.headers['x-real-ip'] ?? '').trim();
    ip = isIP(first) ? first : isIP(real) ? real : '';
  }
  if (!ip) ip = req.socket.remoteAddress || req.ip || 'unknown';
  ip = ip.replace(/^::ffff:/, '');
  if (isIP(ip) === 6) ip = `${ipv6Groups(ip).slice(0, 4).join(':')}::/64`;
  return ip;
}
/** the 8 groups of an IPv6 address, with :: expanded */
function ipv6Groups(ip: string) {
  const [head, tail = ''] = ip.split('::');
  const a = head ? head.split(':') : [];
  const b = ip.includes('::') && tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  return groups.map((g) => (g.includes('.') ? g : g.replace(/^0+(?=.)/, '').toLowerCase()));
}

/** Express middleware: `limit` requests per `windowMs` per IP for this route group. */
export function rateLimit(name: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${name}:${clientIp(req)}`;
    if (!allow(key, limit, windowMs)) {
      res.set('Retry-After', String(retryAfter(key)));
      return res.status(429).json({ error: 'Too many requests. Slow down and try again in a moment.' });
    }
    next();
  };
}

/* ------------------------------------------------------------------ errors */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export const bad = (msg: string) => new HttpError(400, msg);
export const unauthorized = (msg = 'Sign in first.') => new HttpError(401, msg);
export const forbidden = (msg = 'Not allowed.') => new HttpError(403, msg);
export const notFound = (msg = 'Not found.') => new HttpError(404, msg);

export const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/* ------------------------------------------------------------------ input helpers */
export const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const int = (v: unknown, def: number, min: number, max: number) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
export const bool = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';
export function httpUrl(v: unknown): string | null {
  const s = str(v, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
