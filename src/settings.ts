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
}

export const DEFAULTS: Settings = {
  x_handle: X_HANDLE,
  footer_x_url: `https://x.com/${X_HANDLE}`,
  discord_url: '',
  telegram_url: '',
  citizenship_open: true,
  wallet_edits_open: true,
  referral_points: 50,
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
};

let cache: { at: number; value: Settings } | null = null;

export async function getSettings(fresh = false): Promise<Settings> {
  if (!fresh && cache && Date.now() - cache.at < 5_000) return cache.value;
  const rows = await db.select<{ key: string; value: unknown }>('settings');
  const value = { ...DEFAULTS } as Settings;
  for (const r of rows) if (r.key in DEFAULTS) (value as unknown as Record<string, unknown>)[r.key] = r.value;
  cache = { at: Date.now(), value };
  return value;
}

export async function updateSettings(patch: Partial<Settings>) {
  const rows = Object.entries(patch)
    .filter(([k]) => k in DEFAULTS)
    .map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
  if (rows.length) await db.upsert('settings', rows, 'key');
  cache = null;
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
    code_opens_at: Number.isFinite(codeAt) ? new Date(codeAt).toISOString() : null,
    public_opens_at: Number.isFinite(publicAt) ? new Date(publicAt).toISOString() : null,
    message: s.grab_message,
    server_time: new Date(now).toISOString(),
  };
}
