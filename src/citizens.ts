import { Router, type Request, type Response } from 'express';
import { getAddress, isAddress } from 'viem';
import { db } from './db';
import { TtlCache } from './cache';
import { IS_PROD, PUBLIC_API_URL, SITE_URL } from './config';
import { getSettings, publicSettings, type Settings } from './settings';
import { generateCodes } from './codes';
import {
  bad, bearer, forbidden, notFound, randomCode, randomToken, rateLimit, signToken, str, unauthorized, verifyToken, wrap, HttpError,
} from './security';
import { authorizeUrl, finishLogin, parseTweetUrl, pkce, tweetIdOf, X_API_READY, X_LOGIN_READY } from './xapi';

/* ================================================================== types */
export type UserStatus = 'pending' | 'citizen' | 'rejected' | 'banned';
export interface User {
  id: string;
  x_id: string;
  username: string;
  name: string | null;
  avatar_url: string | null;
  followers: number | null;
  account_created_at: string | null;
  referral_code: string;
  referred_by: string | null;
  points: number;
  wallet_address: string | null;
  status: UserStatus;
  citizen_no: number | null;
  tier: string | null;
  admin_note: string | null;
  grab_code: string | null;
  approved_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at?: string;
}
export type TaskKind = 'follow' | 'like' | 'repost' | 'engage' | 'quote' | 'reply' | 'post' | 'art' | 'daily' | 'visit' | 'custom';
export type VerifyMode = 'auto' | 'review' | 'x_api';
export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  description: string;
  points: number;
  target_url: string | null;
  x_handle: string | null;
  verify_mode: VerifyMode;
  verify_after_hours: number;
  requires_link: boolean;
  required_text: string | null;
  active: boolean;
  sort: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}
export interface Submission {
  id: string;
  user_id: string;
  task_id: string;
  status: 'pending' | 'in_review' | 'verified' | 'rejected';
  tweet_url: string | null;
  tweet_id: string | null;
  verify_at: string | null;
  points_awarded: number;
  review_note: string | null;
  created_at: string;
  updated_at?: string;
}

export const TASK_KINDS: TaskKind[] = ['follow', 'like', 'repost', 'engage', 'quote', 'reply', 'post', 'art', 'daily', 'visit', 'custom'];
export const LINK_KINDS: TaskKind[] = ['quote', 'reply', 'post', 'art'];

/* ================================================================== helpers */
const nowIso = () => new Date().toISOString();

export async function userFromReq(req: Request): Promise<User | null> {
  const t = verifyToken<{ uid: string }>('user', bearer(req));
  if (!t) return null;
  return db.one<User>('users', { id: t.uid });
}
async function requireUser(req: Request) {
  const u = await userFromReq(req);
  if (!u) throw unauthorized('Connect X first.');
  if (u.status === 'banned') throw forbidden('This account is blocked from CITYHOOD tasks.');
  return u;
}

/* Short shared caches keep the dashboard cheap when thousands of people have it open at once. */
const ranks = new TtlCache<number>(5000);
const refInfo = new TtlCache<{ count: number; applied: { code: string; referrer_id: string } | null; referrer: string | null }>(20000);

function rankOf(points: number) {
  if (points <= 0) return Promise.resolve(0);
  // everyone with the same points has the same rank, so this is shared between them
  return ranks.get(String(points), 20_000, async () => (await db.count('users', { points: { gt: points }, status: { neq: 'banned' } })) + 1);
}

function referralInfo(userId: string) {
  return refInfo.get(userId, 30_000, async () => {
    const [count, applied] = await Promise.all([db.count('referrals', { referrer_id: userId }), db.one<{ code: string; referrer_id: string }>('referrals', { referee_id: userId })]);
    const referrer = applied ? ((await db.one<User>('users', { id: applied.referrer_id }))?.username ?? null) : null;
    return { count, applied, referrer };
  });
}

async function uniqueReferralCode() {
  for (let i = 0; i < 20; i++) {
    const c = randomCode(6);
    if (!(await db.one('users', { referral_code: c }))) return c;
  }
  throw new Error('could not allocate a referral code');
}

