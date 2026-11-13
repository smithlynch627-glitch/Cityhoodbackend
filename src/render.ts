import { Resvg, renderAsync } from '@resvg/resvg-js';
import { renderScene, type SceneBuilding } from './shared/art';
import { DEFAULT_CATALOG, developmentOf, simulate, typeById, type ChainLand } from './shared/economy';

export function sceneFor(land: ChainLand, now: number): SceneBuilding[] {
  const live = simulate(DEFAULT_CATALOG, land, now);
  return live.buildings.map((b) => {
    const t = typeById(DEFAULT_CATALOG, b.kind);
    return {
      kind: b.kind,
      key: t?.key ?? 'unknown',
      size: t?.size ?? 1,
      x: b.x,
      y: b.y,
      level: b.liveLevel,
      working: b.working && b.liveLevel > 0,
    };
  });
}

export function landSvg(landId: number, land: ChainLand | null, now: number, animate = true): string {
  const buildings = land ? sceneFor(land, now) : [];
  return renderScene(DEFAULT_CATALOG.gridSize, buildings, {
    seed: (landId % 997) + 7,
    uid: `nft${landId}`,
    animate,
    title: `CITYHOOD Land #${landId}`,
    padding: 60,
  });
}

/** Square PNG for marketplaces / wallets that don't render SVG. */
export function landPng(svg: string, size = 1000): Buffer {
  return new Resvg(squareSvg(svg), { fitTo: { mode: 'width', value: size }, background: '#9fd8e6', font: { loadSystemFonts: true } }).render().asPng();
}

/** Same as landPng, rendered on a worker thread so the API keeps answering while it draws. */
export async function landPngAsync(svg: string, size = 1000): Promise<Buffer> {
  return (await renderAsync(squareSvg(svg), { fitTo: { mode: 'width', value: size }, background: '#9fd8e6', font: { loadSystemFonts: true } })).asPng();
}

function squareSvg(svg: string): string {
  // make the scene square: wrap the viewBox in a square sky canvas
  const m = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/);
  let squared = svg;
  if (m) {
    const [x, y, w, h] = m.slice(1).map(Number);
    const side = Math.max(w, h);
    const nx = x - (side - w) / 2;
    const ny = y - (side - h) / 2;
    squared = svg
      .replace(m[0], `viewBox="${nx} ${ny} ${side} ${side}"`)
      .replace(/<rect x="[-\d.]+" y="[-\d.]+" width="[\d.]+" height="[\d.]+" fill="url\(#chsky-[^"]+\)"\/>/, (r) =>
        r.replace(/x="[-\d.]+" y="[-\d.]+" width="[\d.]+" height="[\d.]+"/, `x="${nx}" y="${ny}" width="${side}" height="${side}"`),
      );
  }
  return squared;
}

/** Share of the 16×16 island covered by buildings (0–100). */
export function development(land: ChainLand | null) {
  return developmentOf(DEFAULT_CATALOG, land?.buildings ?? []);
}

