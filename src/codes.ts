import { db } from './db';
import { sixDigits } from './security';

export interface GrabCode {
  code: string;
  label: string | null;
  batch: string | null;
  status: 'unused' | 'claimed' | 'revoked';
  wallet: string | null;
  user_id: string | null;
  claimed_at: string | null;
  created_at: string;
}

/** Creates `count` unique 6-digit codes. Collisions with existing codes are retried. */
export async function generateCodes(count: number, label: string | null, batch: string | null, userId: string | null = null) {
  const out: GrabCode[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (out.length < count && guard++ < count * 20) {
    const want = Math.min(200, count - out.length);
    const fresh: string[] = [];
    while (fresh.length < want) {
      const c = sixDigits();
      if (!seen.has(c)) {
        seen.add(c);
        fresh.push(c);
      }
    }
    const taken = new Set((await db.select<GrabCode>('grab_codes', { where: { code: { in: fresh } } })).map((r) => r.code));
    const rows = fresh
      .filter((c) => !taken.has(c))
      .map((code) => ({ code, label, batch, status: 'unused', wallet: null, user_id: userId, claimed_at: null }));
    if (rows.length) out.push(...(await db.insert<GrabCode>('grab_codes', rows)));
  }
  return out;
}

export const normCode = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(0, 6);
