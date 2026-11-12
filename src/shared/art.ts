/**
 * CITYHOOD art engine v2 — cartoon isometric SVG as plain strings (no DOM / React).
 * Shared by the game map, the website and the backend NFT renderer.
 *
 * Grid (gx, gy) projects with a 2:1 isometric projection. Building functions draw in LOCAL coords:
 * the footprint spans 0..size on both axes with iso(0,0) at the origin; callers translate to iso(x,y).
 * Visible faces: "left" = plane y = y1 (faces the viewer's left), "right" = plane x = x1.
 */

export const HW = 32;
export const HH = 16;
export const OUTLINE = '#2b2236';
const SW = 1.5;
const RX = HW * Math.SQRT2;
const RY = HH * Math.SQRT2;

export type P = [number, number];
export const iso = (x: number, y: number, z = 0): P => [(x - y) * HW, (x + y) * HH - z];
const I = iso;

/* ------------------------------------------------------------------ svg helpers */
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const pts = (a: P[]) => a.map((p) => f1(p[0]) + ',' + f1(p[1])).join(' ');
const dq = (a: P[]) => 'M' + a.map((p) => f1(p[0]) + ',' + f1(p[1])).join('L') + 'Z';
const poly = (a: P[], fill: string, sw = SW, extra = '') =>
  `<polygon points="${pts(a)}" fill="${fill}" stroke="${OUTLINE}" stroke-width="${sw}" stroke-linejoin="round"${extra ? ' ' + extra : ''}/>`;
const polyNS = (a: P[], fill: string, extra = '') => `<polygon points="${pts(a)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`;
const ln = (a: P, b: P, stroke = OUTLINE, w = SW, extra = '') =>
  `<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"${extra ? ' ' + extra : ''}/>`;
const circ = (c: P, r: number, fill: string, sw = SW, extra = '') =>
  `<circle cx="${f1(c[0])}" cy="${f1(c[1])}" r="${f1(r)}" fill="${fill}"${sw > 0 ? ` stroke="${OUTLINE}" stroke-width="${sw}"` : ''}${extra ? ' ' + extra : ''}/>`;
const ell = (c: P, rx: number, ry: number, fill: string, sw = SW, extra = '') =>
  `<ellipse cx="${f1(c[0])}" cy="${f1(c[1])}" rx="${f1(rx)}" ry="${f1(ry)}" fill="${fill}"${sw > 0 ? ` stroke="${OUTLINE}" stroke-width="${sw}"` : ''}${extra ? ' ' + extra : ''}/>`;
const pathS = (d: string, fill: string, sw = SW, extra = '') =>
  `<path d="${d}" fill="${fill}"${sw > 0 ? ` stroke="${OUTLINE}" stroke-width="${sw}" stroke-linejoin="round"` : ''}${extra ? ' ' + extra : ''}/>`;
const g = (cls: string, inner: string, extra = '') => `<g class="${cls}"${extra ? ' ' + extra : ''}>${inner}</g>`;

/* ------------------------------------------------------------------ light (3D shading) */
/**
 * Shared gradients that give the flat cartoon faces volume: lit tops, walls that darken toward the ground,
 * round shading on cylinders, soft contact shadows and deeper island rock. Every standalone SVG embeds them
 * (renderScene, buildingIcon) and the web app mounts one hidden copy at its root for inline maps. Overlays
 * reference them with a `none` fallback, so art without the defs simply renders flat.
 * Colours are written as rgb() so nightify() (which rewrites #hex) leaves them alone.
 */
export const LIGHT_DEFS =
  '<linearGradient id="chL-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(255,255,255)" stop-opacity=".22"/><stop offset=".42" stop-color="rgb(255,255,255)" stop-opacity="0"/><stop offset=".78" stop-color="rgb(14,18,40)" stop-opacity=".05"/><stop offset="1" stop-color="rgb(14,18,40)" stop-opacity=".24"/></linearGradient>' +
  '<linearGradient id="chL-r" x1="0" y1="0" x2=".55" y2="1"><stop offset="0" stop-color="rgb(255,255,255)" stop-opacity=".1"/><stop offset=".45" stop-color="rgb(14,18,40)" stop-opacity=".04"/><stop offset="1" stop-color="rgb(14,18,40)" stop-opacity=".3"/></linearGradient>' +
  '<linearGradient id="chL-t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(255,255,255)" stop-opacity=".38"/><stop offset=".55" stop-color="rgb(255,255,255)" stop-opacity="0"/><stop offset="1" stop-color="rgb(14,18,40)" stop-opacity=".07"/></linearGradient>' +
  '<linearGradient id="chL-c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgb(14,18,40)" stop-opacity=".1"/><stop offset=".28" stop-color="rgb(255,255,255)" stop-opacity=".3"/><stop offset=".52" stop-color="rgb(255,255,255)" stop-opacity="0"/><stop offset="1" stop-color="rgb(14,18,40)" stop-opacity=".26"/></linearGradient>' +
  '<radialGradient id="chL-ao" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="rgb(14,18,40)" stop-opacity=".34"/><stop offset=".62" stop-color="rgb(14,18,40)" stop-opacity=".16"/><stop offset="1" stop-color="rgb(14,18,40)" stop-opacity="0"/></radialGradient>' +
  '<linearGradient id="chL-rock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(255,255,255)" stop-opacity=".16"/><stop offset=".3" stop-color="rgb(14,18,40)" stop-opacity="0"/><stop offset="1" stop-color="rgb(14,18,40)" stop-opacity=".42"/></linearGradient>' +
  '<radialGradient id="chL-sun" cx=".32" cy=".28" r=".8"><stop offset="0" stop-color="rgb(255,255,240)" stop-opacity=".3"/><stop offset=".6" stop-color="rgb(255,255,240)" stop-opacity=".06"/><stop offset="1" stop-color="rgb(255,255,240)" stop-opacity="0"/></radialGradient>';
/** CSS for the light overlays: softer at night. */
export const LIGHT_STYLE = '.ch-sh{pointer-events:none}.night .ch-sh{opacity:.55}';
/** Shading overlay on a polygon (no outline). */
const shadeOver = (a: P[], id: string) => `<polygon points="${pts(a)}" fill="url(#${id}) none" class="ch-sh"/>`;

