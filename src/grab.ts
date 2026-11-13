import { Router, type Request } from 'express';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { db } from './db';
import { client } from './chain';
import { CHAIN, SALE_ADDRESS, SALE_SIGNER_KEY, VOUCHER_MINUTES, SITE_URL } from './config';
import { getSettings, grabPhase } from './settings';
import { normCode, type GrabCode } from './codes';
import type { User } from './citizens';
import { allow, bad, bearer, clientIp, forbidden, hits, HttpError, randomToken, rateLimit, retryAfter, signToken, str, unauthorized, verifyToken, wrap } from './security';

const signer = /^0x[0-9a-fA-F]{64}$/.test(SALE_SIGNER_KEY) ? privateKeyToAccount(SALE_SIGNER_KEY as Hex) : null;
if (!signer) console.warn('[grab] SALE_SIGNER_PRIVATE_KEY is missing — sale vouchers are disabled.');

export const GRAB_READY = () => !!(signer && SALE_ADDRESS);
export const signerAddress = () => signer?.address ?? null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Which wallets may enter during the code phase without typing a code. */
async function walletPass(address: Address) {
  const lower = address.toLowerCase();
  const listed = await db.one<{ wallet: string; note: string | null }>('grab_wallets', { wallet: lower });
  if (listed) return { ok: true as const, via: 'wallet' as const };
  const s = await getSettings();
  if (s.citizen_wallet_is_code) {
    const u = await db.one<User>('users', { wallet_address: getAddress(address), status: 'citizen' });
    if (u) return { ok: true as const, via: 'citizen' as const, username: u.username };
  }
  return { ok: false as const };
}

/** Same 400 ms floor for every answer, so timing never tells a valid code from an invalid one. */
async function steady<T>(fn: () => Promise<T>, ms = 400): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    const left = ms - (Date.now() - t0);
    if (left > 0) await sleep(left);
  }
}

/**
 * Brute-force protection for 6-digit codes. Only WRONG codes count towards the tight limits, so a rush of real
 * code holders (thousands at opening time, many sharing one mobile-network IP) is never blocked, while guessing
 * stops fast: 15 wrong codes per IP per 10 min, and a global brake if wrong codes pour in from many IPs.
 */
const WINDOW = 10 * 60_000;
function codeGuard(req: Request) {
  const ip = clientIp(req);
  if (hits(`codefail:${ip}`) >= 15) throw new HttpError(429, `Too many wrong codes. Try again in ${Math.max(1, Math.ceil(retryAfter(`codefail:${ip}`) / 60))} min.`);
  if (!allow(`code:${ip}`, 150, WINDOW)) throw new HttpError(429, `Too many code checks. Try again in ${Math.max(1, Math.ceil(retryAfter(`code:${ip}`) / 60))} min.`);
  if (hits('codefail:global') >= 6000) throw new HttpError(429, 'The code checker is busy. Try again in a few minutes.');
}
function codeFailed(req: Request) {
  allow(`codefail:${clientIp(req)}`, Number.MAX_SAFE_INTEGER, WINDOW);
  allow('codefail:global', Number.MAX_SAFE_INTEGER, WINDOW);
}
/** per-wallet limit on top of the (generous, NAT-friendly) per-IP one */
function walletLimit(name: string, wallet: string, limit: number) {
  const key = `${name}:${wallet.toLowerCase()}`;
  if (!allow(key, limit, WINDOW)) throw new HttpError(429, `Too many requests for this wallet. Try again in ${Math.max(1, Math.ceil(retryAfter(key) / 60))} min.`);
}

export const grab = Router();

grab.get(
  '/api/grab/status',
  wrap(async (_req, res) => {
    const s = await getSettings();
    res.set('Cache-Control', 'no-store').json({ ...grabPhase(s), ready: GRAB_READY(), sale: SALE_ADDRESS ?? null, chainId: CHAIN.id });
  }),
);

/** Code checker: anyone can see whether a code (or wallet) is valid before Grab Land opens. Doesn't use the code. */
grab.post(
  '/api/grab/check',
  wrap(async (req, res) => {
    codeGuard(req);
    const input = str(req.body?.code, 64);
    const out = await steady(async () => {
      if (isAddress(input, { strict: false })) {
        const p = await walletPass(getAddress(input));
        return p.ok
          ? { valid: true, kind: 'wallet', message: p.via === 'citizen' ? 'This wallet belongs to an approved citizen. It works as your code.' : 'This wallet is on the Grab Land list. It works as your code.' }
          : { valid: false, kind: 'wallet', message: 'This wallet is not on the list. Use your 6-digit code, or wait for public access.' };
      }
      const code = normCode(input);
      if (code.length !== 6) return { valid: false, kind: 'code', message: 'Codes are 6 digits.' };
      const row = await db.one<GrabCode>('grab_codes', { code });
      if (!row || row.status === 'revoked') {
        codeFailed(req);
        return { valid: false, kind: 'code', message: "That code doesn't exist." };
      }
      if (row.status === 'claimed') return { valid: true, kind: 'code', used: true, message: `This code is valid and already linked to wallet ${short(row.wallet ?? '')}. Only that wallet can enter with it.` };
      return { valid: true, kind: 'code', used: false, message: 'Valid code. It links to the first wallet that enters with it.' };
    });
    res.set('Cache-Control', 'no-store').json(out);
  }),
);

