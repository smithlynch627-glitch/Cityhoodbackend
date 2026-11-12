/**
 * CITYHOOD economy — a TypeScript mirror of CityGame.sol.
 * Used by the frontend (live ticking counters, validation, demo mode) and the backend (metadata).
 * Keep the math here identical to the contract (integer, floor division, same order of operations).
 */
import catalogJson from './catalog.json';

export type Category =
  | 'civic'
  | 'residential'
  | 'commercial'
  | 'industry'
  | 'nature'
  | 'infrastructure'
  | 'landmark';

export interface BuildingType {
  id: number;
  key: string;
  name: string;
  category: Category;
  size: number;
  cost: number; // whole $CITY at level 1
  time: number; // seconds at level 1
  rate: number; // $CITY / hour at level 1
  boost: number; // bps at level 1
  hallReq: number;
  maxCount: number;
  maxLevel: number;
  pop: number;
  desc: string;
  enabled?: boolean;
}

export interface EconomyParams {
  starterGrant: number;
  speedUpCostPerMinute: number;
  burnBps: number;
  maxBoostBps: number;
  emissionBps: number;
  levelCostBps: number;
  levelTimeBps: number;
  levelRateBps: number;
}

export interface Catalog {
  gridSize: number;
  maxBuilders: number;
  params: EconomyParams;
  buildings: BuildingType[];
}

export const DEFAULT_CATALOG: Catalog = {
  gridSize: catalogJson.gridSize,
  maxBuilders: catalogJson.maxBuilders,
  params: catalogJson.params,
  buildings: (catalogJson.buildings as BuildingType[]).map((b) => ({ ...b, enabled: true })),
};

export const HALL_KIND = 1;
export const ROAD_KIND = 2;
export const WAD = 10n ** 18n;

export function typeById(cat: Catalog, id: number): BuildingType | undefined {
  return cat.buildings.find((b) => b.id === id);
}

export function levelCost(cat: Catalog, t: BuildingType, level: number): bigint {
  let c = BigInt(t.cost) * WAD;
  for (let i = 1; i < level; i++) c = (c * BigInt(cat.params.levelCostBps)) / 10000n;
  return c;
}

export function levelTime(cat: Catalog, t: BuildingType, level: number): number {
  let s = t.time;
  for (let i = 1; i < level; i++) s = Math.floor((s * cat.params.levelTimeBps) / 10000);
  return s;
}

export function levelRate(cat: Catalog, t: BuildingType, level: number): number {
  if (level <= 0) return 0;
  return Math.floor((t.rate * (10000 + (level - 1) * cat.params.levelRateBps)) / 10000);
}

export function levelBoost(t: BuildingType, level: number): number {
  return level <= 0 ? 0 : t.boost * level;
}

export function buildersFor(cat: Catalog, hallLevel: number): number {
  return Math.min(1 + hallLevel, cat.maxBuilders);
}

export function speedUpCost(cat: Catalog, remainingSec: number): bigint {
  if (remainingSec <= 0) return 0n;
  const minutes = Math.ceil(remainingSec / 60);
  return BigInt(minutes) * BigInt(cat.params.speedUpCostPerMinute) * WAD;
}

export interface ChainBuilding {
  kind: number;
  x: number;
  y: number;
  level: number; // completed level stored on-chain
  busy: boolean; // construction / upgrade in progress (on-chain flag, may already be finished)
  readyAt: number; // unix seconds
  rate: number;
  boost: number;
  points: bigint;
}

export interface ChainLand {
  activated: boolean;
  hallLevel: number;
  lastSettle: number;
  boost: number;
  rate: number;
  score: bigint;
  pending: bigint;
  totalClaimed: bigint;
  buildings: ChainBuilding[];
}

export interface LiveBuilding extends ChainBuilding {
  idx: number;
  /** level the player sees right now (completed construction applied) */
  liveLevel: number;
  /** still under construction / upgrading at `now` */
  working: boolean;
  /** target level of the running job */
  targetLevel: number;
}