/* ------------------------------------------------------------------ colour helpers */
function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export function shade(hex: string, amt: number): string {
  return toHex(rgb(hex).map((c) => (amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
}
export function mix(a: string, b: string, t: number): string {
  const A = rgb(a);
  const B = rgb(b);
  return toHex(A.map((v, i) => v * (1 - t) + B[i] * t));
}
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const vhash = (x: number, y: number, salt = 0) => {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};
const pick = <T,>(arr: T[], h: number) => arr[Math.abs(Math.floor(h)) % arr.length];

/* ------------------------------------------------------------------ palette */
const WALLS = ['#f6b26b', '#f7d77c', '#f08a7e', '#9ccfee', '#c2acee', '#f5b8cc', '#a6dfa9', '#f8e7bd', '#ffd3a8'];
const ROOFS = ['#e05a4f', '#4a7bd0', '#3fa47e', '#8b5a3c', '#e57f3c', '#7b5cc4', '#2f8f9d'];
const TOWERS = ['#ef7d6d', '#f7c84a', '#5fc3ae', '#9b7fd4', '#6aa9e6', '#f29bb8', '#7ccf8a'];
// window colours come in "lit" / "dark" pairs that look the same by day and split at night
const WIN = '#c7ecff';
const WIN_D = '#c3e8fc';
const WINR = '#9fd3f0';
const WINR_D = '#9bcfec';
const GLASS = '#cfe9ff';
const GLASSR = '#a9d4f2';
const LAMP = '#ffe27a';
const GLOW1 = '#ffd86a';
const GLOW2 = '#fff6c8';
const NEON_A = '#ff4fa3';
const NEON_B = '#39e0ff';
const HEAD = '#fff3a0';
const BLINK_R = '#ff4d4d';
const BLINK_B = '#3d8bff';
const GRASS_TOP = '#8fd45b';
const LOT_GRASS = '#9fe06c';

/* ------------------------------------------------------------------ night palette */
const NIGHT_FIXED: Record<string, string> = {
  [WIN]: '#ffd66b',
  [WINR]: '#f0b94c',
  [GLASS]: '#ffe08f',
  [GLASSR]: '#eebf5a',
  [WIN_D]: '#34416c',
  [WINR_D]: '#2c3862',
  [LAMP]: '#fff1a8',
  [GLOW1]: GLOW1,
  [GLOW2]: GLOW2,
  [NEON_A]: NEON_A,
  [NEON_B]: NEON_B,
  [HEAD]: HEAD,
  [BLINK_R]: BLINK_R,
  [BLINK_B]: BLINK_B,
  [OUTLINE]: '#16122a',
};
const nightCache = new Map<string, string>();
const colorNight = (hex: string) => {
  const k = hex.toLowerCase();
  if (NIGHT_FIXED[k]) return NIGHT_FIXED[k];
  return mix(k, '#16214a', 0.56);
};
/** Recolours an SVG string for night: dusky world, lit windows, glowing lamps. */
export function nightify(svg: string): string {
  const hit = nightCache.get(svg);
  if (hit) return hit;
  const out = svg.replace(/#[0-9a-fA-F]{6}\b/g, colorNight);
  if (nightCache.size > 4000) nightCache.clear();
  nightCache.set(svg, out);
  return out;
}

/* ------------------------------------------------------------------ primitives */
interface BoxOpts {
  top?: string;
  left?: string;
  right?: string;
  sw?: number;
  ao?: boolean;
  rim?: boolean;
}
function box(x0: number, y0: number, x1: number, y1: number, z0: number, h: number, color: string, o: BoxOpts = {}) {
  const sw = o.sw ?? SW;
  const top = o.top ?? shade(color, 0.2);
  const left = o.left ?? color;
  const right = o.right ?? shade(color, -0.2);
  const fl: P[] = [I(x0, y1, z0), I(x1, y1, z0), I(x1, y1, z0 + h), I(x0, y1, z0 + h)];
  const fr: P[] = [I(x1, y1, z0), I(x1, y0, z0), I(x1, y0, z0 + h), I(x1, y1, z0 + h)];
  let s = poly(fl, left, sw) + poly(fr, right, sw);
  if (h > 2.5) s += shadeOver(fl, 'chL-l') + shadeOver(fr, 'chL-r');
  if (o.ao && h > 8) {
    s += polyNS([I(x0, y1, z0), I(x1, y1, z0), I(x1, y1, z0 + 3), I(x0, y1, z0 + 3)], shade(left, -0.14));
    s += polyNS([I(x1, y1, z0), I(x1, y0, z0), I(x1, y0, z0 + 3), I(x1, y1, z0 + 3)], shade(right, -0.14));
  }
  const ft: P[] = [I(x0, y0, z0 + h), I(x1, y0, z0 + h), I(x1, y1, z0 + h), I(x0, y1, z0 + h)];
  s += poly(ft, top, sw) + shadeOver(ft, 'chL-t');
  if (o.rim) s += `<polyline points="${pts([I(x0, y1, z0 + h), I(x1, y1, z0 + h), I(x1, y0, z0 + h)])}" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="1.1" class="ch-day"/>`;
  return s;
}
/** quad on the left face (plane y = y1, spanning x0..x1), u in 0..1 along x */
function qLp(x0: number, x1: number, y1: number, u0: number, u1: number, z0: number, z1: number): P[] {
  const X = (u: number) => x0 + (x1 - x0) * u;
  return [I(X(u0), y1, z0), I(X(u1), y1, z0), I(X(u1), y1, z1), I(X(u0), y1, z1)];
}
/** quad on the right face (plane x = x1). u = 0 at the front corner (x1,y1) -> 1 at (x1,y0) */
function qRp(y0: number, y1: number, x1: number, u0: number, u1: number, z0: number, z1: number): P[] {
  const Y = (u: number) => y1 - (y1 - y0) * u;
  return [I(x1, Y(u0), z0), I(x1, Y(u1), z0), I(x1, Y(u1), z1), I(x1, Y(u0), z1)];
}
const qL = (x0: number, x1: number, y1: number, u0: number, u1: number, z0: number, z1: number, fill: string, sw = 1.2) => poly(qLp(x0, x1, y1, u0, u1, z0, z1), fill, sw);
const qR = (y0: number, y1: number, x1: number, u0: number, u1: number, z0: number, z1: number, fill: string, sw = 1.2) => poly(qRp(y0, y1, x1, u0, u1, z0, z1), fill, sw);

function gridQuads(face: 'L' | 'R', a0: number, a1: number, fixed: number, cols: number, rows: number, zs: number, ze: number, wf = 0.55, hf = 0.58) {
  const out: P[][] = [];
  const rh = (ze - zs) / rows;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const uc = (c + 0.5) / cols;
      const hw = wf / cols / 2;
      const z0 = zs + rh * r + (rh * (1 - hf)) / 2;
      out.push(face === 'L' ? qLp(a0, a1, fixed, uc - hw, uc + hw, z0, z0 + rh * hf) : qRp(a0, a1, fixed, uc - hw, uc + hw, z0, z0 + rh * hf));
    }
  return out;
}
/** Windows as two compound paths (lit / unlit at night) — few DOM nodes, lots of windows. */
function winPaths(quads: P[][], face: 'L' | 'R', seed: number, litPct = 62, sw = 1.1) {
  let dl = '';
  let dd = '';
  quads.forEach((q, i) => {
    if (vhash(i, seed, 7) % 100 < litPct) dl += dq(q);
    else dd += dq(q);
  });
  const [lit, dark] = face === 'L' ? [WIN, WIN_D] : [WINR, WINR_D];
  return (dl ? pathS(dl, lit, sw) : '') + (dd ? pathS(dd, dark, sw) : '');
}
const windowsL = (x0: number, x1: number, y1: number, cols: number, rows: number, zs: number, ze: number, seed = 1, wf = 0.55, hf = 0.58) =>
  winPaths(gridQuads('L', x0, x1, y1, cols, rows, zs, ze, wf, hf), 'L', seed);
const windowsR = (y0: number, y1: number, x1: number, cols: number, rows: number, zs: number, ze: number, seed = 1, wf = 0.55, hf = 0.58) =>
  winPaths(gridQuads('R', y0, y1, x1, cols, rows, zs, ze, wf, hf), 'R', seed);

/** translucent diagonal glass reflection on a face */
function sheenL(x0: number, x1: number, y1: number, z0: number, z1: number) {
  const X = (u: number) => x0 + (x1 - x0) * u;
  return polyNS([I(X(0.12), y1, z1), I(X(0.32), y1, z1), I(X(0.18), y1, z0), I(X(0.02), y1, z0)], '#ffffff', 'fill-opacity=".28" class="ch-day"');
}
function sheenR(y0: number, y1: number, x1: number, z0: number, z1: number) {
  const Y = (u: number) => y1 - (y1 - y0) * u;
  return polyNS([I(x1, Y(0.5), z1), I(x1, Y(0.62), z1), I(x1, Y(0.5), z0), I(x1, Y(0.38), z0)], '#ffffff', 'fill-opacity=".18" class="ch-day"');
}

function gableX(x0: number, y0: number, x1: number, y1: number, z: number, rh: number, roof: string, wall: string, ov = 0.07, lines = false) {
  const ym = (y0 + y1) / 2;
  const R0 = I(x0 - ov, ym, z + rh);
  const R1 = I(x1 + ov, ym, z + rh);
  const A = I(x0 - ov, y1 + ov, z);
  const B = I(x1 + ov, y1 + ov, z);
  let s =
    poly([I(x0 - ov, y0 - ov, z), I(x1 + ov, y0 - ov, z), R1, R0], shade(roof, -0.1)) +
    poly([I(x1, y1, z), I(x1, y0, z), I(x1, ym, z + rh)], shade(wall, -0.2)) +
    shadeOver([I(x1, y1, z), I(x1, y0, z), I(x1, ym, z + rh)], 'chL-r') +
    poly([A, B, R1, R0], roof) +
    shadeOver([R0, R1, B, A], 'chL-l');
  if (lines) {
    for (const t of [0.34, 0.67]) {
      const p0: P = [A[0] + (R0[0] - A[0]) * t, A[1] + (R0[1] - A[1]) * t];
      const p1: P = [B[0] + (R1[0] - B[0]) * t, B[1] + (R1[1] - B[1]) * t];
      s += ln(p0, p1, shade(roof, -0.25), 1);
    }
    s += ln(R0, R1, shade(roof, 0.3), 2.2);
  }
  return s;
}
function gableY(x0: number, y0: number, x1: number, y1: number, z: number, rh: number, roof: string, wall: string, ov = 0.07, lines = false) {
  const xm = (x0 + x1) / 2;
  const R0 = I(xm, y0 - ov, z + rh);
  const R1 = I(xm, y1 + ov, z + rh);
  const A = I(x1 + ov, y1 + ov, z);
  const B = I(x1 + ov, y0 - ov, z);
  let s =
    poly([I(x0 - ov, y0 - ov, z), I(x0 - ov, y1 + ov, z), R1, R0], shade(roof, -0.1)) +
    shadeOver([I(x0 - ov, y0 - ov, z), I(x0 - ov, y1 + ov, z), R1, R0], 'chL-t') +
    poly([I(x0, y1, z), I(x1, y1, z), I(xm, y1, z + rh)], wall) +
    shadeOver([I(x0, y1, z), I(x1, y1, z), I(xm, y1, z + rh)], 'chL-l') +
    poly([A, B, R0, R1], shade(roof, -0.16)) +
    shadeOver([R1, R0, B, A], 'chL-r');
  if (lines) {
    for (const t of [0.34, 0.67]) {
      const p0: P = [A[0] + (R1[0] - A[0]) * t, A[1] + (R1[1] - A[1]) * t];
      const p1: P = [B[0] + (R0[0] - B[0]) * t, B[1] + (R0[1] - B[1]) * t];
      s += ln(p0, p1, shade(roof, -0.35), 1);
    }
    s += ln(R0, R1, shade(roof, 0.25), 2.2);
  }
  return s;
}
function pyramid(x0: number, y0: number, x1: number, y1: number, z: number, rh: number, roof: string, ov = 0.07) {
  const A = I((x0 + x1) / 2, (y0 + y1) / 2, z + rh);
  const fl: P[] = [I(x0 - ov, y1 + ov, z), I(x1 + ov, y1 + ov, z), A];
  const fr: P[] = [I(x1 + ov, y1 + ov, z), I(x1 + ov, y0 - ov, z), A];
  return poly(fl, roof) + shadeOver(fl, 'chL-l') + poly(fr, shade(roof, -0.18)) + shadeOver(fr, 'chL-r');
}
function cyl(cx: number, cy: number, r: number, z0: number, h: number, color: string, top?: string, sw = SW) {
  const [px, py] = I(cx, cy);
  const rx = r * RX;
  const ry = r * RY;
  const by = py - z0;
  const ty = py - z0 - h;
  const side = `<path d="M${f1(px - rx)},${f1(ty)} L${f1(px - rx)},${f1(by)} A${f1(rx)},${f1(ry)} 0 0 0 ${f1(px + rx)},${f1(by)} L${f1(px + rx)},${f1(ty)} Z" fill="${color}" stroke="${OUTLINE}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  const shadeSide = `<path d="M${f1(px + rx * 0.35)},${f1(ty + ry * 0.94)} L${f1(px + rx * 0.35)},${f1(by + ry * 0.94)} A${f1(rx)},${f1(ry)} 0 0 0 ${f1(px + rx)},${f1(by)} L${f1(px + rx)},${f1(ty)} Z" fill="${shade(color, -0.18)}"/>`;
  const round = `<path d="M${f1(px - rx)},${f1(ty)} L${f1(px - rx)},${f1(by)} A${f1(rx)},${f1(ry)} 0 0 0 ${f1(px + rx)},${f1(by)} L${f1(px + rx)},${f1(ty)} Z" fill="url(#chL-c) none" class="ch-sh"/>`;
  return side + shadeSide + round + ell([px, ty], rx, ry, top ?? shade(color, 0.15), sw) + `<ellipse cx="${f1(px)}" cy="${f1(ty)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="url(#chL-t) none" class="ch-sh"/>`;
}
/** soft ambient-occlusion pad under a footprint */
const ao = (x0: number, y0: number, x1: number, y1: number, k = 0.05) =>
  polyNS([I(x0 - 0.22, y0 - 0.1), I(x1 + 0.3, y0 - 0.1), I(x1 + 0.3, y1 + 0.34), I(x0 - 0.22, y1 + 0.34)], 'url(#chL-ao) none', 'class="ch-sh"') +
  polyNS([I(x0 - k, y0 - k), I(x1 + k, y0 - k), I(x1 + k, y1 + k), I(x0 - k, y1 + k)], '#1d2a3a', 'fill-opacity=".11"');

/* ------------------------------------------------------------------ lots (ground pads) */
type LotKind = 'grass' | 'paved' | 'plaza' | 'asphalt' | 'dirt';
function lot(size: number, kind: LotKind, v = 0) {
  const k = 0.035;
  const a = I(k, k);
  const b = I(size - k, k);
  const c = I(size - k, size - k);
  const d = I(k, size - k);
  const base: Record<LotKind, string> = { grass: LOT_GRASS, paved: '#e9e4d8', plaza: '#efe6d0', asphalt: '#9097a4', dirt: '#cfa874' };
  let s = poly([a, b, c, d], base[kind], 1.1);
  if (kind === 'paved' || kind === 'plaza') {
    let dd = '';
    const n = kind === 'plaza' ? 4 * size : 3 * size;
    for (let i = 1; i < n; i++) {
      const t = (i / n) * (size - 2 * k) + k;
      dd += `M${f1(I(t, k)[0])},${f1(I(t, k)[1])}L${f1(I(t, size - k)[0])},${f1(I(t, size - k)[1])}`;
      dd += `M${f1(I(k, t)[0])},${f1(I(k, t)[1])}L${f1(I(size - k, t)[0])},${f1(I(size - k, t)[1])}`;
    }
    s += `<path d="${dd}" stroke="${kind === 'plaza' ? '#dccfb0' : '#d6d0c2'}" stroke-width="1" fill="none"/>`;
  } else if (kind === 'asphalt') {
    const r = mulberry32(v + 3);
    let dd = '';
    for (let i = 0; i < size * 3; i++) {
      const t = 0.15 + r() * (size - 0.3);
      dd += `M${f1(I(t, 0.12)[0])},${f1(I(t, 0.12)[1])}L${f1(I(t, 0.32)[0])},${f1(I(t, 0.32)[1])}`;
    }
    s += `<path d="${dd}" stroke="#f3d34a" stroke-width="1.6" fill="none"/>`;
  } else if (kind === 'grass') {
    s += polyNS([I(k + 0.06, k + 0.06), I(size - k - 0.06, k + 0.06), I(size - k - 0.06, size - k - 0.06), I(k + 0.06, size - k - 0.06)], '#ffffff', 'fill-opacity=".10"');
  } else {
    const r = mulberry32(v + 9);
    for (let i = 0; i < 7 * size; i++) s += circ(I(k + r() * (size - 2 * k), k + r() * (size - 2 * k)), 0.9 + r() * 1.3, '#b48a57', 0);
  }
  return s;
}

/* ------------------------------------------------------------------ nature */
export type TreeKind = 'round' | 'pine' | 'poplar';
export function tree(gx: number, gy: number, sc = 1, green = '#5cbf4a', z = 0, kind: TreeKind = 'round'): string {
  const [x, y] = I(gx, gy, z);
  let s = ell([x, y], 9 * sc, 4.5 * sc, '#1d2a3a', 0, 'fill-opacity=".16"');
  if (kind === 'pine') {
    s += `<rect x="${f1(x - 2 * sc)}" y="${f1(y - 7 * sc)}" width="${f1(4 * sc)}" height="${f1(7 * sc)}" rx="1" fill="#8b5a3c" stroke="${OUTLINE}" stroke-width="1.2"/>`;
    const dark = shade(green, -0.22);
    let c = '';
    [
      [0, 10, 26],
      [-7, 8, 20],
      [-13, 6, 14],
    ].forEach(([dy, w, h]) => {
      c += `<polygon points="${f1(x - w * sc)},${f1(y - (6 - dy) * sc)} ${f1(x + w * sc)},${f1(y - (6 - dy) * sc)} ${f1(x)},${f1(y - (h - dy + 6) * sc)}" fill="${dark}" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/>`;
      c += `<polygon points="${f1(x - w * sc + 2)},${f1(y - (6 - dy) * sc - 1)} ${f1(x)},${f1(y - (6 - dy) * sc - 1)} ${f1(x)},${f1(y - (h - dy + 6) * sc + 3)}" fill="${shade(dark, 0.18)}"/>`;
    });
    return s + g('ch-sway', c);
  }
  if (kind === 'poplar') {
    s += `<rect x="${f1(x - 1.8 * sc)}" y="${f1(y - 8 * sc)}" width="${f1(3.6 * sc)}" height="${f1(8 * sc)}" rx="1" fill="#8b5a3c" stroke="${OUTLINE}" stroke-width="1.2"/>`;
    const c =
      ell([x, y - 20 * sc], 7.5 * sc, 15 * sc, green, 1.4) +
      ell([x + 2.5 * sc, y - 16 * sc], 4 * sc, 9 * sc, shade(green, -0.18), 0) +
      ell([x - 2.5 * sc, y - 27 * sc], 2.2 * sc, 4.5 * sc, shade(green, 0.3), 0);
    return s + g('ch-sway', c);
  }
  const blobs: [number, number, number][] = [
    [x - 5 * sc, y - 14 * sc, 7 * sc],
    [x + 5 * sc, y - 14 * sc, 7 * sc],
    [x, y - 21 * sc, 8 * sc],
  ];
  s += `<rect x="${f1(x - 2.2 * sc)}" y="${f1(y - 10 * sc)}" width="${f1(4.4 * sc)}" height="${f1(10 * sc)}" rx="1" fill="#8b5a3c" stroke="${OUTLINE}" stroke-width="1.3"/>`;
  let c = blobs.map(([bx, by, r]) => circ([bx, by], r + 1.5, OUTLINE, 0)).join('');
  c += blobs.map(([bx, by, r]) => circ([bx, by], r, green, 0)).join('');
  c += circ([x + 4 * sc, y - 12 * sc], 4.5 * sc, shade(green, -0.18), 0);
  c += circ([x - 3 * sc, y - 23.5 * sc], 3 * sc, shade(green, 0.32), 0);
  return s + g('ch-sway', c);
}
function bush(gx: number, gy: number, sc = 1, green = '#58b545', z = 0) {
  const [x, y] = I(gx, gy, z);
  const b: [number, number, number][] = [
    [x - 3.5 * sc, y - 3 * sc, 4 * sc],
    [x + 3.5 * sc, y - 3 * sc, 4 * sc],
    [x, y - 6 * sc, 4.5 * sc],
  ];
  return (
    b.map(([bx, by, r]) => circ([bx, by], r + 1.3, OUTLINE, 0)).join('') +
    b.map(([bx, by, r]) => circ([bx, by], r, green, 0)).join('') +
    circ([x - 1.5 * sc, y - 8 * sc], 1.6 * sc, shade(green, 0.35), 0)
  );
}
const FLOWER_COLS = ['#ffffff', '#ffd84d', '#ff8fb1', '#ff6b6b', '#c7a6ff', '#ffa94d'];
function flowers(gx: number, gy: number, seed: number, n = 4, spread = 0.3, z = 0) {
  const r = mulberry32(seed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const [x, y] = I(gx + (r() - 0.5) * spread, gy + (r() - 0.5) * spread, z);
    s += circ([x, y - 1], 1.9, pick(FLOWER_COLS, r() * 100), 0.8);
  }
  return s;
}
function hedge(a: P, b: P, color = '#4fae43') {
  return ln(a, b, OUTLINE, 9.5) + ln(a, b, color, 7) + ln([a[0], a[1] - 2], [b[0], b[1] - 2], shade(color, 0.25), 2.4);
}
function smoke(x: number, y: number, delay = 0) {
  return `<g class="ch-smoke" style="animation-delay:${delay}s">${[
    [0, 0, 6],
    [7, -5, 7],
    [2, -12, 8],
  ]
    .map(([dx, dy, r]) => circ([x + dx, y + dy], r, '#ffffff', 1.3))
    .join('')}</g>`;
}
/** street lamp standing at ground point (gx, gy) */
function lamp(gx: number, gy: number, h = 22) {
  const [x, y] = I(gx, gy);
  return (
    ell([x, y], 3, 1.5, '#1d2a3a', 0, 'fill-opacity=".25"') +
    ln([x, y], [x, y - h], OUTLINE, 3) +
    ln([x, y], [x, y - h], '#5b6475', 1.6) +
    ln([x, y - h], [x + 5, y - h - 2], OUTLINE, 2) +
    ell([x + 5.5, y - h - 1], 3.4, 2, LAMP, 1.1) +
    halo([x + 5.5, y + 1], 16, GLOW1, 8) + halo([x + 5.5, y - h - 1], 12, GLOW2)
  );
}
function bench(gx: number, gy: number, alongX = true) {
  const w = 0.14;
  return alongX
    ? box(gx - w, gy - 0.04, gx + w, gy + 0.04, 2, 2.5, '#b9763f', { sw: 1 }) + box(gx - w, gy - 0.05, gx + w, gy - 0.03, 2, 7, '#a0683f', { sw: 1 })
    : box(gx - 0.04, gy - w, gx + 0.04, gy + w, 2, 2.5, '#b9763f', { sw: 1 }) + box(gx - 0.05, gy - w, gx - 0.03, gy + w, 2, 7, '#a0683f', { sw: 1 });
}
function planter(gx: number, gy: number, seed = 1) {
  return box(gx - 0.09, gy - 0.09, gx + 0.09, gy + 0.09, 0, 4, '#c98f5c', { sw: 1 }) + bush(gx, gy, 0.55, '#5cbf4a', 4) + flowers(gx, gy, seed, 2, 0.1, 4);
}
function cone(gx: number, gy: number) {
  const [cx, cy] = I(gx, gy);
  return `<polygon points="${f1(cx)},${f1(cy - 10)} ${f1(cx - 4.5)},${f1(cy)} ${f1(cx + 4.5)},${f1(cy)}" fill="#ff8a3d" stroke="${OUTLINE}" stroke-width="1.2" stroke-linejoin="round"/>` + ln([cx - 2.6, cy - 4], [cx + 2.6, cy - 4], '#ffffff', 1.6);
}
function mailboxPost(gx: number, gy: number, color = '#4a7bd0') {
  return box(gx - 0.015, gy - 0.015, gx + 0.015, gy + 0.015, 0, 8, '#8b5a3c', { sw: 0.9 }) + box(gx - 0.05, gy - 0.035, gx + 0.05, gy + 0.035, 8, 5, color, { sw: 1 });
}
/** coloured flag on a pole (animated) */
function flag(x: number, y: number, h: number, color: string) {
  return ln([x, y], [x, y - h], OUTLINE, 1.6) + `<g class="ch-flag"><polygon points="${f1(x)},${f1(y - h)} ${f1(x + 13)},${f1(y - h + 3)} ${f1(x)},${f1(y - h + 7)}" fill="${color}" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/></g>`;
}
/** soft light halo (visible at night only) */
function halo(p: P, r: number, color = GLOW1, ry?: number) {
  const e = (k: number, o: number) => (ry ? ell(p, r * k, ry * k, color, 0, `fill-opacity="${o}"`) : circ(p, r * k, color, 0, `fill-opacity="${o}"`));
  return `<g class="ch-glow">${e(1, 0.1)}${e(0.68, 0.16)}${e(0.38, 0.32)}</g>`;
}
function blinkLight(p: P, color: string, delay = 0) {
  return `<g class="ch-blink" style="animation-delay:${delay}s">${circ(p, 2.6, color, 1.1)}</g>` + halo(p, 9, color);
}

/* ------------------------------------------------------------------ vehicles (parked props + traffic) */
const CAR_COLORS = ['#ff5a4f', '#4f8ef7', '#ffd166', '#f5f5f5', '#56c271', '#9b7fd4', '#ff9f43'];
export const CAR_VARIANTS = CAR_COLORS.length + 1; // + bus
export type Dir = 'xp' | 'xn' | 'yp' | 'yn';

function vehicleBody(dir: Dir, color: string, len: number, wid: number, h: number, cabin: { len: number; h: number; off: number; color?: string }) {
  const alongX = dir === 'xp' || dir === 'xn';
  const sgn = dir === 'xp' || dir === 'yp' ? 1 : -1;
  const L2 = len / 2;
  const W2 = wid / 2;
  const [x0, y0, x1, y1] = alongX ? [-L2, -W2, L2, W2] : [-W2, -L2, W2, L2];
  let s = ell(I(0, 0), 24 * len, 5, '#1d2a3a', 0, 'fill-opacity=".22"');
  const gl: P[] = alongX
    ? [I(sgn * L2, -W2), I(sgn * (L2 + 0.55), -W2 - 0.12), I(sgn * (L2 + 0.55), W2 + 0.12), I(sgn * L2, W2)]
    : [I(-W2, sgn * L2), I(-W2 - 0.12, sgn * (L2 + 0.55)), I(W2 + 0.12, sgn * (L2 + 0.55)), I(W2, sgn * L2)];
  s += `<g class="ch-glow">${polyNS(gl, GLOW1, 'fill-opacity=".45"')}</g>`;
  const wz = 1.2;
  if (alongX) s += ell(I(x0 + len * 0.25, y1, wz), 2.6, 2.6, OUTLINE, 0) + ell(I(x1 - len * 0.22, y1, wz), 2.6, 2.6, OUTLINE, 0);
  else s += ell(I(x1, y0 + len * 0.25, wz), 2.6, 2.6, OUTLINE, 0) + ell(I(x1, y1 - len * 0.22, wz), 2.6, 2.6, OUTLINE, 0);
  s += box(x0, y0, x1, y1, 1.6, h, color, { sw: 1.1 });
  if (cabin.h > 0.1) {
    const c0 = -cabin.len / 2 + cabin.off * sgn;
    const c1 = cabin.len / 2 + cabin.off * sgn;
    const cw = W2 * 0.86;
    const cab = alongX ? [c0, -cw, c1, cw] : [-cw, c0, cw, c1];
    s += box(cab[0], cab[1], cab[2], cab[3], 1.6 + h, cabin.h, cabin.color ?? '#bfe6ff', { sw: 1.1, top: shade(color, 0.15) });
  }
  const z = 1.6 + h * 0.45;
  const lightCol = sgn > 0 ? HEAD : BLINK_R;
  if (alongX) s += poly(qRp(y0, y1, x1, 0.12, 0.3, z, z + 2.2), lightCol, 0.8) + poly(qRp(y0, y1, x1, 0.7, 0.88, z, z + 2.2), lightCol, 0.8);
  else s += poly(qLp(x0, x1, y1, 0.12, 0.3, z, z + 2.2), lightCol, 0.8) + poly(qLp(x0, x1, y1, 0.7, 0.88, z, z + 2.2), lightCol, 0.8);
  return s;
}
function busWindows(dir: Dir, len = 0.62) {
  const alongX = dir === 'xp' || dir === 'xn';
  const L2 = len / 2;
  return alongX ? winPaths(gridQuads('L', -L2, L2, 0.12, 5, 1, 5.8, 9.6, 0.82, 0.9), 'L', 3, 80, 0.8) : winPaths(gridQuads('R', -L2, L2, 0.12, 5, 1, 5.8, 9.6, 0.82, 0.9), 'R', 3, 80, 0.8);
}
export function carArt(variant: number, dir: Dir): string {
  if (variant >= CAR_COLORS.length) return vehicleBody(dir, '#ffc23d', 0.62, 0.24, 9.5, { len: 0, h: 0, off: 0 }) + busWindows(dir);
  return vehicleBody(dir, CAR_COLORS[variant], 0.42, 0.22, 4.5, { len: 0.22, h: 4.5, off: -0.03 });
}
/** parked vehicle prop (fire truck, police car, ambulance, school bus) at ground point (gx, gy) */
function parked(gx: number, gy: number, dir: Dir, body: string, len: number, h: number, stripe?: string, siren?: [string, string], bus = false) {
  const [tx, ty] = I(gx, gy);
  const alongX = dir === 'xp' || dir === 'xn';
  let s = bus ? vehicleBody(dir, body, len, 0.24, h, { len: 0, h: 0, off: 0 }) + busWindows(dir, len) : vehicleBody(dir, body, len, 0.24, h, { len: len * 0.38, h: 4.5, off: len * 0.22 * (dir === 'xp' || dir === 'yp' ? 1 : -1) });
  if (stripe) {
    const L2 = len / 2;
    s += alongX ? poly(qLp(-L2, L2, 0.12, 0, 1, 1.6 + h * 0.3, 1.6 + h * 0.5), stripe, 0.6) : poly(qRp(-L2, L2, 0.12, 0, 1, 1.6 + h * 0.3, 1.6 + h * 0.5), stripe, 0.6);
  }
  if (siren) {
    const [sx, sy] = I(0, 0, 1.6 + h + 5.5);
    s += blinkLight([sx - 3, sy], siren[0]) + blinkLight([sx + 3, sy], siren[1], 0.8);
  }
  return `<g transform="translate(${f1(tx)},${f1(ty)})">${s}</g>`;
}

/* ------------------------------------------------------------------ people */
const SHIRTS = ['#ff6b6b', '#4f8ef7', '#ffd166', '#6cc56a', '#b388ff', '#ff9f43'];
const SKINS = ['#f5cba7', '#d9a172', '#9a6640'];
export const PERSON_VARIANTS = SHIRTS.length * SKINS.length;
export function personArt(variant: number, flip: boolean, hat?: string): string {
  const shirt = SHIRTS[variant % SHIRTS.length];
  const skin = SKINS[Math.floor(variant / SHIRTS.length) % SKINS.length];
  const hair = pick(['#3b2a20', '#6b4b2e', '#1d1d1d', '#c9a15b'], variant * 7);
  let s = ell([0, 0], 3.6, 1.6, '#1d2a3a', 0, 'fill-opacity=".25"');
  s += `<g class="ch-legs">${ln([-1.2, -5], [-1.6, 0], OUTLINE, 1.6)}${ln([1.2, -5], [1.6, 0], OUTLINE, 1.6)}</g>`;
  s += `<rect x="-3" y="-11" width="6" height="7" rx="2.2" fill="${shirt}" stroke="${OUTLINE}" stroke-width="1"/>`;
  s += circ([0, -13.6], 2.9, skin, 1);
  s += hat
    ? `<path d="M-3.3,-14.2 A3.3,3.3 0 0 1 3.3,-14.2 L4.2,-13.6 L-4.2,-13.6Z" fill="${hat}" stroke="${OUTLINE}" stroke-width=".9"/>`
    : `<path d="M-2.9,-14.2 A2.9,2.9 0 0 1 2.9,-14.6 L2.2,-15 Q0,-15.8 -2.6,-14.8Z" fill="${hair}"/>`;
  return flip ? `<g transform="scale(-1,1)">${s}</g>` : s;
}
function worker(gx: number, gy: number, variant: number, flip = false, hammering = true) {
  const [x, y] = I(gx, gy);
  const tool = hammering
    ? `<g class="ch-hammer">${ln([2.6, -9], [7, -13], OUTLINE, 1.4)}<rect x="5.6" y="-15.5" width="4" height="2.6" rx=".6" fill="#7a808e" stroke="${OUTLINE}" stroke-width=".8"/></g>`
    : `<rect x="3" y="-12" width="7" height="5" rx="1" fill="#c97f4c" stroke="${OUTLINE}" stroke-width=".8"/>`;
  return `<g transform="translate(${f1(x)},${f1(y)})${flip ? ' scale(-1,1)' : ''}">${personArt(variant, false, '#ffcc29')}<rect x="-3" y="-10" width="6" height="2" fill="#ff8a3d"/>${tool}</g>`;
}

/* ------------------------------------------------------------------ BUILDINGS */
export interface ArtCtx {
  /** neighbour road flags for roads: [north(y-1), east(x+1), south(y+1), west(x-1)] */
  roads?: [boolean, boolean, boolean, boolean];
}

function dome(cx: number, cy: number, r: number, z: number, dh: number, color: string) {
  const [px, py] = I(cx, cy, z);
  const rx = r * RX;
  const ry = r * RY;
  return (
    `<path d="M${f1(px - rx)},${f1(py)} Q${f1(px - rx)},${f1(py - dh)} ${f1(px)},${f1(py - dh)} Q${f1(px + rx)},${f1(py - dh)} ${f1(px + rx)},${f1(py)} A${f1(rx)},${f1(ry)} 0 0 1 ${f1(px - rx)},${f1(py)}Z" fill="${color}" stroke="${OUTLINE}" stroke-width="${SW}"/>` +
    `<path d="M${f1(px + rx * 0.2)},${f1(py - dh + 1)} Q${f1(px + rx)},${f1(py - dh)} ${f1(px + rx)},${f1(py)} A${f1(rx)},${f1(ry)} 0 0 1 ${f1(px + rx * 0.25)},${f1(py + ry * 0.97)}Z" fill="${shade(color, -0.18)}"/>` +
    `<path d="M${f1(px - rx * 0.55)},${f1(py - dh * 0.15)} Q${f1(px - rx * 0.5)},${f1(py - dh * 0.85)} ${f1(px)},${f1(py - dh)}" fill="none" stroke="#ffffff" stroke-opacity=".6" stroke-width="2" class="ch-day"/>`
  );
}

function cityhall(L: number, v: number) {
  const wall = L >= 5 ? '#fff6e2' : '#f6ecd6';
  const roof = L >= 4 ? '#3f7fd6' : '#4f8be0';
  let s = lot(2, 'plaza', v);
  s += planter(0.22, 1.78, 3) + planter(1.78, 0.22, 4);
  if (L >= 2) s += lamp(0.5, 1.9) + lamp(1.9, 0.5);
  if (L >= 4) s += box(0.1, 0.5, 0.36, 1.42, 0, 18, wall, { ao: true }) + windowsL(0.1, 0.36, 1.42, 1, 2, 3, 16, v + 1) + gableY(0.1, 0.5, 0.36, 1.42, 18, 7, roof, wall);
  s += ao(0.32, 0.3, 1.66, 1.62);
  s += box(0.32, 0.3, 1.66, 1.62, 0, 4, '#e2d6bd');
  const h = 26 + L * 4;
  s += box(0.38, 0.34, 1.62, 1.58, 4, h, wall, { rim: true });
  for (let i = 0; i < 6; i++) {
    const u = 0.07 + i * 0.17;
    if (u > 0.38 && u < 0.56) continue;
    s += qL(0.38, 1.62, 1.58, u, u + 0.065, 4, 4 + h - 3, '#ffffff', 1);
    s += polyNS(qLp(0.38, 1.62, 1.58, u + 0.045, u + 0.065, 4, 4 + h - 3), '#e3d9c4');
  }
  s += qL(0.38, 1.62, 1.58, 0.41, 0.57, 4, 20, '#6b4a8a');
  s += qL(0.38, 1.62, 1.58, 0.43, 0.55, 18, 20.5, LAMP, 0.8);
  s += windowsR(0.34, 1.58, 1.62, 3, 2, 8, 4 + h - 3, v + 2);
  s += box(0.7, 1.58, 1.3, 1.97, 0, 2, '#efe8d8') + box(0.76, 1.58, 1.24, 1.86, 2, 2, '#f6f0e2');
  const z = 4 + h;
  s += box(0.33, 0.29, 1.67, 1.63, z, 4, '#ddd0b5');
  const top = z + 4;
  if (L >= 3) {
    s += poly([I(0.66, 1.63, top), I(1.34, 1.63, top), I(1.0, 1.63, top + 13)], '#f3e9d2', 1.4);
    const [cx, cy] = I(1.0, 1.63, top + 5);
    s += circ([cx, cy], 3.6, '#ffffff', 1.1) + ln([cx, cy], [cx, cy - 2.4], OUTLINE, 0.9) + ln([cx, cy], [cx + 1.8, cy], OUTLINE, 0.9);
    s += cyl(1, 0.96, 0.36, top, 9, wall);
    const dh = 22 + (L - 3) * 4;
    s += dome(1, 0.96, 0.36, top + 9, dh, L >= 5 ? '#f2c14e' : '#4fb7a6');
    s += cyl(1, 0.96, 0.07, top + 9 + dh - 2, 7, wall);
    s += flag(...I(1, 0.96, top + 9 + dh + 5), 20, '#7ed957');
  } else {
    s += pyramid(0.33, 0.29, 1.67, 1.63, top, 14 + L, roof);
    let ft = top + 14 + L;
    if (L >= 2) {
      const th = 14 + L * 3;
      const tz = top + 6;
      s += box(0.82, 0.8, 1.18, 1.16, tz, th, wall, { rim: true });
      const [cx, cy] = I(1, 1.16, tz + th - 7);
      s += circ([cx - 6, cy + 3], 4.2, '#ffffff', 1.2) + ln([cx - 6, cy + 3], [cx - 6, cy + 0.6], OUTLINE, 1) + ln([cx - 6, cy + 3], [cx - 4, cy + 3], OUTLINE, 1);
      s += pyramid(0.8, 0.78, 1.2, 1.18, tz + th, 12, '#d9534f');
      ft = tz + th + 12;
    }
    s += flag(...I(1, 1, ft - 1), 18, '#7ed957');
  }
  if (L >= 5) s += lamp(1.15, 1.92) + lamp(1.92, 1.15);
  return s;
}

function road(ctx: ArtCtx, v: number) {
  const [n, e, so, w] = ctx.roads ?? [false, false, false, false];
  const cnt = [n, e, so, w].filter(Boolean).length;
  const SIDE = '#ddd8cb';
  const CURB = '#b6ae9c';
  const k = 0.17;
  let s = poly([I(0, 0), I(1, 0), I(1, 1), I(0, 1)], '#6d7484', 1.2);
  if (!n) s += polyNS([I(0, 0), I(1, 0), I(1, k), I(0, k)], SIDE) + ln(I(w ? 0 : k, k), I(e ? 1 : 1 - k, k), CURB, 1.4);
  if (!e) s += polyNS([I(1 - k, 0), I(1, 0), I(1, 1), I(1 - k, 1)], SIDE) + ln(I(1 - k, n ? 0 : k), I(1 - k, so ? 1 : 1 - k), CURB, 1.4);
  if (!so) s += polyNS([I(0, 1 - k), I(1, 1 - k), I(1, 1), I(0, 1)], SIDE) + ln(I(w ? 0 : k, 1 - k), I(e ? 1 : 1 - k, 1 - k), CURB, 1.4);
  if (!w) s += polyNS([I(0, 0), I(k, 0), I(k, 1), I(0, 1)], SIDE) + ln(I(k, n ? 0 : k), I(k, so ? 1 : 1 - k), CURB, 1.4);
  const cornerSq = (x: number, y: number) => polyNS([I(x, y), I(x + k, y), I(x + k, y + k), I(x, y + k)], SIDE);
  if (n && w) s += cornerSq(0, 0);
  if (n && e) s += cornerSq(1 - k, 0);
  if (so && e) s += cornerSq(1 - k, 1 - k);
  if (so && w) s += cornerSq(0, 1 - k);
  const c = I(0.5, 0.5);
  if (cnt === 0) {
    for (const t of [0.35, 0.5, 0.65]) s += ln(I(t, 0.3), I(t, 0.7), '#f4f1e6', 1.6);
  } else if (cnt >= 3) {
    let d = '';
    for (let i = 0; i < 5; i++) {
      const t = 0.24 + i * 0.13;
      const seg = (a: P, b: P) => `M${f1(a[0])},${f1(a[1])}L${f1(b[0])},${f1(b[1])}`;
      if (n) d += seg(I(t, 0.03), I(t, 0.15));
      if (so) d += seg(I(t, 0.85), I(t, 0.97));
      if (w) d += seg(I(0.03, t), I(0.15, t));
      if (e) d += seg(I(0.85, t), I(0.97, t));
    }
    s += `<path d="${d}" stroke="#f4f1e6" stroke-width="2.6" fill="none"/>`;
  } else {
    const dashed = 'stroke-dasharray="5 5"';
    if ((e || w) && !n && !so) s += ln(I(0, 0.5), I(1, 0.5), '#f6e7a6', 1.8, dashed);
    else if ((n || so) && !e && !w) s += ln(I(0.5, 0), I(0.5, 1), '#f6e7a6', 1.8, dashed);
    else {
      if (n) s += ln(c, I(0.5, 0), '#f6e7a6', 1.8, dashed);
      if (e) s += ln(c, I(1, 0.5), '#f6e7a6', 1.8, dashed);
      if (so) s += ln(c, I(0.5, 1), '#f6e7a6', 1.8, dashed);
      if (w) s += ln(c, I(0, 0.5), '#f6e7a6', 1.8, dashed);
    }
  }
  if (v % 7 === 0 && cnt > 0) s += ell(I(0.36, 0.64), 3.4, 1.7, '#5a606e', 0.9);
  if (cnt > 0 && cnt <= 2 && v % 3 === 0) {
    if (!so) s += lamp(0.5, 1 - k / 2);
    else if (!e) s += lamp(1 - k / 2, 0.5);
    else if (!w) s += lamp(k / 2, 0.5);
    else if (!n) s += lamp(0.5, k / 2);
  }
  return s;
}

function house(L: number, v: number) {
  const wall = pick(WALLS, v);
  const roof = pick(ROOFS, v >>> 3);
  const alongX = ((v >>> 6) & 1) === 0;
  let s = lot(1, 'grass', v);
  if (L >= 2) s += hedge(I(0.1, 0.08), I(0.92, 0.08)) + hedge(I(0.08, 0.1), I(0.08, 0.86));
  s += ell(I(0.62, 0.82), 3.2, 1.7, '#e6dfcf', 0.8) + ell(I(0.62, 0.92), 3.2, 1.7, '#e6dfcf', 0.8);
  const x0 = 0.2;
  const y0 = 0.2;
  const x1 = 0.78;
  const y1 = 0.74;
  const W = x1 - x0;
  const h = L >= 3 ? 27 : 16;
  if (L >= 4) {
    s += box(0.78, 0.26, 0.95, 0.6, 0, 11, shade(wall, -0.06), { ao: true }) + qR(0.26, 0.6, 0.95, 0.15, 0.85, 0, 8, '#e9e4d8', 1.1);
    s += polyNS(qRp(0.26, 0.6, 0.95, 0.18, 0.82, 2.5, 3.2), '#c9c2b2') + polyNS(qRp(0.26, 0.6, 0.95, 0.18, 0.82, 5, 5.7), '#c9c2b2');
  }
  s += ao(x0, y0, x1, y1);
  s += box(x0, y0, x1, y1, 0, h, wall, { ao: true });
  s += qL(x0, x1, y1, 0.55, 0.78, 0, 11, '#7a4b2a') + circ(I(x0 + W * 0.74, y1, 5.5), 0.9, LAMP, 0.6);
  s += box(x0 + W * 0.52, y1, x0 + W * 0.81, y1 + 0.06, 0, 1.5, '#d8d0bf', { sw: 1 });
  s += windowsL(x0, x0 + W * 0.5, y1, 1, 1, 4, 13, v + 1, 0.62, 0.72);
  s += polyNS(qLp(x0, x1, y1, 0.07, 0.11, 5, 12), shade(roof, 0.1)) + polyNS(qLp(x0, x1, y1, 0.39, 0.43, 5, 12), shade(roof, 0.1));
  if (L >= 2) s += box(x0 + W * 0.1, y1, x0 + W * 0.4, y1 + 0.05, 3, 2.5, '#a0683f', { sw: 0.9 }) + flowers(x0 + W * 0.25, y1 + 0.03, v, 3, 0.18, 6);
  s += windowsR(y0, y1, x1, 2, 1, 3, 13, v + 2);
  if (L >= 3) s += windowsL(x0, x1, y1, 2, 1, 15, 24, v + 3) + windowsR(y0, y1, x1, 2, 1, 15, 24, v + 4);
  if (L >= 2) s += box(0.6, 0.28, 0.69, 0.37, h + 2, 13, '#b5523b', { sw: 1.1 });
  if (L >= 5) s += smoke(...I(0.645, 0.325, h + 18), (v % 5) * 0.4);
  s += alongX ? gableX(x0, y0, x1, y1, h, 12, roof, wall, 0.07, true) : gableY(x0, y0, x1, y1, h, 12, roof, wall, 0.07, true);
  if (L >= 5) {
    const sp: P[] = alongX ? [I(0.3, 0.68, h + 3), I(0.62, 0.68, h + 3), I(0.62, 0.52, h + 9.5), I(0.3, 0.52, h + 9.5)] : [I(0.72, 0.62, h + 3), I(0.72, 0.3, h + 3), I(0.58, 0.3, h + 9.5), I(0.58, 0.62, h + 9.5)];
    s += poly(sp, '#35508f', 1) + ln([(sp[0][0] + sp[3][0]) / 2, (sp[0][1] + sp[3][1]) / 2], [(sp[1][0] + sp[2][0]) / 2, (sp[1][1] + sp[2][1]) / 2], '#6d8fd6', 1);
  }
  if (L >= 2) s += mailboxPost(0.9, 0.9, pick(['#4a7bd0', '#e05a4f', '#3fa47e'], v));
  if (L >= 3) s += bush(0.12, 0.9, 0.7) + flowers(0.3, 0.9, v + 9, 3, 0.15);
  if (L >= 4) s += lamp(0.92, 0.66, 16);
  return s;
}

function treeGrove(v: number) {
  const r = mulberry32(v);
  const greens = ['#5cbf4a', '#4fae43', '#6cc957', '#46a35a'];
  const kinds: TreeKind[] = ['round', 'pine', 'poplar', 'round'];
  let s = lot(1, 'grass', v);
  s += flowers(0.75, 0.75, v, 4, 0.22) + bush(0.18, 0.7, 0.75);
  const spots: [number, number][] = [
    [0.3, 0.32],
    [0.72, 0.36],
    [0.46, 0.74],
  ];
  spots.forEach(([x, y], i) => {
    s += tree(x + (r() - 0.5) * 0.08, y + (r() - 0.5) * 0.08, 0.8 + r() * 0.3, pick(greens, r() * 10), 0, pick(kinds, (v >>> (i * 3)) + i));
  });
  return s;
}

function awningStrip(x0: number, x1: number, y1: number, color: string, zA = 17) {
  let s = '';
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const a = x0 + ((x1 - x0) * i) / segs;
    const b = x0 + ((x1 - x0) * (i + 1)) / segs;
    s += poly([I(a, y1, zA), I(b, y1, zA), I(b, y1 + 0.15, zA - 5), I(a, y1 + 0.15, zA - 5)], i % 2 ? '#ffffff' : color, 1);
  }
  return s;
}
function shop(L: number, v: number) {
  const wall = pick(['#fff1d6', '#f7d06b', '#ffd1dc', '#c9f0e4', '#d7e7ff'], v);
  const aw = pick(['#e2504c', '#3c8ce7', '#2fa87a', '#f08b2e'], v >>> 4);
  const x0 = 0.14;
  const y0 = 0.18;
  const x1 = 0.86;
  const y1 = 0.78;
  const h = 22 + (L >= 3 ? 11 : 0);
  let s = lot(1, 'paved', v);
  s += ao(x0, y0, x1, y1);
  s += box(x0, y0, x1, y1, 0, h, wall, { ao: true, rim: true });
  s += qL(x0, x1, y1, 0.06, 0.6, 2, 12, GLASS, 1.2);
  for (let i = 0; i < 4; i++) s += polyNS(qLp(x0, x1, y1, 0.1 + i * 0.12, 0.17 + i * 0.12, 2.5, 6 + (i % 2) * 2), pick(['#ff8a3d', '#ffd166', '#6cc56a', '#ff6b6b'], i + v));
  s += qL(x0, x1, y1, 0.68, 0.9, 0, 12, '#7a4b2a');
  s += windowsR(y0, y1, x1, 2, 1, 4, 16, v);
  if (L >= 3) s += windowsL(x0, x1, y1, 3, 1, 22, 31, v + 1) + windowsR(y0, y1, x1, 2, 1, 22, 31, v + 2);
  s += awningStrip(x0, x1, y1, aw);
  s += box(x0, y0, x1, y1, h, 3, shade(wall, -0.08));
  const [sx, sy] = I(0.5, 0.48, h + 3);
  s += ln([sx, sy], [sx, sy - 6], OUTLINE, 1.4);
  s += `<rect x="${f1(sx - 12)}" y="${f1(sy - 16)}" width="24" height="10" rx="3" fill="${L >= 5 ? NEON_A : aw}" stroke="${OUTLINE}" stroke-width="1.3"/>`;
  s += circ([sx - 5, sy - 11], 2.4, LAMP, 0.9) + `<rect x="${f1(sx - 1)}" y="${f1(sy - 12.5)}" width="8" height="3" rx="1" fill="#ffffff"/>`;
  if (L >= 5) s += halo([sx, sy - 11], 20, NEON_A);
  if (L >= 2) s += box(0.86, 0.82, 0.97, 0.94, 0, 4, '#c99a5b', { sw: 0.9 }) + flowers(0.915, 0.88, v, 3, 0.06, 4);
  if (L >= 4) s += box(0.3, 0.3, 0.48, 0.45, h + 3, 6, '#c7ccd8', { sw: 1 }) + box(0.55, 0.25, 0.7, 0.38, h + 3, 5, '#c7ccd8', { sw: 1 });
  return s;
}

function cafe(L: number, v: number) {
  const wall = pick(['#c8664e', '#e8b07a', '#7b9e87', '#5d7fae'], v);
  const aw = pick(['#2f8f5a', '#f2e6c8', '#e05a4f', '#2b5fa8'], v >>> 3);
  const x0 = 0.18;
  const y0 = 0.16;
  const x1 = 0.84;
  const y1 = 0.66;
  const h = 21 + (L >= 3 ? 11 : 0);
  let s = lot(1, 'paved', v);
  s += ao(x0, y0, x1, y1);
  s += box(x0, y0, x1, y1, 0, h, wall, { ao: true });
  s += qL(x0, x1, y1, 0.08, 0.62, 1.5, 12.5, GLASS, 1.2);
  s += polyNS(qLp(x0, x1, y1, 0.3, 0.33, 1.5, 12.5), '#ffffff', 'fill-opacity=".6" class="ch-day"');
  s += qL(x0, x1, y1, 0.7, 0.9, 0, 12, '#5b3a22');
  s += windowsR(y0, y1, x1, 2, 1, 4, 15, v);
  if (L >= 3) s += windowsL(x0, x1, y1, 3, 1, 22, 30, v + 1) + windowsR(y0, y1, x1, 2, 1, 22, 30, v + 2);
  s += awningStrip(x0, x1, y1, aw, 16);
  s += box(x0, y0, x1, y1, h, 2.5, shade(wall, -0.15));
  const [cx, cy] = I(0.52, 0.42, h + 2.5);
  s += ln([cx, cy], [cx, cy - 5], OUTLINE, 1.3);
  s += `<path d="M${f1(cx - 6)},${f1(cy - 16)} h12 l-1.6,9 a2,2 0 0 1 -2,1.6 h-4.8 a2,2 0 0 1 -2,-1.6Z" fill="#ffffff" stroke="${OUTLINE}" stroke-width="1.2"/>`;
  s += `<path d="M${f1(cx + 6)},${f1(cy - 14)} a2.6,2.6 0 0 1 0,5" fill="none" stroke="${OUTLINE}" stroke-width="1.2"/>`;
  s += `<g class="ch-steam"><path d="M${f1(cx - 2)},${f1(cy - 18)} q-2,-3 0,-5 q2,-2 0,-5" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"/></g>`;
  const tables: [number, number][] = L >= 2 ? [[0.3, 0.84], [0.62, 0.86]] : [[0.42, 0.85]];
  for (const [tx, ty] of tables) {
    const [px, py] = I(tx, ty);
    s += ell([px, py], 5, 2.2, '#1d2a3a', 0, 'fill-opacity=".18"') + ln([px, py], [px, py - 7], OUTLINE, 1.4) + ell([px, py - 7], 4.4, 2, '#ffffff', 1);
    s += ln([px, py - 7], [px, py - 16], OUTLINE, 1);
    s += `<path d="M${f1(px - 9)},${f1(py - 15)} Q${f1(px)},${f1(py - 23)} ${f1(px + 9)},${f1(py - 15)}Z" fill="${aw}" stroke="${OUTLINE}" stroke-width="1.1"/>`;
  }
  if (L >= 4) s += bush(0.9, 0.2, 0.6) + planter(0.92, 0.5, v);
  if (L >= 5) s += halo(I(0.52, 0.42, h + 13), 14, LAMP);
  return s;
}

function apartment(L: number, v: number) {
  const wall = pick(TOWERS, v);
  const x0 = 0.17;
  const y0 = 0.17;
  const x1 = 0.83;
  const y1 = 0.83;
  const h = 40 + L * 12;
  let s = lot(1, 'paved', v);
  s += ao(x0, y0, x1, y1);
  s += box(x0, y0, x1, y1, 0, h, wall, { ao: true, rim: true });
  if (L >= 3) s += polyNS(qLp(x0, x1, y1, 0, 1, 0, 10), shade(wall, -0.25)) + polyNS(qRp(y0, y1, x1, 0, 1, 0, 10), shade(wall, -0.38));
  const rows = Math.max(2, Math.floor((h - 12) / 11));
  s += windowsL(x0, x1, y1, 3, rows, 12, h - 3, v);
  s += windowsR(y0, y1, x1, 3, rows, 4, h - 3, v + 5);
  const rh = (h - 15) / rows;
  for (let r = 1; r < rows; r += 2) {
    const z = 12 + rh * r;
    for (const uc of [1 / 6, 5 / 6]) {
      const xa = x0 + (x1 - x0) * (uc - 0.11);
      const xb = x0 + (x1 - x0) * (uc + 0.11);
      s += poly([I(xa, y1, z), I(xb, y1, z), I(xb, y1 + 0.07, z), I(xa, y1 + 0.07, z)], shade(wall, 0.25), 0.9);
      s += poly([I(xa, y1 + 0.07, z), I(xb, y1 + 0.07, z), I(xb, y1 + 0.07, z + 4), I(xa, y1 + 0.07, z + 4)], '#e7f6ff', 0.9, 'fill-opacity=".85"');
    }
  }
  s += qL(x0, x1, y1, 0.38, 0.62, 0, 10, '#4b3a6b');
  s += poly([I(x0 + 0.22, y1, 11), I(x0 + 0.44, y1, 11), I(x0 + 0.44, y1 + 0.1, 10), I(x0 + 0.22, y1 + 0.1, 10)], shade(wall, -0.3), 1);
  s += box(x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, h, 3, shade(wall, -0.12));
  if (v % 2) s += cyl(0.62, 0.36, 0.1, h + 3, 10, '#b0b8c8');
  else s += box(0.28, 0.3, 0.52, 0.5, h + 3, 6, '#c7ccd8', { sw: 1.1 });
  if (L >= 4) {
    const [ax, ay] = I(0.32, 0.6, h + 3);
    s += ln([ax, ay], [ax, ay - 14], OUTLINE, 1.4) + ln([ax - 4, ay - 10], [ax + 4, ay - 12], OUTLINE, 1.1);
  }
  s += planter(0.08, 0.92, v) + planter(0.92, 0.08, v + 1);
  return s;
}

function duck(p: P) {
  const [x, y] = p;
  return ell([x, y], 4.4, 2.6, '#ffffff', 1) + circ([x + 3.2, y - 3], 2.2, '#ffffff', 1) + `<polygon points="${f1(x + 5)},${f1(y - 3.4)} ${f1(x + 7.6)},${f1(y - 2.8)} ${f1(x + 5)},${f1(y - 2.2)}" fill="#ffa94d"/>`;
}

function park(L: number, v: number) {
  let s = box(0.04, 0.04, 1.96, 1.96, 0, 2, '#7fcf55', { top: '#9fdc6a' });
  let dd = '';
  for (let i = 1; i < 8; i += 2) {
    const a = 0.04 + (1.92 * i) / 8;
    const b = 0.04 + (1.92 * (i + 1)) / 8;
    dd += dq([I(a, 0.04, 2), I(b, 0.04, 2), I(b, 1.96, 2), I(a, 1.96, 2)]);
  }
  s += `<path d="${dd}" fill="#ffffff" fill-opacity=".08"/>`;
  const P2 = (x: number, y: number) => I(x, y, 2);
  const path = [P2(0.05, 1.25), P2(0.6, 1.05), P2(1.15, 1.2), P2(1.6, 0.85), P2(1.95, 0.75)];
  const d = `M${f1(path[0][0])},${f1(path[0][1])} Q${f1(path[1][0])},${f1(path[1][1])} ${f1((path[1][0] + path[2][0]) / 2)},${f1((path[1][1] + path[2][1]) / 2)} T${f1(path[3][0])},${f1(path[3][1])} T${f1(path[4][0])},${f1(path[4][1])}`;
  s += `<path d="${d}" fill="none" stroke="${OUTLINE}" stroke-width="10" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#efd69b" stroke-width="7.4" stroke-linecap="round"/>`;
  if (L >= 2) s += ell(I(1.35, 1.5, 2), 16, 8, '#6ec6e8', 1.4) + ell(I(1.31, 1.47, 2), 6, 2.4, '#c4f0ff', 0) + `<g class="ch-duck">${duck(I(1.42, 1.55, 3))}</g>`;
  s += bench(0.75, 1.42, true);
  s += lamp(0.55, 0.95) + (L >= 2 ? lamp(1.75, 1.0) : '');
  if (L >= 3) {
    const gx = 0.55;
    const gy = 0.5;
    s += cyl(gx, gy, 0.22, 2, 2, '#e8dcc2');
    for (const [a, b] of [
      [-0.15, 0.15],
      [0.15, 0.15],
      [0.15, -0.15],
    ] as [number, number][])
      s += ln(I(gx + a, gy + b, 4), I(gx + a, gy + b, 18), OUTLINE, 2.2);
    const [cx, cy] = I(gx, gy, 18);
    s += `<path d="M${f1(cx - 22)},${f1(cy)} L${f1(cx)},${f1(cy - 14)} L${f1(cx + 22)},${f1(cy)} Q${f1(cx)},${f1(cy + 9)} ${f1(cx - 22)},${f1(cy)}Z" fill="#e05a4f" stroke="${OUTLINE}" stroke-width="1.4"/>`;
    s += flowers(1.0, 0.7, v, 6, 0.3, 2) + flowers(0.55, 1.3, v + 1, 5, 0.3, 2) + flowers(1.6, 1.7, v + 2, 4, 0.3, 2);
  }
  s += tree(1.05, 0.3, 0.95, '#4fae43', 2, 'pine') + tree(1.6, 0.35, 1.0, '#6cc957', 2, 'round');
  s += tree(0.3, 1.7, 0.95, '#4fae43', 2, 'round') + tree(1.8, 1.45, 1.0, '#5cbf4a', 2, 'poplar');
  if (L < 3) s += tree(0.32, 0.35, 1.05, '#5cbf4a', 2);
  if (L >= 2) s += bush(1.0, 1.78, 1, '#58b545', 2) + bush(0.2, 1.05, 0.9, '#58b545', 2);
  return s;
}

function fountain(L: number) {
  let s = lot(1, 'plaza');
  const r = 0.3 + L * 0.02;
  s += cyl(0.5, 0.5, r, 0, 6, '#cfc6b4', '#6ec6e8');
  const [cx, cy] = I(0.5, 0.5, 6);
  s += ell([cx - 4, cy - 1], 6, 2.2, '#c4f0ff', 0);
  s += cyl(0.5, 0.5, 0.05, 6, 12, '#d9d1c1');
  s += cyl(0.5, 0.5, 0.12, 18, 3, '#d9d1c1', '#6ec6e8');
  if (L >= 3) s += cyl(0.5, 0.5, 0.03, 21, 6, '#d9d1c1') + cyl(0.5, 0.5, 0.07, 27, 2, '#d9d1c1', '#6ec6e8');
  const [tx, ty] = I(0.5, 0.5, L >= 3 ? 30 : 22);
  s += `<g class="ch-spray">${circ([tx, ty - 5], 2.4, '#bfefff', 1) + circ([tx - 6, ty - 1], 1.8, '#bfefff', 1) + circ([tx + 6, ty - 1], 1.8, '#bfefff', 1)}</g>`;
  if (L >= 2) s += bench(0.12, 0.5, false) + bench(0.5, 0.88, true) + planter(0.1, 0.1, 3) + planter(0.9, 0.9, 4);
  if (L >= 3) s += lamp(0.9, 0.12, 18);
  return s;
}

function office(L: number, v: number) {
  const glass = pick(['#8f7fd6', '#6f9fe0', '#5cc0c7', '#7d8ce0'], v);
  const x0 = 0.2;
  const y0 = 0.2;
  const x1 = 0.8;
  const y1 = 0.8;
  const h = 60 + L * 14;
  let s = lot(1, 'paved', v);
  s += ao(x0, y0, x1, y1);
  s += box(x0, y0, x1, y1, 0, h, glass, { rim: true });
  const rows = Math.floor((h - 12) / 9);
  s += winPaths(gridQuads('L', x0, x1, y1, 1, rows, 9, h - 3, 0.88, 0.64), 'L', v, 75, 1);
  s += winPaths(gridQuads('R', y0, y1, x1, 1, rows, 9, h - 3, 0.88, 0.64), 'R', v + 3, 75, 1);
  let md = '';
  for (const u of [0.33, 0.66]) {
    const a = qLp(x0, x1, y1, u, u, 8, h - 2);
    const b = qRp(y0, y1, x1, u, u, 8, h - 2);
    md += `M${f1(a[0][0])},${f1(a[0][1])}L${f1(a[3][0])},${f1(a[3][1])}M${f1(b[0][0])},${f1(b[0][1])}L${f1(b[3][0])},${f1(b[3][1])}`;
  }
  s += `<path d="${md}" stroke="${shade(glass, -0.3)}" stroke-width="1.2" fill="none"/>`;
  s += sheenL(x0, x1, y1, 8, h - 2) + sheenR(y0, y1, x1, 8, h - 2);
  s += qL(x0, x1, y1, 0.34, 0.66, 0, 8, '#4b3a6b', 1.1);
  s += poly([I(x0 + 0.12, y1, 9), I(x1 - 0.12, y1, 9), I(x1 - 0.12, y1 + 0.12, 8), I(x0 + 0.12, y1 + 0.12, 8)], '#3c4458', 1);
  s += box(0.26, 0.26, 0.74, 0.74, h, 7, shade(glass, 0.12));
  if (L >= 4) {
    const [hx, hy] = I(0.5, 0.5, h + 7);
    s += ell([hx, hy], 12, 6, '#5d6475', 1.2) + `<path d="M${f1(hx - 4)},${f1(hy - 2.6)}v5.2M${f1(hx + 4)},${f1(hy - 2.6)}v5.2M${f1(hx - 4)},${f1(hy)}h8" stroke="#ffd166" stroke-width="1.6" fill="none"/>`;
    s += blinkLight(I(0.26, 0.74, h + 9), BLINK_R) + blinkLight(I(0.74, 0.26, h + 9), BLINK_R, 0.8);
  } else {
    s += pyramid(0.3, 0.3, 0.7, 0.7, h + 7, 10, shade(glass, -0.15), 0);
    if (L >= 3) {
      const [ax, ay] = I(0.5, 0.5, h + 17);
      s += ln([ax, ay], [ax, ay - 16], OUTLINE, 1.6) + blinkLight([ax, ay - 17], BLINK_R);
    }
  }
  s += planter(0.08, 0.92, v) + (L >= 2 ? lamp(0.92, 0.5, 18) : '');
  return s;
}

function factory(L: number) {
  const brick = '#c96e55';
  let s = lot(2, 'asphalt', 3);
  const ch = 46 + L * 6;
  for (const [cx, cy, dl] of [
    [0.42, 0.34, 0],
    [0.82, 0.28, 1.1],
  ] as [number, number, number][]) {
    s += cyl(cx, cy, 0.1, 2, ch, '#d9d4cc');
    s += cyl(cx, cy, 0.105, 2 + ch * 0.55, 6, '#e2504c');
    s += cyl(cx, cy, 0.105, 2 + ch - 8, 6, '#e2504c');
    s += smoke(...I(cx, cy, 2 + ch + 4), dl);
  }
  if (L >= 3) s += cyl(1.62, 0.3, 0.16, 0, 34, '#c8ccd4') + cyl(1.62, 0.3, 0.16, 34, 3, '#aeb4bf') + ln(I(1.47, 0.42, 30), I(1.18, 0.6, 22), '#7a808e', 2.4);
  s += box(1.12, 0.18, 1.82, 0.92, 0, 18, '#a7adb8', { ao: true });
  s += qL(1.12, 1.82, 0.92, 0.18, 0.82, 0, 14, '#7a808e');
  let rd = '';
  for (let z = 3; z < 14; z += 2.5) {
    const q = qLp(1.12, 1.82, 0.92, 0.18, 0.82, z, z);
    rd += `M${f1(q[0][0])},${f1(q[0][1])}L${f1(q[1][0])},${f1(q[1][1])}`;
  }
  s += `<path d="${rd}" stroke="#5f6573" stroke-width=".9" fill="none"/>`;
  const x0 = 0.18;
  const y0 = 0.62;
  const x1 = 1.55;
  const y1 = 1.82;
  const h = 22 + L * 2;
  s += ao(x0, y0, x1, y1);
  s += box(x0, y0, x1, y1, 0, h, brick, { ao: true });
  s += windowsL(x0, x1, y1, 4, 1, 7, h - 3, 3, 0.62, 0.58);
  s += windowsR(y0, y1, x1, 3, 1, 7, h - 3, 4, 0.62, 0.58);
  for (let i = 0; i < 3; i++) {
    const a = x0 + ((x1 - x0) * i) / 3;
    const b = x0 + ((x1 - x0) * (i + 1)) / 3;
    s += gableY(a, y0, b, y1, h, 10, '#8a8f9c', brick, 0.02);
  }
  s += box(1.65, 1.35, 1.85, 1.55, 0, 7, '#c99a5b', { sw: 1.1 }) + box(1.68, 1.6, 1.86, 1.78, 0, 6, '#c99a5b', { sw: 1.1 });
  if (L >= 2) s += parked(1.72, 1.05, 'yp', '#4f8ef7', 0.5, 9);
  return s;
}

function power(L: number) {
  let s = lot(2, 'asphalt', 5);
  const tower = (gx: number, gy: number, h: number) => {
    const [px, py] = I(gx, gy, 2);
    const rb = 0.46 * RX;
    const rt = 0.34 * RX;
    const rm = 0.28 * RX;
    const ty = py - h;
    let t = `<path d="M${f1(px - rt)},${f1(ty)} Q${f1(px - rm)},${f1(py - h * 0.45)} ${f1(px - rb)},${f1(py)} A${f1(rb)},${f1(rb * 0.5)} 0 0 0 ${f1(px + rb)},${f1(py)} Q${f1(px + rm)},${f1(py - h * 0.45)} ${f1(px + rt)},${f1(ty)} Z" fill="#e3e7ee" stroke="${OUTLINE}" stroke-width="${SW}" stroke-linejoin="round"/>`;
    t += `<path d="M${f1(px + rt * 0.3)},${f1(ty + 4)} Q${f1(px + rm * 0.6)},${f1(py - h * 0.45)} ${f1(px + rb * 0.4)},${f1(py + rb * 0.45)} L${f1(px + rb)},${f1(py)} Q${f1(px + rm)},${f1(py - h * 0.45)} ${f1(px + rt)},${f1(ty)} Z" fill="#c4cad6"/>`;
    t += ell([px, py - h * 0.62], rm * 1.02, rm * 0.5, 'none', 0, `stroke="#e05a4f" stroke-width="3" stroke-opacity=".8"`);
    t += ell([px, ty], rt, rt * 0.5, '#8a93a5', SW) + ell([px, ty + 2], rt * 0.8, rt * 0.34, '#5d6475', 0);
    t += `<g class="ch-smoke">${circ([px - 6, ty - 8], 9, '#ffffff', 1.3) + circ([px + 8, ty - 12], 10, '#ffffff', 1.3) + circ([px, ty - 20], 11, '#ffffff', 1.3)}</g>`;
    return t;
  };
  if (L >= 3) s += tower(0.5, 1.2, 44);
  s += tower(0.68, 0.62, 46 + L * 6);
  s += box(1.15, 0.9, 1.85, 1.8, 0, 20, '#f2d36b', { ao: true, rim: true });
  s += windowsL(1.15, 1.85, 1.8, 3, 1, 6, 18, 2);
  const [bx, by] = I(1.85, 1.35, 13);
  s += `<polygon points="${f1(bx + 3)},${f1(by - 9)} ${f1(bx - 2)},${f1(by + 1)} ${f1(bx + 3)},${f1(by + 1)} ${f1(bx)},${f1(by + 9)} ${f1(bx + 7)},${f1(by - 2)} ${f1(bx + 2)},${f1(by - 2)}" fill="#ffffff" stroke="${OUTLINE}" stroke-width="1.1" stroke-linejoin="round"/>`;
  if (L >= 2) {
    const sx = L >= 3 ? 0.95 : 0.15;
    for (let i = 0; i < 3; i++) {
      const y = 1.2 + i * 0.24;
      if (sx < 0.9) s += poly([I(sx, y, 4), I(0.95, y, 4), I(0.95, y + 0.16, 9), I(sx, y + 0.16, 9)], '#3e5f9e', 1.1);
    }
  }
  const [tx, ty2] = I(1.82, 0.22, 2);
  s += ln([tx - 6, ty2], [tx, ty2 - 42], OUTLINE, 1.6) + ln([tx + 6, ty2], [tx, ty2 - 42], OUTLINE, 1.6) + ln([tx - 9, ty2 - 30], [tx + 9, ty2 - 30], OUTLINE, 1.6) + ln([tx - 6, ty2 - 20], [tx + 6, ty2 - 20], OUTLINE, 1.2);
  s += box(1.3, 0.2, 1.5, 0.4, 0, 8, '#9aa3b2', { sw: 1 }) + box(1.3, 0.48, 1.5, 0.68, 0, 8, '#9aa3b2', { sw: 1 });
  return s;
}

function skyscraper(L: number, v: number) {
  const glass = pick(['#4fc1b0', '#5b9be0', '#9b7fd4', '#3fb2d1'], v);
  let s = lot(2, 'plaza', v);
  s += box(0.12, 0.12, 1.88, 1.88, 0, 12, '#d7dbe5', { ao: true });
  s += qL(0.12, 1.88, 1.88, 0.38, 0.62, 0, 9, '#4b3a6b');
  s += qL(0.12, 1.88, 1.88, 0.06, 0.32, 2, 9, GLASS, 1) + qL(0.12, 1.88, 1.88, 0.68, 0.94, 2, 9, GLASS, 1);
  const h1 = 66 + L * 14;
  const x0 = 0.38;
  const x1 = 1.62;
  s += box(x0, x0, x1, x1, 12, h1, glass, { rim: true });
  const rows1 = Math.floor((h1 - 6) / 10);
  s += winPaths(gridQuads('L', x0, x1, x1, 1, rows1, 18, 12 + h1 - 4, 0.9, 0.55), 'L', v, 70, 1);
  s += winPaths(gridQuads('R', x0, x1, x1, 1, rows1, 18, 12 + h1 - 4, 0.9, 0.55), 'R', v + 1, 70, 1);
  s += sheenL(x0, x1, x1, 14, 12 + h1 - 2) + sheenR(x0, x1, x1, 14, 12 + h1 - 2);
  let fd = '';
  for (const u of [0.25, 0.5, 0.75]) {
    const a = qLp(x0, x1, x1, u, u, 14, 12 + h1 - 1);
    const b = qRp(x0, x1, x1, u, u, 14, 12 + h1 - 1);
    fd += `M${f1(a[0][0])},${f1(a[0][1])}L${f1(a[3][0])},${f1(a[3][1])}M${f1(b[0][0])},${f1(b[0][1])}L${f1(b[3][0])},${f1(b[3][1])}`;
  }
  s += `<path d="${fd}" stroke="${shade(glass, -0.35)}" stroke-width="1.4" fill="none"/>`;
  const z2 = 12 + h1;
  const h2 = 26 + L * 6;
  s += box(0.6, 0.6, 1.4, 1.4, z2, h2, shade(glass, 0.08), { rim: true });
  const rows2 = Math.max(2, Math.floor((h2 - 4) / 9));
  s += winPaths(gridQuads('L', 0.6, 1.4, 1.4, 1, rows2, z2 + 4, z2 + h2 - 3, 0.88, 0.58), 'L', v + 2, 70, 1);
  s += winPaths(gridQuads('R', 0.6, 1.4, 1.4, 1, rows2, z2 + 4, z2 + h2 - 3, 0.88, 0.58), 'R', v + 3, 70, 1);
  const z3 = z2 + h2;
  s += box(0.78, 0.78, 1.22, 1.22, z3, 10, shade(glass, -0.1));
  s += polyNS(qLp(0.78, 1.22, 1.22, 0, 1, z3 + 3, z3 + 6), NEON_B) + polyNS(qRp(0.78, 1.22, 1.22, 0, 1, z3 + 3, z3 + 6), NEON_B);
  s += halo(I(1, 1, z3 + 5), 22, NEON_B);
  const [ax, ay] = I(1, 1, z3 + 10);
  s += ln([ax, ay], [ax, ay - 26 - L * 2], OUTLINE, 1.8) + blinkLight([ax, ay - 27 - L * 2], BLINK_R);
  s += planter(0.2, 1.8, v) + planter(1.8, 0.2, v + 1) + lamp(1.0, 1.93, 18);
  return s;
}

function bank(L: number) {
  let s = lot(2, 'plaza', 2);
  s += box(0.1, 0.1, 1.9, 1.9, 0, 4, '#e3dccb') + box(0.14, 0.14, 1.86, 1.86, 4, 3, '#ece6d6');
  const x0 = 0.3;
  const y0 = 0.3;
  const x1 = 1.7;
  const y1 = 1.7;
  const h = 30 + L * 3;
  s += box(x0, y0, x1, y1, 7, h, '#f3eee2', { rim: true });
  s += qL(x0, x1, y1, 0.44, 0.56, 7, 24, '#6b4a2a');
  for (let i = 0; i < 6; i++) {
    const u = 0.06 + i * 0.17;
    if (u > 0.38 && u < 0.6) continue;
    s += qL(x0, x1, y1, u, u + 0.07, 7, 7 + h - 2, '#ffffff', 1) + polyNS(qLp(x0, x1, y1, u + 0.05, u + 0.07, 7, 7 + h - 2), '#e2dccd');
  }
  for (let i = 0; i < 5; i++) {
    const u = 0.08 + i * 0.2;
    s += qR(y0, y1, x1, u, u + 0.08, 7, 7 + h - 2, '#f6f2e8', 1);
  }
  const z = 7 + h;
  s += box(0.25, 0.25, 1.75, 1.75, z, 5, '#e0d8c4');
  s += polyNS(qLp(0.25, 1.75, 1.75, 0, 1, z + 1.5, z + 3), '#f2c14e');
  if (L >= 4) s += cyl(1, 1, 0.42, z + 5, 7, '#efe8d8') + dome(1, 1, 0.42, z + 12, 24, '#f2c14e');
  else s += gableY(0.25, 0.25, 1.75, 1.75, z + 5, 16, '#3fa47e', '#f3eee2', 0.03);
  const [cx, cy] = I(1, 1.75, z + 9);
  s += circ([cx, cy], 6.5, '#f7c84a', 1.4) + circ([cx, cy], 4.2, 'none', 0, `stroke="#e0a20a" stroke-width="1.4"`) + `<path d="M${f1(cx + 1.8)},${f1(cy - 2)} a2.4,2.4 0 1 0 0,4" fill="none" stroke="${OUTLINE}" stroke-width="1.4" stroke-linecap="round"/>`;
  s += lamp(0.6, 1.94, 18) + lamp(1.94, 0.6, 18);
  if (L >= 3) s += bush(0.18, 1.82, 0.9) + bush(1.82, 0.18, 0.9);
  return s;
}

function stadium(L: number) {
  let s = lot(3, 'plaza', 4);
  const [cx, cy] = I(1.5, 1.5, 2);
  const rx = 1.32 * RX;
  const ry = 1.32 * RY;
  const wall = 16 + L * 3;
  s += ell([cx, cy + 2], rx + 8, ry + 5, '#1d2a3a', 0, 'fill-opacity=".14"');
  s += `<path d="M${f1(cx - rx)},${f1(cy - wall)} L${f1(cx - rx)},${f1(cy)} A${f1(rx)},${f1(ry)} 0 0 0 ${f1(cx + rx)},${f1(cy)} L${f1(cx + rx)},${f1(cy - wall)} Z" fill="#e86a5c" stroke="${OUTLINE}" stroke-width="${SW}"/>`;
  let rib = '';
  for (let i = 1; i < 10; i++) {
    const a = Math.PI * (i / 10);
    const x = cx - Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    rib += `M${f1(x)},${f1(y)}L${f1(x)},${f1(y - wall)}`;
  }
  s += `<path d="${rib}" stroke="${shade('#e86a5c', -0.25)}" stroke-width="1.2"/>`;
  s += ell([cx, cy - wall], rx, ry, '#f2f0ea', SW);
  s += ell([cx, cy - wall + 2], rx * 0.9, ry * 0.9, '#6aa9e6', 1.2);
  s += ell([cx, cy - wall + 3.5], rx * 0.8, ry * 0.8, '#f7c84a', 1.2);
  s += ell([cx, cy - wall + 5], rx * 0.7, ry * 0.7, '#e05a4f', 1.2);
  s += ell([cx, cy - wall + 6.5], rx * 0.58, ry * 0.58, '#5fbf4a', 1.4);
  s += ell([cx, cy - wall + 6.5], rx * 0.16, ry * 0.16, 'none', 0, `stroke="#ffffff" stroke-width="1.4"`);
  s += ln([cx - rx * 0.41, cy - wall + 6.5 - ry * 0.41], [cx + rx * 0.41, cy - wall + 6.5 + ry * 0.41], '#ffffff', 1.4);
  if (L >= 2) {
    const arc = `M${f1(cx - rx)},${f1(cy - wall)} A${f1(rx)},${f1(ry)} 0 0 1 ${f1(cx + rx)},${f1(cy - wall)}`;
    s += `<path d="${arc}" fill="none" stroke="${OUTLINE}" stroke-width="7"/><path d="${arc}" fill="none" stroke="#ffffff" stroke-width="4.5"/>`;
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (1 + i / 5);
      s += flag(cx + Math.cos(a) * rx * 0.97, cy - wall + Math.sin(a) * ry * 0.97, 14, pick(['#7ed957', '#ff6b6b', '#5b9be0', '#ffd166'], i));
    }
  }
  for (const [gx, gy] of [
    [0.2, 0.2],
    [2.8, 0.2],
    [0.2, 2.8],
    [2.8, 2.8],
  ]) {
    const [lx, ly] = I(gx, gy, 2);
    s += ln([lx, ly], [lx, ly - 50], OUTLINE, 2) + `<rect x="${f1(lx - 8)}" y="${f1(ly - 58)}" width="16" height="9" rx="2" fill="${LAMP}" stroke="${OUTLINE}" stroke-width="1.3"/>`;
    s += halo([lx, ly - 54], 22, GLOW2);
  }
  if (L >= 3) {
    const [sx, sy] = I(1.5, 0.15, 2);
    s += ln([sx - 10, sy], [sx - 10, sy - 30], OUTLINE, 2) + ln([sx + 10, sy], [sx + 10, sy - 30], OUTLINE, 2);
    s += `<rect x="${f1(sx - 18)}" y="${f1(sy - 46)}" width="36" height="18" rx="3" fill="#2b3a55" stroke="${OUTLINE}" stroke-width="1.3"/><rect x="${f1(sx - 14)}" y="${f1(sy - 42)}" width="12" height="9" fill="${NEON_B}"/><rect x="${f1(sx + 2)}" y="${f1(sy - 42)}" width="12" height="9" fill="${NEON_A}"/>`;
  }
  return s;
}

function pond(v: number) {
  const r = mulberry32(v);
  let s = lot(1, 'grass', v);
  const [cx, cy] = I(0.5, 0.5);
  const n = 10;
  const p: P[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 0.82 + r() * 0.18;
    p.push([cx + Math.cos(a) * 25 * k, cy + Math.sin(a) * 12.5 * k]);
  }
  let d = `M${f1((p[0][0] + p[1][0]) / 2)},${f1((p[0][1] + p[1][1]) / 2)}`;
  for (let i = 1; i <= n; i++) {
    const a = p[i % n];
    const b = p[(i + 1) % n];
    d += ` Q${f1(a[0])},${f1(a[1])} ${f1((a[0] + b[0]) / 2)},${f1((a[1] + b[1]) / 2)}`;
  }
  s += `<path d="${d}Z" fill="#cfc6b4" stroke="${OUTLINE}" stroke-width="${SW}" transform="translate(0,1.5)"/>`;
  s += `<path d="${d}Z" fill="#6ec6e8" stroke="${OUTLINE}" stroke-width="${SW}"/>`;
  s += ell([cx - 7, cy - 3], 7, 2.2, '#c4f0ff', 0);
  s += ell([cx + 8, cy + 3], 4.5, 2.4, '#5fbf4a', 1) + ell([cx - 3, cy + 5], 3.5, 1.8, '#5fbf4a', 1);
  s += circ([cx + 9, cy + 1.5], 1.4, '#ff8fb1', 0.8);
  s += `<g class="ch-duck">${duck([cx - 8, cy + 2])}</g>`;
  const [rx0, ry0] = I(0.88, 0.74);
  s += ln([rx0, ry0], [rx0 - 1, ry0 - 12], '#3f8f2f', 1.6) + ln([rx0 + 3, ry0], [rx0 + 4, ry0 - 9], '#3f8f2f', 1.6) + ell([rx0 - 1, ry0 - 13], 1.4, 3, '#8b5a3c', 0.8);
  return s;
}

function school(L: number, v: number) {
  const brick = '#d4694e';
  let s = lot(2, 'paved', v);
  s += poly([I(1.08, 1.08), I(1.9, 1.08), I(1.9, 1.9), I(1.08, 1.9)], '#5aa36a', 1.1);
  s += polyNS([I(1.2, 1.2), I(1.78, 1.2), I(1.78, 1.78), I(1.2, 1.78)], 'none', 'stroke="#ffffff" stroke-width="1.4"');
  s += ell(I(1.49, 1.49), 8, 4, 'none', 0, `stroke="#ffffff" stroke-width="1.4"`);
  const [sx, sy] = I(1.7, 1.25);
  s += ln([sx, sy], [sx, sy - 16], OUTLINE, 2) + ln([sx + 6, sy - 2], [sx + 6, sy - 16], OUTLINE, 2) + `<path d="M${f1(sx + 3)},${f1(sy - 16)} Q${f1(sx - 10)},${f1(sy - 10)} ${f1(sx - 16)},${f1(sy + 4)}" fill="none" stroke="#ff8a3d" stroke-width="4" stroke-linecap="round"/>`;
  const h = 26 + (L >= 2 ? 10 : 0);
  s += ao(0.1, 0.1, 1.9, 0.92);
  s += box(0.1, 0.12, 1.9, 0.92, 0, h, brick, { ao: true, rim: true });
  s += windowsL(0.1, 1.9, 0.92, 7, L >= 2 ? 2 : 1, 5, h - 3, v, 0.6, 0.6);
  s += windowsR(0.12, 0.92, 1.9, 3, L >= 2 ? 2 : 1, 5, h - 3, v + 1);
  s += box(0.06, 0.08, 1.94, 0.96, h, 3, '#f1e6d6');
  s += box(0.1, 0.92, 0.9, 1.88, 0, h - 6, brick, { ao: true });
  s += windowsL(0.1, 0.9, 1.88, 3, 1, 5, h - 9, v + 2);
  s += qL(0.1, 0.9, 1.88, 0.62, 0.86, 0, 11, '#5b3a22');
  s += box(0.06, 0.88, 0.94, 1.92, h - 6, 3, '#f1e6d6');
  s += box(0.8, 0.3, 1.2, 0.7, h + 3, 16, '#f6ecd6', { rim: true });
  const [cx, cy] = I(1.0, 0.7, h + 12);
  s += circ([cx - 6, cy + 3], 4.4, '#ffffff', 1.2) + ln([cx - 6, cy + 3], [cx - 6, cy], OUTLINE, 1) + ln([cx - 6, cy + 3], [cx - 3.8, cy + 3], OUTLINE, 1);
  s += pyramid(0.78, 0.28, 1.22, 0.72, h + 19, 12, '#2f6fb3');
  s += flag(...I(1.92, 0.98), 34, '#5b9be0');
  if (L >= 2) s += parked(1.5, 0.99, 'xp', '#ffc23d', 0.62, 9.5, undefined, undefined, true);
  if (L >= 3) s += poly([I(0.3, 0.2, h + 3.2), I(0.7, 0.2, h + 3.2), I(0.7, 0.8, h + 3.2), I(0.3, 0.8, h + 3.2)], '#35508f', 1) + tree(1.92, 1.95, 0.8, '#5cbf4a', 0, 'round');
  return s;
}

function firestation(L: number, v: number) {
  const red = '#d9483b';
  let s = lot(1, 'paved', v);
  const x0 = 0.14;
  const y0 = 0.34;
  const x1 = 0.86;
  const y1 = 0.7;
  const h = 26 + (L >= 2 ? 6 : 0);
  s += ao(0.14, 0.14, x1, y1);
  s += box(0.14, 0.14, 0.34, 0.34, 0, h + 22, '#c8bfb0', { ao: true });
  s += windowsL(0.14, 0.34, 0.34, 1, 3, h + 4, h + 20, v);
  s += pyramid(0.12, 0.12, 0.36, 0.36, h + 22, 8, red);
  s += box(x0, y0, x1, y1, 0, h, red, { ao: true, rim: true });
  for (const [a, b] of [
    [0.06, 0.44],
    [0.52, 0.9],
  ] as [number, number][]) {
    s += qL(x0, x1, y1, a, b, 0, 15, '#f2f0ea', 1.2);
    let dd = '';
    for (let z = 3; z < 15; z += 3) {
      const q = qLp(x0, x1, y1, a, b, z, z);
      dd += `M${f1(q[0][0])},${f1(q[0][1])}L${f1(q[1][0])},${f1(q[1][1])}`;
    }
    s += `<path d="${dd}" stroke="#c9c2b2" stroke-width="1" fill="none"/>`;
  }
  s += windowsL(x0, x1, y1, 3, 1, 18, h - 2, v + 1);
  s += windowsR(y0, y1, x1, 2, 1, 4, h - 2, v + 2);
  s += box(x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, h, 3, '#f2f0ea');
  s += blinkLight(I(0.5, 0.52, h + 5), BLINK_R);
  if (L >= 2) s += parked(0.5, 0.86, 'xp', red, 0.62, 10, '#f2f0ea', [BLINK_R, BLINK_B]);
  if (L >= 3) s += flag(...I(0.92, 0.2), 30, red);
  return s;
}

function police(L: number, v: number) {
  const blue = '#3d6fd1';
  let s = lot(1, 'paved', v);
  const x0 = 0.16;
  const y0 = 0.14;
  const x1 = 0.84;
  const y1 = 0.68;
  const h = 26 + (L >= 2 ? 8 : 0);
  s += ao(x0, y0, x1, y1);
  s += box(x0, y0, x1, y1, 0, h, '#eef1f6', { ao: true, rim: true });
  s += polyNS(qLp(x0, x1, y1, 0, 1, h - 7, h - 3), blue) + polyNS(qRp(y0, y1, x1, 0, 1, h - 7, h - 3), shade(blue, -0.2));
  s += windowsL(x0, x1, y1, 3, 1, 4, h - 9, v);
  s += windowsR(y0, y1, x1, 2, L >= 2 ? 2 : 1, 4, h - 9, v + 1);
  s += qL(x0, x1, y1, 0.4, 0.6, 0, 12, '#2b3a55');
  const [bx, by] = I(0.5, y1, h - 1);
  s += `<path d="M${f1(bx)},${f1(by - 13)} l5,2 v4 q0,5 -5,7 q-5,-2 -5,-7 v-4Z" fill="#f2c14e" stroke="${OUTLINE}" stroke-width="1.1"/>`;
  s += box(x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, h, 3, blue);
  const [ax, ay] = I(0.3, 0.3, h + 3);
  s += ln([ax, ay], [ax, ay - 16], OUTLINE, 1.4) + blinkLight([ax, ay - 17], BLINK_R);
  s += parked(0.5, 0.86, 'xp', '#f5f7fb', 0.44, 5, blue, L >= 2 ? [BLINK_R, BLINK_B] : undefined);
  if (L >= 3) s += planter(0.08, 0.92, v) + lamp(0.92, 0.3, 18);
  return s;
}

function hospital(L: number, v: number) {
  let s = lot(2, 'paved', v);
  const x0 = 0.18;
  const y0 = 0.15;
  const x1 = 1.82;
  const y1 = 1.4;
  const h = 40 + L * 10;
  s += ao(x0, y0, x1, y1);
  s += box(x0, y0, x1, y1, 0, h, '#f6f8fb', { ao: true, rim: true });
  const rows = Math.floor((h - 10) / 10);
  s += windowsL(x0, x1, y1, 7, rows, 12, h - 3, v, 0.7, 0.55);
  s += windowsR(y0, y1, x1, 5, rows, 4, h - 3, v + 1, 0.7, 0.55);
  s += polyNS(qLp(x0, x1, y1, 0, 1, 0, 9), '#cfe3f3') + qL(x0, x1, y1, 0.42, 0.58, 0, 9, GLASS, 1.1);
  s += box(x0 + 0.55, y1, x0 + 1.1, y1 + 0.3, 9, 2, '#e05a4f');
  s += ln(I(x0 + 0.58, y1 + 0.28), I(x0 + 0.58, y1 + 0.28, 9), OUTLINE, 1.4) + ln(I(x0 + 1.07, y1 + 0.28), I(x0 + 1.07, y1 + 0.28, 9), OUTLINE, 1.4);
  const [cx, cy] = I(x0 + (x1 - x0) * 0.82, y1, h - 9);
  s += `<path d="M${f1(cx - 2.6)},${f1(cy - 9)}h5.2v4.4h4.4v5.2h-4.4v4.4h-5.2v-4.4h-4.4v-5.2h4.4Z" fill="#e2504c" stroke="${OUTLINE}" stroke-width="1"/>`;
  s += box(x0 - 0.02, y0 - 0.02, x1 + 0.02, y1 + 0.02, h, 3, '#dfe6ee');
  if (L >= 2) {
    const [hx, hy] = I(1.0, 0.78, h + 3);
    s += ell([hx, hy], 22, 11, '#3d8f5f', 1.3) + ell([hx, hy], 15, 7.5, 'none', 0, `stroke="#ffffff" stroke-width="1.4"`) + `<path d="M${f1(hx - 4)},${f1(hy - 3)}v6M${f1(hx + 4)},${f1(hy - 3)}v6M${f1(hx - 4)},${f1(hy)}h8" stroke="#ffffff" stroke-width="1.8" fill="none"/>`;
  } else {
    s += box(0.6, 0.5, 1.0, 0.9, h + 3, 6, '#c7ccd8', { sw: 1 });
  }
  if (L >= 3) s += blinkLight(I(0.2, 0.17, h + 5), BLINK_R) + blinkLight(I(1.8, 0.17, h + 5), BLINK_R, 0.7);
  s += parked(1.55, 1.72, 'xn', '#f7f7f7', 0.46, 7, '#e2504c', [BLINK_R, BLINK_B]);
  s += tree(0.3, 1.75, 0.85, '#5cbf4a') + planter(0.85, 1.82, v);
  return s;
}

function windmill(L: number) {
  let s = lot(1, 'grass', 7);
  s += box(0.3, 0.52, 0.62, 0.84, 0, 10, '#e9edf3', { ao: true }) + qR(0.52, 0.84, 0.62, 0.3, 0.7, 0, 7, '#7a808e', 1);
  const h = 64 + L * 14;
  const [bx, by] = I(0.5, 0.42);
  const rB = 4.6;
  const rT = 2.4;
  s += ell([bx, by], 7, 3.5, '#1d2a3a', 0, 'fill-opacity=".2"');
  s += `<path d="M${f1(bx - rB)},${f1(by)} L${f1(bx - rT)},${f1(by - h)} L${f1(bx + rT)},${f1(by - h)} L${f1(bx + rB)},${f1(by)}Z" fill="#f4f6fa" stroke="${OUTLINE}" stroke-width="1.4" stroke-linejoin="round"/>`;
  s += `<path d="M${f1(bx + 0.5)},${f1(by)} L${f1(bx + 0.4)},${f1(by - h)} L${f1(bx + rT)},${f1(by - h)} L${f1(bx + rB)},${f1(by)}Z" fill="#d9dee8"/>`;
  s += `<rect x="${f1(bx - 5)}" y="${f1(by - h - 4)}" width="13" height="7" rx="3" fill="#eef1f6" stroke="${OUTLINE}" stroke-width="1.3"/>`;
  const blade = (rot: number) => `<path d="M0,0 C3,-6 3,-24 0.6,-${30 + L * 4} C-1.6,-24 -2.6,-8 0,0Z" fill="#ffffff" stroke="${OUTLINE}" stroke-width="1.2" transform="rotate(${rot})"/>`;
  s += `<g transform="translate(${f1(bx - 5)},${f1(by - h - 0.5)})"><g class="ch-spin">${blade(0) + blade(120) + blade(240)}${circ([0, 0], 2.6, '#c7ccd8', 1.1)}</g></g>`;
  s += blinkLight([bx + 2, by - h - 6], BLINK_R);
  return s;
}

function hotel(L: number, v: number) {
  const wall = pick(['#f6ead6', '#e9dff3', '#dff0ec'], v);
  const trim = '#c9a24a';
  let s = lot(2, 'plaza', v);
  s += poly([I(1.12, 1.1), I(1.9, 1.1), I(1.9, 1.9), I(1.12, 1.9)], '#e9e3d4', 1.1);
  s += poly([I(1.24, 1.24), I(1.8, 1.24), I(1.8, 1.66), I(1.24, 1.66)], '#58c4ea', 1.2);
  s += polyNS([I(1.3, 1.3), I(1.55, 1.3), I(1.5, 1.42), I(1.3, 1.42)], '#bdf0ff', 'fill-opacity=".8"');
  s += box(1.3, 1.74, 1.5, 1.82, 0, 2, '#ffffff', { sw: 0.9 }) + box(1.58, 1.74, 1.78, 1.82, 0, 2, '#ffffff', { sw: 0.9 });
  const palm = (gx: number, gy: number) => {
    const [x, y] = I(gx, gy);
    let p = `<path d="M${f1(x)},${f1(y)} q2,-10 -1,-22" fill="none" stroke="#8b5a3c" stroke-width="2.6" stroke-linecap="round"/>`;
    for (const a of [-70, -30, 10, 50, 130, 170]) {
      const r = (a * Math.PI) / 180;
      p += `<path d="M${f1(x - 1)},${f1(y - 22)} q${f1(8 * Math.cos(r))},${f1(-6 + 4 * Math.sin(r))} ${f1(13 * Math.cos(r))},${f1(5 + 6 * Math.sin(r))}" fill="none" stroke="#3f9a4a" stroke-width="3.2" stroke-linecap="round"/>`;
    }
    return g('ch-sway', p);
  };
  s += palm(1.92, 1.2) + palm(1.15, 1.95);
  const x0 = 0.15;
  const y0 = 0.15;
  const x1 = 1.05;
  const y1 = 1.85;
  const h = 70 + L * 14;
  s += ao(x0, y0, x1, y1);
  s += box(x0, y0, x1, y1, 0, h, wall, { ao: true, rim: true });
  const rows = Math.floor((h - 14) / 10);
  s += windowsL(x0, x1, y1, 3, rows, 14, h - 6, v, 0.62, 0.6);
  s += windowsR(y0, y1, x1, 6, rows, 14, h - 6, v + 1, 0.62, 0.6);
  s += polyNS(qLp(x0, x1, y1, 0, 1, 0, 11), shade(wall, -0.2)) + polyNS(qRp(y0, y1, x1, 0, 1, 0, 11), shade(wall, -0.32));
  s += polyNS(qLp(x0, x1, y1, 0, 1, 11, 12.5), trim) + polyNS(qRp(y0, y1, x1, 0, 1, 11, 12.5), trim);
  s += qR(y0, y1, x1, 0.38, 0.62, 0, 10, '#7a4b2a', 1.1);
  s += polyNS([I(x1, 0.92), I(x1 + 0.4, 0.92), I(x1 + 0.4, 1.08), I(x1, 1.08)], '#d9353f');
  s += box(x1, 0.82, x1 + 0.26, 1.18, 10, 2.4, trim);
  s += box(x0 - 0.03, y0 - 0.03, x1 + 0.03, y1 + 0.03, h, 4, trim);
  const [rx, ry] = I(0.6, 1.2, h + 4);
  s += `<rect x="${f1(rx - 22)}" y="${f1(ry - 14)}" width="44" height="11" rx="3" fill="#2b2236" stroke="${OUTLINE}" stroke-width="1.2"/>`;
  for (let i = 0; i < 5; i++) s += circ([rx - 16 + i * 8, ry - 8.5], 2.2, i % 2 ? LAMP : '#ffd166', 0);
  s += halo([rx, ry - 8], 30, LAMP);
  if (L >= 5) s += poly([I(0.3, 0.3, h + 4.2), I(0.9, 0.3, h + 4.2), I(0.9, 0.7, h + 4.2), I(0.3, 0.7, h + 4.2)], '#58c4ea', 1);
  return s;
}

function ferris(L: number) {
  let s = lot(2, 'plaza', 6);
  s += box(1.45, 1.45, 1.85, 1.85, 0, 12, '#ff8fb1', { ao: true }) + gableX(1.45, 1.45, 1.85, 1.85, 12, 7, '#ffffff', '#ff8fb1');
  const [cx, cy0] = I(1, 1);
  const R = 42 + L * 7;
  const cy = cy0 - R - 12;
  const legs = `M${f1(cx - 24)},${f1(cy0 + 4)} L${f1(cx)},${f1(cy)} L${f1(cx + 24)},${f1(cy0 + 4)}`;
  s += `<path d="${legs}" fill="none" stroke="${OUTLINE}" stroke-width="6" stroke-linejoin="round"/><path d="${legs}" fill="none" stroke="#e9edf3" stroke-width="3.4" stroke-linejoin="round"/>`;
  const n = 8 + (L - 1) * 2;
  let wheel = circ([0, 0], R, 'none', 0, `stroke="${OUTLINE}" stroke-width="5"`) + circ([0, 0], R, 'none', 0, `stroke="#ff6b6b" stroke-width="3"`);
  wheel += circ([0, 0], R * 0.55, 'none', 0, `stroke="${OUTLINE}" stroke-width="1.6"`);
  let sp = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    sp += `M0,0L${f1(Math.cos(a) * R)},${f1(Math.sin(a) * R)}`;
  }
  wheel += `<path d="${sp}" stroke="${OUTLINE}" stroke-width="1.2"/>`;
  const cols = ['#ffd166', '#4f8ef7', '#6cc56a', '#ff9f43', '#b388ff'];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const gx = Math.cos(a) * R;
    const gy = Math.sin(a) * R;
    wheel += `<g transform="translate(${f1(gx)},${f1(gy)})"><g class="ch-spin-rev">${ln([0, 0], [0, 4], OUTLINE, 1.2)}<rect x="-5" y="4" width="10" height="7.5" rx="2.5" fill="${pick(cols, i)}" stroke="${OUTLINE}" stroke-width="1.1"/></g></g>`;
    wheel += `<g class="ch-glow">${circ([gx, gy], 3.2, GLOW2, 0)}</g>`;
  }
  s += `<g transform="translate(${f1(cx)},${f1(cy)})"><g class="ch-spin-slow">${wheel}</g>${circ([0, 0], 4.4, '#e9edf3', 1.3)}</g>`;
  s += flowers(0.3, 1.7, 3, 5) + bench(0.4, 0.3, true);
  return s;
}

