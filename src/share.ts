import path from 'node:path';
import { readFileSync } from 'node:fs';
import { Router } from 'express';
import { Resvg, renderAsync, type ResvgRenderOptions } from '@resvg/resvg-js';
import { db } from './db';
import { GAME_READY, NFT_READY, PUBLIC_API_URL, SITE_URL } from './config';
import { snapshot, type LandSnapshot } from './chain';
import { sceneFor } from './render';
import { TtlCache } from './cache';
import { getSettings } from './settings';
import { notFound, rateLimit, str, wrap } from './security';
import { renderScene, type SceneBuilding } from './shared/art';
import { DEFAULT_CATALOG } from './shared/economy';
import type { User } from './citizens';

const FONT_DIR = path.join(__dirname, '../assets/fonts');
const FONTS = ['Fredoka_600SemiBold.ttf', 'Fredoka_700Bold.ttf', 'PlusJakartaSans_600SemiBold.ttf', 'PlusJakartaSans_800ExtraBold.ttf'].map((f) => path.join(FONT_DIR, f));

/** the CITYHOOD logo (transparent PNG), embedded into every card */
const LOGO = (() => {
  try {
    return `data:image/png;base64,${readFileSync(path.join(__dirname, '../assets/logo.png')).toString('base64')}`;
  } catch {
    return null;
  }
})();
const logoTag = (x: number, y: number, h: number) => (LOGO ? `<image x="${x}" y="${y}" width="${Math.round(h * 0.846)}" height="${h}" xlink:href="${LOGO}"/>` : '');

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
    ${logoTag(26, 12, 70)}
    <text x="96" y="62" font-family="Fredoka" font-weight="700" font-size="40" fill="#fff">CITYHOOD</text>
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

