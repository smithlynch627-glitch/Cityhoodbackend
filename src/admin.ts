import { Router, type NextFunction, type Request, type Response } from 'express';
import { getAddress, isAddress } from 'viem';
import { db } from './db';
import { ADMIN_TOKEN, CHAIN, CITY_ADDRESS, GAME_ADDRESS, LAND_ADDRESS, SALE_ADDRESS } from './config';
import { getSettings, grabPhase, updateSettings, DEFAULTS, type Settings } from './settings';
import { generateCodes, normCode, type GrabCode } from './codes';
import { setStatus, TASK_KINDS, LINK_KINDS, type Submission, type Task, type User, type UserStatus } from './citizens';
import { getTokenomics } from './market';
import { signerAddress } from './grab';
import { X_API_READY, X_LOGIN_READY } from './xapi';
import { allow, bad, bearer, bool, clientIp, forbidden, httpUrl, int, notFound, retryAfter, safeEqual, signToken, str, unauthorized, verifyToken, wrap, HttpError } from './security';

export const admin = Router();
const nowIso = () => new Date().toISOString();

async function audit(action: string, detail: Record<string, unknown> = {}) {
  await db.insert('audit', { actor: 'admin', action, detail }).catch(() => {});
}

/* ------------------------------------------------------------------ auth */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!ADMIN_TOKEN) return next(new HttpError(503, 'Admin is disabled. Set ADMIN_TOKEN on the server.'));
  const t = bearer(req);
  if (t && (verifyToken('admin', t) || safeEqual(t, ADMIN_TOKEN))) return next();
  next(unauthorized('Admin sign-in required.'));
}