function statue(L: number, v: number) {
  let s = lot(1, 'plaza', v);
  if (L >= 2) s += flowers(0.18, 0.5, v, 4, 0.15) + flowers(0.82, 0.5, v + 1, 4, 0.15) + flowers(0.5, 0.85, v + 2, 4, 0.2);
  s += box(0.3, 0.3, 0.7, 0.7, 0, 5, '#c8c0ae') + box(0.36, 0.36, 0.64, 0.64, 5, 16, '#ddd5c3', { rim: true });
  const metal = L >= 3 ? '#f2c14e' : '#c7864a';
  const [x, y] = I(0.5, 0.5, 21);
  s += `<path d="M${f1(x - 4)},${f1(y)} L${f1(x - 3)},${f1(y - 14)} L${f1(x + 3)},${f1(y - 14)} L${f1(x + 4)},${f1(y)}Z" fill="${metal}" stroke="${OUTLINE}" stroke-width="1.2"/>`;
  s += `<path d="M${f1(x - 5.5)},${f1(y - 14)} Q${f1(x)},${f1(y - 18)} ${f1(x + 5.5)},${f1(y - 14)} L${f1(x + 4)},${f1(y - 7)} L${f1(x - 4)},${f1(y - 7)}Z" fill="${shade(metal, -0.12)}" stroke="${OUTLINE}" stroke-width="1.1"/>`;
  s += circ([x, y - 20.5], 3.6, metal, 1.1);
  s += `<path d="M${f1(x + 4.5)},${f1(y - 14)} L${f1(x + 9)},${f1(y - 27)}" stroke="${OUTLINE}" stroke-width="3.4" stroke-linecap="round"/><path d="M${f1(x + 4.5)},${f1(y - 14)} L${f1(x + 9)},${f1(y - 27)}" stroke="${metal}" stroke-width="2" stroke-linecap="round"/>`;
  s += `<path d="M${f1(x + 9)},${f1(y - 27)} q-3,-4 0,-9 q3,5 0,9Z" fill="#ff8a3d" stroke="${OUTLINE}" stroke-width="1"/>`;
  s += halo([x + 9, y - 31], 14, GLOW1);
  if (L >= 3) s += lamp(0.12, 0.88, 16) + lamp(0.88, 0.12, 16);
  return s;
}