export async function profileOf(u: User, s?: Settings) {
  s ??= await getSettings();
  const [rank, ref] = await Promise.all([rankOf(u.points), referralInfo(u.id)]);
  const referralCount = ref.count;
  const applied = ref.applied;
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    avatar_url: u.avatar_url,
    points: u.points,
    rank,
    referral_code: u.referral_code,
    referral_count: referralCount,
    referral_points: s.referral_points,
    milestones: s.milestones.map((m) => ({ ...m, reached: referralCount >= m.need })),
    applied_referral: applied ? { code: applied.code, username: ref.referrer ?? 'someone' } : null,
    wallet_address: u.wallet_address,
    wallet_edits_open: s.wallet_edits_open,
    registration_open: s.citizenship_open,
    status: u.status,
    citizen_no: u.citizen_no,
    tier: u.tier,
    grab_code: u.status === 'citizen' ? u.grab_code : null,
    approved_at: u.approved_at,
    share_url: u.status === 'citizen' ? `${PUBLIC_API_URL}/c/${encodeURIComponent(u.username)}` : null,
    card_url: u.status === 'citizen' ? `${PUBLIC_API_URL}/api/citizen/card/${encodeURIComponent(u.username)}.png` : null,
  };
}

async function award(userId: string, points: number) {
  if (points) await db.addPoints(userId, points);
}

/** Referrer bonuses when they hit 3 / 10 / 25 … referrals (each paid once). */
async function payMilestones(referrerId: string, s: Settings) {
  const n = await db.count('referrals', { referrer_id: referrerId });
  for (const m of s.milestones) {
    if (n < m.need) continue;
    const paid = await db.one('bonuses', { user_id: referrerId, need: m.need });
    if (paid) continue;
    try {
      await db.insert('bonuses', { user_id: referrerId, need: m.need, bonus: m.bonus });
      await award(referrerId, m.bonus);
    } catch {
      /* unique (user_id, need) — already paid by a parallel request */
    }
  }
}

export async function applyReferral(user: User, code: string, s: Settings) {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(clean)) throw bad('Refer codes are 6 letters and numbers.');
  if (clean === user.referral_code) throw bad('You cannot use your own refer code.');
  // stop farming with fresh throwaway X accounts
  const days = user.account_created_at ? (Date.now() - Date.parse(user.account_created_at)) / 86_400_000 : Infinity;
  if (s.referral_min_account_days > 0 && days < s.referral_min_account_days) throw bad(`Refer codes need an X account at least ${s.referral_min_account_days} days old.`);
  if (s.referral_min_followers > 0 && user.followers !== null && user.followers < s.referral_min_followers) throw bad(`Refer codes need an X account with at least ${s.referral_min_followers} followers.`);
  if (await db.one('referrals', { referee_id: user.id })) throw bad('You already used a refer code.');
  const ref = await db.one<User>('users', { referral_code: clean });
  if (!ref || ref.status === 'banned') throw bad('That refer code does not exist.');
  if (ref.referred_by === user.id) throw bad('You two already referred each other the other way round.');
  try {
    await db.insert('referrals', { referrer_id: ref.id, referee_id: user.id, code: clean, points: s.referral_points });
    refInfo.delete(ref.id);
    refInfo.delete(user.id);
  } catch {
    throw bad('You already used a refer code.');
  }
  await db.update('users', { id: user.id }, { referred_by: ref.id, updated_at: nowIso() });
  await Promise.all([award(ref.id, s.referral_points), award(user.id, s.referral_points)]);
  await payMilestones(ref.id, s);
  return { referrer: ref.username, points: s.referral_points };
}

/** Admin: approve / reject / ban. Approval assigns a citizen number and (optionally) a Grab Land code. */
export async function setStatus(userId: string, status: UserStatus, opts: { tier?: string | null; note?: string | null } = {}) {
  const u = await db.one<User>('users', { id: userId });
  if (!u) throw notFound('User not found.');
  const s = await getSettings();
  const patch: Partial<User> = { status, updated_at: nowIso() };
  if (opts.tier !== undefined) patch.tier = opts.tier;
  if (opts.note !== undefined) patch.admin_note = opts.note;
  if (status === 'citizen') {
    if (!u.citizen_no) patch.citizen_no = await db.nextCitizenNo();
    if (!u.approved_at) patch.approved_at = nowIso();
    if (!u.grab_code && s.auto_code_for_citizens) {
      const [c] = await generateCodes(1, `@${u.username}`, 'citizens', u.id);
      if (c) patch.grab_code = c.code;
    }
  }
  const [out] = await db.update<User>('users', { id: userId }, patch as Record<string, unknown>);
  return out;
}

