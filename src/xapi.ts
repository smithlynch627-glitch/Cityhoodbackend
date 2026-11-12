import { createHash, randomBytes } from 'node:crypto';
import { X_BEARER_TOKEN, X_CALLBACK_URL, X_CLIENT_ID, X_CLIENT_SECRET } from './config';

/* ------------------------------------------------------------------ OAuth 2.0 (PKCE) */
export const X_LOGIN_READY = !!(X_CLIENT_ID && X_CALLBACK_URL);
// Only what's needed to know who you are. CITYHOOD never posts, and never reads your DMs or followers.
const SCOPES = ['tweet.read', 'users.read'];

export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authorizeUrl(state: string, challenge: string) {
  const u = new URL('https://x.com/i/oauth2/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', X_CLIENT_ID);
  u.searchParams.set('redirect_uri', X_CALLBACK_URL);
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export interface XUser {
  id: string;
  username: string;
  name: string;
  profile_image_url?: string;
  created_at?: string;
  public_metrics?: { followers_count: number; following_count: number; tweet_count: number };
}

async function xfetch(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), init.timeoutMs ?? 12_000);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Exchanges the OAuth code for a short-lived token, reads the profile, then revokes the token. */
export async function finishLogin(code: string, verifier: string): Promise<XUser> {
  const body = new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: X_CALLBACK_URL, code_verifier: verifier, client_id: X_CLIENT_ID });
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (X_CLIENT_SECRET) headers.Authorization = `Basic ${Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64')}`;
  const tr = await xfetch('https://api.x.com/2/oauth2/token', { method: 'POST', headers, body });
  const tj = (await tr.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!tr.ok || !tj.access_token) throw new Error(`X sign-in failed: ${tj.error_description ?? tr.status}`);
  const ur = await xfetch('https://api.x.com/2/users/me?user.fields=profile_image_url,created_at,public_metrics', {
    headers: { Authorization: `Bearer ${tj.access_token}` },
  });
  const uj = (await ur.json().catch(() => ({}))) as { data?: XUser };
  if (!ur.ok || !uj.data?.id) throw new Error(`Couldn't read your X profile (${ur.status}).`);
  // we don't keep X tokens
  void xfetch('https://api.x.com/2/oauth2/revoke', {
    method: 'POST',
    headers,
    body: new URLSearchParams({ token: tj.access_token, token_type_hint: 'access_token', client_id: X_CLIENT_ID }),
  }).catch(() => {});
  return uj.data;
}

/* ------------------------------------------------------------------ X API checks (app bearer token) */
export const X_API_READY = !!X_BEARER_TOKEN;
export type Check = 'yes' | 'no' | 'unavailable';

async function api<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  if (!X_BEARER_TOKEN) return { ok: false, status: 0 };
  try {
    const r = await xfetch(`https://api.x.com/2${path}`, { headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` } });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, data: (await r.json()) as T };
  } catch {
    return { ok: false, status: 599 };
  }
}

/** Walks up to `pages` pages of a user list looking for `userId`. */
async function inList(path: string, userId: string, pages = 5): Promise<Check> {
  let token = '';
  for (let i = 0; i < pages; i++) {
    const r = await api<{ data?: { id: string }[]; meta?: { next_token?: string } }>(`${path}${path.includes('?') ? '&' : '?'}max_results=100${token ? `&pagination_token=${token}` : ''}`);
    if (!r.ok) return 'unavailable';
    if (r.data.data?.some((u) => u.id === userId)) return 'yes';
    token = r.data.meta?.next_token ?? '';
    if (!token) return 'no';
  }
  return 'no';
}

export const checkRepost = (tweetId: string, userId: string) => inList(`/tweets/${tweetId}/retweeted_by`, userId);
export const checkLike = (tweetId: string, userId: string) => inList(`/tweets/${tweetId}/liking_users`, userId);

export async function checkFollow(userId: string, handle: string): Promise<Check> {
  const t = await api<{ data?: { id: string } }>(`/users/by/username/${encodeURIComponent(handle)}`);
  if (!t.ok || !t.data.data) return 'unavailable';
  const target = t.data.data.id;
  let token = '';
  for (let i = 0; i < 5; i++) {
    const r = await api<{ data?: { id: string }[]; meta?: { next_token?: string } }>(
      `/users/${userId}/following?max_results=1000${token ? `&pagination_token=${token}` : ''}`,
    );
    if (!r.ok) return 'unavailable';
    if (r.data.data?.some((u) => u.id === target)) return 'yes';
    token = r.data.meta?.next_token ?? '';
    if (!token) return 'no';
  }
  return 'no';
}

export interface TweetInfo {
  id: string;
  author_id: string;
  text: string;
  referenced_tweets?: { type: 'quoted' | 'replied_to' | 'retweeted'; id: string }[];
}
export async function lookupTweet(id: string): Promise<TweetInfo | 'missing' | 'unavailable'> {
  const r = await api<{ data?: TweetInfo }>(`/tweets/${id}?tweet.fields=author_id,referenced_tweets,text`);
  if (!r.ok) return r.status === 404 ? 'missing' : 'unavailable';
  return r.data.data ?? 'missing';
}

/* ------------------------------------------------------------------ links */
/** Parses https://x.com/<handle>/status/<id> (also twitter.com, mobile, ?s= params). */
export function parseTweetUrl(url: string): { handle: string; id: string } | null {
  const m = url.trim().match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})(?:[/?#].*)?$/i);
  return m ? { handle: m[1], id: m[2] } : null;
}
export const tweetIdOf = (url?: string | null) => (url ? parseTweetUrl(url)?.id ?? null : null);