function watertower(L: number, v: number) {
  let s = lot(1, 'grass', v);
  const legs: [number, number][] = [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.72, 0.72],
    [0.28, 0.72],
  ];
  const lh = 34 + L * 6;
  const top = (a: number, b: number) => I(0.5 + (a - 0.5) * 0.6, 0.5 + (b - 0.5) * 0.6, lh);
  let ld = '';
  for (const [a, b] of legs) ld += `M${f1(I(a, b)[0])},${f1(I(a, b)[1])}L${f1(top(a, b)[0])},${f1(top(a, b)[1])}`;
  s += `<path d="${ld}" stroke="${OUTLINE}" stroke-width="3.2"/><path d="${ld}" stroke="#8a93a5" stroke-width="1.6"/>`;
  s += ln(I(0.33, 0.67, lh * 0.45), I(0.67, 0.67, lh * 0.45), '#8a93a5', 1.4) + ln(I(0.67, 0.33, lh * 0.45), I(0.67, 0.67, lh * 0.45), '#8a93a5', 1.4);
  const tank = L >= 3 ? '#4f8ef7' : '#e05a4f';
  const r = 0.27 + L * 0.02;
  s += cyl(0.5, 0.5, r, lh, 22, tank);
  const [sx, sy] = I(0.5, 0.5, lh + 10);
  s += `<path d="M${f1(sx - r * RX)},${f1(sy)} A${f1(r * RX)},${f1(r * RY)} 0 0 0 ${f1(sx + r * RX)},${f1(sy)}" fill="none" stroke="#ffffff" stroke-width="3"/>`;
  const [tx, ty] = I(0.5, 0.5, lh + 22);
  const rr = r * RX;
  s += `<path d="M${f1(tx - rr)},${f1(ty)} L${f1(tx)},${f1(ty - 13)} L${f1(tx + rr)},${f1(ty)} A${f1(rr)},${f1(rr * 0.5)} 0 0 1 ${f1(tx - rr)},${f1(ty)}Z" fill="${shade(tank, -0.2)}" stroke="${OUTLINE}" stroke-width="1.4"/>`;
  s += ln(I(0.72, 0.72, 2), I(0.62, 0.66, lh), OUTLINE, 1.2);
  return s;
}