/** 1200×630 invite card for X: who invites you, their refer code and what you both get. */
export async function referralCardSvg(u: User, handle: string, points: number) {
  const avatar = await avatarData(u.avatar_url);
  const name = esc((u.name || u.username).slice(0, 24));
  const user = esc(`@${u.username}`);
  const code = esc(u.referral_code);
  const island = islandArt((u.referral_code.charCodeAt(0) * 31 + u.referral_code.charCodeAt(5)) % 997);
  const initials = esc((u.username[0] ?? 'C').toUpperCase());
  const host = esc(siteHost());
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6cc6ee"/><stop offset=".62" stop-color="#bfeafa"/><stop offset="1" stop-color="#eaf9fd"/></linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#fff2d6"/></linearGradient>
    <clipPath id="av"><circle cx="0" cy="0" r="40"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  <g fill="#fff" opacity=".92">
    <ellipse cx="120" cy="96" rx="74" ry="26"/><ellipse cx="172" cy="82" rx="46" ry="30"/>
    <ellipse cx="520" cy="574" rx="96" ry="24"/><ellipse cx="572" cy="560" rx="52" ry="28"/>
    <ellipse cx="1100" cy="590" rx="80" ry="22"/>
  </g>
  <svg x="20" y="70" width="520" height="520">${island.replace(/^<svg[^>]*>/, (m) => m.replace(/width="[^"]*"|height="[^"]*"/g, ''))}</svg>
  <g transform="translate(578 62)">
    <rect x="7" y="11" width="580" height="506" rx="34" fill="#15304c"/>
    <rect width="580" height="506" rx="34" fill="url(#paper)" stroke="#15304c" stroke-width="6"/>
    <rect width="580" height="92" rx="34" fill="#15304c"/>
    <rect y="58" width="580" height="34" fill="#15304c"/>
    ${logoTag(24, 12, 68)}
    <text x="92" y="60" font-family="Fredoka" font-weight="700" font-size="38" fill="#fff">CITYHOOD</text>
    <text x="546" y="58" text-anchor="end" font-family="Plus Jakarta Sans" font-weight="600" font-size="20" fill="#cde4f5">You're invited</text>
    <g transform="translate(78 160)">
      <circle r="46" fill="#ffc83a" stroke="#15304c" stroke-width="5"/>
      ${avatar ? `<image x="-40" y="-40" width="80" height="80" xlink:href="${avatar}" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>` : `<text y="15" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="42" fill="#15304c">${initials}</text>`}
    </g>
    <text x="142" y="152" font-family="Fredoka" font-weight="700" font-size="34" fill="#15304c">${name}</text>
    <text x="143" y="186" font-family="Plus Jakarta Sans" font-weight="600" font-size="21" fill="#46617d">${user} invites you to the sky city</text>
    <text x="40" y="258" font-family="Plus Jakarta Sans" font-weight="600" font-size="20" fill="#46617d">Use my refer code</text>
    <rect x="38" y="272" width="504" height="108" rx="22" fill="#fff" stroke="#15304c" stroke-width="4" stroke-dasharray="14 10"/>
    <text x="290" y="350" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="70" letter-spacing="14" fill="#15304c">${code}</text>
    <g transform="translate(40 404)">
      <rect width="${points >= 1000 ? 300 : 280}" height="44" rx="22" fill="#b6fb04"/>
      <text x="20" y="29" font-family="Plus Jakarta Sans" font-weight="800" font-size="19" fill="#1d3300">+${points.toLocaleString('en-US')} points for both of us</text>
    </g>
    <text x="40" y="482" font-family="Plus Jakarta Sans" font-weight="800" font-size="21" fill="#15304c">Get your passport at ${host}</text>
  </g>
</svg>`;
}

const pngOptions = (width: number): ResvgRenderOptions => ({
  fitTo: { mode: 'width', value: width },
  font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Plus Jakarta Sans' },
});

export function svgToPng(svg: string, width = 1200) {
  return new Resvg(svg, pngOptions(width)).render().asPng();
}

/** Same as svgToPng but renders on a worker thread, so a burst of share images never stalls the API. */
export async function svgToPngAsync(svg: string, width = 1200) {
  return (await renderAsync(svg, pngOptions(width))).asPng();
}

/* ------------------------------------------------------------------ land share card */
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const siteHost = () => {
  try {
    return new URL(SITE_URL).host.replace(/^www\./, '');
  } catch {
    return 'cityhood.online';
  }
};

/** 1200×630 card for X: the land itself on the left, a land deed on the right. */
export function landCardSvg(snap: LandSnapshot, handle: string) {
  const id = snap.landId;
  const island = renderScene(DEFAULT_CATALOG.gridSize, sceneFor(snap.land, snap.chainTime), {
    seed: (id % 997) + 7,
    uid: `lc${id}`,
    sky: false,
    clouds: false,
    animate: false,
    padding: 24,
  });
  const no = `#${id}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6cc6ee"/><stop offset=".62" stop-color="#bfeafa"/><stop offset="1" stop-color="#eaf9fd"/></linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#fff2d6"/></linearGradient>
    <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff6c4" stop-opacity=".95"/><stop offset="1" stop-color="#fff6c4" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  <circle cx="320" cy="300" r="300" fill="url(#sun)"/>
  <g fill="#fff" opacity=".92">
    <ellipse cx="120" cy="96" rx="74" ry="26"/><ellipse cx="172" cy="82" rx="46" ry="30"/>
    <ellipse cx="520" cy="574" rx="96" ry="24"/><ellipse cx="572" cy="560" rx="52" ry="28"/>
    <ellipse cx="1100" cy="590" rx="80" ry="22"/>
  </g>
  <svg x="10" y="40" width="600" height="560">${island.replace(/^<svg[^>]*>/, (m) => m.replace(/width="[^"]*"|height="[^"]*"/g, ''))}</svg>
  <g transform="translate(624 74)">
    <rect x="7" y="11" width="540" height="482" rx="34" fill="#15304c"/>
    <rect width="540" height="482" rx="34" fill="url(#paper)" stroke="#15304c" stroke-width="6"/>
    <rect width="540" height="92" rx="34" fill="#15304c"/>
    <rect y="58" width="540" height="34" fill="#15304c"/>
    ${logoTag(24, 12, 68)}
    <text x="92" y="60" font-family="Fredoka" font-weight="700" font-size="38" fill="#fff">CITYHOOD</text>
    <text x="506" y="58" text-anchor="end" font-family="Plus Jakarta Sans" font-weight="600" font-size="20" fill="#cde4f5">@${esc(handle)}</text>
    <text x="36" y="196" font-family="Fredoka" font-weight="700" font-size="${no.length > 5 ? 74 : 88}" fill="#15304c">Land ${esc(no)}</text>
    <text x="38" y="240" font-family="Plus Jakarta Sans" font-weight="600" font-size="24" fill="#46617d">A floating island city on Robinhood Chain</text>
    <g font-family="Plus Jakarta Sans" font-weight="600" font-size="19" fill="#46617d">
      <text x="38" y="306">Island</text><text x="190" y="306">Owner</text>
    </g>
    <g font-family="Fredoka" font-weight="700" font-size="28" fill="#15304c">
      <text x="38" y="344">16 × 16</text><text x="190" y="344">${esc(snap.owner ? short(snap.owner) : '—')}</text>
    </g>
    <line x1="38" y1="384" x2="502" y2="384" stroke="#15304c" stroke-opacity=".14" stroke-width="2" stroke-dasharray="8 8"/>
    <text x="38" y="434" font-family="Plus Jakarta Sans" font-weight="800" font-size="23" fill="#15304c">Grab yours at ${esc(siteHost())}</text>
    <g transform="translate(450 322) rotate(-12)">
      <circle r="56" fill="#fffaf0" fill-opacity=".6" stroke="#ff6b57" stroke-width="6"/>
      <circle r="45" fill="none" stroke="#ff6b57" stroke-width="2.5"/>
      <text y="8" text-anchor="middle" font-family="Fredoka" font-weight="700" font-size="22" fill="#ff6b57">MINTED</text>
    </g>
  </g>
</svg>`;
}

/** The small HTML page X (and other apps) read for a share link: preview card tags, then on to the site. */
function ogPage(o: { title: string; desc: string; img: string; dest: string; handle: string }) {
  const t = esc(o.title);
  const d = esc(o.desc);
  const i = esc(o.img);
  const u = esc(o.dest);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${t}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta property="og:type" content="website"><meta property="og:site_name" content="CITYHOOD"><meta property="og:title" content="${t}"><meta property="og:description" content="${d}">
<meta property="og:image" content="${i}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${t}">
<meta property="og:url" content="${u}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@${esc(o.handle)}">
<meta name="twitter:title" content="${t}"><meta name="twitter:description" content="${d}"><meta name="twitter:image" content="${i}"><meta name="twitter:image:alt" content="${t}">
<meta http-equiv="refresh" content="0;url=${u}">
</head><body style="font-family:sans-serif;background:#cdeffb;color:#15304c;display:grid;place-items:center;min-height:100vh;margin:0">
<a href="${u}" style="color:#15304c">Continue to CITYHOOD</a>
<script>location.replace(${JSON.stringify(o.dest).replace(/</g, '\\u003c')})</script></body></html>`;
}