/* ================================================================== default tasks */
export async function seedTasks() {
  if ((await db.count('tasks')) > 0) return;
  const s = await getSettings();
  const h = s.x_handle;
  const base = { active: true, starts_at: null, ends_at: null, required_text: null };
  await db.insert('tasks', [
    { ...base, sort: 1, kind: 'follow', title: `Follow @${h}`, description: `Follow the official CITYHOOD account on X.`, points: 50, x_handle: h, target_url: null, verify_mode: 'auto', verify_after_hours: 12, requires_link: false },
    { ...base, sort: 2, kind: 'engage', title: 'Like, repost and reply to the pinned post', description: 'Open the post and do all three. Show the city some love.', points: 100, x_handle: h, target_url: null, verify_mode: 'auto', verify_after_hours: 12, requires_link: false },
    { ...base, sort: 3, kind: 'quote', title: 'Quote the pinned post', description: 'Quote the post in your own words, then paste the link to your quote.', points: 150, x_handle: h, target_url: null, verify_mode: 'review', verify_after_hours: 0, requires_link: true },
    { ...base, sort: 4, kind: 'art', title: 'Draw your dream island', description: 'Make CITYHOOD art, post it on X and submit the link. The team reviews every piece.', points: 500, x_handle: h, target_url: null, verify_mode: 'review', verify_after_hours: 0, requires_link: true },
    { ...base, sort: 5, kind: 'post', title: 'Write a post about CITYHOOD', description: 'Tell your followers why you want a land in the sky. Submit the link.', points: 300, x_handle: h, target_url: null, verify_mode: 'review', verify_after_hours: 0, requires_link: true, required_text: null },
  ]);
}

/* ================================================================== router */
export const citizens = Router();
const usedLogins = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of usedLogins) if (exp < now) usedLogins.delete(k);
}, 60_000).unref();

const cookie = (res: Response, name: string, value: string, maxAge: number) =>
  res.append(
    'Set-Cookie',
    `${name}=${value}; Path=/api/x; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${IS_PROD || PUBLIC_API_URL.startsWith('https') ? '; Secure' : ''}`,
  );