function flowerBed(v: number) {
  let s = lot(1, 'grass', v);
  s += box(0.2, 0.2, 0.8, 0.8, 0, 5, '#b9763f', { rim: true });
  s += poly([I(0.25, 0.25, 5), I(0.75, 0.25, 5), I(0.75, 0.75, 5), I(0.25, 0.75, 5)], '#6b4a2a', 1);
  const r = mulberry32(v);
  for (let i = 0; i < 16; i++) {
    const [x, y] = I(0.28 + r() * 0.44, 0.28 + r() * 0.44, 5);
    s += circ([x, y - 2], 2.4, '#4fae43', 0) + circ([x, y - 3.5], 2.1, pick(FLOWER_COLS, v + i), 0.8);
  }
  return s;
}

function plaza(v: number) {
  let s = lot(1, 'plaza', v);
  const d = v % 4;
  if (d === 0) s += bench(0.5, 0.5, true) + lamp(0.8, 0.2, 18);
  else if (d === 1) s += planter(0.5, 0.5, v) + bench(0.5, 0.82, true);
  else if (d === 2) s += ell(I(0.5, 0.48), 12, 6, '#d8ccb2', 1.2) + tree(0.5, 0.48, 0.9, '#5cbf4a', 0, 'round');
  else s += lamp(0.5, 0.5, 20) + bench(0.25, 0.5, false) + bench(0.75, 0.5, false);
  return s;
}