/* ------------------------------------------------------------------ routes */
export const share = Router();
const cards = new Map<string, { at: number; png: Buffer }>();

/** Rendered share cards (LRU, single-flight: 50 people asking for the same new card share one render). */
const landCards = new TtlCache<Buffer>(300);
const snaps = new TtlCache<LandSnapshot | null>(3000);
const landSnap = (id: number) => snaps.get(String(id), 15_000, () => snapshot(id));
const landId = (v: string) => {
  const m = /^(\d{1,7})(\.png)?$/i.exec(v);
  const id = m ? Number(m[1]) : 0;
  return id >= 1 ? id : 0;
};

/** X handles are case-insensitive. ILIKE treats "_" as a wildcard, so candidates are re-checked exactly. */
async function citizenByName(name: string) {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(name)) return null;
  const rows = await db.select<User>('users', { where: { username: { ilike: name }, status: 'citizen' }, limit: 10 });
  return rows.find((u) => u.username.toLowerCase() === name.toLowerCase()) ?? null;
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
      hit = { at: Date.now(), png: await svgToPngAsync(await citizenCardSvg(u, s.x_handle)) };
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
    res.set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'public, max-age=300').send(ogPage({ title, desc, img, dest, handle: s.x_handle }));
  }),
);

/** The land's share card (PNG). Used as the X post image and by the "Save image" button after a mint. */
share.get(
  '/api/land/card/:file',
  rateLimit('landcard', 40, 60_000),
  wrap(async (req, res) => {
    if (!NFT_READY) throw notFound();
    const id = landId(str(req.params.file, 16));
    if (!id) throw notFound();
    const snap = await landSnap(id);
    if (!snap) throw notFound('Land not minted yet.');
    const s = await getSettings();
    const state = `${snap.owner}:${snap.land.buildings.length}:${snap.land.score}:${s.x_handle}`;
    const png = await landCards.get(`${id}:${state}`, 30 * 60_000, () => svgToPngAsync(landCardSvg(snap, s.x_handle)));
    res
      .set('Content-Type', 'image/png')
      .set('Cache-Control', 'public, max-age=600')
      .set('Content-Disposition', `inline; filename="cityhood-land-${id}.png"`)
      .send(png);
  }),
);