const readCookie = (req: Request, name: string) => {
  const m = String(req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
};
const back = (res: Response, hash: string) => res.redirect(302, `${SITE_URL}/citizenship#${hash}`);

/** Step 1: send the browser to X. */
citizens.get('/api/x/login', rateLimit('xlogin', 30, 10 * 60_000), (req, res) => {
  if (!X_LOGIN_READY) return back(res, 'error=' + encodeURIComponent('X login is not configured on the server yet.'));
  const { verifier, challenge } = pkce();
  const state = randomToken(16);
  const ref = str(req.query.ref, 6).toUpperCase().replace(/[^A-Z0-9]/g, '');
  cookie(res, 'chx', signToken('login', { st: state, v: verifier, ref }, 600), 600);
  res.redirect(302, authorizeUrl(state, challenge));
});

/** Step 2: X sends the browser back here. */
citizens.get(
  '/api/x/callback',
  rateLimit('xcb', 30, 10 * 60_000),
  wrap(async (req, res) => {
    const c = verifyToken<{ st: string; v: string; ref: string }>('login', readCookie(req, 'chx'));
    cookie(res, 'chx', '', 0);
    if (req.query.error) return back(res, 'error=' + encodeURIComponent('X sign-in was cancelled.'));
    if (!c || str(req.query.state, 100) !== c.st) return back(res, 'error=' + encodeURIComponent('Your sign-in expired. Try Connect X again.'));
    let xu;
    try {
      xu = await finishLogin(str(req.query.code, 500), c.v);
    } catch (e) {
      return back(res, 'error=' + encodeURIComponent(e instanceof Error ? e.message : 'X sign-in failed.'));
    }
    const s = await getSettings();
    const avatar = xu.profile_image_url ? xu.profile_image_url.replace('_normal.', '_400x400.') : null;
    let u = await db.one<User>('users', { x_id: xu.id });
    const meta = {
      username: xu.username,
      name: xu.name,
      avatar_url: avatar,
      followers: xu.public_metrics?.followers_count ?? null,
      account_created_at: xu.created_at ?? null,
      last_login_at: nowIso(),
      updated_at: nowIso(),
    };
    if (u) {
      [u] = await db.update<User>('users', { id: u.id }, meta);
    } else {
      if (!s.citizenship_open) return back(res, 'error=' + encodeURIComponent('Citizenship registration is closed right now.'));
      [u] = await db.insert<User>('users', {
        x_id: xu.id,
        ...meta,
        referral_code: await uniqueReferralCode(),
        referred_by: null,
        points: 0,
        wallet_address: null,
        status: 'pending',
        citizen_no: null,
        tier: null,
        admin_note: null,
        grab_code: null,
        approved_at: null,
      });
      if (c.ref) await applyReferral(u, c.ref, s).catch(() => {});
    }
    // one-time code in the URL fragment (never sent to servers), swapped for a session below
    back(res, 'login=' + signToken('login', { uid: u.id, j: randomToken(8) }, 120));
  }),
);

/** Step 3: the site swaps the one-time code for a 30-day session token. */
citizens.post(
  '/api/x/session',
  rateLimit('xsess', 30, 10 * 60_000),
  wrap(async (req, res) => {
    const t = verifyToken<{ uid: string; j: string }>('login', str(req.body?.login, 2000));
    if (!t || !t.uid || usedLogins.has(t.j)) throw unauthorized('That sign-in link expired. Connect X again.');
    usedLogins.set(t.j, t.exp * 1000);
    const u = await db.one<User>('users', { id: t.uid });
    if (!u) throw unauthorized('Account not found. Connect X again.');
    res.json({ token: signToken('user', { uid: u.id }, 30 * 86400), profile: await profileOf(u) });
  }),
);

/**
 * Local testing only: sign in as any username without X. Never available in production
 * (NODE_ENV=production or on Railway) and only when DEV_LOGIN=1 is set.
 */
if (!IS_PROD && process.env.DEV_LOGIN === '1') {
  console.warn('[citizens] DEV_LOGIN is on — /api/x/dev-login lets anyone sign in. Local testing only.');
  citizens.post(
    '/api/x/dev-login',
    wrap(async (req, res) => {
      const username = str(req.body?.username, 15).replace(/[^A-Za-z0-9_]/g, '') || 'tester';
      let u = await db.one<User>('users', { x_id: `dev-${username.toLowerCase()}` });
      if (!u) {
        [u] = await db.insert<User>('users', {
          x_id: `dev-${username.toLowerCase()}`, username, name: username, avatar_url: null, followers: 42, account_created_at: null,
          referral_code: await uniqueReferralCode(), referred_by: null, points: 0, wallet_address: null, status: 'pending',
          citizen_no: null, tier: null, admin_note: null, grab_code: null, approved_at: null, last_login_at: nowIso(),
        });
      }
      res.json({ login: signToken('login', { uid: u.id, j: randomToken(8) }, 120) });
    }),
  );
}

citizens.get(
  '/api/citizen/config',
  wrap(async (_req, res) => {
    const s = await getSettings();
    res.json({ ...publicSettings(s), x_login: X_LOGIN_READY, x_api: X_API_READY, login_url: `${PUBLIC_API_URL}/api/x/login` });
  }),
);

citizens.get(
  '/api/citizen/me',
  wrap(async (req, res) => {
    const u = await requireUser(req);
    res.set('Cache-Control', 'no-store').json(await profileOf(u));
  }),
);

citizens.get(
  '/api/citizen/tasks',
  wrap(async (req, res) => {
    const u = await userFromReq(req);
    const tasks = await db.select<Task>('tasks', { where: { active: true }, order: [['sort', 'asc'], ['created_at', 'asc']] });
    const subs = u ? await db.select<Submission>('submissions', { where: { user_id: u.id } }) : [];
    const byTask = new Map(subs.map((x) => [x.task_id, x]));
    const now = Date.now();
    res.set('Cache-Control', 'no-store').json({
      tasks: tasks
        .filter((t) => !t.starts_at || Date.parse(t.starts_at) <= now)
        .map((t) => {
          const sub = byTask.get(t.id);
          return {
            ...t,
            submission: sub
              ? { status: sub.status, tweet_url: sub.tweet_url, verify_at: sub.verify_at, points_awarded: sub.points_awarded, review_note: sub.review_note }
              : null,
          };
        }),
    });
  }),
);

citizens.post(
  '/api/citizen/tasks/:id/submit',
  rateLimit('submit', 40, 10 * 60_000),
  wrap(async (req, res) => {
    const u = await requireUser(req);
    const s = await getSettings();
    if (!s.citizenship_open) throw forbidden('Tasks are paused right now.');
    const task = await db.one<Task>('tasks', { id: str(req.params.id, 64) });
    if (!task || !task.active) throw notFound('That task is not available.');
    const now = Date.now();
    if (task.starts_at && Date.parse(task.starts_at) > now) throw bad('This task has not started yet.');
    if (task.ends_at && Date.parse(task.ends_at) < now) throw bad('This task has ended.');
    if (['follow'].includes(task.kind) && !task.x_handle) throw bad('This task opens soon.');
    if (['like', 'repost', 'engage', 'daily', 'quote', 'reply'].includes(task.kind) && !tweetIdOf(task.target_url)) throw bad('This task opens soon.');

    const prev = await db.one<Submission>('submissions', { user_id: u.id, task_id: task.id });
    if (prev && prev.status !== 'rejected') throw new HttpError(409, 'You already did this task.');

    let tweetUrl: string | null = null;
    let tweetId: string | null = null;
    if (task.requires_link) {
      const raw = str(req.body?.tweet_url, 300);
      const p = parseTweetUrl(raw);
      if (!p) throw bad('Paste a post link like https://x.com/yourname/status/123456.');
      if (p.handle.toLowerCase() !== u.username.toLowerCase()) throw bad(`That post is from @${p.handle}. Submit a post from @${u.username}.`);
      const dup = await db.one<Submission>('submissions', { task_id: task.id, tweet_id: p.id, user_id: { neq: u.id } });
      if (dup) throw bad('That post was already submitted.');
      tweetUrl = `https://x.com/${p.handle}/status/${p.id}`;
      tweetId = p.id;
    }

    let status: Submission['status'];
    let verifyAt: string | null = null;
    const mode: VerifyMode = task.verify_mode === 'x_api' && !X_API_READY ? 'review' : task.verify_mode;
    if (mode === 'review' || (task.kind === 'custom' && mode === 'x_api')) status = 'in_review';
    else if (mode === 'x_api') {
      status = 'pending';
      verifyAt = new Date(now + 2 * 60_000).toISOString(); // give X a moment to index the action
    } else {
      status = 'pending';
      verifyAt = new Date(now + Math.max(0, task.verify_after_hours) * 3_600_000).toISOString();
    }
    const row = { status, tweet_url: tweetUrl, tweet_id: tweetId, verify_at: verifyAt, review_note: null, points_awarded: 0, updated_at: nowIso() };
    const [sub] = prev
      ? await db.update<Submission>('submissions', { id: prev.id, status: 'rejected' }, row)
      : await db.insert<Submission>('submissions', { user_id: u.id, task_id: task.id, ...row });
    if (!sub) throw new HttpError(409, 'You already did this task.');
    res.json({ status: sub.status, verify_at: sub.verify_at });
  }),
);

citizens.post(
  '/api/citizen/referral',
  rateLimit('referral', 15, 10 * 60_000),
  wrap(async (req, res) => {
    const u = await requireUser(req);
    const s = await getSettings();
    if (!s.citizenship_open) throw forbidden('Refer codes are paused right now.');
    res.json(await applyReferral(u, str(req.body?.code, 12), s));
  }),
);

citizens.post(
  '/api/citizen/wallet',
  rateLimit('wallet', 20, 10 * 60_000),
  wrap(async (req, res) => {
    const u = await requireUser(req);
    const s = await getSettings();
    if (!s.wallet_edits_open) throw forbidden('Wallet changes are closed right now.');
    const raw = str(req.body?.address, 64);
    if (!isAddress(raw, { strict: false })) throw bad('That is not a valid wallet address. It starts with 0x and has 42 characters.');
    const address = getAddress(raw);
    if (/^0x0{40}$/i.test(address)) throw bad('That is the zero address.');
    const taken = await db.one<User>('users', { wallet_address: address, id: { neq: u.id } });
    if (taken) throw bad('That wallet is already linked to another X account.');
    const changed = u.wallet_address !== address;
    if (changed) await db.update('users', { id: u.id }, { wallet_address: address, updated_at: nowIso() });
    res.json({ wallet_address: address, changed });
  }),
);

const shared = new TtlCache<unknown>(10);
citizens.get(
  '/api/citizen/leaderboard',
  wrap(async (_req, res) => {
    const rows = await shared.get('lb', 20_000, async () => {
      const list = await db.select<User>('users', { where: { points: { gt: 0 }, status: { neq: 'banned' } }, order: [['points', 'desc'], ['created_at', 'asc']], limit: 1000 });
      return list.map((r, i) => ({ rank: i + 1, username: r.username, avatar_url: r.avatar_url, points: r.points, citizen: r.status === 'citizen' }));
    });
    res.set('Cache-Control', 'public, max-age=15').json({ rows });
  }),
);

citizens.get(
  '/api/citizen/stats',
  wrap(async (_req, res) => {
    const out = await shared.get('stats', 30_000, async () => {
      const [users, citizensN] = await Promise.all([db.count('users'), db.count('users', { status: 'citizen' })]);
      return { users, citizens: citizensN };
    });
    res.set('Cache-Control', 'public, max-age=30').json(out);
  }),
);