/* ------------------------------------------------------------------ construction */
/*
 * A construction site goes through four stages, driven by build progress (0..1):
 *   0  breaking ground  — survey stakes, excavator digging the pit, dirt pile
 *   1  foundation       — concrete slab poured, rebar, mixer truck
 *   2  structure        — steel frame climbs, floors are clad from the bottom up, scaffolding, tower crane
 *   3  finishing        — building complete, scaffolding comes down, sparkles
 * In the live game the art for a stage is fixed and the continuous parts (frame height, cladding,
 * scaffolding) follow CSS variables (--fr, --rv, --sc) set on the building's <g>, with a 1 s transition.
 * Nothing is re-created between ticks, so every crane swing, worker and spark keeps animating smoothly.
 * Static renders (NFT images, snapshots) bake the same numbers into plain SVG attributes instead.
 */
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export interface BuildPhase {
  stage: 0 | 1 | 2 | 3;
  /** steel frame height, 0..1 */
  fr: number;
  /** cladding (the real building revealed from the ground up), 0..1 */
  rv: number;
  /** scaffolding height, 0..1 */
  sc: number;
}
export function constructionPhase(progress: number): BuildPhase {
  const p = clamp01(progress);
  return {
    stage: p < 0.12 ? 0 : p < 0.24 ? 1 : p < 0.9 ? 2 : 3,
    fr: clamp01((p - 0.22) / 0.43),
    rv: clamp01((p - 0.38) / 0.52),
    sc: clamp01((p - 0.2) / 0.42),
  };
}
/** CSS variables for a live construction site (put them on the building's <g style>). */
export function constructionVars(progress: number): Record<string, string> {
  const ph = constructionPhase(progress);
  return { '--fr': ph.fr.toFixed(4), '--rv': ph.rv.toFixed(4), '--sc': ph.sc.toFixed(4) };
}
const cv = (name: string, val: number) => `var(${name},${val.toFixed(4)})`;

export function sitePad(size: number, seed = 1): string {
  return lot(size, 'dirt', seed) + siteFence(size);
}
function crates(size: number) {
  return box(size - 0.42, 0.14, size - 0.14, 0.36, 0, 4, '#c97f4c', { sw: 1 }) + box(size - 0.4, 0.16, size - 0.16, 0.34, 4, 3, '#d98f5c', { sw: 1 });
}

/** stage 0: survey stakes, string lines and a dug pit */
function groundworks(size: number, seed: number) {
  const a = 0.22;
  const b = size - 0.22;
  const d = 6;
  let s = '';
  s += poly([I(a, a, -d), I(b, a, -d), I(b, b, -d), I(a, b, -d)], '#9c7448', 1.1);
  s += polyNS([I(a, a, 0), I(b, a, 0), I(b, a, -d), I(a, a, -d)], '#87623b');
  s += polyNS([I(a, a, 0), I(a, b, 0), I(a, b, -d), I(a, a, -d)], '#7a5833');
  s += `<polyline points="${pts([I(a, b, 0), I(a, a, 0), I(b, a, 0)])}" fill="none" stroke="${OUTLINE}" stroke-width="1.1"/>`;
  const r = mulberry32(seed + 5);
  for (let i = 0; i < 5 * size; i++) s += circ(I(a + r() * (b - a), a + r() * (b - a), -d), 1 + r(), '#8a663f', 0);
  const st = 0.14;
  const corners: [number, number][] = [
    [st, st],
    [size - st, st],
    [size - st, size - st],
    [st, size - st],
  ];
  const ring = [...corners, corners[0]].map(([x, y]) => I(x, y, 6));
  s += `<polyline points="${pts(ring)}" fill="none" stroke="#ffffff" stroke-width="1" stroke-dasharray="3 2"/>`;
  for (const [x, y] of corners) s += ln(I(x, y), I(x, y, 8), OUTLINE, 2.2) + ln(I(x, y, 6), I(x, y, 8.5), '#ff6b57', 2);
  return s;
}
function dirtPile(gx: number, gy: number, sc = 1) {
  const [x, y] = I(gx, gy);
  const w = 15 * sc;
  const h = 11 * sc;
  return (
    ell([x, y], w + 2, 5 * sc, '#1d2a3a', 0, 'fill-opacity=".16"') +
    `<path d="M${f1(x - w)},${f1(y)} Q${f1(x - w * 0.55)},${f1(y - h * 1.1)} ${f1(x)},${f1(y - h)} Q${f1(x + w * 0.6)},${f1(y - h * 0.95)} ${f1(x + w)},${f1(y)} Z" fill="#b98b55" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<path d="M${f1(x - w * 0.4)},${f1(y - h * 0.6)} Q${f1(x - w * 0.1)},${f1(y - h * 0.95)} ${f1(x + w * 0.25)},${f1(y - h * 0.8)}" stroke="#d6aa72" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    circ([x + w * 0.5, y - 2], 1.6, '#8a663f', 0) +
    circ([x - w * 0.6, y - 1.5], 1.3, '#8a663f', 0)
  );
}
/** little yellow excavator; arm and bucket dig on a loop */
function excavator(gx: number, gy: number, sc = 1, flip = false) {
  const [x, y] = I(gx, gy);
  const Y = '#f7c84a';
  let t = ell([0, 1], 17, 5.5, '#1d2a3a', 0, 'fill-opacity=".2"');
  t += `<rect x="-14" y="-6" width="25" height="7.5" rx="3.7" fill="#3a3f4b" stroke="${OUTLINE}" stroke-width="1.2"/>`;
  for (const cx of [-10, -2.5, 5]) t += circ([cx, -2.2], 2, '#5c6370', 0.8);
  t += `<path d="M-12,-6 L-12,-15 L4,-15 L8,-10.5 L8,-6Z" fill="${Y}" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/>`;
  t += `<rect x="-12" y="-11" width="6" height="3" fill="#2b2236" opacity=".25"/>`;
  t += `<rect x="-10" y="-26" width="11" height="12" rx="2.2" fill="#f2b632" stroke="${OUTLINE}" stroke-width="1.3"/><rect x="-8" y="-24" width="7" height="6" rx="1.2" fill="${WIN}" stroke="${OUTLINE}" stroke-width=".8"/>`;
  // boom + stick + bucket (two-joint dig cycle)
  t += `<g class="ch-dig" style="transform-origin:5px -13px">`;
  t += `<path d="M5,-13 L19,-28" stroke="${OUTLINE}" stroke-width="5.4" stroke-linecap="round"/><path d="M5,-13 L19,-28" stroke="${Y}" stroke-width="3.4" stroke-linecap="round"/>`;
  t += `<g class="ch-dig2" style="transform-origin:19px -28px">`;
  t += `<path d="M19,-28 L26,-12" stroke="${OUTLINE}" stroke-width="4.4" stroke-linecap="round"/><path d="M19,-28 L26,-12" stroke="${Y}" stroke-width="2.6" stroke-linecap="round"/>`;
  t += `<path d="M23,-14 L31,-12 L29,-5 L22,-7Z" fill="#7a808e" stroke="${OUTLINE}" stroke-width="1.2" stroke-linejoin="round"/>`;
  t += `<path d="M22.5,-7 l1,2.4 M25,-6.3 l1,2.4 M27.5,-5.6 l1,2.4" stroke="${OUTLINE}" stroke-width="1" />`;
  t += `<g class="ch-dirt">${circ([30, -4], 1.6, '#b98b55', 0.6)}${circ([27, -2], 1.3, '#b98b55', 0.6)}</g>`;
  t += `</g></g>`;
  return `<g transform="translate(${f1(x)},${f1(y)}) scale(${flip ? -sc : sc},${sc})"><g class="ch-in">${t}</g></g>`;
}
/** cement mixer truck, drum turning */
function mixerTruck(gx: number, gy: number, sc = 1) {
  const [x, y] = I(gx, gy);
  let t = ell([0, 2], 22, 6, '#1d2a3a', 0, 'fill-opacity=".2"');
  t += `<rect x="-20" y="-7" width="38" height="5" rx="1.5" fill="#4a505c" stroke="${OUTLINE}" stroke-width="1.1"/>`;
  for (const cx of [-14, -5, 12]) t += circ([cx, -1.5], 3.4, '#2b2236', 0) + circ([cx, -1.5], 1.4, '#9aa1ad', 0);
  t += `<path d="M8,-7 L8,-20 L15,-20 L19,-13 L19,-7Z" fill="#ff6b57" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/><path d="M10,-18 L14.5,-18 L17,-13.5 L10,-13.5Z" fill="${WIN}" stroke="${OUTLINE}" stroke-width=".8"/>`;
  t += `<ellipse cx="-6" cy="-15" rx="14" ry="8.5" transform="rotate(-12 -6 -15)" fill="#e9eef4" stroke="${OUTLINE}" stroke-width="1.3"/>`;
  t += `<g transform="translate(-6,-15)"><g class="ch-drum">`;
  t += `<path d="M-9,-3 Q0,-9 9,-2 M-10,3 Q0,-3 10,4" stroke="#ff6b57" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  t += `</g></g>`;
  t += `<path d="M-20,-12 L-24,-6 L-19,-6" fill="#c9ced6" stroke="${OUTLINE}" stroke-width="1"/>`;
  return `<g transform="translate(${f1(x)},${f1(y)}) scale(${sc})"><g class="ch-in">${t}</g></g>`;
}
function wheelbarrow(gx: number, gy: number) {
  const [x, y] = I(gx, gy);
  return `<g transform="translate(${f1(x)},${f1(y)})"><g class="ch-in">${circ([5, -2.5], 2.6, '#2b2236', 0)}<path d="M-6,-9 L7,-9 L5,-4 L-3,-4Z" fill="#4fae43" stroke="${OUTLINE}" stroke-width="1.1" stroke-linejoin="round"/>${ell([0.5, -9], 6.5, 1.6, '#9aa1ad', 0.8)}${ln([-3, -4], [-9, -1], OUTLINE, 1.3)}</g></g>`;
}

/** a crew member walking back and forth between two ground points */
function patrolWorker(a: [number, number], b: [number, number], variant: number, dur = 9, delay = 0) {
  const [x0, y0] = I(a[0], a[1]);
  const [x1, y1] = I(b[0], b[1]);
  const body = personArt(variant, false, '#ffcc29') + `<rect x="-3" y="-10" width="6" height="2" fill="#ff8a3d"/>`;
  return `<g transform="translate(${f1(x0)},${f1(y0)})"><g class="ch-patrol" style="--dx:${f1(x1 - x0)}px;--dy:${f1(y1 - y0)}px;animation-duration:${dur}s;animation-delay:-${delay}s">${body}</g></g>`;
}
function sparks(p: P, delay = 0) {
  let r = '';
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    r += ln([Math.cos(a) * 1.5, Math.sin(a) * 1.5], [Math.cos(a) * (4.5 + (i % 3)), Math.sin(a) * (4.5 + (i % 3))], i % 2 ? '#fff6c8' : '#ffd84d', 1.3);
  }
  return `<g transform="translate(${f1(p[0])},${f1(p[1])})"><g class="ch-spark" style="animation-delay:${delay}s">${r}${circ([0, 0], 1.6, '#ffffff', 0)}</g>${halo([0, 0], 8, '#ffd86a')}</g>`;
}
function buildSparkle(p: P, r = 5, delay = 0) {
  const d = `M0,${-r} Q0,0 ${r},0 Q0,0 0,${r} Q0,0 ${-r},0 Q0,0 0,${-r}Z`;
  return `<g transform="translate(${f1(p[0])},${f1(p[1])})"><g class="ch-twinkle" style="animation-delay:${delay}s"><path d="${d}" fill="#fff6c8" stroke="#ffd84d" stroke-width=".8"/></g></g>`;
}
export function workers(size: number, seed = 1): string {
  return worker(size * 0.32, size - 0.16, seed % PERSON_VARIANTS, false, true) + worker(size - 0.16, size * 0.55, (seed + 5) % PERSON_VARIANTS, true, seed % 2 === 0);
}
export function dust(size: number): string {
  const [x, y] = I(size * 0.5, size * 0.8);
  return `<g class="ch-dust">${circ([x - 8, y], 4, '#e9dcc5', 1)}${circ([x + 6, y - 2], 5, '#e9dcc5', 1)}</g><g class="ch-dust" style="animation-delay:1.1s">${circ([x + 14, y - 6], 3.4, '#e9dcc5', 1)}</g>`;
}

/**
 * Scaffolding on the two street-facing sides. `sc` = how far up it reaches (0..1 of `h`).
 * Live: the poles grow with --sc and each ledger appears when the poles pass it.
 */