export function metadataFor(landId: number, land: ChainLand | null, now: number, apiUrl: string, siteUrl: string) {
  const live = land ? simulate(DEFAULT_CATALOG, land, now) : null;
  const counts = new Map<string, number>();
  live?.buildings.forEach((b) => {
    const t = typeById(DEFAULT_CATALOG, b.kind);
    if (t && b.liveLevel > 0) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  });
  const dev = development(land);
  const base = live ? live.rate : 0;
  const boosted = live ? Math.round(live.ratePerHourWithBoost * 100) / 100 : 0;
  const status = !land?.activated
    ? 'Empty Land'
    : dev.tiles === 0
      ? 'Founded'
      : live && live.hallLevel >= 5
        ? 'Metropolis'
        : live && live.hallLevel >= 3
          ? 'City'
          : 'Town';
  const attributes: { trait_type: string; value: string | number; display_type?: string; max_value?: number }[] = [
    { trait_type: 'Status', value: status },
    { trait_type: 'Development %', value: dev.percent, display_type: 'number', max_value: 100 },
    { trait_type: 'Tiles Built', value: dev.tiles, display_type: 'number', max_value: dev.total },
    { trait_type: 'Base $CITY per Hour', value: base, display_type: 'number' },
    { trait_type: '$CITY per Hour', value: boosted, display_type: 'number' },
    { trait_type: 'Production Boost', value: live ? Math.round(live.effectiveBoost) / 100 : 0, display_type: 'boost_percentage' },
    { trait_type: 'City Hall Level', value: live?.hallLevel ?? 0, display_type: 'number', max_value: 5 },
    { trait_type: 'Buildings', value: live?.buildings.length ?? 0, display_type: 'number' },
    { trait_type: 'Population', value: live?.population ?? 0, display_type: 'number' },
    { trait_type: 'City Score', value: land ? Number(land.score) : 0, display_type: 'number' },
    ...[...counts.entries()].map(([name, n]) => ({ trait_type: name, value: n, display_type: 'number' })),
  ];
  return {
    name: `CITYHOOD Land #${landId}`,
    description: land?.activated
      ? `A floating island city on Robinhood Chain. ${dev.percent}% developed (${dev.tiles} of ${dev.total} tiles), ${live?.buildings.length ?? 0} buildings, earning ${boosted.toLocaleString('en-US')} $CITY per hour (${base.toLocaleString('en-US')} base). The image is rendered live from on-chain state and refreshes as the city grows.`
      : 'An empty floating island on Robinhood Chain, waiting for its first road. Build a city with $CITY and earn more every hour. The image is rendered live from on-chain state.',
    image: `${apiUrl}/api/image/${landId}.png`,
    image_svg: `${apiUrl}/api/image/${landId}.svg`,
    external_url: `${siteUrl}/city/${landId}`,
    background_color: '9fd8e6',
    attributes,
  };
}

/** A fully built sample city (used for the collection image). */
export function sampleCity(): ChainLand {
  const n = DEFAULT_CATALOG.gridSize;
  const id = (key: string) => DEFAULT_CATALOG.buildings.find((b) => b.key === key)!.id;
  const used = new Set<string>();
  const out: ChainLand['buildings'] = [];
  const put = (key: string, x: number, y: number, level: number) => {
    const t = typeById(DEFAULT_CATALOG, id(key))!;
    for (let dx = 0; dx < t.size; dx++) for (let dy = 0; dy < t.size; dy++) if (x + dx >= n || y + dy >= n || used.has(`${x + dx},${y + dy}`)) return;
    for (let dx = 0; dx < t.size; dx++) for (let dy = 0; dy < t.size; dy++) used.add(`${x + dx},${y + dy}`);
    out.push({ kind: t.id, x, y, level, busy: false, readyAt: 0, rate: 0, boost: 0, points: 0n });
  };
  for (let i = 0; i < n; i++) {
    put('road', i, 5, 1);
    put('road', i, 10, 1);
    if (i !== 5 && i !== 10) {
      put('road', 5, i, 1);
      put('road', 10, i, 1);
    }
  }
  put('cityhall', 6, 6, 5);
  put('park', 8, 6, 3);
  put('fountain', 6, 8, 3);
  put('statue', 7, 8, 3);
  put('skyscraper', 0, 0, 5);
  put('skyscraper', 11, 0, 4);
  put('hotel', 2, 0, 4);
  put('bank', 13, 2, 4);
  put('stadium', 11, 11, 3);
  put('ferris', 0, 11, 3);
  put('factory', 13, 6, 4);
  put('power', 11, 6, 3);
  put('school', 2, 11, 3);
  put('hospital', 6, 11, 3);
  let h = 7;
  const fill = ['apartment', 'office', 'house', 'shop', 'cafe', 'tree', 'house', 'apartment', 'flowers', 'office'];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (used.has(`${x},${y}`)) continue;
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      put(fill[h % fill.length], x, y, 1 + (h % 4));
    }
  return { activated: true, hallLevel: 5, lastSettle: 0, boost: 0, rate: 0, score: 0n, pending: 0n, totalClaimed: 0n, buildings: out };
}
