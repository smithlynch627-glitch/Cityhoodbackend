import { db } from './db';
import { X_HANDLE } from './config';

/** Everything the admin panel can switch without a redeploy. Stored in cityhood_settings (key → JSON). */
export interface Settings {
  x_handle: string;
  footer_x_url: string;
  discord_url: string;
  telegram_url: string;

  citizenship_open: boolean;
  wallet_edits_open: boolean;
  referral_points: number;
  /** anti-farming: X accounts younger than this (days) can't use a refer code */
  referral_min_account_days: number;
  /** anti-farming: X accounts with fewer followers can't use a refer code */
  referral_min_followers: number;
  milestones: { need: number; bonus: number }[];
  /** Approving a citizen also issues them a personal 6-digit Grab Land code. */
  auto_code_for_citizens: boolean;
  /** An approved citizen's saved wallet works as their Grab Land code. */
  citizen_wallet_is_code: boolean;
  share_text: string;

  /** Master switch for Grab Land. Off = locked for everyone, whatever the timers say. */
  grab_enabled: boolean;
  /** When code holders may enter (ISO time). */
  grab_code_opens_at: string | null;
  /** When everyone may enter without a code (ISO time). */
  grab_public_opens_at: string | null;
  grab_message: string;
  /** Bumped by "sign out all admin sessions": every admin token issued before stops working. */
  admin_epoch: number;

  /*
   * What visitors can see before launch. 'auto' follows the Grab Land timer, 'show' / 'hide' override it.
   * show_grab: the Grab Land page, its menu link and every "Grab a land" button (auto: once a timer is set)
   * show_contracts: contract addresses and explorer links (auto: once a timer is set)
   * show_wallet: the Connect wallet button (auto: once a timer is set)
   * show_progress: the "islands minted" progress bar (auto: once code holders can enter)
   */
  show_grab: Visibility;
  show_contracts: Visibility;
  show_wallet: Visibility;
  show_progress: Visibility;
}
export type Visibility = 'auto' | 'show' | 'hide';
export const VISIBILITY_KEYS = ['show_grab', 'show_contracts', 'show_wallet', 'show_progress'] as const;

export const DEFAULTS: Settings = {
  x_handle: X_HANDLE,
  footer_x_url: `https://x.com/${X_HANDLE}`,
  discord_url: '',
  telegram_url: '',
  citizenship_open: true,
  wallet_edits_open: true,
  referral_points: 50,
  referral_min_account_days: 14,
  referral_min_followers: 3,
  milestones: [
    { need: 3, bonus: 100 },
    { need: 10, bonus: 400 },
    { need: 25, bonus: 1200 },
  ],
  auto_code_for_citizens: true,
  citizen_wallet_is_code: true,
  share_text: "I'm officially a citizen of CITYHOOD 🏙️ My island in the sky is waiting.",
  grab_enabled: false,
  grab_code_opens_at: null,
  grab_public_opens_at: null,
  grab_message: 'Grab Land opens soon. Code holders get in first.',
  admin_epoch: 0,
  show_grab: 'auto',
  show_contracts: 'auto',
  show_wallet: 'auto',
  show_progress: 'auto',
};

let cache: { at: number; value: Settings } | null = null;
let loading: Promise<Settings> | null = null;
/** bumped on every write, so a read that started before the write can't put old values back in the cache */
let gen = 0;

/** Settings, read from the database at most every 5 s; concurrent callers share one read. */
export async function getSettings(fresh = false): Promise<Settings> {
  if (!fresh && cache && Date.now() - cache.at < 5_000) return cache.value;
  if (!fresh && loading) return loading;
  const g = gen;
  const run = (async () => {
    const rows = await db.select<{ key: string; value: unknown }>('settings');
    const value = { ...DEFAULTS } as Settings;
    for (const r of rows) if (r.key in DEFAULTS) (value as unknown as Record<string, unknown>)[r.key] = r.value;
    if (g === gen) cache = { at: Date.now(), value };
    return value;
  })();
  if (!fresh) loading = run;
  try {
    return await run;
  } catch (e) {
    if (cache) return cache.value; // database hiccup: keep the last known settings
    throw e;
  } finally {
    if (loading === run) loading = null;
  }
}

export async function updateSettings(patch: Partial<Settings>) {
  const rows = Object.entries(patch)
    .filter(([k]) => k in DEFAULTS)
    .map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
  if (rows.length) await db.upsert('settings', rows, 'key');
  gen++;
  cache = null;
  loading = null;
  return getSettings(true);
}

/** The settings anyone may read (site footer, Citizenship and Grab Land pages). */
export function publicSettings(s: Settings) {
  return {
    x_handle: s.x_handle,
    footer_x_url: s.footer_x_url,
    discord_url: s.discord_url,
    telegram_url: s.telegram_url,
    citizenship_open: s.citizenship_open,
    wallet_edits_open: s.wallet_edits_open,
    referral_points: s.referral_points,
    milestones: s.milestones,
    share_text: s.share_text,
    reveal: siteReveal(s),
  };
}

/**
 * What the website shows right now. Hiding is about what visitors see; buying is separately protected by the
 * server (no buy pass before Grab Land opens), so a hidden page can't be used to buy early.
 */
export function siteReveal(s: Settings, now = Date.now()) {
  const g = grabPhase(s, now);
  const timerSet = !!g.code_opens_at; // countdown, open, or paused with times kept
  const live = g.phase === 'code' || g.phase === 'public';
  const pick = (v: Visibility, auto: boolean) => (v === 'show' ? true : v === 'hide' ? false : auto);
  return {
    grab: pick(s.show_grab, timerSet),
    contracts: pick(s.show_contracts, timerSet),
    wallet: pick(s.show_wallet, timerSet),
    progress: pick(s.show_progress, live),
    /** when the progress bar turns on by itself (auto + countdown), so pages can flip at the exact moment */
    progress_at: s.show_progress === 'auto' && g.phase === 'countdown' ? g.code_opens_at : null,
  };
}

/* ------------------------------------------------------------------ Grab Land phase */
export type GrabPhase = 'locked' | 'countdown' | 'code' | 'public';

/** Where Grab Land stands right now. The server clock decides; the browser only shows it. */
export function grabPhase(s: Settings, now = Date.now()) {
  const codeAt = s.grab_code_opens_at ? Date.parse(s.grab_code_opens_at) : NaN;
  const publicAt = s.grab_public_opens_at ? Date.parse(s.grab_public_opens_at) : NaN;
  let phase: GrabPhase;
  if (!s.grab_enabled || !Number.isFinite(codeAt)) phase = 'locked';
  else if (now < codeAt) phase = 'countdown';
  else if (!Number.isFinite(publicAt) || now < publicAt) phase = 'code';
  else phase = 'public';
  return {
    phase,
    enabled: s.grab_enabled,
    /** switched off by the admin while a timer is set (times are kept for "Resume") */
    paused: !s.grab_enabled && Number.isFinite(codeAt),
    code_opens_at: Number.isFinite(codeAt) ? new Date(codeAt).toISOString() : null,
    public_opens_at: Number.isFinite(publicAt) ? new Date(publicAt).toISOString() : null,
    message: s.grab_message,
    server_time: new Date(now).toISOString(),
  };
}