/** Share link for a land: X shows the land card as the post image, people who click go to the site. */
share.get(
  '/l/:id',
  rateLimit('landpage', 120, 60_000),
  wrap(async (req, res) => {
    const id = landId(str(req.params.id, 16));
    const snap = id && NFT_READY ? await landSnap(id).catch(() => null) : null;
    const s = await getSettings();
    const dest = snap && GAME_READY ? `${SITE_URL}/city/${id}` : `${SITE_URL}/grab`;
    const title = snap ? `CITYHOOD Land #${id}` : 'CITYHOOD Land';
    const desc = snap
      ? `Land #${id} was just minted on Robinhood Chain. Buy $CITY, get a mint key and grab your own floating island city.`
      : 'Floating island cities on Robinhood Chain. Buy $CITY, get a mint key and grab your Land.';
    const img = snap ? `${PUBLIC_API_URL}/api/land/card/${id}.png` : `${PUBLIC_API_URL}/api/collection.png`;
    res.set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'public, max-age=300').send(ogPage({ title, desc, img, dest, handle: s.x_handle }));
  }),
);

/* ------------------------------------------------------------------ refer codes */
const refCards = new TtlCache<Buffer>(300);
const refUsers = new TtlCache<User | null>(5000);
const refCode = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const userByRef = (code: string) =>
  refUsers.get(code, 60_000, async () => {
    const u = await db.one<User>('users', { referral_code: code });
    return u && u.status !== 'banned' && u.status !== 'rejected' ? u : null;
  });

/** Invite card image (PNG) for a refer code. */
share.get(
  '/api/citizen/refcard/:file',
  rateLimit('refcard', 40, 60_000),
  wrap(async (req, res) => {
    const code = refCode(str(req.params.file, 20).replace(/\.png$/i, ''));
    if (code.length !== 6) throw notFound();
    const u = await userByRef(code);
    if (!u) throw notFound();
    const s = await getSettings();
    const png = await refCards.get(`${code}:${u.avatar_url}:${u.name}:${s.referral_points}:${s.x_handle}`, 6 * 3600_000, async () => svgToPngAsync(await referralCardSvg(u, s.x_handle, s.referral_points)));
    res.set('Content-Type', 'image/png').set('Cache-Control', 'public, max-age=3600').send(png);
  }),
);

/** Share link for a refer code: X shows the invite card, people who click land on Citizenship with the code. */
share.get(
  '/r/:code',
  rateLimit('refpage', 120, 60_000),
  wrap(async (req, res) => {
    const code = refCode(str(req.params.code, 20));
    const u = code.length === 6 ? await userByRef(code).catch(() => null) : null;
    const s = await getSettings();
    const dest = `${SITE_URL}/citizenship${u ? `?ref=${code}` : ''}`;
    const title = u ? `@${u.username} invited you to CITYHOOD` : 'CITYHOOD Citizenship';
    const desc = u
      ? `Use refer code ${code} when you connect X and you both get +${s.referral_points} points. Floating island cities on Robinhood Chain.`
      : 'Connect X, finish city tasks and become a citizen of CITYHOOD: floating island cities on Robinhood Chain.';
    const img = u ? `${PUBLIC_API_URL}/api/citizen/refcard/${code}.png` : `${PUBLIC_API_URL}/api/collection.png`;
    res.set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'public, max-age=300').send(ogPage({ title, desc, img, dest, handle: s.x_handle }));
  }),
);