export function scaffold(size: number, h: number, net = false, sc = 1, live = false): string {
  const a = 0.04;
  const b = size - 0.04;
  let s = '';
  const top = sc * h;
  if (net) {
    s += polyNS([I(a, b), I(b, b), I(b, b, h), I(a, b, h)], '#4fc96b', 'fill-opacity=".22" class="ch-net"');
    s += polyNS([I(b, b), I(b, a), I(b, a, h), I(b, b, h)], '#3fae5a', 'fill-opacity=".22" class="ch-net"');
  }
  const posts: [number, number][] = [
    [a, b],
    [(a + b) / 2, b],
    [b, b],
    [b, (a + b) / 2],
    [b, a],
  ];
  if (size >= 2)
    posts.push(
      [(a + (a + b) / 2) / 2, b],
      [((a + b) / 2 + b) / 2, b],
      [b, ((a + b) / 2 + b) / 2],
      [b, (a + (a + b) / 2) / 2],
    );
  const pole = (x: number, y: number) => {
    const [bx, by] = I(x, y);
    const d = `M${f1(bx)},${f1(by)}L${f1(bx)},${f1(by - h)}`;
    const line = `<path d="${d}" stroke="${OUTLINE}" stroke-width="2.8" fill="none" stroke-linecap="round"/><path d="${d}" stroke="#d9a35f" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
    if (live) return `<g class="ch-lv" style="transform-origin:${f1(bx)}px ${f1(by)}px;transform:scaleY(${cv('--sc', sc)})">${line}</g>`;
    const d2 = `M${f1(bx)},${f1(by)}L${f1(bx)},${f1(by - top)}`;
    return top > 1 ? `<path d="${d2}" stroke="${OUTLINE}" stroke-width="2.8" fill="none" stroke-linecap="round"/><path d="${d2}" stroke="#d9a35f" stroke-width="1.5" fill="none" stroke-linecap="round"/>` : '';
  };
  for (const [x, y] of posts) s += pole(x, y);
  for (let z = 9; z <= h; z += 11) {
    const d = `M${f1(I(a, b, z)[0])},${f1(I(a, b, z)[1])}L${f1(I(b, b, z)[0])},${f1(I(b, b, z)[1])}L${f1(I(b, a, z)[0])},${f1(I(b, a, z)[1])}`;
    const plank = `<path d="${d}" stroke="${OUTLINE}" stroke-width="3.6" fill="none" stroke-linejoin="round"/><path d="${d}" stroke="#e8b979" stroke-width="2.2" fill="none" stroke-linejoin="round"/>`;
    if (live) s += `<g class="ch-lv" style="opacity:clamp(0,calc((${cv('--sc', sc)} * ${f1(h)} - ${z} + 4) / 4),1)">${plank}</g>`;
    else if (z <= top) s += plank;
  }
  return s;
}

/**
 * Tower crane: the jib slews round the mast (foreshortened in iso), the trolley runs along it and the
 * hook lowers and lifts its load on a loop.
 */
export function crane(size: number, h: number, load: 'beam' | 'pallet' | 'none' = 'beam', seed = 0): string {
  const [x, y] = I(size * 0.16, size * 0.16);
  let lat = `M${f1(x - 2.5)},${f1(y)}L${f1(x - 2.5)},${f1(y - h)}M${f1(x + 2.5)},${f1(y)}L${f1(x + 2.5)},${f1(y - h)}`;
  for (let z = 0; z < h - 7; z += 7) lat += `M${f1(x - 2.5)},${f1(y - z)}L${f1(x + 2.5)},${f1(y - z - 7)}`;
  let s = box(size * 0.16 - 0.06, size * 0.16 - 0.06, size * 0.16 + 0.06, size * 0.16 + 0.06, 0, 3, '#9aa1ad', { sw: 1 });
  s += `<path d="${lat}" stroke="${OUTLINE}" stroke-width="3" fill="none"/><path d="${lat}" stroke="#f7c84a" stroke-width="1.6" fill="none"/>`;
  const jl = 30 + size * 22;
  const top = y - h;
  const delay = (seed % 7) * 1.3;
  s += `<g class="ch-slew" style="transform-origin:${f1(x)}px ${f1(top)}px;animation-delay:-${delay}s">`;
  s += ln([x - 20, top], [x + jl, top], OUTLINE, 5.4) + ln([x - 20, top], [x + jl, top], '#f7c84a', 3.4);
  let truss = '';
  for (let i = 0; i < jl - 6; i += 7) truss += `M${f1(x + i)},${f1(top - 1.6)}L${f1(x + i + 3.5)},${f1(top + 1.6)}L${f1(x + i + 7)},${f1(top - 1.6)}`;
  s += `<path d="${truss}" stroke="${OUTLINE}" stroke-width=".8" fill="none" opacity=".55"/>`;
  s += ln([x, top - 11], [x + jl * 0.7, top], OUTLINE, 1) + ln([x, top - 11], [x - 17, top], OUTLINE, 1);
  s += `<rect x="${f1(x - 24)}" y="${f1(top - 3)}" width="10" height="10" rx="1.5" fill="#8a8f9c" stroke="${OUTLINE}" stroke-width="1.1"/>`;
  // trolley + hook + load
  const tx = x + jl * 0.32;
  const cable = 34;
  s += `<g class="ch-trolley" style="--run:${f1(jl * 0.48)}px;animation-delay:-${delay * 0.7}s">`;
  s += `<rect x="${f1(tx - 4)}" y="${f1(top - 1)}" width="8" height="4" rx="1" fill="#4a505c" stroke="${OUTLINE}" stroke-width=".9"/>`;
  s += `<g class="ch-cable" style="transform-origin:${f1(tx)}px ${f1(top + 3)}px;animation-delay:-${delay * 0.5}s">${ln([tx, top + 3], [tx, top + 3 + cable], OUTLINE, 1)}</g>`;
  s += `<g class="ch-lift" style="--lift:${f1(-cable * 0.55)}px;animation-delay:-${delay * 0.5}s"><g class="ch-swing" style="transform-origin:${f1(tx)}px ${f1(top + 3 + cable)}px">`;
  s += `<path d="M${f1(tx)},${f1(top + 3 + cable)} q2.5,0 2.5,2.5 q0,2.6 -2.6,2.6" stroke="${OUTLINE}" stroke-width="1.4" fill="none"/>`;
  if (load === 'beam') s += ln([tx - 6, top + 3 + cable], [tx, top + cable - 2], OUTLINE, 0.8) + ln([tx + 6, top + 3 + cable], [tx, top + cable - 2], OUTLINE, 0.8) + `<rect x="${f1(tx - 13)}" y="${f1(top + 4 + cable)}" width="26" height="3.6" rx=".6" fill="#e0663a" stroke="${OUTLINE}" stroke-width="1"/>`;
  else if (load === 'pallet') s += `<rect x="${f1(tx - 7)}" y="${f1(top + 6 + cable)}" width="14" height="8" rx="1" fill="#c8553d" stroke="${OUTLINE}" stroke-width="1"/><path d="M${f1(tx - 7)},${f1(top + 10 + cable)}h14M${f1(tx)},${f1(top + 6 + cable)}v8" stroke="#8b3a29" stroke-width=".8"/><rect x="${f1(tx - 8)}" y="${f1(top + 14 + cable)}" width="16" height="2" fill="#a0683f" stroke="${OUTLINE}" stroke-width=".8"/>`;
  s += `</g></g></g>`;
  s += blinkLight([x + jl, top - 2], BLINK_R);
  s += `</g>`;
  s += `<rect x="${f1(x - 5)}" y="${f1(top + 2)}" width="10" height="9" rx="2" fill="#f08b2e" stroke="${OUTLINE}" stroke-width="1.2"/><rect x="${f1(x - 3)}" y="${f1(top + 4)}" width="6" height="3.5" rx="1" fill="${WIN}"/>`;
  s += ln([x, top - 11], [x, top], OUTLINE, 2);
  return s;
}

/** the visible prism of a building up to height `val * maxH`, as a clipPath (live or static) */
function riseClip(id: string, size: number, maxH: number, name: string, val: number, live: boolean, pad = 0.04) {
  const T = I(-pad, -pad);
  const R = I(size + pad, -pad);
  const B = I(size + pad, size + pad);
  const L = I(-pad, size + pad);
  const yMid = L[1];
  if (!live) {
    const h = val * maxH;
    return `<clipPath id="${id}"><polygon points="${pts([L, B, R, [R[0], R[1] - h], [T[0], T[1] - h], [L[0], L[1] - h]])}"/></clipPath>`;
  }
  const dia = pts([T, R, B, L]);
  return (
    `<clipPath id="${id}"><polygon points="${dia}"/>` +
    `<rect class="ch-lv" x="${f1(L[0])}" y="${f1(yMid - maxH)}" width="${f1(R[0] - L[0])}" height="${f1(maxH)}" style="transform-origin:0px ${f1(yMid)}px;transform:scaleY(${cv(name, val)})"/>` +
    `<polygon class="ch-lv" points="${dia}" style="transform:translateY(calc(${cv(name, val)} * -${f1(maxH)}px))"/></clipPath>`
  );
}

/** approximate visual height above the footprint (px) */
export function artHeight(key: string, L: number): number {
  switch (key) {
    case 'cityhall': return L >= 3 ? 30 + L * 4 + 9 + 22 + (L - 3) * 4 + 32 : 52 + L * 12;
    case 'road': return 6;
    case 'house': return L >= 3 ? 48 : 36;
    case 'tree': return 34;
    case 'shop': return L >= 3 ? 56 : 46;
    case 'cafe': return L >= 3 ? 52 : 42;
    case 'apartment': return 56 + L * 12;
    case 'park': return 40;
    case 'fountain': return 34;
    case 'office': return 96 + L * 14;
    case 'factory': return 76 + L * 6;
    case 'power': return 82 + L * 6;
    case 'skyscraper': return 150 + L * 22;
    case 'bank': return 72 + L * 3;
    case 'stadium': return 64;
    case 'pond': return 16;
    case 'school': return 70;
    case 'firestation': return 70;
    case 'police': return 54;
    case 'hospital': return 50 + L * 10;
    case 'windmill': return 100 + L * 18;
    case 'hotel': return 82 + L * 14;
    case 'ferris': return 100 + L * 14;
    case 'statue': return 58;
    case 'watertower': return 74 + L * 6;
    case 'flowers': return 14;
    case 'plaza': return 26;
    default: return 40;
  }
}

/** Draw a finished building (level >= 1) in local coordinates. */
export function buildingArt(key: string, size: number, level: number, variant: number, ctx: ArtCtx = {}): string {
  const L = Math.max(1, level);
  switch (key) {
    case 'cityhall': return cityhall(L, variant);
    case 'road': return road(ctx, variant);
    case 'house': return house(L, variant);
    case 'tree': return treeGrove(variant);
    case 'shop': return shop(L, variant);
    case 'cafe': return cafe(L, variant);
    case 'apartment': return apartment(L, variant);
    case 'park': return park(L, variant);
    case 'fountain': return fountain(L);
    case 'office': return office(L, variant);
    case 'factory': return factory(L);
    case 'power': return power(L);
    case 'skyscraper': return skyscraper(L, variant);
    case 'bank': return bank(L);
    case 'stadium': return stadium(L);
    case 'pond': return pond(variant);
    case 'school': return school(L, variant);
    case 'firestation': return firestation(L, variant);
    case 'police': return police(L, variant);
    case 'hospital': return hospital(L, variant);
    case 'windmill': return windmill(L);
    case 'hotel': return hotel(L, variant);
    case 'ferris': return ferris(L);
    case 'statue': return statue(L, variant);
    case 'watertower': return watertower(L, variant);
    case 'flowers': return flowerBed(variant);
    case 'plaza': return plaza(variant);
    default: return box(0.2, 0.2, size - 0.2, size - 0.2, 0, 20, '#cccccc');
  }
}

/** Local-coordinate bounds of a building's art (for reveal clipping and overlays). */
export function artBounds(key: string, size: number, level: number) {
  const top = -artHeight(key, Math.max(1, level)) - 30;
  return { x: -size * HW - 40, y: top, w: size * HW * 2 + 80, h: size * HH * 2 + 10 - top };
}

/** steel frame standing on the current top floor (cap) and reaching up to the frame height */
function frameAbove(size: number, Hf: number, H: number, ph: BuildPhase, live: boolean) {
  const k = size >= 2 ? 0.18 : 0.15;
  const a = k;
  const b = size - k;
  const m = size / 2;
  const cols: [number, number][] = [
    [a, a],
    [b, a],
    [a, b],
    [b, b],
  ];
  if (size >= 2) cols.push([m, a], [a, m], [b, m], [m, b]);
  cols.sort((p, q) => p[0] + p[1] - (q[0] + q[1]));
  const RV = cv('--rv', ph.rv);
  const FR = cv('--fr', ph.fr);
  let s = '';
  // floor beams (with braces on the two front faces), each one shows once the frame passes it
  for (let z = 12; z < Hf; z += 12) {
    const ring = [I(a, a, z), I(b, a, z), I(b, b, z), I(a, b, z), I(a, a, z)];
    const d = 'M' + ring.map((p) => `${f1(p[0])},${f1(p[1])}`).join('L');
    const brace = (z / 12) % 2 === 1 ? `M${f1(I(a, b, z - 12)[0])},${f1(I(a, b, z - 12)[1])}L${f1(I(b, b, z)[0])},${f1(I(b, b, z)[1])}M${f1(I(b, b, z - 12)[0])},${f1(I(b, b, z - 12)[1])}L${f1(I(b, a, z)[0])},${f1(I(b, a, z)[1])}` : '';
    const g =
      `<path d="${d}" stroke="${OUTLINE}" stroke-width="3.4" fill="none" stroke-linejoin="round"/><path d="${d}" stroke="#e0663a" stroke-width="1.9" fill="none" stroke-linejoin="round"/>` +
      (brace ? `<path d="${brace}" stroke="#b9472a" stroke-width="1.1" fill="none"/>` : '');
    if (live) s += `<g class="ch-lv" style="opacity:calc(clamp(0, (${FR} * ${f1(Hf)} - ${z} + 5) / 5, 1) * clamp(0, (${z} - ${RV} * ${f1(H)}) / 3, 1))">${g}</g>`;
    else if (z <= ph.fr * Hf && z > ph.rv * H) s += g;
  }
  for (const [x, y] of cols) {
    const [bx, by] = I(x, y);
    if (live) {
      const d = `M${f1(bx)},${f1(by)}L${f1(bx)},${f1(by - Hf)}`;
      s += `<g class="ch-lv" style="transform-origin:${f1(bx)}px ${f1(by)}px;transform:translateY(calc(${RV} * -${f1(H)}px)) scaleY(max(0, (${FR} * ${f1(Hf)} - ${RV} * ${f1(H)}) / ${f1(Hf)}))"><path d="${d}" stroke="${OUTLINE}" stroke-width="4" fill="none"/><path d="${d}" stroke="#e0663a" stroke-width="2.4" fill="none"/></g>`;
    } else {
      const z0 = ph.rv * H;
      const z1 = ph.fr * Hf;
      if (z1 - z0 > 1) {
        const d = `M${f1(bx)},${f1(by - z0)}L${f1(bx)},${f1(by - z1)}`;
        s += `<path d="${d}" stroke="${OUTLINE}" stroke-width="4" fill="none"/><path d="${d}" stroke="#e0663a" stroke-width="2.4" fill="none"/>`;
      }
    }
  }
  // the crew up top: a welder at the front corner, sparks along a beam
  const up = (inner: string) => (live ? `<g class="ch-lv" style="transform:translateY(calc(${FR} * -${f1(Hf)}px))">${inner}</g>` : `<g transform="translate(0,${f1(-ph.fr * Hf)})">${inner}</g>`);
  s += up(worker(b - 0.02, b - 0.08, (size * 7 + 3) % PERSON_VARIANTS, true, true) + sparks(I((a + b) / 2, b, 2), 0.4) + (size >= 2 ? sparks(I(b, (a + b) / 2, 2), 1.1) : ''));
  return s;
}

/** concrete floor plate at the current cladding height; hides everything of the building above it */
function topCap(size: number, H: number, ph: BuildPhase, live: boolean, pad = 0.04) {
  const slab = box(-pad, -pad, size + pad, size + pad, -3, 3, '#c9ced6', { sw: 1.1, top: '#d7dbe2' });
  return live ? `<g class="ch-lv" style="transform:translateY(calc(${cv('--rv', ph.rv)} * -${f1(H)}px))">${slab}</g>` : `<g transform="translate(0,${f1(-ph.rv * H)})">${slab}</g>`;
}

function siteFence(size: number) {
  const k = 0.06;
  const fence = (a: P, b: P) => ln(a, b, OUTLINE, 5) + ln(a, b, '#ff8a3d', 3.2) + ln(a, b, '#ffffff', 3.2, 'stroke-dasharray="4 4"');
  let s = fence(I(k, size - k, 5), I(size - k, size - k, 5)) + fence(I(size - k, k, 5), I(size - k, size - k, 5));
  for (const [x, y] of [
    [k, size - k],
    [size - k, size - k],
    [size - k, k],
  ] as [number, number][])
    s += ln(I(x, y), I(x, y, 7), OUTLINE, 2);
  return s + cone(0.12, size - 0.2) + cone(size - 0.2, 0.12);
}

/**
 * Brand-new construction, staged by progress (see `constructionPhase`). With `live`, the continuous parts
 * follow the --fr / --rv / --sc CSS variables on the parent <g> (see `constructionVars`), so the same
 * markup can be kept on screen for the whole stage and animate smoothly.
 */
export function constructionArt(key: string, size: number, variant: number, progress: number, clipId: string, ctx: ArtCtx = {}, live = false): string {
  const ph = constructionPhase(progress);
  const art = buildingArt(key, size, 1, variant, ctx);
  const H = artHeight(key, 1);
  const big = size >= 2;
  const craneOn = big || H > 70;
  let s = lot(size, 'dirt', variant);

  if (ph.stage === 0) {
    s += groundworks(size, variant);
    s += `<g class="ch-blueprint">${art}</g>`;
    s += dirtPile(size * 0.26, size * 0.82, big ? 1.35 : 0.72);
    s += excavator(size * 0.66, size * 0.6, big ? 1.05 : 0.6);
    s += worker(size * 0.22, size * 0.42, variant % PERSON_VARIANTS, false, false);
    s += dust(size) + siteFence(size);
    return s;
  }

  if (ph.stage === 1) {
    s += crates(size);
    s += `<g class="ch-blueprint">${art}</g>`;
    s += `<g class="ch-pour">${box(0.1, 0.1, size - 0.1, size - 0.1, 0, 4, '#c9ced6', { sw: 1.1, top: '#d7dbe2' })}</g>`;
    let rebar = '';
    const n = big ? 5 : 3;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const gx = 0.2 + ((size - 0.4) * i) / (n - 1);
        const gy = 0.2 + ((size - 0.4) * j) / (n - 1);
        rebar += ln(I(gx, gy, 4), I(gx, gy, 13), OUTLINE, 2.2) + ln(I(gx, gy, 4), I(gx, gy, 13), '#d0552b', 1.1);
      }
    s += `<g class="ch-in">${rebar}</g>`;
    s += big ? mixerTruck(size - 0.32, size * 0.42, 1) : wheelbarrow(size * 0.78, size * 0.86);
    s += worker(size * 0.36, size - 0.18, variant % PERSON_VARIANTS, false, true);
    s += patrolWorker([0.18, size * 0.5], [size * 0.55, size * 0.5], (variant + 4) % PERSON_VARIANTS, big ? 8 : 6);
    s += dust(size) + siteFence(size);
    return s;
  }

  const Hf = Math.round(H * 0.96 + 6);
  const HS = Math.round(Math.min(H * 0.9, H - 4) + 10);
  const maxH = H + 2;

  if (ph.stage === 2) {
    s += crates(size);
    if (craneOn) s += crane(size, Math.max(H + 26, 78), ph.rv > 0.05 ? 'pallet' : 'beam', variant);
    s += `<g class="ch-blueprint">${art}</g>`;
    s += riseClip(clipId, size, maxH, '--rv', ph.rv, live);
    s += `<g clip-path="url(#${clipId})">${art}</g>`;
    s += topCap(size, maxH, ph, live);
    s += frameAbove(size, Hf, maxH, ph, live);
    s += scaffold(size, HS, false, ph.sc, live);
    if (big) {
      const [hx, hy] = I(size - 0.04, size * 0.3);
      s += `<g class="ch-hoist" style="--hs:${HS}${live ? '' : `;--sc:${ph.sc.toFixed(3)}`}"><rect x="${f1(hx - 5)}" y="${f1(hy - 12)}" width="10" height="11" rx="1.2" fill="#f7c84a" stroke="${OUTLINE}" stroke-width="1.1"/><rect x="${f1(hx - 3)}" y="${f1(hy - 10)}" width="6" height="4" fill="${WIN}"/></g>`;
    }
    s += patrolWorker([0.16, size - 0.02], [size * 0.8, size - 0.02], (variant + 2) % PERSON_VARIANTS, big ? 10 : 7, variant % 5);
    s += worker(size - 0.02, size * 0.3, (variant + 9) % PERSON_VARIANTS, true, true);
    s += dust(size) + siteFence(size);
    return s;
  }

  // stage 3: finished shell, scaffolding comes down, finishing touches
  s += art;
  s += `<g class="ch-unscaffold">${scaffold(size, HS, false, 1, false)}</g>`;
  const top = I(size * 0.5, size * 0.5, H * 0.92);
  s += buildSparkle([top[0] - 14 * size, top[1] + 6], 5, 0) + buildSparkle([top[0] + 16 * size, top[1] + 14], 4, 0.7) + buildSparkle([top[0], top[1] - 8], 6, 1.3);
  s += worker(size * 0.3, size - 0.1, variant % PERSON_VARIANTS, false, true) + cone(0.12, size - 0.2) + cone(size - 0.2, 0.12);
  return s;
}

/** Upgrade in progress: crane behind, the building wrapped in netted scaffolding, crew and sparks. */
export function upgradeArt(key: string, size: number, level: number, variant: number, ctx: ArtCtx = {}): string {
  const height = artHeight(key, level);
  const sh = Math.min(height * 0.7, 84);
  let s = '';
  if (size >= 2 || height > 90) s += crane(size, Math.max(height + 22, 76), 'pallet', variant);
  s += buildingArt(key, size, level, variant, ctx);
  s += scaffold(size, sh, true);
  s += sparks(I(size - 0.06, size - 0.06, sh - 4), 0.2) + sparks(I(size * 0.4, size - 0.04, sh * 0.6), 1);
  s += workers(size, variant + 1);
  s += patrolWorker([0.14, size + 0.02], [size * 0.7, size + 0.02], (variant + 3) % PERSON_VARIANTS, 8, variant % 4);
  return s;
}

/* ------------------------------------------------------------------ props outside the grid */
export function mailboxArt(unread: boolean): string {
  let s = ell([0, 0], 10, 5, '#1d2a3a', 0, 'fill-opacity=".2"');
  s += box(-0.03, -0.03, 0.03, 0.03, 0, 18, '#8b5a3c', { sw: 1.1 });
  s += box(-0.16, -0.09, 0.16, 0.09, 18, 9, '#3d74d6', { sw: 1.3, top: '#5a8ee8' });
  const [fx, fy] = I(0.16, 0.06, 20);
  s += unread
    ? `<g class="ch-flagup">${ln([fx, fy], [fx, fy - 14], OUTLINE, 1.6)}<rect x="${f1(fx)}" y="${f1(fy - 14)}" width="8" height="6" rx="1" fill="#ff4d4d" stroke="${OUTLINE}" stroke-width="1.1"/></g>`
    : `${ln([fx, fy], [fx + 10, fy + 2], OUTLINE, 1.6)}<rect x="${f1(fx + 6)}" y="${f1(fy - 1)}" width="7" height="5" rx="1" fill="#ff4d4d" stroke="${OUTLINE}" stroke-width="1.1"/>`;
  if (unread) {
    const [lx, ly] = I(-0.06, 0.09, 24);
    s += `<rect x="${f1(lx - 5)}" y="${f1(ly - 4)}" width="10" height="6.5" rx="1" fill="#ffffff" stroke="${OUTLINE}" stroke-width="1" transform="rotate(-12 ${f1(lx)} ${f1(ly)})"/>`;
  }
  return s;
}

/* ------------------------------------------------------------------ island */
export const ISLAND_MARGIN = 0.6;
const LIP = 14;

export function islandDepth(n: number) {
  return 24 * n + 30;
}
export function islandBounds(n: number) {
  const m = ISLAND_MARGIN;
  const [lx] = I(-m, n + m);
  const [rx] = I(n + m, -m);
  const [, ty] = I(-m, -m);
  const [, by] = I(n + m, n + m);
  return { left: lx, right: rx, top: ty, bottom: by + LIP + islandDepth(n) };
}
/** where the waterfall leaves the right edge: 0 = front corner, 1 = back corner */
export const WATERFALL_T = 0.62;
/** grid y of the waterfall on the right margin */
export const waterfallY = (n: number) => n + ISLAND_MARGIN - WATERFALL_T * (n + 2 * ISLAND_MARGIN);

export function islandSvg(n: number, seed = 7, uid = 'a'): string {
  const m = ISLAND_MARGIN;
  const r = mulberry32(seed);
  const T = I(-m, -m);
  const R = I(n + m, -m);
  const B = I(n + m, n + m);
  const L = I(-m, n + m);
  const Lb: P = [L[0], L[1] + LIP];
  const Bb: P = [B[0], B[1] + LIP];
  const Rb: P = [R[0], R[1] + LIP];
  const depth = islandDepth(n);
  const sc = n / 12;
  const tip: P = [B[0] + 14 * sc, B[1] + depth];
  const jit = (a: number) => (r() - 0.5) * a;

  const steps = 10;
  const leftC: P[] = [];
  const rightC: P[] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const bulge = Math.sin(t * Math.PI) * 70 * sc;
    leftC.push([Lb[0] + (tip[0] - Lb[0]) * t + jit(26), Lb[1] + (tip[1] - Lb[1]) * Math.pow(t, 0.85) - bulge * 0.4 + jit(22)]);
    rightC.push([Rb[0] + (tip[0] - Rb[0]) * t + jit(26), Rb[1] + (tip[1] - Rb[1]) * Math.pow(t, 0.85) - bulge * 0.4 + jit(22)]);
  }
  const front: P[] = [
    [Bb[0] + jit(6), Bb[1] + depth * 0.27],
    [Bb[0] + 8 + jit(6), Bb[1] + depth * 0.53],
    [Bb[0] + jit(6), Bb[1] + depth * 0.77],
  ];
  const leftFace: P[] = [Lb, Bb, ...front, tip, ...leftC.slice().reverse()];
  const rightFace: P[] = [Bb, Rb, ...rightC, tip, ...front.slice().reverse()];
  const cl = `chcl-${uid}-${seed}`;
  const cr = `chcr-${uid}-${seed}`;
  let s = `<defs><clipPath id="${cl}"><polygon points="${pts(leftFace)}"/></clipPath><clipPath id="${cr}"><polygon points="${pts(rightFace)}"/></clipPath></defs>`;
  s += '<g class="ch-island">';
  s += poly(leftFace, '#c9b493', 2.2);
  s += poly(rightFace, '#a8936f', 2.2);
  s += shadeOver(leftFace, 'chL-rock') + shadeOver(rightFace, 'chL-rock');
  const ledge = (a: P, b: P, c: string, w = 1.8) => {
    const mid: P = [(a[0] + b[0]) / 2 + jit(10), (a[1] + b[1]) / 2 + jit(10)];
    return `<path d="M${f1(a[0])},${f1(a[1])} Q${f1(mid[0])},${f1(mid[1])} ${f1(b[0])},${f1(b[1])}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
  };
  s += `<g clip-path="url(#${cl})">`;
  s += polyNS([Lb, Bb, [Bb[0], Bb[1] + depth * 0.18], [Lb[0], Lb[1] + depth * 0.06]], '#d8c4a2', 'fill-opacity=".7"');
  for (let i = 0; i < 6; i++) {
    const t = 0.1 + i * 0.15;
    const a: P = [Lb[0] - 10 + t * 120 * sc, Lb[1] + 20 + t * depth * 0.75];
    const b: P = [Bb[0] + 10, Bb[1] + 20 + t * depth * 0.66];
    s += ledge(a, b, '#957f62') + ledge([a[0] + 2, a[1] + 4], [b[0], b[1] + 4], '#dccaa9', 1.4);
  }
  s += '</g>';
  s += `<g clip-path="url(#${cr})">`;
  s += polyNS([Bb, Rb, [Rb[0], Rb[1] + depth * 0.06], [Bb[0], Bb[1] + depth * 0.18]], '#b9a582', 'fill-opacity=".6"');
  for (let i = 0; i < 6; i++) {
    const t = 0.1 + i * 0.15;
    const a: P = [Bb[0] - 10, Bb[1] + 20 + t * depth * 0.66];
    const b: P = [Rb[0] + 10 - t * 120 * sc, Rb[1] + 20 + t * depth * 0.75];
    s += ledge(a, b, '#7b6849') + ledge([a[0], a[1] + 4], [b[0] - 2, b[1] + 4], '#bca986', 1.4);
  }
  s += '</g>';
  const shelf = (x: number, y: number, w: number, h: number, slope: number, fillTop: string, fillFront: string) => {
    const A: P = [x, y];
    const Bp: P = [x + w, y + w * slope];
    const back = slope > 0 ? -9 : 9;
    return poly([A, Bp, [Bp[0] + back, Bp[1] - 11], [A[0] + back, A[1] - 11]], fillTop, 1.6) + poly([A, Bp, [Bp[0] + 3, Bp[1] + h], [A[0] + 4, A[1] + h * 0.85]], fillFront, 1.6);
  };
  s += shelf(Lb[0] + 90 * sc, Lb[1] + 110 * sc, 100 * sc, 30, 0.5, '#e0cfae', '#bba886');
  s += shelf(Lb[0] + 250 * sc, Lb[1] + 220 * sc, 80 * sc, 26, 0.5, '#e0cfae', '#bba886');
  s += shelf(Rb[0] - 200 * sc, Rb[1] + 140 * sc, 100 * sc, 30, -0.5, '#bfac8b', '#968263');
  for (let i = 0; i < 12; i++) {
    const left = i % 2 === 0;
    const t = r();
    const x = left ? Lb[0] + 60 + t * 300 * sc : Rb[0] - 60 - t * 300 * sc;
    const y = (left ? Lb[1] + (x - Lb[0]) * 0.5 : Rb[1] + (Rb[0] - x) * 0.5) + 18 + r() * 70 * sc;
    s += ell([x, y], 9 + r() * 7, 5 + r() * 3, '#6dbb45', 1.4) + ell([x - 2, y - 2], 4, 1.8, '#9be06a', 0);
  }
  for (let i = 0; i < 6; i++) {
    const bx = tip[0] - 80 + i * 30 + jit(10);
    const by = tip[1] - 60 + Math.abs(i - 2.5) * -16 + 24;
    s += `<path d="M${f1(bx)},${f1(by)} q${f1(jit(14))},${f1(18)} ${f1(jit(10))},${f1(34 + r() * 20)} q${f1(jit(12))},${f1(14)} ${f1(jit(8))},${f1(20)}" fill="none" stroke="#7a5a3a" stroke-width="2.2" stroke-linecap="round"/>`;
  }
  // waterfall pouring down the right face
  const wTop: P = [Bb[0] + (Rb[0] - Bb[0]) * WATERFALL_T, Bb[1] + (Rb[1] - Bb[1]) * WATERFALL_T];
  const wLen = depth * 0.55;
  const ww = 13 * sc + 6;
  s += `<path d="M${f1(wTop[0] - ww / 2)},${f1(wTop[1] - 2)} L${f1(wTop[0] + ww / 2)},${f1(wTop[1] - 8)} Q${f1(wTop[0] + ww / 2 + 3)},${f1(wTop[1] + wLen * 0.5)} ${f1(wTop[0] + ww * 0.3)},${f1(wTop[1] + wLen)} L${f1(wTop[0] - ww * 0.5)},${f1(wTop[1] + wLen)} Q${f1(wTop[0] - ww / 2 - 2)},${f1(wTop[1] + wLen * 0.5)} ${f1(wTop[0] - ww / 2)},${f1(wTop[1] - 2)}Z" fill="#6ec6e8" stroke="${OUTLINE}" stroke-width="1.8"/>`;
  s += `<g class="ch-water">${[-0.25, 0, 0.25]
    .map((o) => `<path d="M${f1(wTop[0] + o * ww)},${f1(wTop[1] - 24)} L${f1(wTop[0] + o * ww * 0.8)},${f1(wTop[1] + wLen - 6)}" stroke="#d9f6ff" stroke-width="2" stroke-dasharray="10 14" fill="none"/>`)
    .join('')}</g>`;
  s += `<g class="ch-mist">${circ([wTop[0] - 8, wTop[1] + wLen], 9, '#ffffff', 1.3)}${circ([wTop[0] + 6, wTop[1] + wLen + 3], 11, '#ffffff', 1.3)}${circ([wTop[0] - 2, wTop[1] + wLen + 10], 8, '#ffffff', 1.3)}</g>`;
  const wave = (a: P, b: P, count: number) => {
    const out: P[] = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + (i % 2 ? 7 + r() * 5 : 0)]);
    }
    return out;
  };
  const lw = wave(Lb, Bb, Math.round(26 * sc));
  const rw = wave(Bb, Rb, Math.round(26 * sc));
  s += poly([L, B, ...lw.slice().reverse()], '#6fbe40', 2);
  s += poly([B, R, ...rw.slice().reverse()], '#58a833', 2);
  for (let i = 0; i < Math.round(10 * sc); i++) {
    const left = i % 2 === 0;
    const t = 0.08 + r() * 0.84;
    if (!left && Math.abs(t - WATERFALL_T) < 0.06) continue;
    const a: P = left ? [L[0] + (B[0] - L[0]) * t, L[1] + (B[1] - L[1]) * t + LIP + 4] : [B[0] + (R[0] - B[0]) * t, B[1] + (R[1] - B[1]) * t + LIP + 4];
    const len = 40 + r() * 80;
    s += `<path d="M${f1(a[0])},${f1(a[1])} q${f1(jit(18))},${f1(len * 0.4)} ${f1(jit(6))},${f1(len * 0.65)} t${f1(jit(10))},${f1(len * 0.35)}" fill="none" stroke="#3f8f2f" stroke-width="2.4" stroke-linecap="round"/>`;
    for (let k = 1; k <= 3; k++) {
      const ly = a[1] + (len * k) / 3.4;
      const lx = a[0] + jit(8);
      s += `<ellipse cx="${f1(lx + (k % 2 ? 4 : -4))}" cy="${f1(ly)}" rx="4" ry="2.2" fill="#5cbf4a" stroke="${OUTLINE}" stroke-width="1" transform="rotate(${k % 2 ? 30 : -30} ${f1(lx)} ${f1(ly)})"/>`;
    }
  }
  s += poly([T, R, B, L], GRASS_TOP, 2.2);
  s += shadeOver([T, R, B, L], 'chL-sun');
  s += polyNS([I(-m + 0.25, -m + 0.25), I(n + m - 0.25, -m + 0.25), I(n + m - 0.25, n + m - 0.25), I(-m + 0.25, n + m - 0.25)], 'none', 'stroke="#a8e374" stroke-width="2" stroke-dasharray="1 9" stroke-linecap="round"');
  // the pool and stream that feed the waterfall
  const wy = waterfallY(n);
  const pc = I(n + m * 0.42, wy);
  const lipP = I(n + m, wy);
  s += `<path d="M${f1(pc[0])},${f1(pc[1])} L${f1(lipP[0])},${f1(lipP[1] - 2)}" stroke="${OUTLINE}" stroke-width="9" stroke-linecap="round"/><path d="M${f1(pc[0])},${f1(pc[1])} L${f1(lipP[0])},${f1(lipP[1] - 2)}" stroke="#6ec6e8" stroke-width="6.4" stroke-linecap="round"/>`;
  s += ell([pc[0], pc[1]], 15, 6.5, '#6ec6e8', 1.6) + ell([pc[0] - 3, pc[1] - 1.5], 6, 2, '#c4f0ff', 0);
  s += '</g>';
  return s;
}