/** Message to sign: proves you own the wallet. Free, no transaction. */
grab.get(
  '/api/grab/challenge',
  rateLimit('gchal', 600, 10 * 60_000),
  wrap(async (req, res) => {
    const raw = str(req.query.address, 64);
    if (!isAddress(raw, { strict: false })) throw bad('Connect a wallet first.');
    const address = getAddress(raw);
    const nonce = randomToken(12);
    const issued = new Date().toISOString();
    const host = new URL(SITE_URL).host;
    const message = `${host} wants you to enter CITYHOOD Grab Land with your wallet:\n${address}\n\nSigning is free and doesn't send a transaction.\n\nChain ID: ${CHAIN.id}\nNonce: ${nonce}\nIssued At: ${issued}`;
    res.set('Cache-Control', 'no-store').json({ message, challenge: signToken('grab', { k: 'ch', a: address, m: message }, 600) });
  }),
);

/** Enter Grab Land: wallet signature + (during the code phase) a code or a listed wallet. */
grab.post(
  '/api/grab/enter',
  rateLimit('genter', 300, 10 * 60_000),
  wrap(async (req, res) => {
    const ch = verifyToken<{ k: string; a: Address; m: string }>('grab', str(req.body?.challenge, 4000));
    if (!ch || ch.k !== 'ch') throw unauthorized('Your sign-in expired. Try again.');
    const signature = str(req.body?.signature, 4000) as Hex;
    if (!/^0x[0-9a-fA-F]+$/.test(signature)) throw bad('Missing wallet signature.');
    // EOAs and smart wallets (ERC-1271 / ERC-6492, e.g. Coinbase Smart Wallet)
    const ok = await client.verifyMessage({ address: ch.a, message: ch.m, signature }).catch(() => false);
    if (!ok) throw unauthorized("That signature doesn't match your wallet.");
    const address = ch.a;
    const lower = address.toLowerCase();
    walletLimit('genter', address, 20);

    const s = await getSettings();
    const g = grabPhase(s);
    if (g.phase === 'locked' || g.phase === 'countdown') throw forbidden('Grab Land is not open yet. Check your code and come back when the timer ends.');

    const existing = await db.one<{ wallet: string; via: string; code: string | null }>('grab_entries', { wallet: lower });
    let via = existing?.via ?? 'public';
    let usedCode: string | null = existing?.code ?? null;

    if (!existing && g.phase === 'code') {
      const pass = await walletPass(address);
      if (pass.ok) via = pass.via;
      else {
        codeGuard(req);
        const code = normCode(req.body?.code);
        if (code.length !== 6) throw forbidden('During the code phase you need your 6-digit code, or a wallet that is on the list.');
        // atomic: only succeeds while the code is still unused
        const [claimed] = await db.update<GrabCode>('grab_codes', { code, status: 'unused' }, { status: 'claimed', wallet: lower, claimed_at: new Date().toISOString() });
        if (!claimed) {
          const row = await db.one<GrabCode>('grab_codes', { code });
          if (!row || row.status === 'revoked') {
            codeFailed(req);
            throw forbidden("That code doesn't exist.");
          }
          if (row.wallet !== lower) throw forbidden(`That code is already linked to ${short(row.wallet ?? '')}. Enter with that wallet.`);
        }
        via = 'code';
        usedCode = code;
      }
    }
    if (!existing) {
      await db.upsert('grab_entries', { wallet: lower, via, code: usedCode, entered_at: new Date().toISOString(), ip: clientIp(req) }, 'wallet');
    }
    res.json({ token: signToken('grab', { k: 'in', a: address }, 6 * 3600), wallet: address, via, phase: g.phase });
  }),
);

async function grabUser(req: Request) {
  const t = verifyToken<{ k: string; a: Address }>('grab', bearer(req));
  if (!t || t.k !== 'in') throw unauthorized('Enter Grab Land first.');
  return t.a;
}

grab.get(
  '/api/grab/me',
  wrap(async (req, res) => {
    const a = await grabUser(req);
    const e = await db.one<{ via: string; code: string | null; entered_at: string }>('grab_entries', { wallet: a.toLowerCase() });
    const g = grabPhase(await getSettings());
    res.set('Cache-Control', 'no-store').json({ wallet: a, via: e?.via ?? 'public', entered_at: e?.entered_at ?? null, phase: g.phase });
  }),
);

/** Short-lived EIP-712 voucher that lets this wallet call CitySale.buy. */
grab.post(
  '/api/grab/voucher',
  rateLimit('gvoucher', 1200, 10 * 60_000),
  wrap(async (req, res) => {
    const a = await grabUser(req);
    walletLimit('gvoucher', a, 60);
    if (!signer || !SALE_ADDRESS) throw new HttpError(503, 'The sale is not configured on the server yet.');
    const g = grabPhase(await getSettings());
    if (g.phase === 'locked' || g.phase === 'countdown') throw forbidden('Grab Land is closed right now.');
    if (g.phase === 'code' && !(await db.one('grab_entries', { wallet: a.toLowerCase() }))) throw forbidden('Enter with your code first.');
    const deadline = BigInt(Math.floor(Date.now() / 1000) + VOUCHER_MINUTES * 60);
    const signature = await signer.signTypedData({
      domain: { name: 'CITYHOOD Sale', version: '1', chainId: CHAIN.id, verifyingContract: SALE_ADDRESS },
      types: { Voucher: [{ name: 'buyer', type: 'address' }, { name: 'deadline', type: 'uint256' }] },
      primaryType: 'Voucher',
      message: { buyer: a, deadline },
    });
    await db.update('grab_entries', { wallet: a.toLowerCase() }, { last_voucher_at: new Date().toISOString() });
    res.set('Cache-Control', 'no-store').json({ buyer: a, deadline: deadline.toString(), signature });
  }),
);