admin.post(
  '/api/admin/login',
  wrap(async (req, res) => {
    if (!ADMIN_TOKEN) throw new HttpError(503, 'Admin is disabled. Set ADMIN_TOKEN on the server.');
    const key = `adminlogin:${clientIp(req)}`;
    if (!allow(key, 6, 15 * 60_000)) throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(retryAfter(key) / 60)} min.`);
    await new Promise((r) => setTimeout(r, 300));
    if (!safeEqual(str(req.body?.password, 500), ADMIN_TOKEN)) throw unauthorized('Wrong password.');
    await audit('login', { ip: clientIp(req) });
    res.json({ token: signToken('admin', { a: 1 }, 12 * 3600), expiresIn: 12 * 3600 });
  }),
);

admin.use('/api/admin', (req, res, next) => (req.path === '/login' ? next() : requireAdmin(req, res, next)));

/* ------------------------------------------------------------------ overview */
admin.get(
  '/api/admin/overview',
  wrap(async (_req, res) => {
    const s = await getSettings(true);
    const [users, citizens, pending, reviews, tasks, codesUnused, codesClaimed, entries, wallets] = await Promise.all([
      db.count('users'),
      db.count('users', { status: 'citizen' }),
      db.count('users', { status: 'pending' }),
      db.count('submissions', { status: 'in_review' }),
      db.count('tasks', { active: true }),
      db.count('grab_codes', { status: 'unused' }),
      db.count('grab_codes', { status: 'claimed' }),
      db.count('grab_entries'),
      db.count('grab_wallets'),
    ]);
    const tk = await getTokenomics().catch(() => null);
    res.json({
      counts: { users, citizens, pending, reviews, tasks, codesUnused, codesClaimed, entries, wallets },
      grab: grabPhase(s),
      settings: s,
      server: {
        db: db.name,
        xLogin: X_LOGIN_READY,
        xApi: X_API_READY,
        voucherSigner: signerAddress(),
        chainId: CHAIN.id,
        contracts: { land: LAND_ADDRESS ?? null, city: CITY_ADDRESS ?? null, game: GAME_ADDRESS ?? null, sale: SALE_ADDRESS ?? null },
      },
      tokenomics: tk,
    });
  }),
);

/* ------------------------------------------------------------------ settings */
admin.get('/api/admin/settings', wrap(async (_req, res) => res.json(await getSettings(true))));

admin.put(
  '/api/admin/settings',
  wrap(async (req, res) => {
    const b = req.body ?? {};
    const patch: Partial<Settings> = {};
    const text = (k: keyof Settings, max: number) => k in b && ((patch as Record<string, unknown>)[k] = str(b[k], max));
    const url = (k: keyof Settings) => {
      if (!(k in b)) return;
      if (b[k] === '' || b[k] === null) return ((patch as Record<string, unknown>)[k] = '');
      const u = httpUrl(b[k]);
      if (!u) throw bad(`${k} must be an https link.`);
      (patch as Record<string, unknown>)[k] = u;
    };
    const flag = (k: keyof Settings) => k in b && ((patch as Record<string, unknown>)[k] = bool(b[k]));
    if ('x_handle' in b) patch.x_handle = str(b.x_handle, 15).replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '') || DEFAULTS.x_handle;
    url('footer_x_url');
    url('discord_url');
    url('telegram_url');
    flag('citizenship_open');
    flag('wallet_edits_open');
    flag('auto_code_for_citizens');
    flag('citizen_wallet_is_code');
    flag('grab_enabled');
    text('share_text', 240);
    text('grab_message', 240);
    if ('referral_points' in b) patch.referral_points = int(b.referral_points, 50, 0, 100000);
    if ('milestones' in b) {
      if (!Array.isArray(b.milestones)) throw bad('milestones must be a list.');
      patch.milestones = b.milestones
        .slice(0, 10)
        .map((m: { need?: unknown; bonus?: unknown }) => ({ need: int(m.need, 1, 1, 100000), bonus: int(m.bonus, 0, 0, 1_000_000) }))
        .sort((a: { need: number }, c: { need: number }) => a.need - c.need);
    }
    for (const k of ['grab_code_opens_at', 'grab_public_opens_at'] as const) {
      if (!(k in b)) continue;
      if (b[k] === null || b[k] === '') patch[k] = null;
      else {
        const t = Date.parse(String(b[k]));
        if (!Number.isFinite(t)) throw bad(`${k} is not a valid date.`);
        patch[k] = new Date(t).toISOString();
      }
    }
    const next = { ...(await getSettings(true)), ...patch };
    if (next.grab_code_opens_at && next.grab_public_opens_at && Date.parse(next.grab_public_opens_at) < Date.parse(next.grab_code_opens_at)) {
      throw bad('Public access must open after the code phase starts.');
    }
    const s = await updateSettings(patch);
    await audit('settings', patch as Record<string, unknown>);
    res.json(s);
  }),
);

/** One-click timer: "code phase opens in X minutes, everyone Y minutes after that". */
admin.post(
  '/api/admin/grab/schedule',
  wrap(async (req, res) => {
    const openIn = int(req.body?.open_in_minutes, 0, 0, 60 * 24 * 60);
    const publicAfter = int(req.body?.public_after_minutes, 60, 0, 60 * 24 * 60);
    const codeAt = new Date(Date.now() + openIn * 60_000);
    const publicAt = new Date(codeAt.getTime() + publicAfter * 60_000);
    const s = await updateSettings({ grab_enabled: true, grab_code_opens_at: codeAt.toISOString(), grab_public_opens_at: publicAt.toISOString() });
    await audit('grab.schedule', { openIn, publicAfter });
    res.json(grabPhase(s));
  }),
);

/* ------------------------------------------------------------------ Grab Land codes */
admin.get(
  '/api/admin/codes',
  wrap(async (req, res) => {
    const where: Record<string, unknown> = {};
    const status = str(req.query.status, 10);
    if (['unused', 'claimed', 'revoked'].includes(status)) where.status = status;
    const batch = str(req.query.batch, 60);
    if (batch) where.batch = batch;
    const q = str(req.query.q, 64);
    const limit = int(req.query.limit, 100, 1, 1000);
    const offset = int(req.query.offset, 0, 0, 1_000_000);
    const [rows, total] = await Promise.all([
      db.select<GrabCode>('grab_codes', { where, order: [['created_at', 'desc']], limit, offset, search: q ? { cols: ['code', 'label', 'wallet', 'batch'], q } : undefined }),
      db.count('grab_codes', where),
    ]);
    res.json({ rows, total });
  }),
);

admin.post(
  '/api/admin/codes/generate',
  wrap(async (req, res) => {
    const count = int(req.body?.count, 1, 1, 5000);
    const label = str(req.body?.label, 80) || null;
    const batch = str(req.body?.batch, 60) || `batch-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
    const rows = await generateCodes(count, label, batch);
    await audit('codes.generate', { count: rows.length, batch, label });
    res.json({ rows, batch });
  }),
);