/** flat ground decoration (grass tufts, pebbles, wild flowers) on free tiles */
export function islandDecor(n: number, seed: number, occupied: (gx: number, gy: number) => boolean): string {
  const r = mulberry32(seed * 31 + 5);
  let tufts = '';
  let s = '';
  for (let i = 0; i < n * n * 0.9; i++) {
    const gx = r() * n;
    const gy = r() * n;
    const kind = r();
    const col = r() * 9;
    if (occupied(Math.floor(gx), Math.floor(gy))) continue;
    const [x, y] = I(gx, gy);
    if (kind < 0.55) tufts += `M${f1(x - 3)},${f1(y)}l2,-5l1,4l2,-6l1,6l2,-4l1,5`;
    else if (kind < 0.75) s += circ([x, y], 1.8, pick(['#ffffff', '#ffd84d', '#ff8fb1'], col), 0.8);
    else if (kind < 0.85) s += ell([x, y], 3.5, 2.2, '#b9b3a6', 1);
  }
  return (tufts ? `<path d="${tufts}" fill="none" stroke="#5aa83a" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>` : '') + s;
}

/** trees and rocks on the island rim (outside the build grid), returned separately for depth sorting */
export function rimProps(n: number, seed: number): { x: number; y: number; svg: string }[] {
  const r = mulberry32(seed * 17 + 3);
  const out: { x: number; y: number; svg: string }[] = [];
  const count = Math.round(n * 0.7);
  const kinds: TreeKind[] = ['round', 'pine', 'poplar'];
  for (let i = 0; i < count; i++) {
    const side = i % 2;
    const t = 0.05 + r() * 0.9;
    const k = r();
    const sc = 0.62 + r() * 0.2;
    const kind = pick(kinds, r() * 9);
    const gx = side ? n + 0.3 : t * n;
    const gy = side ? t * n : n + 0.3;
    if (side && Math.abs(gy - waterfallY(n)) < 1.4) continue;
    if (!side && t > 0.12 && t < 0.32) continue; // keep the mailbox corner clear
    const svg = k < 0.75 ? tree(0, 0, sc, pick(['#5cbf4a', '#4fae43', '#46a35a'], i), 0, kind) : ell([0, -2], 6, 4, '#c4bdb0', 1.2) + ell([-2, -4], 2.6, 1.2, '#e2ddd2', 0);
    out.push({ x: gx, y: gy, svg });
  }
  return out;
}
/** grid position of the mailbox prop (front margin, outside the build grid) */
export const mailboxPos = (n: number) => ({ x: n * 0.22, y: n + 0.32 });

export function cloudSvg(cx: number, cy: number, sc = 1, cls = ''): string {
  const blobs: [number, number, number][] = [
    [-22, 0, 13],
    [0, -9, 18],
    [21, -1, 13],
    [9, 5, 12],
    [-9, 5, 12],
  ];
  const o = '#5d8aa6';
  let s = `<g${cls ? ` class="${cls}"` : ''}>`;
  s += blobs.map(([x, y, r]) => circ([cx + x * sc, cy + y * sc], (r + 2) * sc, o, 0)).join('');
  s += blobs.map(([x, y, r]) => circ([cx + x * sc, cy + y * sc], r * sc, '#ffffff', 0)).join('');
  s += ell([cx, cy + 9 * sc], 26 * sc, 4 * sc, '#d6ecf7', 0);
  return s + '</g>';
}

export function sparkle(cx: number, cy: number, r = 10, fill = '#e9fbff') {
  return `<path class="ch-twinkle" d="M${f1(cx)},${f1(cy - r)} Q${f1(cx + r * 0.18)},${f1(cy - r * 0.18)} ${f1(cx + r)},${f1(cy)} Q${f1(cx + r * 0.18)},${f1(cy + r * 0.18)} ${f1(cx)},${f1(cy + r)} Q${f1(cx - r * 0.18)},${f1(cy + r * 0.18)} ${f1(cx - r)},${f1(cy)} Q${f1(cx - r * 0.18)},${f1(cy - r * 0.18)} ${f1(cx)},${f1(cy - r)}Z" fill="${fill}"/>`;
}

/* ------------------------------------------------------------------ scene composition */
export interface SceneBuilding {
  kind: number;
  key: string;
  size: number;
  x: number;
  y: number;
  level: number; // visible level (0 = brand-new construction)
  working?: boolean; // construction / upgrade in progress
  progress?: number; // 0..1 for brand-new construction
}

export function roadNeighbours(list: { key: string; x: number; y: number }[], b: { x: number; y: number }): [boolean, boolean, boolean, boolean] {
  const at = (x: number, y: number) => list.some((o) => o.key === 'road' && o.x === x && o.y === y);
  return [at(b.x, b.y - 1), at(b.x + 1, b.y), at(b.x, b.y + 1), at(b.x - 1, b.y)];
}

export function depthKey(b: { x: number; y: number; size: number }) {
  return b.x + b.y + b.size + b.x * 0.001;
}

/** Inner SVG for one placed building in local coords (handles construction & upgrades). */
export function placedArt(b: SceneBuilding, all: SceneBuilding[], seed: number, uid: string, idx: number): string {
  const variant = vhash(b.x, b.y, seed + b.kind);
  const ctx: ArtCtx = b.key === 'road' ? { roads: roadNeighbours(all, b) } : {};
  if (b.level <= 0) return constructionArt(b.key, b.size, variant, b.progress ?? 0.45, `chcp-${uid}-${idx}`, ctx);
  if (b.working) return upgradeArt(b.key, b.size, b.level, variant, ctx);
  return buildingArt(b.key, b.size, b.level, variant, ctx);
}

export const SCENE_STYLE = `
.ch-smoke{animation:chSmoke 3.2s ease-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes chSmoke{0%{opacity:0;transform:translateY(6px) scale(.6)}25%{opacity:1}100%{opacity:0;transform:translateY(-22px) scale(1.25)}}
.ch-steam{animation:chSteam 2.4s ease-out infinite;transform-box:fill-box;transform-origin:bottom center}
@keyframes chSteam{0%{opacity:0;transform:translateY(3px)}40%{opacity:.9}100%{opacity:0;transform:translateY(-6px)}}
.ch-flag{animation:chFlag 1.4s ease-in-out infinite;transform-box:fill-box;transform-origin:left center}
@keyframes chFlag{0%,100%{transform:scaleX(1) skewY(0)}50%{transform:scaleX(.82) skewY(6deg)}}
.ch-blink{animation:chBlink 1.6s steps(2,start) infinite}
@keyframes chBlink{to{opacity:.2}}
.ch-spray{animation:chSpray 1.1s ease-in-out infinite;transform-box:fill-box;transform-origin:bottom center}
@keyframes chSpray{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
.ch-crane{animation:chCrane 6s ease-in-out infinite}
@keyframes chCrane{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(6deg)}}
.ch-hook{animation:chHook 3s ease-in-out infinite}
@keyframes chHook{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
.ch-hammer{animation:chHammer .5s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:0% 100%}
@keyframes chHammer{from{transform:rotate(-25deg)}to{transform:rotate(25deg)}}
.ch-dust{animation:chDust 2.2s ease-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes chDust{0%{opacity:0;transform:scale(.4)}30%{opacity:.9}100%{opacity:0;transform:scale(1.4) translateY(-6px)}}
.ch-twinkle{animation:chTwinkle 2.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes chTwinkle{0%,100%{transform:scale(.6);opacity:.5}50%{transform:scale(1);opacity:1}}
.ch-float{animation:chFloat 7s ease-in-out infinite}
@keyframes chFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
.ch-drift{animation:chDrift 26s linear infinite alternate}
@keyframes chDrift{from{transform:translateX(-30px)}to{transform:translateX(40px)}}
.ch-sway{animation:chSway 4.5s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 100%}
@keyframes chSway{0%,100%{transform:rotate(-1.6deg)}50%{transform:rotate(1.6deg)}}
.ch-spin{animation:chSpin 3.2s linear infinite}
.ch-spin-slow{animation:chSpin 22s linear infinite}
.ch-spin-rev{animation:chSpin 22s linear infinite reverse}
@keyframes chSpin{to{transform:rotate(360deg)}}
.ch-water{animation:chWater .9s linear infinite}
@keyframes chWater{to{transform:translateY(24px)}}
.ch-mist{animation:chMist 2.6s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes chMist{0%,100%{transform:scale(.92);opacity:.85}50%{transform:scale(1.08);opacity:1}}
.ch-duck{animation:chDuck 2.8s ease-in-out infinite}
@keyframes chDuck{0%,100%{transform:translate(0,0)}50%{transform:translate(4px,1.5px)}}
.ch-flagup{animation:chFlagUp 1.2s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 100%}
@keyframes chFlagUp{0%,100%{transform:rotate(0)}50%{transform:rotate(-8deg)}}
.ch-legs{animation:chLegs .45s steps(2) infinite;transform-box:fill-box;transform-origin:50% 0}
@keyframes chLegs{50%{transform:scaleX(-1)}}
.ch-blueprint{animation:chBp 2.4s ease-in-out infinite}
.ch-blueprint *{fill:rgba(110,190,255,.08);stroke:#3f9cff;stroke-width:1.1;stroke-dasharray:3 2.5}
@keyframes chBp{0%,100%{opacity:.55}50%{opacity:.95}}
.ch-lv{transition:transform 1.05s linear,opacity 1.05s linear}
.ch-dig{animation:chDig 2.6s ease-in-out infinite}
@keyframes chDig{0%,100%{transform:rotate(0)}35%{transform:rotate(16deg)}60%{transform:rotate(-14deg)}}
.ch-dig2{animation:chDig2 2.6s ease-in-out infinite}
@keyframes chDig2{0%,100%{transform:rotate(0)}35%{transform:rotate(24deg)}60%{transform:rotate(-26deg)}}
.ch-dirt{animation:chDirt 2.6s ease-out infinite}
@keyframes chDirt{0%,55%{opacity:0;transform:translate(0,0)}62%{opacity:1}100%{opacity:0;transform:translate(7px,9px)}}
.ch-drum{animation:chSpin 1.8s linear infinite}
.ch-pour{animation:chPour 1.3s cubic-bezier(.2,.9,.3,1) both;transform-box:fill-box;transform-origin:50% 100%}
@keyframes chPour{from{opacity:0;transform:scaleY(.15)}}
.ch-in{animation:chIn .7s cubic-bezier(.2,1.5,.4,1) both;transform-box:fill-box;transform-origin:50% 100%}
@keyframes chIn{from{opacity:0;transform:translateY(8px) scale(.7)}}
.ch-patrol{animation:chPatrol 9s linear infinite}
@keyframes chPatrol{0%{transform:translate(0,0) scaleX(1)}48%{transform:translate(var(--dx),var(--dy)) scaleX(1)}50%{transform:translate(var(--dx),var(--dy)) scaleX(-1)}98%{transform:translate(0,0) scaleX(-1)}100%{transform:translate(0,0) scaleX(1)}}
.ch-spark{animation:chSpark 1.5s ease-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes chSpark{0%,100%{opacity:0;transform:scale(.3)}8%{opacity:1;transform:scale(1)}28%{opacity:0;transform:scale(1.4)}}
.ch-slew{animation:chSlew 16s ease-in-out infinite}
@keyframes chSlew{0%,100%{transform:scaleX(1)}40%,55%{transform:scaleX(-.62)}}
.ch-trolley{animation:chTrolley 7s ease-in-out infinite alternate}
@keyframes chTrolley{from{transform:translateX(0)}to{transform:translateX(var(--run,20px))}}
.ch-cable{animation:chCable 5s ease-in-out infinite}
@keyframes chCable{0%,100%{transform:scaleY(.45)}50%{transform:scaleY(1)}}
.ch-lift{animation:chLift 5s ease-in-out infinite}
@keyframes chLift{0%,100%{transform:translateY(var(--lift,-18px))}50%{transform:translateY(0)}}
.ch-swing{animation:chSwing 3.1s ease-in-out infinite}
@keyframes chSwing{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
.ch-hoist{animation:chHoist 6s ease-in-out infinite}
@keyframes chHoist{0%,15%,100%{transform:translateY(0)}50%,65%{transform:translateY(calc(var(--sc,.5) * var(--hs,60) * -.85px))}}
.ch-unscaffold{animation:chUnscaf 1.8s ease-in .4s both}
@keyframes chUnscaf{to{opacity:0;transform:translateY(22px)}}
.ch-net{animation:chNet 3s ease-in-out infinite}
@keyframes chNet{50%{fill-opacity:.34}}
.ch-glow{opacity:0;transition:opacity .8s;pointer-events:none}
.night .ch-glow{opacity:1;mix-blend-mode:screen}
.ch-sh{pointer-events:none}
.night .ch-sh{opacity:.55}
.night .ch-day{display:none}
@media (prefers-reduced-motion: reduce){.ch-smoke,.ch-steam,.ch-flag,.ch-blink,.ch-spray,.ch-crane,.ch-hook,.ch-hammer,.ch-dust,.ch-twinkle,.ch-float,.ch-drift,.ch-sway,.ch-spin,.ch-spin-slow,.ch-spin-rev,.ch-water,.ch-mist,.ch-duck,.ch-flagup,.ch-legs,.ch-blueprint,.ch-dig,.ch-dig2,.ch-dirt,.ch-drum,.ch-pour,.ch-in,.ch-patrol,.ch-spark,.ch-slew,.ch-trolley,.ch-cable,.ch-lift,.ch-swing,.ch-hoist,.ch-net{animation:none}.ch-lv{transition:none}.ch-unscaffold{display:none}}
`;

/** Full standalone scene (hero art, NFT image, snapshots). */
export function renderScene(
  n: number,
  buildings: SceneBuilding[],
  opts: { seed?: number; sky?: boolean; clouds?: boolean; animate?: boolean; padding?: number; title?: string; uid?: string; night?: boolean; mailbox?: boolean } = {},
): string {
  const seed = opts.seed ?? 7;
  const uid = opts.uid ?? 'scene';
  const night = !!opts.night;
  const b = islandBounds(n);
  const pad = opts.padding ?? 70;
  const maxH = buildings.reduce((mx, o) => {
    const [, y] = iso(o.x, o.y);
    return Math.max(mx, artHeight(o.key, Math.max(1, o.level)) + 40 - (y - b.top));
  }, 60);
  const minY = b.top - Math.max(60, maxH) - pad * 0.4;
  const minX = b.left - pad;
  const w = b.right - b.left + pad * 2;
  const h = b.bottom - minY + pad * 0.6;
  const occ = new Set<string>();
  buildings.forEach((o) => {
    for (let dx = 0; dx < o.size; dx++) for (let dy = 0; dy < o.size; dy++) occ.add(`${o.x + dx},${o.y + dy}`);
  });
  const N = (x: string) => (night ? nightify(x) : x);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f1(minX)} ${f1(minY)} ${f1(w)} ${f1(h)}" width="100%" height="100%">`;
  if (opts.title) s += `<title>${opts.title}</title>`;
  s += `<style>${opts.animate === false ? SCENE_STYLE.replace(/animation:[^;}]+;?/g, '') : SCENE_STYLE}</style>`;
  s += `<defs>${LIGHT_DEFS}</defs>`;
  if (opts.sky !== false) {
    const [c0, c1] = night ? ['#0f1d3d', '#26386a'] : ['#a8e0ee', '#8fd2e3'];
    s += `<defs><linearGradient id="chsky-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient></defs>`;
    s += `<rect x="${f1(minX)}" y="${f1(minY)}" width="${f1(w)}" height="${f1(h)}" fill="url(#chsky-${uid})"/>`;
    if (night) {
      const r = mulberry32(seed + 99);
      for (let i = 0; i < 40; i++) s += circ([minX + r() * w, minY + r() * h * 0.7], 0.8 + r() * 1.4, '#ffffff', 0, `fill-opacity="${f1(0.4 + r() * 0.6)}"`);
    } else s += sparkle(minX + w * 0.86, minY + h * 0.86, 16) + sparkle(minX + w * 0.1, minY + h * 0.18, 9);
  }
  if (opts.clouds !== false) s += N(cloudSvg(minX + w * 0.18, b.bottom - 150, 1.3, 'ch-drift') + cloudSvg(minX + w * 0.8, b.bottom - 230, 0.9, 'ch-drift'));
  s += `<g class="${opts.animate !== false ? 'ch-float' : ''}${night ? ' night' : ''}">`;
  s += N(islandSvg(n, seed, uid));
  s += N(islandDecor(n, seed, (x, y) => occ.has(`${x},${y}`)));
  const items: { key: number; svg: string }[] = [];
  buildings.forEach((o, i) => {
    const [tx, ty] = iso(o.x, o.y);
    items.push({ key: depthKey(o), svg: `<g transform="translate(${f1(tx)},${f1(ty)})">${N(placedArt(o, buildings, seed, uid, i))}</g>` });
  });
  for (const p of rimProps(n, seed)) {
    const [tx, ty] = iso(p.x, p.y);
    items.push({ key: p.x + p.y + 0.5, svg: `<g transform="translate(${f1(tx)},${f1(ty)})">${N(p.svg)}</g>` });
  }
  if (opts.mailbox) {
    const mp = mailboxPos(n);
    const [tx, ty] = iso(mp.x, mp.y);
    items.push({ key: mp.x + mp.y + 0.5, svg: `<g transform="translate(${f1(tx)},${f1(ty)})">${N(mailboxArt(false))}</g>` });
  }
  items.sort((a, c) => a.key - c.key);
  s += items.map((i) => i.svg).join('');
  s += '</g>';
  if (opts.clouds !== false) s += N(cloudSvg(minX + w * 0.26, b.bottom - 40, 1.1, 'ch-drift') + cloudSvg(minX + w * 0.74, b.bottom - 60, 1.25, 'ch-drift') + cloudSvg(minX + w * 0.92, b.bottom - 300, 0.7, 'ch-drift'));
  return s + '</svg>';
}

const ICON_STYLE = '.ch-glow{opacity:0}.night .ch-glow{opacity:1;mix-blend-mode:screen}.night .ch-day{display:none}' + LIGHT_STYLE;
/** Small standalone icon of one building on a grass tile (shop cards, panels). */
export function buildingIcon(key: string, size: number, level = 1, variant = 3, night = false): string {
  const top = artHeight(key, Math.max(1, level)) + 10;
  const x0 = -size * HW - 8;
  const w = size * HW * 2 + 16;
  const y0 = -top;
  const h = top + size * HH * 2 + 12;
  const e = size + 0.08;
  const tile = poly([I(-0.08, -0.08), I(e, -0.08), I(e, e), I(-0.08, e)], GRASS_TOP, 1.6);
  const lip =
    poly([I(-0.08, e), I(e, e), [I(e, e)[0], I(e, e)[1] + 6], [I(-0.08, e)[0], I(-0.08, e)[1] + 6]], '#6fbe40', 1.4) +
    poly([I(e, e), I(e, -0.08), [I(e, -0.08)[0], I(e, -0.08)[1] + 6], [I(e, e)[0], I(e, e)[1] + 6]], '#58a833', 1.4);
  const inner = lip + tile + buildingArt(key, size, Math.max(1, level), variant, key === 'road' ? { roads: [false, true, false, true] } : {});
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f1(x0)} ${f1(y0)} ${f1(w)} ${f1(h)}" width="100%" height="100%"><style>${ICON_STYLE}</style><defs>${LIGHT_DEFS}</defs><g${night ? ' class="night"' : ''}>${night ? nightify(inner) : inner}</g></svg>`;
}

/** Defs for traffic sprites: cars (all directions) and citizens. Use with <use href="#chv-{v}-{dir}"> / <use href="#chp-{v}-{l|r}">. */
export function agentDefs(night = false): string {
  const N = (x: string) => (night ? nightify(x) : x);
  let s = '<defs>';
  const dirs: Dir[] = ['xp', 'xn', 'yp', 'yn'];
  for (let v = 0; v < CAR_VARIANTS; v++) for (const d of dirs) s += `<g id="chv-${v}-${d}">${N(carArt(v, d))}</g>`;
  for (let v = 0; v < PERSON_VARIANTS; v++) s += `<g id="chp-${v}-r">${N(personArt(v, false))}</g><g id="chp-${v}-l">${N(personArt(v, true))}</g>`;
  return s + '</defs>';
}
