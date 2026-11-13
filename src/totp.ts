import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time codes (RFC 6238), the 6-digit codes from Google Authenticator, Authy, 1Password and so on.
 * Used as an optional second step for the admin sign-in (ADMIN_TOTP_SECRET).
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function codeAt(secret: Buffer, counter: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/** A fresh 160-bit secret, as the base32 text authenticator apps take. */
export function newTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function otpauthUrl(secret: string, account: string) {
  return `otpauth://totp/${encodeURIComponent(`CITYHOOD:${account}`)}?secret=${secret}&issuer=CITYHOOD&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Checks a code against the current 30-second step and one step either side (phone clocks drift).
 * Returns the step that matched, so the caller can refuse the same code twice.
 */
export function checkTotp(secretB32: string, code: string, now = Date.now()): number | null {
  const c = String(code ?? '').replace(/\D/g, '');
  if (c.length !== 6) return null;
  const secret = base32Decode(secretB32);
  if (secret.length < 10) return null;
  const step = Math.floor(now / 30_000);
  for (const d of [0, -1, 1]) {
    const want = codeAt(secret, step + d);
    if (timingSafeEqual(Buffer.from(want), Buffer.from(c))) return step + d;
  }
  return null;
}