export interface LiveLand {
  pending: bigint;
  rate: number;
  boost: number;
  effectiveBoost: number;
  hallLevel: number;
  buildings: LiveBuilding[];
  busyBuilders: number;
  maxBuilders: number;
  population: number;
  ratePerHourWithBoost: number;
}

/**
 * Accrual for `dtMs` milliseconds. Multiplying numerator and denominator by 1000 keeps the result
 * identical to the contract's per-second formula for whole seconds, while allowing a smooth live
 * counter between blocks.
 */
function accrueMs(cat: Catalog, rate: number, boost: number, dtMs: number): bigint {
  if (dtMs <= 0 || rate <= 0 || cat.params.emissionBps <= 0) return 0n;
  const b = Math.min(boost, cat.params.maxBoostBps);
  return (
    (BigInt(rate) * WAD * BigInt(Math.floor(dtMs)) * BigInt(10000 + b) * BigInt(cat.params.emissionBps)) /
    (3600n * 1000n * 10000n * 10000n)
  );
}

/** Same algorithm as CityGame._simulate: applies finished jobs in readyAt order and accrues rewards. */
export function simulate(cat: Catalog, land: ChainLand, now: number): LiveLand {
  let pending = land.pending;
  let rate = land.rate;
  let boost = land.boost;
  let hall = land.hallLevel;
  let last = land.lastSettle;

  const live: LiveBuilding[] = land.buildings.map((b, idx) => ({
    ...b,
    idx,
    liveLevel: b.level,
    working: b.busy,
    targetLevel: b.busy ? b.level + 1 : b.level,
  }));

  if (land.activated) {
    const jobs = live.filter((b) => b.busy).sort((a, b) => a.readyAt - b.readyAt);
    for (const j of jobs) {
      if (j.readyAt > now) break;
      if (j.readyAt > last) {
        pending += accrueMs(cat, rate, boost, (j.readyAt - last) * 1000);
        last = j.readyAt;
      }
      const t = typeById(cat, j.kind);
      if (!t) continue;
      const newLevel = j.level + 1;
      const nr = levelRate(cat, t, newLevel);
      const nb = levelBoost(t, newLevel);
      rate = rate - j.rate + nr;
      boost = boost - j.boost + nb;
      j.liveLevel = newLevel;
      j.working = false;
      j.rate = nr;
      j.boost = nb;
      if (j.kind === HALL_KIND) hall = newLevel;
    }
    if (now > last) pending += accrueMs(cat, rate, boost, Math.floor(now * 1000) - last * 1000);
  }

  const effectiveBoost = Math.min(boost, cat.params.maxBoostBps);
  const population = live.reduce((p, b) => {
    const t = typeById(cat, b.kind);
    return p + (t && b.liveLevel > 0 ? t.pop * b.liveLevel : 0);
  }, 0);

  return {
    pending,
    rate,
    boost,
    effectiveBoost,
    hallLevel: hall,
    buildings: live,
    busyBuilders: live.filter((b) => b.working).length,
    maxBuilders: buildersFor(cat, hall),
    population,
    ratePerHourWithBoost:
      (rate * (10000 + effectiveBoost) * (cat.params.emissionBps / 10000)) / 10000,
  };
}

export function occupancyGrid(cat: Catalog, buildings: { kind: number; x: number; y: number }[], ignoreIdx = -1) {
  const n = cat.gridSize;
  const grid: number[] = new Array(n * n).fill(-1);
  buildings.forEach((b, i) => {
    if (i === ignoreIdx) return;
    const t = typeById(cat, b.kind);
    const s = t?.size ?? 1;
    for (let dy = 0; dy < s; dy++)
      for (let dx = 0; dx < s; dx++) {
        const gx = b.x + dx;
        const gy = b.y + dy;
        if (gx < n && gy < n) grid[gy * n + gx] = i;
      }
  });
  return grid;
}

