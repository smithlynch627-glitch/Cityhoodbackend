import path from 'node:path';
import { Router } from 'express';
import { Resvg } from '@resvg/resvg-js';
import { db } from './db';
import { PUBLIC_API_URL, SITE_URL } from './config';
import { getSettings } from './settings';
import { notFound, rateLimit, str, wrap } from './security';
import { renderScene, type SceneBuilding } from './shared/art';
import { DEFAULT_CATALOG } from './shared/economy';
import type { User } from './citizens';

const FONT_DIR = path.join(__dirname, '../assets/fonts');
const FONTS = ['Fredoka_600SemiBold.ttf', 'Fredoka_700Bold.ttf', 'PlusJakartaSans_600SemiBold.ttf', 'PlusJakartaSans_800ExtraBold.ttf'].map((f) => path.join(FONT_DIR, f));

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function avatarData(url: string | null): Promise<string | null> {
  if (!url || !/^https:\/\/pbs\.twimg\.com\//.test(url)) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !/^image\/(jpeg|png|webp)/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 600_000 || type.includes('webp')) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** A small island with a few buildings for the left of the card (same art engine as the game). */
function islandArt(seed: number) {
  const pick = (key: string, x: number, y: number, level: number): SceneBuilding[] => {
    const t = DEFAULT_CATALOG.buildings.find((b) => b.key === key);
    return t ? [{ kind: t.id, key, size: t.size, x, y, level }] : [];
  };
  const b = [
    ...pick('cityhall', 2, 2, 3),
    ...pick('road', 0, 4, 1), ...pick('road', 1, 4, 1), ...pick('road', 2, 4, 1), ...pick('road', 3, 4, 1), ...pick('road', 4, 4, 1), ...pick('road', 5, 4, 1),
    ...pick('skyscraper', 4, 0, 3), ...pick('apartment', 0, 0, 3), ...pick('house', 1, 1, 2), ...pick('tree', 0, 2, 1), ...pick('cafe', 0, 5, 2),
    ...pick('house', 2, 5, 2), ...pick('tree', 4, 5, 1), ...pick('flowers', 5, 5, 1), ...pick('fountain', 4, 2, 2), ...pick('tree', 5, 3, 1),
  ];
  return renderScene(6, b, { uid: `card${seed}`, sky: false, clouds: false, animate: false, padding: 10, seed });
}

export async function citizenCardSvg(u: User, handle: string) {
  const avatar = await avatarData(u.avatar_url);
  const no = `#${String(u.citizen_no ?? 0).padStart(4, '0')}`;
  const issued = new Date(u.approved_at ?? Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const name = esc((u.name || u.username).slice(0, 28));
  const user = esc(`@${u.username}`);
  const island = islandArt((u.citizen_no ?? 7) % 997);
  const initials = esc((u.username[0] ?? 'C').toUpperCase());
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fcff0"/><stop offset=".6" stop-color="#bfeafa"/><stop offset="1" stop-color="#e9f8fd"/></linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#fff4dc"/></linearGradient>
    <clipPath id="av"><circle cx="0" cy="0" r="58"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  <g fill="#fff" opacity=".9">
    <ellipse cx="140" cy="110" rx="70" ry="26"/><ellipse cx="190" cy="96" rx="46" ry="30"/>
    <ellipse cx="560" cy="560" rx="90" ry="24"/><ellipse cx="610" cy="548" rx="50" ry="28"/>
  </g>
  <svg x="20" y="70" width="520" height="520">${island.replace(/^<svg[^>]*>/, (m) => m.replace(/width="[^"]*"|height="[^"]*"/g, ''))}</svg>
  <g transform="translate(560 70)">
    <rect x="6" y="10" width="600" height="490" rx="34" fill="#15304c"/>
    <rect width="600" height="490" rx="34" fill="url(#paper)" stroke="#15304c" stroke-width="6"/>
    <rect x="0" y="0" width="600" height="96" rx="34" fill="#15304c"/>
    <rect x="0" y="60" width="600" height="36" fill="#15304c"/>
    <text x="36" y="62" font-family="Fredoka" font-weight="700" font-size="40" fill="#fff">CITYHOOD</text>
    <text x="566" y="60" text-anchor="end" font-family="Plus Jakarta Sans" font-weight="600" font-size="20" fill="#cde4f5">Certificate of citizenship</text>
    <g transform="translate(104 196)">
      <circle r="64" fill="#ffc83a" stroke="#15304c" stroke-width="5"/>
      ${avatar ? `<image x="-58" y="-58" width="116" height="116" xlink:href="${avatar}" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>` : `<text y="20" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="58" fill="#15304c">${initials}</text>`}
    </g>
    <text x="196" y="182" font-family="Fredoka" font-weight="700" font-size="44" fill="#15304c">${name}</text>
    <text x="198" y="222" font-family="Plus Jakarta Sans" font-weight="600" font-size="24" fill="#46617d">${user}</text>
    <g font-family="Plus Jakarta Sans" font-weight="600" font-size="20" fill="#46617d">
      <text x="40" y="318">Citizen no.</text><text x="230" y="318">Status</text><text x="400" y="318">Issued</text>
    </g>
    <g font-family="Fredoka" font-weight="700" font-size="34" fill="#15304c">
      <text x="40" y="358">${no}</text><text x="230" y="358">${esc(u.tier || 'Citizen')}</text><text x="400" y="358" font-size="28">${esc(issued)}</text>
    </g>
    <line x1="40" y1="398" x2="560" y2="398" stroke="#15304c" stroke-opacity=".14" stroke-width="2" stroke-dasharray="8 8"/>
    <text x="40" y="446" font-family="Plus Jakarta Sans" font-weight="600" font-size="20" fill="#46617d">Floating islands on Robinhood Chain  /  x.com/${esc(handle)}</text>
    <g transform="translate(486 214) rotate(-14)">
      <circle r="76" fill="none" stroke="#ff6b57" stroke-width="7"/>
      <circle r="62" fill="none" stroke="#ff6b57" stroke-width="3"/>
      <text y="-6" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="22" fill="#ff6b57">APPROVED</text>
      <text y="24" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="17" fill="#ff6b57">city in the sky</text>
    </g>
  </g>
</svg>`;
}

export function svgToPng(svg: string, width = 1200) {
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Plus Jakarta Sans' },
  })
    .render()
    .asPng();
}

/* ------------------------------------------------------------------ routes */
export const share = Router();
const cards = new Map<string, { at: number; png: Buffer }>();

async function citizenByName(name: string) {
  const u = await db.one<User>('users', { username: { ilike: name.replace(/[%_]/g, '') } });
  return u && u.status === 'citizen' ? u : null;
}

share.get(
  '/api/citizen/card/:file',
  rateLimit('card', 60, 60_000),
  wrap(async (req, res) => {
    const name = str(req.params.file, 40).replace(/\.png$/i, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(name)) throw notFound();
    const u = await citizenByName(name);
    if (!u) throw notFound('Not a citizen yet.');
    const key = `${u.id}:${u.citizen_no}:${u.tier}:${u.avatar_url}`;
    let hit = cards.get(key);
    if (!hit || Date.now() - hit.at > 6 * 3600_000) {
      const s = await getSettings();
      hit = { at: Date.now(), png: svgToPng(await citizenCardSvg(u, s.x_handle)) };
      if (cards.size > 500) cards.clear();
      cards.set(key, hit);
    }
    res.set('Content-Type', 'image/png').set('Cache-Control', 'public, max-age=3600').send(hit.png);
  }),
);

/** Share link for X: shows the citizenship card as the post image, then sends people to the site. */
share.get(
  '/c/:name',
  wrap(async (req, res) => {
    const name = str(req.params.name, 20);
    const u = /^[A-Za-z0-9_]{1,15}$/.test(name) ? await citizenByName(name) : null;
    const s = await getSettings();
    const dest = `${SITE_URL}/citizenship${u ? `?ref=${encodeURIComponent(u.referral_code)}` : ''}`;
    const title = u ? `@${u.username} is a CITYHOOD citizen` : 'CITYHOOD Citizenship';
    const desc = 'Connect X, finish city tasks and become a citizen of CITYHOOD — floating island cities on Robinhood Chain.';
    const img = u ? `${PUBLIC_API_URL}/api/citizen/card/${encodeURIComponent(u.username)}.png` : `${PUBLIC_API_URL}/api/collection.png`;
    res.set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'public, max-age=300').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(dest)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@${esc(s.x_handle)}">
<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">
<meta http-equiv="refresh" content="0;url=${esc(dest)}">
</head><body style="font-family:sans-serif;background:#cdeffb;color:#15304c;display:grid;place-items:center;min-height:100vh;margin:0">
<a href="${esc(dest)}" style="color:#15304c">Continue to CITYHOOD</a>
<script>location.replace(${JSON.stringify(dest)})</script></body></html>`);
  }),
);