admin.post(
  '/api/admin/codes/:code/revoke',
  wrap(async (req, res) => {
    const code = normCode(req.params.code);
    const [row] = await db.update<GrabCode>('grab_codes', { code }, { status: 'revoked' });
    if (!row) throw notFound('Code not found.');
    await audit('codes.revoke', { code });
    res.json(row);
  }),
);

admin.post(
  '/api/admin/codes/:code/reset',
  wrap(async (req, res) => {
    const code = normCode(req.params.code);
    const [row] = await db.update<GrabCode>('grab_codes', { code }, { status: 'unused', wallet: null, claimed_at: null });
    if (!row) throw notFound('Code not found.');
    await audit('codes.reset', { code });
    res.json(row);
  }),
);

admin.delete(
  '/api/admin/codes/:code',
  wrap(async (req, res) => {
    const code = normCode(req.params.code);
    const n = await db.remove('grab_codes', { code, status: { neq: 'claimed' } });
    if (!n) throw bad('Only unused or revoked codes can be deleted.');
    await audit('codes.delete', { code });
    res.json({ ok: true });
  }),
);

admin.get(
  '/api/admin/codes.csv',
  wrap(async (req, res) => {
    const batch = str(req.query.batch, 60);
    const rows = await db.select<GrabCode>('grab_codes', { where: batch ? { batch } : {}, order: [['created_at', 'asc']], limit: 100000 });
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['code,label,batch,status,wallet,claimed_at,created_at', ...rows.map((r) => [r.code, r.label, r.batch, r.status, r.wallet, r.claimed_at, r.created_at].map(cell).join(','))].join('\n');
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="cityhood-codes${batch ? `-${batch}` : ''}.csv"`).send(csv);
  }),
);

/* ------------------------------------------------------------------ wallet allowlist */
admin.get(
  '/api/admin/wallets',
  wrap(async (req, res) => {
    const q = str(req.query.q, 64);
    const rows = await db.select('grab_wallets', { order: [['created_at', 'desc']], limit: int(req.query.limit, 200, 1, 5000), offset: int(req.query.offset, 0, 0, 1e6), search: q ? { cols: ['wallet', 'note'], q } : undefined });
    res.json({ rows, total: await db.count('grab_wallets') });
  }),
);

admin.post(
  '/api/admin/wallets',
  wrap(async (req, res) => {
    const list = String(req.body?.wallets ?? '')
      .split(/[\s,;]+/)
      .map((w) => w.trim())
      .filter(Boolean);
    const note = str(req.body?.note, 120) || null;
    const good = [...new Set(list.filter((w) => isAddress(w, { strict: false })).map((w) => getAddress(w).toLowerCase()))].slice(0, 10000);
    const badOnes = list.filter((w) => !isAddress(w, { strict: false }));
    if (good.length) await db.upsert('grab_wallets', good.map((wallet) => ({ wallet, source: 'admin', note })), 'wallet');
    await audit('wallets.add', { added: good.length, invalid: badOnes.length });
    res.json({ added: good.length, invalid: badOnes.slice(0, 20) });
  }),
);

admin.delete(
  '/api/admin/wallets/:wallet',
  wrap(async (req, res) => {
    const w = str(req.params.wallet, 64).toLowerCase();
    await db.remove('grab_wallets', { wallet: w });
    await audit('wallets.remove', { wallet: w });
    res.json({ ok: true });
  }),
);

admin.get(
  '/api/admin/entries',
  wrap(async (req, res) => {
    const rows = await db.select('grab_entries', { order: [['entered_at', 'desc']], limit: int(req.query.limit, 200, 1, 5000), offset: int(req.query.offset, 0, 0, 1e6) });
    res.json({ rows, total: await db.count('grab_entries') });
  }),
);

/* ------------------------------------------------------------------ citizens */
admin.get(
  '/api/admin/users',
  wrap(async (req, res) => {
    const where: Record<string, unknown> = {};
    const status = str(req.query.status, 12);
    if (['pending', 'citizen', 'rejected', 'banned'].includes(status)) where.status = status;
    const q = str(req.query.q, 64).replace(/^@/, '');
    const sort = str(req.query.sort, 12);
    const order: [string, 'asc' | 'desc'][] = sort === 'new' ? [['created_at', 'desc']] : sort === 'followers' ? [['followers', 'desc']] : [['points', 'desc'], ['created_at', 'asc']];
    const limit = int(req.query.limit, 50, 1, 500);
    const offset = int(req.query.offset, 0, 0, 1e6);
    const [rows, total] = await Promise.all([
      db.select<User>('users', { where, order, limit, offset, search: q ? { cols: ['username', 'name', 'wallet_address', 'referral_code'], q } : undefined }),
      db.count('users', where),
    ]);
    res.json({ rows, total });
  }),
);

admin.patch(
  '/api/admin/users/:id',
  wrap(async (req, res) => {
    const id = str(req.params.id, 64);
    const b = req.body ?? {};
    let user: User | undefined;
    if (b.status) {
      if (!['pending', 'citizen', 'rejected', 'banned'].includes(b.status)) throw bad('Unknown status.');
      user = await setStatus(id, b.status as UserStatus, { tier: 'tier' in b ? str(b.tier, 30) || null : undefined, note: 'admin_note' in b ? str(b.admin_note, 300) || null : undefined });
    } else {
      const patch: Record<string, unknown> = { updated_at: nowIso() };
      if ('tier' in b) patch.tier = str(b.tier, 30) || null;
      if ('admin_note' in b) patch.admin_note = str(b.admin_note, 300) || null;
      [user] = await db.update<User>('users', { id }, patch);
    }
    if ('points_delta' in b) {
      const d = int(b.points_delta, 0, -1_000_000, 1_000_000);
      if (d) await db.addPoints(id, d);
    }
    if (!user) throw notFound('User not found.');
    await audit('users.update', { id, ...b });
    res.json(await db.one<User>('users', { id }));
  }),
);

admin.post(
  '/api/admin/users/bulk',
  wrap(async (req, res) => {
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map((x: unknown) => str(x, 64)).filter(Boolean).slice(0, 500) : [];
    const status = str(req.body?.status, 12) as UserStatus;
    if (!['pending', 'citizen', 'rejected', 'banned'].includes(status)) throw bad('Unknown status.');
    let n = 0;
    for (const id of ids) {
      await setStatus(id, status).then(() => n++).catch(() => {});
    }
    await audit('users.bulk', { status, count: n });
    res.json({ updated: n });
  }),
);

/* ------------------------------------------------------------------ reviews */
admin.get(
  '/api/admin/submissions',
  wrap(async (req, res) => {
    const status = str(req.query.status, 12) || 'in_review';
    const subs = await db.select<Submission>('submissions', { where: { status }, order: [['created_at', 'asc']], limit: int(req.query.limit, 100, 1, 500), offset: int(req.query.offset, 0, 0, 1e6) });
    const users = new Map((await db.select<User>('users', { where: { id: { in: [...new Set(subs.map((s) => s.user_id))] } } })).map((u) => [u.id, u]));
    const tasks = new Map((await db.select<Task>('tasks')).map((t) => [t.id, t]));
    res.json({
      rows: subs.map((s) => ({ ...s, user: users.get(s.user_id) ? { id: s.user_id, username: users.get(s.user_id)!.username, avatar_url: users.get(s.user_id)!.avatar_url, followers: users.get(s.user_id)!.followers } : null, task: tasks.get(s.task_id) ?? null })),
      total: await db.count('submissions', { status }),
    });
  }),
);

admin.post(
  '/api/admin/submissions/:id',
  wrap(async (req, res) => {
    const sub = await db.one<Submission>('submissions', { id: str(req.params.id, 64) });
    if (!sub) throw notFound('Submission not found.');
    const action = str(req.body?.action, 10);
    const note = str(req.body?.note, 300) || null;
    if (action === 'approve') {
      if (sub.status === 'verified') throw bad('Already approved.');
      const task = await db.one<Task>('tasks', { id: sub.task_id });
      const pts = 'points' in (req.body ?? {}) ? int(req.body.points, task?.points ?? 0, 0, 1_000_000) : task?.points ?? 0;
      const [done] = await db.update<Submission>('submissions', { id: sub.id, status: sub.status }, { status: 'verified', points_awarded: pts, review_note: note, updated_at: nowIso() });
      if (done) await db.addPoints(sub.user_id, pts);
    } else if (action === 'reject') {
      await db.update('submissions', { id: sub.id }, { status: 'rejected', review_note: note ?? 'Not approved.', updated_at: nowIso() });
    } else throw bad('action must be approve or reject.');
    await audit(`submissions.${action}`, { id: sub.id });
    res.json(await db.one('submissions', { id: sub.id }));
  }),
);

/* ------------------------------------------------------------------ tasks */
function taskInput(b: Record<string, unknown>, partial: boolean) {
  const t: Record<string, unknown> = {};
  if (!partial || 'kind' in b) {
    if (!TASK_KINDS.includes(b.kind as never)) throw bad(`kind must be one of ${TASK_KINDS.join(', ')}.`);
    t.kind = b.kind;
  }
  if (!partial || 'title' in b) {
    t.title = str(b.title, 100);
    if (!t.title) throw bad('Title is required.');
  }
  if (!partial || 'description' in b) t.description = str(b.description, 400);
  if (!partial || 'points' in b) t.points = int(b.points, 0, 0, 1_000_000);
  if ('target_url' in b) t.target_url = b.target_url ? httpUrl(b.target_url) : null;
  if ('x_handle' in b) t.x_handle = str(b.x_handle, 15).replace(/^@/, '') || null;
  if (!partial || 'verify_mode' in b) {
    if (!['auto', 'review', 'x_api'].includes(String(b.verify_mode))) throw bad('verify_mode must be auto, review or x_api.');
    t.verify_mode = b.verify_mode;
  }
  if (!partial || 'verify_after_hours' in b) t.verify_after_hours = int(b.verify_after_hours, 24, 0, 24 * 30);
  if ('requires_link' in b) t.requires_link = bool(b.requires_link);
  else if (!partial) t.requires_link = LINK_KINDS.includes(t.kind as never);
  if ('required_text' in b) t.required_text = str(b.required_text, 80) || null;
  if (!partial || 'active' in b) t.active = 'active' in b ? bool(b.active) : true;
  if (!partial || 'sort' in b) t.sort = int(b.sort, 100, 0, 100000);
  for (const k of ['starts_at', 'ends_at']) {
    if (!(k in b)) continue;
    t[k] = b[k] ? (Number.isFinite(Date.parse(String(b[k]))) ? new Date(String(b[k])).toISOString() : null) : null;
  }
  return t;
}

admin.get('/api/admin/tasks', wrap(async (_req, res) => res.json({ rows: await db.select<Task>('tasks', { order: [['sort', 'asc'], ['created_at', 'asc']] }) })));

admin.post(
  '/api/admin/tasks',
  wrap(async (req, res) => {
    const [row] = await db.insert('tasks', { starts_at: null, ends_at: null, target_url: null, x_handle: null, required_text: null, ...taskInput(req.body ?? {}, false) });
    await audit('tasks.create', { id: (row as unknown as Task).id });
    res.json(row);
  }),
);

admin.patch(
  '/api/admin/tasks/:id',
  wrap(async (req, res) => {
    const [row] = await db.update('tasks', { id: str(req.params.id, 64) }, taskInput(req.body ?? {}, true));
    if (!row) throw notFound('Task not found.');
    await audit('tasks.update', { id: req.params.id });
    res.json(row);
  }),
);

admin.delete(
  '/api/admin/tasks/:id',
  wrap(async (req, res) => {
    const id = str(req.params.id, 64);
    if (await db.count('submissions', { task_id: id, status: 'verified' })) {
      // keep history: deactivate instead of deleting a task people already earned points on
      await db.update('tasks', { id }, { active: false });
      await audit('tasks.deactivate', { id });
      return res.json({ ok: true, deactivated: true });
    }
    await db.remove('submissions', { task_id: id });
    await db.remove('tasks', { id });
    await audit('tasks.delete', { id });
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------------------ audit */
admin.get(
  '/api/admin/audit',
  wrap(async (req, res) => {
    res.json({ rows: await db.select('audit', { order: [['created_at', 'desc']], limit: int(req.query.limit, 100, 1, 1000) }) });
  }),
);