export function canPlace(
  cat: Catalog,
  buildings: { kind: number; x: number; y: number }[],
  kind: number,
  x: number,
  y: number,
  ignoreIdx = -1,
): boolean {
  const t = typeById(cat, kind);
  if (!t) return false;
  const n = cat.gridSize;
  if (x < 0 || y < 0 || x + t.size > n || y + t.size > n) return false;
  const grid = occupancyGrid(cat, buildings, ignoreIdx);
  for (let dy = 0; dy < t.size; dy++)
    for (let dx = 0; dx < t.size; dx++) if (grid[(y + dy) * n + (x + dx)] !== -1) return false;
  return true;
}

/** Why a new building of `kind` can't be started right now (null = allowed). Mirrors contract checks. */
/** 0s build time -> completes instantly on-chain and needs no builder (roads, trees, decorations). */
/** How much of the island is built on: tiles covered by buildings (incl. roads) out of gridSize². Shown in the game and the NFT metadata. */
export function developmentOf(cat: Catalog, buildings: readonly { kind: number }[]) {
  const total = cat.gridSize * cat.gridSize;
  let tiles = 0;
  for (const b of buildings) {
    const s = typeById(cat, b.kind)?.size ?? 1;
    tiles += s * s;
  }
  return { tiles, total, percent: Math.round((tiles / total) * 1000) / 10 };
}

export function isInstant(cat: Catalog, t: BuildingType, level = 1): boolean {
  return levelTime(cat, t, level) === 0;
}

export function countOf(live: { buildings: { kind: number }[] }, kind: number) {
  return live.buildings.filter((b) => b.kind === kind).length;
}

export function buildBlocker(cat: Catalog, live: LiveLand, kind: number, extra = 0): string | null {
  const t = typeById(cat, kind);
  if (!t || t.enabled === false) return 'Not available';
  if (live.hallLevel < t.hallReq) return t.hallReq <= 1 ? 'Build a City Hall first' : `Needs City Hall Lv ${t.hallReq}`;
  if (countOf(live, kind) + extra >= t.maxCount) return `Max ${t.maxCount} built`;
  if (!isInstant(cat, t) && live.busyBuilders >= live.maxBuilders) return 'All builders busy';
  return null;
}

export function upgradeBlocker(cat: Catalog, live: LiveLand, b: LiveBuilding): string | null {
  const t = typeById(cat, b.kind);
  if (!t) return 'Unknown building';
  if (b.working) return 'Already under construction';
  if (b.liveLevel >= t.maxLevel) return 'Max level';
  if (b.kind !== HALL_KIND && b.liveLevel + 1 > live.hallLevel) return `Upgrade City Hall to Lv ${b.liveLevel + 1} first`;
  if (!isInstant(cat, t, b.liveLevel + 1) && live.busyBuilders >= live.maxBuilders) return 'All builders busy';
  return null;
}

/** Tiles from a to b locked to the dominant axis (used for drag-painting roads). */
export function lineTiles(a: { x: number; y: number }, b: { x: number; y: number }, max = 40): { x: number; y: number }[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const out: { x: number; y: number }[] = [];
  if (Math.abs(dx) >= Math.abs(dy)) {
    const s = Math.sign(dx) || 1;
    for (let i = 0; i <= Math.abs(dx) && out.length < max; i++) out.push({ x: a.x + i * s, y: a.y });
  } else {
    const s = Math.sign(dy) || 1;
    for (let i = 0; i <= Math.abs(dy) && out.length < max; i++) out.push({ x: a.x, y: a.y + i * s });
  }
  return out;
}

export function formatCity(wei: bigint, decimals = 0): string {
  const neg = wei < 0n;
  const v = neg ? -wei : wei;
  const whole = v / WAD;
  let s = whole.toLocaleString('en-US');
  if (decimals > 0) {
    const frac = ((v % WAD) * 10n ** BigInt(decimals)) / WAD;
    s += '.' + frac.toString().padStart(decimals, '0');
  }
  return (neg ? '-' : '') + s;
}

export function compactNumber(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return Math.round(n).toLocaleString('en-US');
}

export function formatDuration(sec: number, zero = '0s'): string {
  sec = Math.max(0, Math.ceil(sec));
  if (sec === 0) return zero;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}
